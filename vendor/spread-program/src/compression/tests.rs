use super::{
    derive_compressed_state_leaf_address, derive_market_page_leaf_address,
    derive_settlement_leaf_address, hash_leaf_data, init_leaf_account_info, invoke_light_cpi,
    read_only_leaf_account_info, serialize_leaf, write_leaf_account_info, LIGHT_SYSTEM_PROGRAM_ID,
};
use crate::state::{
    CompressedAmebaStateLeaf, CompressedMarketPageExpiry, CompressedMarketPageLeaf,
    CompressedSettlementLeaf, CompressedStateDomain, SettlementComputation,
};
use light_compressed_account::{
    compressed_account::{PackedMerkleContext, PackedReadOnlyCompressedAccount},
    instruction_data::{
        compressed_proof::CompressedProof,
        cpi_context::CompressedCpiContext,
        data::{NewAddressParamsAssignedPacked, PackedReadOnlyAddress},
    },
    CompressedAccountError,
};
use light_sdk::address::v2;
use light_sdk::{
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        CpiAccountsTrait, LightCpiInstruction, LightInstructionData,
    },
    instruction::{
        account_meta::{CompressedAccountMeta, CompressedAccountMetaReadOnly},
        PackedStateTreeInfo,
    },
    LightAccount, LightDiscriminator,
};
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    instruction::Instruction,
    program_error::ProgramError,
    program_stubs::{set_syscall_stubs, SyscallStubs},
    pubkey::Pubkey,
};
use std::sync::{Arc, Mutex};

#[test]
fn decompressed_pda_hash_matches_light_canonical_sha256be() {
    use light_sdk::light_hasher::{sha256::Sha256BE, Hasher, Sha256};

    let pda_key = [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
        25, 26, 27, 28, 29, 30, 31,
    ];
    let actual = hash_leaf_data(&pda_key).unwrap();

    assert_eq!(actual, Sha256BE::hash(&pda_key).unwrap());
    assert_eq!(
        actual,
        [
            0x00, 0x0d, 0xcd, 0x29, 0x66, 0xc4, 0x33, 0x66, 0x91, 0x12, 0x54, 0x48, 0xbb, 0xb2,
            0x5b, 0x4f, 0xf4, 0x12, 0xa4, 0x9c, 0x73, 0x2d, 0xb2, 0xc8, 0xab, 0xc1, 0xb8, 0x58,
            0x1b, 0xd7, 0x10, 0xdd,
        ]
    );
    assert_ne!(actual, Sha256::hash(&pda_key).unwrap());
}

#[derive(Debug, PartialEq)]
struct CapturedCpi {
    instruction: Instruction,
    infos: Vec<(Pubkey, bool, bool)>,
    signer_seeds: Vec<Vec<Vec<u8>>>,
}

struct CaptureLightCpi {
    fee_payer: Pubkey,
    captured: Arc<Mutex<Option<CapturedCpi>>>,
}

impl SyscallStubs for CaptureLightCpi {
    fn sol_invoke_signed(
        &self,
        instruction: &Instruction,
        account_infos: &[AccountInfo<'_>],
        signer_seeds: &[&[&[u8]]],
    ) -> ProgramResult {
        if instruction.program_id == LIGHT_SYSTEM_PROGRAM_ID.into()
            && account_infos.first().map(|account| *account.key) == Some(self.fee_payer)
        {
            *self.captured.lock().unwrap() = Some(CapturedCpi {
                instruction: instruction.clone(),
                infos: account_infos
                    .iter()
                    .map(|account| (*account.key, account.is_signer, account.is_writable))
                    .collect(),
                signer_seeds: signer_seeds
                    .iter()
                    .map(|signer| signer.iter().map(|seed| seed.to_vec()).collect())
                    .collect(),
            });
        }
        Ok(())
    }
}

struct SyscallStubGuard(Option<Box<dyn SyscallStubs>>);

impl Drop for SyscallStubGuard {
    fn drop(&mut self) {
        if let Some(previous) = self.0.take() {
            set_syscall_stubs(previous);
        }
    }
}

fn test_account(is_signer: bool, is_writable: bool) -> AccountInfo<'static> {
    let key = Box::leak(Box::new(Pubkey::new_unique()));
    let owner = Box::leak(Box::new(Pubkey::new_unique()));
    let lamports = Box::leak(Box::new(0));
    let data = Box::leak(Vec::new().into_boxed_slice());
    AccountInfo::new(key, is_signer, is_writable, lamports, data, owner, false, 0)
}

