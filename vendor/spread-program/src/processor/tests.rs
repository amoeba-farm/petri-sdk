use super::*;
use crate::state::{InstrumentDefinition, OptionKind, SettlementStyle};
use borsh::BorshSerialize;
use solana_program::program_pack::Pack;
use spl_token::state::{
    Account as SplTokenAccount, AccountState as SplAccountState, Mint as SplMint,
};

const PROCESSOR_SOURCE: &str = concat!(
    include_str!("../processor.rs"),
    include_str!("account_addresses.rs"),
    include_str!("account_io.rs"),
    include_str!("account_io_tokens.rs"),
    include_str!("active_weights.rs"),
    include_str!("ameba_dlmm.rs"),
    include_str!("ameba_dlmm_light.rs"),
    include_str!("compressed_state.rs"),
    include_str!("instruction_adapters.rs"),
    include_str!("instruction_dispatch.rs"),
    include_str!("instruction_payloads.rs"),
    include_str!("market_settlement.rs"),
    include_str!("market_admin.rs"),
    include_str!("oracle_economics.rs"),
    include_str!("oracle_rules.rs"),
    include_str!("oracle_samba_pot.rs"),
    include_str!("oracle_schedule_validation.rs"),
    include_str!("oracle_state_validation.rs"),
    include_str!("oracle_usdc.rs"),
    include_str!("oracle_usdc_rewards.rs"),
    include_str!("oracle_validation.rs"),
    include_str!("recipe_weights.rs"),
    include_str!("collateral_accounts.rs"),
    include_str!("settlement_signers.rs"),
    include_str!("settlement_sources.rs"),
    include_str!("settlement_validation.rs"),
    include_str!("sku_coverage.rs"),
    include_str!("sku_coverage_resolution.rs"),
    include_str!("sku_manifest.rs"),
    include_str!("staking.rs"),
    include_str!("staking_lifecycle.rs"),
    include_str!("staking_validation.rs"),
    include_str!("vault_core.rs"),
    include_str!("writer_sleeve.rs"),
    include_str!("writer_sleeve/accounts.rs"),
    include_str!("writer_sleeve/auction.rs"),
    include_str!("writer_sleeve/close.rs"),
    include_str!("writer_sleeve/funding.rs"),
    include_str!("writer_sleeve/reconcile.rs"),
    include_str!("writer_sleeve/settlement.rs"),
);

mod account_loading;
mod config_governance;
mod market_settlement;
mod opening_settlement;
mod schedule;
mod sku_coverage;
mod source_weights;
mod staking_economics;
mod stale_cleanup;

#[test]
#[cfg(not(feature = "governance-gate-v1"))]
fn compressed_inner_rejects_a_nested_governance_tail_before_business_dispatch() {
    let mut inner = vec![crate::instruction::VaultInstructionTag::UpdateConfig as u8];
    inner.extend_from_slice(
        &crate::governance_gate::GovernanceInstructionTailV1::for_epoch(41).encode(),
    );
    let capability = crate::governance_gate::test_capability(41);
    assert_eq!(
        process_compressed_inner_instruction(&crate::id(), &[], &inner, &capability),
        Err(VaultError::InvalidGovernanceTail.into())
    );
}
mod writer_sleeve_lifecycle;

fn with_test_account_info<R>(
    key: &Pubkey,
    owner: &Pubkey,
    mut data: Vec<u8>,
    f: impl FnOnce(&AccountInfo) -> R,
) -> R {
    let mut lamports = 0;
    let account = AccountInfo::new(key, false, false, &mut lamports, &mut data, owner, false, 0);
    f(&account)
}

fn validate_test_creation_target(
    program_id: &Pubkey,
    owner: &Pubkey,
    is_writable: bool,
    executable: bool,
    data_len: usize,
) -> ProgramResult {
    let key = Pubkey::new_unique();
    let mut lamports = 1;
    let mut data = vec![0; data_len];
    let account = AccountInfo::new(
        &key,
        false,
        is_writable,
        &mut lamports,
        &mut data,
        owner,
        executable,
        0,
    );
    validate_create_only_program_account_target(program_id, &account)
}

fn exact_test_state_data<T: BorshSerialize>(value: &T, len: usize) -> Vec<u8> {
    let serialized = value.try_to_vec().unwrap();
    assert!(serialized.len() <= len);
    let mut data = vec![0; len];
    data[..serialized.len()].copy_from_slice(&serialized);
    data
}

