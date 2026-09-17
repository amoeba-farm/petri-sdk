//! Supported ALT transactions and unchanged packaged-client messages.
//! The enclosing market fixture remains explicitly prepared intermediate state.
use crate::g3_light_support::*;
use light_token_minter::{dlmm_order_state::DlmmOrderAction, governance_gate::*};
use solana_sdk::{
    address_lookup_table::state::AddressLookupTable,
    clock::Clock,
    instruction::Instruction,
    pubkey::Pubkey,
    sysvar::slot_hashes::SlotHashes,
    transaction::{Transaction, VersionedTransaction},
};
use std::io::Write;

pub struct RealTransport {
    pub lookup: Pubkey,
}
impl RealTransport {
    pub fn create(rpc: &mut light_program_test::LightProgramTest, payer: &Keypair) -> Self {
        assert!(
            rpc.context.get_sigverify(),
            "signature verification must be enabled"
        );
        let slots = rpc.context.get_sysvar::<SlotHashes>();
        let slot = slots.first().expect("runtime slot hashes").0;
        let (ix, lookup) = solana_sdk::address_lookup_table::instruction::create_lookup_table(
            payer.pubkey(),
            payer.pubkey(),
            slot,
        );
        Self::setup(rpc, payer, ix);
        Self { lookup }
    }
    fn setup(rpc: &mut light_program_test::LightProgramTest, payer: &Keypair, ix: Instruction) {
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&payer.pubkey()),
            &[payer],
            rpc.context.latest_blockhash(),
        );
        rpc.context
            .send_transaction(tx)
            .expect("supported lookup table operation");
        rpc.context.expire_blockhash();
    }
    pub fn extend(
        &self,
        rpc: &mut light_program_test::LightProgramTest,
        payer: &Keypair,
        addresses: &[Pubkey],
    ) {
        let account = rpc.context.get_account(&self.lookup).unwrap();
        let table = AddressLookupTable::deserialize(&account.data).unwrap();
        let missing = addresses
            .iter()
            .copied()
            .filter(|k| !table.addresses.contains(k))
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        for chunk in missing.chunks(20) {
            Self::setup(
                rpc,
                payer,
                solana_sdk::address_lookup_table::instruction::extend_lookup_table(
                    self.lookup,
                    payer.pubkey(),
                    Some(payer.pubkey()),
                    chunk.to_vec(),
                ),
            );
        }
        let mut clock = rpc.context.get_sysvar::<Clock>();
        clock.slot += 1; // ALT warmup; unix_timestamp and business deadlines are unchanged.
        rpc.context.set_sysvar(&clock);
    }
    pub fn freeze(&self, rpc: &mut light_program_test::LightProgramTest, payer: &Keypair) {
        Self::setup(
            rpc,
            payer,
            solana_sdk::address_lookup_table::instruction::freeze_lookup_table(
                self.lookup,
                payer.pubkey(),
            ),
        );
    }
    pub fn package_transaction(
        &self,
        f: &MarketFixture,
        owner: &Keypair,
        request: serde_json::Value,
        records: &[Pubkey],
    ) -> VersionedTransaction {
        let base = f.order_instruction(owner, DlmmOrderAction::Initialize, &[]);
        let names = [
            "trader",
            "vaultConfig",
            "market",
            "oracleMonth",
            "writerSleeve",
            "writerSettlementGroup",
            "writerSeriesBook",
            "pool",
            "authority",
            "optionMint",
            "quoteMint",
            "optionVault",
            "quoteVault",
            "traderOptionAccount",
            "traderQuoteAccount",
            "lightTokenProgram",
            "lightCpiAuthority",
            "optionInterface",
            "quoteInterface",
            "splTokenProgram",
            "_system",
            "lightCompressibleConfig",
            "lightRentSponsor",
            "_delegate",
            "_policy",
            "writerPolicySnapshot",
            "_position",
            "writerSleeveUsdcVault",
            "writerMarketStaging",
            "writerRetirementCustody",
            "writerPolicyRegistry",
        ];
        let mut accounts = serde_json::Map::new();
        for (name, meta) in names.iter().zip(&base.accounts) {
            if !name.starts_with('_') {
                accounts.insert(name.to_string(), serde_json::json!(meta.pubkey.to_string()));
            }
        }
        accounts.insert("reservePages".into(), serde_json::json!([]));
        let data = f.rpc.context.get_account(&self.lookup).unwrap();
        let table = AddressLookupTable::deserialize(&data.data).unwrap();
        let input = serde_json::json!({
            "program": program().to_string(), "controller": PINNED_CONTROLLER_PROGRAM_ID.to_string(),
            "gate": PINNED_PROTOCOL_GATE_PDA.to_string(),
            "gateData": f.rpc.context.get_account(&PINNED_PROTOCOL_GATE_PDA).unwrap().data,
            "slot": f.rpc.context.get_sysvar::<Clock>().slot,
            "poolData": f.rpc.context.get_account(&f.pool).unwrap().data,
            "accounts": accounts, "request": request, "records": records.iter().map(ToString::to_string).collect::<Vec<_>>(),
            "blockhash": f.rpc.context.latest_blockhash().to_string(),
            "lookup": {"key": self.lookup.to_string(), "deactivationSlot": table.meta.deactivation_slot.to_string(),
                "lastExtendedSlot": table.meta.last_extended_slot, "lastExtendedSlotStartIndex": table.meta.last_extended_slot_start_index,
                "authority": table.meta.authority.map(|k| k.to_string()), "addresses": table.addresses.iter().map(ToString::to_string).collect::<Vec<_>>()}
        });
        let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tools/g3-closure-package-driver.mjs");
        let mut child = std::process::Command::new("node")
            .arg(script)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(&serde_json::to_vec(&input).unwrap())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "packaged builder: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let output: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        let raw: Vec<u8> = serde_json::from_value(output["transaction"].clone()).unwrap();
        assert!(raw.len() <= 1232);
        let unsigned: VersionedTransaction = bincode::deserialize(&raw).unwrap();
        let message = unsigned.message.serialize();
        let signed = VersionedTransaction::try_new(unsigned.message, &[owner]).unwrap();
        assert_eq!(
            signed.message.serialize(),
            message,
            "never rewrite a validated message"
        );
        signed
    }
}
