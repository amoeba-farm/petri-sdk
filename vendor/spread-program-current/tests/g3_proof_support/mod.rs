use crate::g3_light_support::{govern, program};
use borsh::{BorshDeserialize, BorshSerialize};
use light_client::indexer::{AddressWithTree, Indexer};
use light_program_test::{indexer::TestIndexerExtensions, LightProgramTest, Rpc};
use light_sdk::{
    cpi::v2::{
        lowlevel::{CompressedAccountInfo, OutAccountInfo},
        LightSystemProgramCpi,
    },
    instruction::{account_meta::CompressedAccountMeta, PackedAccounts, SystemAccountMetaConfig},
    LightDiscriminator,
};
use light_token_minter::{
    compression::derive_compressed_state_leaf_address,
    constants::*,
    instruction::{
        CompressedStateAccess, CompressionOutput, ExecuteCompressedStateParams, VaultInstruction,
    },
    state::{CompressedAmebaStateLeaf, CompressedStateDomain},
    LIGHT_CPI_SIGNER,
};
use solana_sdk::{
    account::Account,
    address_lookup_table::{state::AddressLookupTable, AddressLookupTableAccount},
    instruction::{AccountMeta, Instruction},
    message::{v0, VersionedMessage},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::{Transaction, TransactionError, VersionedTransaction},
};
use solana_system_interface::program as system_program;

mod seed_encoding;

pub fn snapshot(rpc: &LightProgramTest, keys: &[Pubkey]) -> Vec<Option<Account>> {
    keys.iter().map(|k| rpc.context.get_account(k)).collect()
}

fn runtime_lookup_table(
    rpc: &mut LightProgramTest,
    payer: &Keypair,
    addresses: Vec<Pubkey>,
) -> AddressLookupTableAccount {
    use solana_sdk::{
        address_lookup_table::instruction as alt, clock::Clock, sysvar::slot_hashes::SlotHashes,
    };
    // A separate local authority gives each table a unique supported PDA even
    // when multiple transactions use the same recent slot. No table bytes are injected.
    rpc.context = rpc.context.clone().with_sigverify(true);
    let authority = Keypair::new();
    let recent = rpc.context.get_sysvar::<SlotHashes>().first().unwrap().0;
    let (create, key) = alt::create_lookup_table(authority.pubkey(), payer.pubkey(), recent);
    let mut instructions = vec![create];
    for chunk in addresses.chunks(20) {
        instructions.push(alt::extend_lookup_table(
            key,
            authority.pubkey(),
            Some(payer.pubkey()),
            chunk.to_vec(),
        ));
    }
    instructions.push(alt::freeze_lookup_table(key, authority.pubkey()));
    for instruction in instructions {
        let mut signers = vec![payer];
        if instruction
            .accounts
            .iter()
            .any(|m| m.pubkey == authority.pubkey() && m.is_signer)
        {
            signers.push(&authority);
        }
        let tx = Transaction::new_signed_with_payer(
            &[instruction],
            Some(&payer.pubkey()),
            &signers,
            rpc.context.latest_blockhash(),
        );
        assert!(bincode::serialize(&tx).unwrap().len() <= 1232);
        rpc.context
            .send_transaction(tx)
            .expect("real ALT create/extend/freeze");
        rpc.context.expire_blockhash();
    }
    let stored = rpc.context.get_account(&key).unwrap();
    let table = AddressLookupTable::deserialize(&stored.data).unwrap();
    assert_eq!(table.addresses.as_ref(), addresses.as_slice());
    assert_eq!(table.meta.authority, None);
    let mut clock = rpc.context.get_sysvar::<Clock>();
    clock.slot += 1;
    rpc.context.set_sysvar(&clock);
    println!(
        "real-proof-alt={key} entries={} bytes={} lamports={}",
        addresses.len(),
        stored.data.len(),
        stored.lamports
    );
    AddressLookupTableAccount { key, addresses }
}

