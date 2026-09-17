//! web3.js 1.98 Message.compile order: first occurrence, then signer/writable groups.
//! Rust's default compiler sorts some keys differently; wallet bytes require the JS ordering.
use solana_message::{
    AddressLookupTableAccount, MessageHeader, VersionedMessage,
    compiled_instruction::CompiledInstruction, legacy, v0,
};
use solana_program::{hash::Hash, instruction::Instruction, pubkey::Pubkey};

#[derive(Clone)]
struct Key {
    address: Pubkey,
    signer: bool,
    writable: bool,
    invoked: bool,
}
fn touch(keys: &mut Vec<Key>, address: Pubkey, signer: bool, writable: bool, invoked: bool) {
    if let Some(k) = keys.iter_mut().find(|k| k.address == address) {
        k.signer |= signer;
        k.writable |= writable;
        k.invoked |= invoked;
    } else {
        keys.push(Key {
            address,
            signer,
            writable,
            invoked,
        });
    }
}
pub(super) fn compile(
    owner: Pubkey,
    expected: &[Instruction],
    tables: &[AddressLookupTableAccount],
    blockhash: Hash,
    versioned: bool,
) -> Result<VersionedMessage, String> {
    let mut keys = vec![];
    touch(&mut keys, owner, true, true, false);
    for ix in expected {
        touch(&mut keys, ix.program_id, false, false, true);
        for k in &ix.accounts {
            touch(&mut keys, k.pubkey, k.is_signer, k.is_writable, false);
        }
    }
    if keys.len() > 256 {
        return Err("G3 account index overflow".into());
    }
    let mut writable_loaded = vec![];
    let mut readonly_loaded = vec![];
    let mut lookups = vec![];
    for table in tables {
        let mut writable_indexes = vec![];
        let mut readonly_indexes = vec![];
        for writable in [true, false] {
            let mut retained = vec![];
            for k in keys {
                let index = if !k.signer && !k.invoked && k.writable == writable {
                    table.addresses.iter().position(|a| *a == k.address)
                } else {
                    None
                };
                if let Some(index) = index {
                    let index = u8::try_from(index).map_err(|_| "G3 lookup index overflow")?;
                    if writable {
                        writable_indexes.push(index);
                        writable_loaded.push(k.address);
                    } else {
                        readonly_indexes.push(index);
                        readonly_loaded.push(k.address);
                    }
                } else {
                    retained.push(k);
                }
            }
            keys = retained;
        }
        if !writable_indexes.is_empty() || !readonly_indexes.is_empty() {
            lookups.push(v0::MessageAddressTableLookup {
                account_key: table.key,
                writable_indexes,
                readonly_indexes,
            });
        }
    }
    let mut static_keys = vec![];
    for (signer, writable) in [(true, true), (true, false), (false, true), (false, false)] {
        static_keys.extend(
            keys.iter()
                .filter(|k| k.signer == signer && k.writable == writable)
                .map(|k| k.address),
        );
    }
    let header = MessageHeader {
        num_required_signatures: u8::try_from(keys.iter().filter(|k| k.signer).count())
            .map_err(|_| "G3 signer overflow")?,
        num_readonly_signed_accounts: u8::try_from(
            keys.iter().filter(|k| k.signer && !k.writable).count(),
        )
        .map_err(|_| "G3 readonly overflow")?,
        num_readonly_unsigned_accounts: u8::try_from(
            keys.iter().filter(|k| !k.signer && !k.writable).count(),
        )
        .map_err(|_| "G3 readonly overflow")?,
    };
    let all: Vec<Pubkey> = static_keys
        .iter()
        .chain(&writable_loaded)
        .chain(&readonly_loaded)
        .copied()
        .collect();
    let index = |key: &Pubkey| {
        all.iter()
            .position(|k| k == key)
            .and_then(|v| u8::try_from(v).ok())
            .ok_or("G3 missing account".to_string())
    };
    let instructions = expected
        .iter()
        .map(|ix| {
            Ok(CompiledInstruction {
                program_id_index: index(&ix.program_id)?,
                accounts: ix
                    .accounts
                    .iter()
                    .map(|m| index(&m.pubkey))
                    .collect::<Result<_, _>>()?,
                data: ix.data.clone(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(if versioned {
        VersionedMessage::V0(v0::Message {
            header,
            account_keys: static_keys,
            recent_blockhash: blockhash,
            instructions,
            address_table_lookups: lookups,
        })
    } else {
        VersionedMessage::Legacy(legacy::Message {
            header,
            account_keys: static_keys,
            recent_blockhash: blockhash,
            instructions,
        })
    })
}