#[test]
fn market_page_leaf_address_matches_light_v2_derivation() {
    let program_id = Pubkey::new_unique();
    let tree_pubkey = Pubkey::new_unique();
    let page = CompressedMarketPageLeaf {
        underlying_id: [7; 32],
        item_id: "ramx".to_string(),
        name: "RAMx".to_string(),
        symbol: "RAMX".to_string(),
        title: "Oracle-Settled Monthly Options".to_string(),
        subtitle: "On-chain".to_string(),
        info_href: "/info/ramx".to_string(),
        page_title: "RAMx Options Desk".to_string(),
        meta_description: "RAMx".to_string(),
        price_display_decimals: 2,
        qty_display_decimals: 0,
        quote_display_decimals: 2,
        expiries: vec![CompressedMarketPageExpiry {
            id: "MAR26".to_string(),
            label: "Mar 2026".to_string(),
            settlement_ts: 1_774_534_400,
            oracle_fix_interval_hours: 6,
            fixes_remaining: 8,
            market_alpha_bps: 180,
            base_oracle_atomic: 10_460,
            absolute_risk_cap_usd: 550_000,
            position_cap_usd: 2_000_000,
        }],
        active: true,
    };

    let expected = v2::derive_address(
        &[
            crate::constants::CURRENT_STATE_NAMESPACE_SEED,
            crate::constants::MARKET_PAGE_LEAF_ADDRESS_SEED,
            page.item_id.as_bytes(),
            &page.underlying_id,
        ],
        &tree_pubkey,
        &program_id,
    );

    assert_eq!(
        derive_market_page_leaf_address(&program_id, &tree_pubkey, &page),
        expected
    );
}

#[test]
fn settlement_leaf_address_matches_light_v2_derivation() {
    let program_id = Pubkey::new_unique();
    let tree_pubkey = Pubkey::new_unique();
    let settlement = CompressedSettlementLeaf {
        schema_version: CompressedSettlementLeaf::CURRENT_SCHEMA_VERSION,
        oracle_month: Pubkey::new_from_array([0x42; 32]),
        recipe_hash: [0x24; 32],
        underlying_id: [9; 32],
        item_id: "ramx".to_string(),
        expiry_id: "MAR26".to_string(),
        settlement_ts: 1_774_534_400,
        price_display_decimals: 2,
        computation: SettlementComputation::SpreadOracleIndexDelta,
        trailing_window_days: 0,
        observations: vec![],
        settlement_price_atomic: 10_625,
        source_uri: "https://oracle.example/spread/oracle/markets/ramx/MAR26".to_string(),
        source_digest: [4; 32],
        base_oracle_atomic: 10_000,
        index_delta_bps: 625,
        submitted_by: Pubkey::new_unique(),
        submitted_slot: 99,
        signer_set_version: 1,
        signer_set_hash: [5; 32],
    };

    let expected = v2::derive_address(
        &[
            crate::constants::CURRENT_STATE_NAMESPACE_SEED,
            crate::constants::SETTLEMENT_LEAF_ADDRESS_SEED,
            settlement.oracle_month.as_ref(),
            settlement.item_id.as_bytes(),
            &settlement.underlying_id,
            settlement.expiry_id.as_bytes(),
        ],
        &tree_pubkey,
        &program_id,
    );

    assert_eq!(
        derive_settlement_leaf_address(&program_id, &tree_pubkey, &settlement),
        expected
    );

    let mut other_month = settlement.clone();
    other_month.oracle_month = Pubkey::new_from_array([0x43; 32]);
    assert_ne!(
        derive_settlement_leaf_address(&program_id, &tree_pubkey, &settlement).0,
        derive_settlement_leaf_address(&program_id, &tree_pubkey, &other_month).0,
        "settlements for distinct oracle months must never share a compressed address"
    );
}