// Unlike LightProgramTest's legacy-only convenience sender, execute the actual v0
// packet and index its emitted events. No synthetic successful events are inserted.
pub fn send(
    rpc: &mut LightProgramTest,
    payer: &Keypair,
    ix: Instruction,
    label: &str,
) -> Result<Vec<String>, TransactionError> {
    let ixs = [
        solana_sdk::compute_budget::ComputeBudgetInstruction::set_compute_unit_limit(1_400_000),
        ix,
    ];
    let mut addresses = ixs
        .iter()
        .flat_map(|i| i.accounts.iter())
        .filter(|a| !a.is_signer)
        .map(|a| a.pubkey)
        .collect::<Vec<_>>();
    addresses.sort();
    addresses.dedup();
    let table = runtime_lookup_table(rpc, payer, addresses);
    let message = v0::Message::try_compile(
        &payer.pubkey(),
        &ixs,
        std::slice::from_ref(&table),
        rpc.context.latest_blockhash(),
    )
    .unwrap();
    let mut keys = message.account_keys.clone();
    for lookup in &message.address_table_lookups {
        for i in &lookup.writable_indexes {
            keys.push(table.addresses[*i as usize]);
        }
    }
    for lookup in &message.address_table_lookups {
        for i in &lookup.readonly_indexes {
            keys.push(table.addresses[*i as usize]);
        }
    }
    let outer = message.instructions.clone();
    let tx = VersionedTransaction::try_new(VersionedMessage::V0(message), &[payer]).unwrap();
    let packet = bincode::serialize(&tx).unwrap().len();
    assert!(
        packet <= 1232,
        "{label}: packet {packet} exceeds Solana limit"
    );
    let result = rpc.context.send_transaction(tx);
    rpc.context.expire_blockhash();
    let meta = match result {
        Ok(m) => m,
        Err(e) => {
            println!("{label}: rejected {:?}\n{}", e.err, e.meta.logs.join("\n"));
            return Err(e.err);
        }
    };
    assert!(meta.compute_units_consumed <= 1_400_000);
    println!(
        "{label}: packet={packet} CU={}",
        meta.compute_units_consumed
    );
    let mut ids = Vec::new();
    let mut data = Vec::new();
    let mut accounts = Vec::new();
    for i in outer.iter().chain(
        meta.inner_instructions
            .iter()
            .flatten()
            .map(|i| &i.instruction),
    ) {
        ids.push(keys[i.program_id_index as usize].into());
        data.push(i.data.clone());
        accounts.push(
            i.accounts
                .iter()
                .map(|n| keys[*n as usize].into())
                .collect(),
        );
    }
    let events = light_event::parse::event_from_light_transaction(&ids, &data, accounts).unwrap();
    if let Some(events) = events {
        let slot = rpc.context.get_sysvar::<solana_sdk::clock::Clock>().slot;
        for e in events {
            rpc.indexer
                .as_mut()
                .unwrap()
                .add_compressed_accounts_with_token_data(slot, &e.event);
        }
    }
    Ok(meta.logs)
}

pub fn leaf(
    domain: CompressedStateDomain,
    canonical_pda: Pubkey,
    data: Vec<u8>,
) -> CompressedAmebaStateLeaf {
    assert_eq!(data.len(), domain.compact_data_len());
    CompressedAmebaStateLeaf {
        schema_version: CompressedAmebaStateLeaf::CURRENT_SCHEMA_VERSION,
        domain,
        canonical_pda,
        revision: 0,
        data,
    }
}
pub fn address(leaf: &CompressedAmebaStateLeaf) -> [u8; 32] {
    derive_compressed_state_leaf_address(
        &program(),
        &LIGHT_DEFAULT_ADDRESS_TREE_V2,
        leaf.domain,
        &leaf.canonical_pda,
    )
    .0
}
pub async fn read(
    rpc: &LightProgramTest,
    original: &CompressedAmebaStateLeaf,
) -> CompressedAmebaStateLeaf {
    let c = rpc
        .get_compressed_account(address(original), None)
        .await
        .unwrap()
        .value
        .unwrap();
    assert_eq!(c.owner, program());
    CompressedAmebaStateLeaf::try_from_slice(&c.data.unwrap().data).unwrap()
}

