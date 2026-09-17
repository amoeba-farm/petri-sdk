//! Actual Mainnet-profile SBF / public package messages. Market, config, economics,
//! product manifest and governance gate are explicit prerequisite fixtures.
//! This is not a full fresh-bootstrap/trading/settlement qualification.
#![cfg(feature = "mainnet-v3")]
#[allow(dead_code)]
mod g3_light_support;
use borsh::BorshDeserialize;
use g3_light_support::*;
use light_program_test::{LightProgramTest, Rpc};
use light_token_minter::{constants::*, governance_gate::*, state::*};
use solana_sdk::{clock::Clock, pubkey::Pubkey, transaction::Transaction};
use std::io::Write;

fn text32(s: &str) -> [u8; 32] {
    let mut b = [0; 32];
    b[..s.len()].copy_from_slice(s.as_bytes());
    b
}
fn set_time(rpc: &mut LightProgramTest, ts: u64) {
    let mut c = rpc.context.get_sysvar::<Clock>();
    c.unix_timestamp = ts as i64;
    c.slot += 1;
    rpc.context.set_sysvar(&c);
    rpc.context.expire_blockhash();
}
fn prerequisites(rpc: &mut LightProgramTest, authority: Pubkey) {
    let (config, bump) = pda(&[VAULT_PDA_SEED]);
    install(
        rpc,
        config,
        &VaultConfig {
            is_initialized: true,
            bump,
            admin: Pubkey::new_unique(),
            oracle_authority: authority,
            usdc_mint: Pubkey::new_unique(),
            vault_token_account: Pubkey::new_unique(),
            paused: true,
            account_discriminator: VaultConfig::ACCOUNT_DISCRIMINATOR,
            account_version: VaultConfig::ACCOUNT_VERSION,
        },
        VaultConfig::LEN,
    );
    let (economics, bump) = pda(&[ORACLE_ECONOMICS_CONFIG_PDA_SEED]);
    install(
        rpc,
        economics,
        &OracleEconomicsConfig {
            is_initialized: true,
            bump,
            account_discriminator: OracleEconomicsConfig::ACCOUNT_DISCRIMINATOR,
            account_version: OracleEconomicsConfig::ACCOUNT_VERSION,
            config_version: 1,
            economics: OracleEconomicParams::default(),
            last_updated_slot: 1,
        },
        OracleEconomicsConfig::LEN,
    );
}
fn market(
    rpc: &mut LightProgramTest,
    product: &str,
    month: u32,
    put: bool,
) -> (Pubkey, [u8; 32], u64, u16) {
    let underlying = text32(if product == "RAMX" {
        "ram-standardized-baskets"
    } else {
        "nand-standardized-baskets"
    });
    let count = if product == "RAMX" { 52 } else { 48 };
    let expiry = if month == 202609 {
        1_790_812_800u64
    } else {
        1_793_491_200u64
    };
    let id = text32(&format!(
        "{product}-{month}-{}-01",
        if put { "PUT" } else { "CALL" }
    ));
    let (key, bump) = pda(&[MARKET_PDA_SEED, &id]);
    install(
        rpc,
        key,
        &Market {
            is_initialized: true,
            bump,
            market_id: id,
            long_contract_mint: Some(Pubkey::new_unique()),
            mint_accounting: MarketMintAccounting::canonical_empty(),
            instrument: InstrumentDefinition {
                underlying_id: underlying,
                expiry_ts: expiry,
                kind: if put {
                    OptionKind::PutSpread
                } else {
                    OptionKind::CallSpread
                },
                ..Default::default()
            },
            ..Default::default()
        },
        Market::LEN,
    );
    let (manifest, bump) = derive_oracle_product_sku_manifest_pda(&program(), &underlying);
    install(
        rpc,
        manifest,
        &OracleProductSkuManifest {
            is_initialized: true,
            bump,
            account_discriminator: OracleProductSkuManifest::ACCOUNT_DISCRIMINATOR,
            account_version: OracleProductSkuManifest::ACCOUNT_VERSION,
            underlying_id: underlying,
            required_sku_root: [7; 32],
            required_sku_count: count,
            reserved: [0; 6],
            last_updated_slot: 1,
        },
        OracleProductSkuManifest::LEN,
    );
    (key, underlying, expiry, count)
}
fn transaction(
    rpc: &LightProgramTest,
    payer: &Keypair,
    authority: &Keypair,
    m: (Pubkey, [u8; 32], u64, u16),
) -> Transaction {
    let x = serde_json::json!({"program":program().to_string(),"controller":PINNED_CONTROLLER_PROGRAM_ID.to_string(),"gate":PINNED_PROTOCOL_GATE_PDA.to_string(),"gateData":rpc.context.get_account(&PINNED_PROTOCOL_GATE_PDA).unwrap().data,"slot":rpc.context.get_sysvar::<Clock>().slot,"authority":authority.pubkey().to_string(),"payer":payer.pubkey().to_string(),"market":m.0.to_string(),"underlying":m.1,"expiry":m.2.to_string(),"count":m.3,"root":vec![7u8;32],"blockhash":rpc.context.latest_blockhash().to_string()});
    let mut child = std::process::Command::new("node")
        .arg(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../tools/launch-schedule-test-driver.mjs"),
        )
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(&serde_json::to_vec(&x).unwrap())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let bytes: Vec<u8> = serde_json::from_value(v["transaction"].clone()).unwrap();
    assert!(bytes.len() <= 1232);
    let mut tx: Transaction = bincode::deserialize(&bytes).unwrap();
    let message = tx.message_data();
    if payer.pubkey() == authority.pubkey() {
        tx.sign(&[payer], rpc.context.latest_blockhash());
    } else {
        tx.sign(&[payer, authority], rpc.context.latest_blockhash());
    }
    assert_eq!(message, tx.message_data());
    tx
}
fn stored_month(rpc: &LightProgramTest, m: (Pubkey, [u8; 32], u64, u16)) -> OracleMonthState {
    let bytes = rpc
        .context
        .get_account(&pda(&[ORACLE_MONTH_PDA_SEED, m.0.as_ref(), &m.2.to_le_bytes()]).0)
        .unwrap()
        .data;
    {
        let mut remaining = bytes.as_slice();
        let month = OracleMonthState::deserialize(&mut remaining).unwrap();
        assert!(remaining.iter().all(|b| *b == 0));
        month
    }
}