#[test]
fn generic_state_address_binds_tree_domain_and_canonical_pda() {
    let program_id = Pubkey::new_unique();
    let tree_pubkey = Pubkey::new_unique();
    let canonical_pda = Pubkey::new_unique();
    let coverage = derive_compressed_state_leaf_address(
        &program_id,
        &tree_pubkey,
        CompressedStateDomain::OracleSkuCoverageRecord,
        &canonical_pda,
    );
    let source = derive_compressed_state_leaf_address(
        &program_id,
        &tree_pubkey,
        CompressedStateDomain::OracleUsdcSourceReward,
        &canonical_pda,
    );
    let other_pda = derive_compressed_state_leaf_address(
        &program_id,
        &tree_pubkey,
        CompressedStateDomain::OracleSkuCoverageRecord,
        &Pubkey::new_unique(),
    );
    let other_tree = derive_compressed_state_leaf_address(
        &program_id,
        &Pubkey::new_unique(),
        CompressedStateDomain::OracleSkuCoverageRecord,
        &canonical_pda,
    );
    assert_ne!(coverage.0, source.0);
    assert_ne!(coverage.0, other_pda.0);
    assert_ne!(coverage.0, other_tree.0);
}

#[test]
fn low_level_light_account_pushes_match_sdk_builder() {
    let program_id = Pubkey::new_unique();
    let proof = light_sdk::proof::borsh_compat::ValidityProof::default();
    let page = CompressedMarketPageLeaf::default();
    let address = [7; 32];

    let mut sdk_account =
        LightAccount::<CompressedMarketPageLeaf>::new_init(&program_id, Some(address), 3);
    *sdk_account = page.clone();
    let sdk_instruction = LightSystemProgramCpi::new_cpi(crate::LIGHT_CPI_SIGNER, proof.into())
        .with_light_account(sdk_account)
        .unwrap();

    let mut direct_account =
        LightAccount::<CompressedMarketPageLeaf>::new_init(&program_id, Some(address), 3);
    *direct_account = page;
    let mut direct_instruction =
        LightSystemProgramCpi::new_cpi(crate::LIGHT_CPI_SIGNER, proof.into());
    direct_instruction
        .account_infos
        .push(direct_account.to_account_info().unwrap());
    assert_eq!(direct_instruction, sdk_instruction);

    let meta = CompressedAccountMetaReadOnly::default();
    let packed_pubkeys = [Pubkey::default()];
    let leaf = CompressedAmebaStateLeaf::default();
    let sdk_account = LightAccount::<CompressedAmebaStateLeaf>::new_read_only(
        &program_id,
        &meta,
        leaf.clone(),
        &packed_pubkeys,
    )
    .unwrap();
    let sdk_instruction = LightSystemProgramCpi::new_cpi(crate::LIGHT_CPI_SIGNER, proof.into())
        .with_light_account(sdk_account)
        .unwrap();

    let direct_account = LightAccount::<CompressedAmebaStateLeaf>::new_read_only(
        &program_id,
        &meta,
        leaf,
        &packed_pubkeys,
    )
    .unwrap();
    let mut direct_instruction =
        LightSystemProgramCpi::new_cpi(crate::LIGHT_CPI_SIGNER, proof.into());
    direct_instruction
        .read_only_accounts
        .push(direct_account.to_packed_read_only_account().unwrap());
    assert_eq!(direct_instruction, sdk_instruction);
}