// Only genesis prerequisites use this fixture executable. Leaf creation still
// executes the installed Light verifier/tree programs and obtains real proofs.
// Restore the production ELF before constructing or executing the tested operation.
pub async fn seed(
    rpc: &mut LightProgramTest,
    payer: &Keypair,
    leaves: &[CompressedAmebaStateLeaf],
) {
    let fixture = std::fs::read(std::env::var("AMEBA_COMPRESSED_FIXTURE_SBF").unwrap()).unwrap();
    rpc.context.add_program(program(), &fixture).unwrap();
    for leaf in leaves {
        let (address, seed) = derive_compressed_state_leaf_address(
            &program(),
            &LIGHT_DEFAULT_ADDRESS_TREE_V2,
            leaf.domain,
            &leaf.canonical_pda,
        );
        let proof = rpc
            .get_validity_proof(
                vec![],
                vec![AddressWithTree {
                    address,
                    tree: LIGHT_DEFAULT_ADDRESS_TREE_V2,
                }],
                None,
            )
            .await
            .unwrap()
            .value;
        assert!(
            proof.proof.0.is_some(),
            "fixture creation requires actual non-inclusion proof"
        );
        let mut packed = PackedAccounts::default();
        packed
            .add_system_accounts_v2(SystemAccountMetaConfig::new(program()))
            .unwrap();
        let output = rpc
            .get_random_state_tree_info()
            .unwrap()
            .pack_output_tree_index(&mut packed)
            .unwrap();
        let trees = proof.pack_tree_infos(&mut packed);
        let mut cpi = LightSystemProgramCpi::new(
            LIGHT_CPI_SIGNER.program_id.into(),
            LIGHT_CPI_SIGNER.bump,
            proof.proof.0,
        );
        let data = leaf.try_to_vec().unwrap();
        let mut data_hash = solana_sdk::hash::hash(&data).to_bytes();
        data_hash[0] = 0;
        cpi.account_infos.push(CompressedAccountInfo {
            address: Some(address),
            input: None,
            output: Some(OutAccountInfo {
                discriminator: CompressedAmebaStateLeaf::LIGHT_DISCRIMINATOR,
                data_hash,
                output_merkle_tree_index: output,
                lamports: 0,
                data,
            }),
        });
        cpi.new_address_params
            .push(trees.address_trees[0].into_new_address_params_assigned_packed(seed, Some(0)));
        let (mut metas, _, _) = packed.to_account_metas();
        metas.insert(1, AccountMeta::new(payer.pubkey(), true));
        send(
            rpc,
            payer,
            Instruction {
                program_id: program(),
                accounts: metas,
                data: seed_encoding::encode(&cpi),
            },
            "fixture_leaf_create",
        )
        .unwrap();
        assert_eq!(read(rpc, leaf).await, *leaf);
    }
    let elf = std::fs::read(
        std::path::Path::new(&std::env::var("SBF_OUT_DIR").unwrap()).join("light_token_minter.so"),
    )
    .unwrap();
    let hash = solana_sdk::hash::hash(&elf)
        .to_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    assert_eq!(hash, std::env::var("AMEBA_TESTED_SBF_SHA256").unwrap());
    rpc.context.add_program(program(), &elf).unwrap();
    println!("restored production SBF sha256={hash}");
}