#[allow(clippy::too_many_arguments)]
fn run_test_update_config(
    mut config: VaultConfig,
    stored_bump_delta: u8,
    is_initialized: bool,
    new_admin: Option<Pubkey>,
    new_oracle_authority: Option<Pubkey>,
    new_usdc_mint: Option<Pubkey>,
    new_vault_token_account: Option<Pubkey>,
    paused: Option<bool>,
) -> (ProgramResult, VaultConfig, VaultConfig) {
    let program_id = Pubkey::new_unique();
    let (config_key, config_bump) =
        Pubkey::find_program_address(&[CURRENT_STATE_NAMESPACE_SEED, VAULT_PDA_SEED], &program_id);
    config.bump = config_bump.wrapping_add(stored_bump_delta);
    config.is_initialized = is_initialized;
    let original = config.clone();
    let admin_key = config.admin;
    let mint_key = config.usdc_mint;
    let vault_key = config.vault_token_account;
    let token_program_key = spl_token_program_id();
    let system_owner = system_program::id();
    let mut admin_lamports = 0;
    let mut admin_data = [];
    let mut config_lamports = 0;
    let mut config_data = exact_test_state_data(&config, VaultConfig::LEN);
    let mut mint_lamports = 0;
    let mut mint_data = vec![0; SplMint::LEN];
    SplMint::pack(
        SplMint {
            mint_authority: COption::None,
            supply: 0,
            decimals: 6,
            is_initialized: true,
            freeze_authority: COption::None,
        },
        &mut mint_data,
    )
    .unwrap();
    let mut vault_lamports = 0;
    let mut vault_data = vec![0; SplTokenAccount::LEN];
    SplTokenAccount::pack(
        SplTokenAccount {
            mint: mint_key,
            owner: config_key,
            amount: 0,
            delegate: COption::None,
            state: SplAccountState::Initialized,
            is_native: COption::None,
            delegated_amount: 0,
            close_authority: COption::None,
        },
        &mut vault_data,
    )
    .unwrap();
    let mut token_program_lamports = 0;
    let mut token_program_data = [];
    let accounts = vec![
        AccountInfo::new(
            &admin_key,
            true,
            false,
            &mut admin_lamports,
            &mut admin_data,
            &system_owner,
            false,
            0,
        ),
        AccountInfo::new(
            &config_key,
            false,
            true,
            &mut config_lamports,
            &mut config_data,
            &program_id,
            false,
            0,
        ),
        AccountInfo::new(
            &mint_key,
            false,
            false,
            &mut mint_lamports,
            mint_data.as_mut_slice(),
            &token_program_key,
            false,
            0,
        ),
        AccountInfo::new(
            &vault_key,
            false,
            false,
            &mut vault_lamports,
            vault_data.as_mut_slice(),
            &token_program_key,
            false,
            0,
        ),
        AccountInfo::new(
            &token_program_key,
            false,
            false,
            &mut token_program_lamports,
            &mut token_program_data,
            &system_owner,
            true,
            0,
        ),
    ];
    let result = process_update_config(
        &program_id,
        &accounts,
        new_admin,
        new_oracle_authority,
        new_usdc_mint,
        new_vault_token_account,
        paused,
    );
    drop(accounts);
    let stored = VaultConfig::try_from_slice(&config_data).unwrap();
    (result, stored, original)
}

fn test_ed25519_instruction(public_key: &Pubkey, message: &[u8]) -> Instruction {
    let signature_offset = ED25519_DATA_START;
    let public_key_offset = signature_offset + ED25519_SIGNATURE_SERIALIZED_SIZE;
    let message_offset = public_key_offset + ED25519_PUBKEY_SERIALIZED_SIZE;
    let mut data = vec![0u8; message_offset + message.len()];
    data[0] = 1;
    data[1] = 0;
    for (offset, value) in [
        (2, signature_offset as u16),
        (4, u16::MAX),
        (6, public_key_offset as u16),
        (8, u16::MAX),
        (10, message_offset as u16),
        (12, message.len() as u16),
        (14, u16::MAX),
    ] {
        data[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
    }
    data[signature_offset..public_key_offset].fill(0x5a);
    data[public_key_offset..message_offset].copy_from_slice(public_key.as_ref());
    data[message_offset..].copy_from_slice(message);
    Instruction {
        program_id: ed25519_program::id(),
        accounts: vec![],
        data,
    }
}

fn top_level_function_source<'a>(source: &'a str, name: &str) -> &'a str {
    let marker = format!("fn {name}(");
    let start = source
        .find(&marker)
        .unwrap_or_else(|| panic!("missing function {name}"));
    let rest = &source[start..];
    let end = rest
        .get(1..)
        .and_then(|tail| {
            ["\nfn ", "\npub fn ", "\npub(super) fn ", "\npub(crate) fn "]
                .iter()
                .filter_map(|next| tail.find(next))
                .min()
        })
        .map(|offset| offset + 1)
        .unwrap_or(rest.len());
    &rest[..end]
}

fn sample_market() -> Market {
    Market {
        instrument: InstrumentDefinition {
            expiry_ts: 1,
            strike_price: 100_000_000,
            cap_price: 125_000_000,
            contract_size: 10,
            max_payout_per_contract: 250,
            kind: OptionKind::CallSpread,
            settlement: SettlementStyle::CashSettledMonthly,
            ..InstrumentDefinition::default()
        },
        ..Market::default()
    }
}

fn six_decimal_spread_instrument(
    kind: OptionKind,
    strike_price: u64,
    cap_price: u64,
    contract_size: u64,
    max_payout_per_contract: u64,
) -> InstrumentDefinition {
    InstrumentDefinition {
        expiry_ts: 1,
        strike_price,
        cap_price,
        contract_size,
        max_payout_per_contract,
        kind,
        settlement: SettlementStyle::CashSettledMonthly,
        ..InstrumentDefinition::default()
    }
}

fn maturity_ladder_fixture(
    planned_listing_ts: u64,
    planned_expiry_ts: u64,
) -> OracleMaturityLadderRegistry {
    OracleMaturityLadderRegistry {
        is_initialized: true,
        account_discriminator: OracleMaturityLadderRegistry::ACCOUNT_DISCRIMINATOR,
        account_version: OracleMaturityLadderRegistry::ACCOUNT_VERSION,
        underlying_id: [7; 32],
        planned_listing_ts,
        planned_expiry_ts,
        ..OracleMaturityLadderRegistry::default()
    }
}

fn synthetic_ram_product_sku_draft() -> OracleProductSkuDraft {
    let mut underlying_id = [0u8; 32];
    underlying_id[..24].copy_from_slice(b"ram-standardized-baskets");
    OracleProductSkuDraft {
        is_initialized: true,
        account_discriminator: OracleProductSkuDraft::ACCOUNT_DISCRIMINATOR,
        account_version: OracleProductSkuDraft::ACCOUNT_VERSION,
        underlying_id,
        expected_sku_count: RAMX_ORACLE_PRODUCT_SKU_COUNT,
        ..OracleProductSkuDraft::default()
    }
}