#[test]
fn direct_leaf_codecs_match_light_account_for_every_operation() {
    let program_id = Pubkey::new_unique();
    let mut address = [0x41; 32];
    address[0] = 0;
    let tree_info = PackedStateTreeInfo {
        root_index: 17,
        prove_by_index: false,
        merkle_tree_pubkey_index: 0,
        queue_pubkey_index: 1,
        leaf_index: 23,
    };
    let meta = CompressedAccountMeta {
        tree_info,
        address,
        output_state_tree_index: 2,
    };

    let market = CompressedMarketPageLeaf::default();
    let mut sdk_market = LightAccount::<CompressedMarketPageLeaf>::new_init(
        &program_id,
        Some(address),
        meta.output_state_tree_index,
    );
    *sdk_market = market.clone();
    assert_eq!(
        init_leaf_account_info(
            address,
            meta.output_state_tree_index,
            CompressedMarketPageLeaf::LIGHT_DISCRIMINATOR,
            serialize_leaf(&market).unwrap(),
        )
        .unwrap(),
        sdk_market.to_account_info().unwrap()
    );

    let settlement = CompressedSettlementLeaf::default();
    let mut sdk_settlement = LightAccount::<CompressedSettlementLeaf>::new_init(
        &program_id,
        Some(address),
        meta.output_state_tree_index,
    );
    *sdk_settlement = settlement.clone();
    assert_eq!(
        init_leaf_account_info(
            address,
            meta.output_state_tree_index,
            CompressedSettlementLeaf::LIGHT_DISCRIMINATOR,
            serialize_leaf(&settlement).unwrap(),
        )
        .unwrap(),
        sdk_settlement.to_account_info().unwrap()
    );

    let old_leaf = CompressedAmebaStateLeaf::default();
    let mut new_leaf = old_leaf.clone();
    new_leaf.revision = 1;
    let mut sdk_update =
        LightAccount::<CompressedAmebaStateLeaf>::new_mut(&program_id, &meta, old_leaf.clone())
            .unwrap();
    *sdk_update = new_leaf.clone();
    let old_data = serialize_leaf(&old_leaf).unwrap();
    assert_eq!(
        write_leaf_account_info(
            &meta,
            CompressedAmebaStateLeaf::LIGHT_DISCRIMINATOR,
            &old_data,
            Some(serialize_leaf(&new_leaf).unwrap()),
        )
        .unwrap(),
        sdk_update.to_account_info().unwrap()
    );

    let sdk_close =
        LightAccount::<CompressedAmebaStateLeaf>::new_close(&program_id, &meta, old_leaf.clone())
            .unwrap();
    assert_eq!(
        write_leaf_account_info(
            &meta,
            CompressedAmebaStateLeaf::LIGHT_DISCRIMINATOR,
            &old_data,
            None,
        )
        .unwrap(),
        sdk_close.to_account_info().unwrap()
    );

    let read_only_meta = CompressedAccountMetaReadOnly { tree_info, address };
    let packed_accounts = [test_account(false, false), test_account(false, false)];
    let packed_pubkeys = [*packed_accounts[0].key, *packed_accounts[1].key];
    let sdk_read_only = LightAccount::<CompressedAmebaStateLeaf>::new_read_only(
        &program_id,
        &read_only_meta,
        old_leaf,
        &packed_pubkeys,
    )
    .unwrap()
    .to_packed_read_only_account()
    .unwrap();
    assert_eq!(
        read_only_leaf_account_info(
            &program_id,
            &read_only_meta,
            CompressedAmebaStateLeaf::LIGHT_DISCRIMINATOR,
            &old_data,
            &packed_accounts,
        )
        .unwrap(),
        sdk_read_only
    );
}