pub async fn emergency_instruction(
    rpc: &LightProgramTest,
    core: Vec<AccountMeta>,
    inputs: &[CompressedAmebaStateLeaf],
    checkpoint: Pubkey,
    inner_instruction: Vec<u8>,
) -> Instruction {
    let with_checkpoint = core.len() == 17;
    let mut hashes = Vec::new();
    for leaf in inputs {
        hashes.push(
            rpc.get_compressed_account(address(leaf), None)
                .await
                .unwrap()
                .value
                .unwrap()
                .hash,
        );
    }
    let checkpoint_address = derive_compressed_state_leaf_address(
        &program(),
        &LIGHT_DEFAULT_ADDRESS_TREE_V2,
        CompressedStateDomain::OracleCarryCheckpoint,
        &checkpoint,
    )
    .0;
    let proof = rpc
        .get_validity_proof(
            hashes,
            if with_checkpoint {
                vec![AddressWithTree {
                    address: checkpoint_address,
                    tree: LIGHT_DEFAULT_ADDRESS_TREE_V2,
                }]
            } else {
                vec![]
            },
            None,
        )
        .await
        .unwrap()
        .value;
    if with_checkpoint {
        assert!(proof.proof.0.is_some());
    }
    let mut packed = PackedAccounts::default();
    packed
        .add_system_accounts_v2(SystemAccountMetaConfig::new(program()))
        .unwrap();
    let trees = proof.pack_tree_infos(&mut packed);
    let states = trees.state_trees.unwrap();
    let mut accesses: Vec<_> = inputs
        .iter()
        .enumerate()
        .map(|(i, leaf)| CompressedStateAccess::Mutable {
            account_index: [9, 10, 14][i],
            meta: CompressedAccountMeta {
                tree_info: states.packed_tree_infos[i],
                address: address(leaf),
                output_state_tree_index: states.output_tree_index,
            },
            leaf: leaf.clone(),
        })
        .collect();
    if with_checkpoint {
        accesses.push(CompressedStateAccess::Initialize {
            account_index: 15,
            domain: CompressedStateDomain::OracleCarryCheckpoint,
            output: CompressionOutput {
                address_tree_info: trees.address_trees[0],
                output_state_tree_index: states.output_tree_index,
            },
        });
    }
    let params = ExecuteCompressedStateParams {
        core_account_count: core.len() as u8,
        rent_payer_index: 0,
        proof: proof.proof.into(),
        accesses,
        inner_instruction,
    };
    let mut metas = core;
    metas.push(AccountMeta::new_readonly(system_program::id(), false));
    metas.extend(packed.to_account_metas().0);
    let mut instruction = govern(metas, VaultInstruction::ExecuteCompressedStateV1 { params });
    if with_checkpoint {
        // Same lossless contextual wire used by the bundled proof builder. The
        // production runtime reconstructs omitted bytes before real Light verification.
        for leaf in inputs.iter().filter(|l| {
            matches!(
                l.domain,
                CompressedStateDomain::OracleSourceState
                    | CompressedStateDomain::OracleCarryJournal
            )
        }) {
            let mut full = vec![leaf.domain as u8];
            full.extend(leaf.revision.to_le_bytes());
            full.extend(&leaf.data);
            let offset = instruction
                .data
                .windows(full.len())
                .position(|w| w == full)
                .unwrap();
            let mut compact = vec![leaf.domain as u8 | 0x80];
            compact.extend(leaf.revision.to_le_bytes());
            if leaf.domain == CompressedStateDomain::OracleSourceState {
                compact.extend(&leaf.data[64..96]);
                compact.extend(&leaf.data[112..130]);
                compact.extend(&leaf.data[132..216]);
            } else {
                compact.extend(&leaf.data[38..70]);
                compact.extend(&leaf.data[102..106]);
            }
            instruction
                .data
                .splice(offset..offset + full.len(), compact);
        }
    }
    instruction
}