#[tokio::test]
async fn mainnet_launch_all_four_cohorts_share_clock_and_reject_reset_and_wrong_authority() {
    let mut rpc = start().await;
    rpc.context = rpc.context.with_sigverify(true);
    let payer = rpc.get_payer().insecure_clone();
    prerequisites(&mut rpc, payer.pubkey());
    for product in ["RAMX", "NANDX"] {
        for month in [202609, 202610] {
            // October initializes after the old Devnet October-1 sunset.
            let start = if month == 202609 {
                1_789_516_800
            } else {
                1_791_072_000
            };
            set_time(&mut rpc, start);
            let call = market(&mut rpc, product, month, false);
            let wrong = Keypair::new();
            let tx = transaction(&rpc, &payer, &wrong, call);
            assert!(rpc.context.send_transaction(tx).is_err());
            assert!(rpc
                .context
                .get_account(
                    &pda(&[
                        ORACLE_MONTH_PDA_SEED,
                        call.0.as_ref(),
                        &call.2.to_le_bytes()
                    ])
                    .0
                )
                .is_none());
            let tx = transaction(&rpc, &payer, &payer, call);
            let result = rpc.context.send_transaction(tx).unwrap();
            println!(
                "launch {product} {month} compute_units={}",
                result.compute_units_consumed
            );
            let before = stored_month(&rpc, call);
            assert_eq!(before.schedule_version, 3);
            assert_eq!(before.scramble_start_ts, start);
            assert_eq!(before.listing_ts, start + 14_400);
            set_time(&mut rpc, start + 100);
            let tx = transaction(&rpc, &payer, &payer, call);
            assert!(rpc.context.send_transaction(tx).is_err());
            assert_eq!(stored_month(&rpc, call), before);
            let put = market(&mut rpc, product, month, true);
            let tx = transaction(&rpc, &payer, &payer, put);
            rpc.context.send_transaction(tx).unwrap();
            let paired = stored_month(&rpc, put);
            assert_eq!(paired.scramble_start_ts, start);
            assert_eq!(paired.listing_ts, before.listing_ts);
            assert!(rpc
                .context
                .get_account(&derive_oracle_maturity_ladder_registry_pda(&program(), &call.1).0)
                .is_none());
        }
    }
}

#[tokio::test]
async fn mainnet_launch_strict_expiry_minus_four_hours_boundaries() {
    for month in [202609, 202610] {
        for delta in [-1i64, 0, 1] {
            let mut rpc = start().await;
            rpc.context = rpc.context.with_sigverify(true);
            let payer = rpc.get_payer().insecure_clone();
            prerequisites(&mut rpc, payer.pubkey());
            let m = market(&mut rpc, "RAMX", month, false);
            set_time(&mut rpc, ((m.2 - 14_400) as i64 + delta) as u64);
            let tx = transaction(&rpc, &payer, &payer, m);
            let result = rpc.context.send_transaction(tx);
            assert_eq!(
                result.is_ok(),
                delta == -1,
                "month={month},delta={delta}: {result:?}"
            );
            if delta >= 0 {
                assert!(rpc
                    .context
                    .get_account(&pda(&[ORACLE_MONTH_PDA_SEED, m.0.as_ref(), &m.2.to_le_bytes()]).0)
                    .is_none());
                let clock = pda(&[b"g3-launch-clock-v1", &m.1, &m.2.to_le_bytes()]).0;
                assert!(rpc.context.get_account(&clock).is_none());
            }
        }
    }
}