#[test]
fn fixed_light_cpi_layout_matches_sdk_adapter() {
    let fee_payer = test_account(false, false);
    let remaining_accounts = vec![
        test_account(false, false),
        test_account(false, true),
        test_account(true, true),
        test_account(true, true),
        test_account(true, true),
        test_account(true, true),
        test_account(false, true),
        test_account(true, false),
    ];
    let cpi_accounts = CpiAccounts::new(&fee_payer, &remaining_accounts, crate::LIGHT_CPI_SIGNER);
    let expected_infos = cpi_accounts.to_account_infos();
    let expected_metas = CpiAccountsTrait::to_account_metas(&cpi_accounts).unwrap();
    let mut sdk_instruction = LightSystemProgramCpi::new_cpi(
        crate::LIGHT_CPI_SIGNER,
        light_sdk::proof::borsh_compat::ValidityProof::default().into(),
    );
    sdk_instruction.compress_or_decompress_lamports = 17;
    sdk_instruction.is_compress = true;
    sdk_instruction.with_cpi_context = true;
    sdk_instruction.with_transaction_hash = true;
    sdk_instruction.cpi_context = CompressedCpiContext {
        set_context: true,
        first_set_context: false,
        cpi_context_account_index: 4,
    };
    sdk_instruction.proof = Some(CompressedProof {
        a: [1; 32],
        b: [2; 64],
        c: [3; 32],
    });
    sdk_instruction
        .new_address_params
        .push(NewAddressParamsAssignedPacked {
            seed: [4; 32],
            address_queue_account_index: 5,
            address_merkle_tree_account_index: 6,
            address_merkle_tree_root_index: 0x0708,
            assigned_to_account: true,
            assigned_account_index: 9,
        });
    sdk_instruction.account_infos.push(
        init_leaf_account_info(
            [10; 32],
            11,
            CompressedMarketPageLeaf::LIGHT_DISCRIMINATOR,
            serialize_leaf(&CompressedMarketPageLeaf::default()).unwrap(),
        )
        .unwrap(),
    );
    sdk_instruction
        .read_only_addresses
        .push(PackedReadOnlyAddress {
            address: [12; 32],
            address_merkle_tree_root_index: 0x0d0e,
            address_merkle_tree_account_index: 15,
        });
    sdk_instruction
        .read_only_accounts
        .push(PackedReadOnlyCompressedAccount {
            account_hash: [16; 32],
            merkle_context: PackedMerkleContext {
                merkle_tree_pubkey_index: 17,
                queue_pubkey_index: 18,
                leaf_index: 0x13141516,
                prove_by_index: true,
            },
            root_index: 0x1718,
        });
    let expected_data = sdk_instruction.data().unwrap();

    let captured = Arc::new(Mutex::new(None));
    let previous = set_syscall_stubs(Box::new(CaptureLightCpi {
        fee_payer: *fee_payer.key,
        captured: Arc::clone(&captured),
    }));
    let _guard = SyscallStubGuard(Some(previous));
    invoke_light_cpi(sdk_instruction, &fee_payer, &remaining_accounts).unwrap();
    let actual = captured.lock().unwrap().take().unwrap();
    let info_shape = |accounts: &[AccountInfo<'_>]| {
        accounts
            .iter()
            .map(|account| (*account.key, account.is_signer, account.is_writable))
            .collect::<Vec<_>>()
    };

    assert_eq!(
        actual.instruction.program_id,
        LIGHT_SYSTEM_PROGRAM_ID.into()
    );
    assert_eq!(actual.instruction.accounts, expected_metas);
    assert_eq!(actual.instruction.data, expected_data);
    assert_eq!(actual.infos, info_shape(&expected_infos));
    assert_eq!(
        actual.signer_seeds,
        vec![vec![
            super::CPI_AUTHORITY_PDA_SEED.to_vec(),
            vec![crate::LIGHT_CPI_SIGNER.bump],
        ]]
    );
}

#[test]
fn specialized_light_error_codes_match_sdk() {
    use light_sdk::{error::LightSdkError, light_hasher::errors::HasherError};

    assert_eq!(
        ProgramError::from(LightSdkError::Borsh),
        ProgramError::Custom(16016)
    );
    assert_eq!(
        ProgramError::from(LightSdkError::CpiAccountsIndexOutOfBounds(5)),
        ProgramError::Custom(16031)
    );
    assert_eq!(
        ProgramError::from(LightSdkError::InvalidMerkleTreeIndex),
        ProgramError::Custom(16037)
    );
    assert_eq!(
        ProgramError::from(LightSdkError::from(CompressedAccountError::InvalidArgument,)),
        ProgramError::Custom(12016)
    );
    assert_eq!(
        ProgramError::from(LightSdkError::from(HasherError::InvalidNumFields)),
        ProgramError::Custom(7006)
    );
}