pub async fn readonly_instruction(
    rpc: &LightProgramTest,
    mut core: Vec<AccountMeta>,
    inputs: &[(u8, CompressedAmebaStateLeaf)],
    inner: Vec<u8>,
) -> Instruction {
    let mut hashes = Vec::new();
    for (_, leaf) in inputs {
        hashes.push(
            rpc.get_compressed_account(address(leaf), None)
                .await
                .unwrap()
                .value
                .unwrap()
                .hash,
        );
    }
    let proof = rpc
        .get_validity_proof(hashes, vec![], None)
        .await
        .unwrap()
        .value;
    let mut packed = PackedAccounts::default();
    packed
        .add_system_accounts_v2(SystemAccountMetaConfig::new(program()))
        .unwrap();
    let trees = proof.pack_tree_infos(&mut packed);
    let states = trees.state_trees.unwrap();
    let accesses = inputs
        .iter()
        .enumerate()
        .map(|(i, (index, leaf))| {
            core[usize::from(*index)].is_writable = true;
            CompressedStateAccess::ReadOnly {
                account_index: *index,
                meta: light_sdk::instruction::account_meta::CompressedAccountMetaReadOnly {
                    tree_info: states.packed_tree_infos[i],
                    address: address(leaf),
                },
                leaf: leaf.clone(),
            }
        })
        .collect();
    let params = ExecuteCompressedStateParams {
        core_account_count: core.len() as u8,
        rent_payer_index: 0,
        proof: proof.proof.into(),
        accesses,
        inner_instruction: inner,
    };
    core.push(AccountMeta::new_readonly(system_program::id(), false));
    core.extend(packed.to_account_metas().0);
    govern(core, VaultInstruction::ExecuteCompressedStateV1 { params })
}

/// Actual mixed read/mutate/create proof transport for lifecycle qualification.
pub async fn mixed_instruction(
    rpc: &LightProgramTest,
    mut core: Vec<AccountMeta>,
    inputs: &[(u8, bool, CompressedAmebaStateLeaf)],
    creates: &[(u8, CompressedStateDomain, Pubkey)],
    inner: Vec<u8>,
) -> Instruction {
    let mut hashes = Vec::new();
    for (_, _, leaf) in inputs {
        hashes.push(
            rpc.get_compressed_account(address(leaf), None)
                .await
                .unwrap()
                .value
                .unwrap()
                .hash,
        );
    }
    let new: Vec<_> = creates
        .iter()
        .map(|(_, domain, key)| AddressWithTree {
            address: derive_compressed_state_leaf_address(
                &program(),
                &LIGHT_DEFAULT_ADDRESS_TREE_V2,
                *domain,
                key,
            )
            .0,
            tree: LIGHT_DEFAULT_ADDRESS_TREE_V2,
        })
        .collect();
    let proof = rpc
        .get_validity_proof(hashes, new, None)
        .await
        .unwrap()
        .value;
    let mut packed = PackedAccounts::default();
    packed
        .add_system_accounts_v2(SystemAccountMetaConfig::new(program()))
        .unwrap();
    let output = rpc
        .get_random_state_tree_info()
        .unwrap()
        .pack_output_tree_index(&mut packed)
        .unwrap();
    let trees = proof.pack_tree_infos(&mut packed);
    let mut accesses = Vec::new();
    for (i, (index, mutable, leaf)) in inputs.iter().enumerate() {
        core[*index as usize].is_writable = true;
        let tree_info = trees.state_trees.as_ref().unwrap().packed_tree_infos[i];
        accesses.push(if *mutable {
            CompressedStateAccess::Mutable {
                account_index: *index,
                meta: CompressedAccountMeta {
                    tree_info,
                    address: address(leaf),
                    output_state_tree_index: output,
                },
                leaf: leaf.clone(),
            }
        } else {
            CompressedStateAccess::ReadOnly {
                account_index: *index,
                meta: light_sdk::instruction::account_meta::CompressedAccountMetaReadOnly {
                    tree_info,
                    address: address(leaf),
                },
                leaf: leaf.clone(),
            }
        });
    }
    for (i, (index, domain, _)) in creates.iter().enumerate() {
        accesses.push(CompressedStateAccess::Initialize {
            account_index: *index,
            domain: *domain,
            output: CompressionOutput {
                address_tree_info: trees.address_trees[i],
                output_state_tree_index: output,
            },
        });
    }
    // These lifecycle contracts follow ascending core-account order.
    accesses.sort_by_key(|access| access.account_index());
    let params = ExecuteCompressedStateParams {
        core_account_count: core.len() as u8,
        rent_payer_index: 0,
        proof: proof.proof.into(),
        accesses,
        inner_instruction: inner,
    };
    core.push(AccountMeta::new_readonly(system_program::id(), false));
    core.extend(packed.to_account_metas().0);
    govern(core, VaultInstruction::ExecuteCompressedStateV1 { params })
}
