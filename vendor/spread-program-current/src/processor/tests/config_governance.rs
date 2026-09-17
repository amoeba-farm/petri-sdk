use super::*;

#[test]
fn historical_set_cannot_attest_new_settlement_after_rotation() {
    fn info(key: Pubkey, owner: Pubkey, bytes: Vec<u8>) -> AccountInfo<'static> {
        AccountInfo::new(
            Box::leak(Box::new(key)),
            false,
            false,
            Box::leak(Box::new(10_000_000)),
            Box::leak(bytes.into_boxed_slice()),
            Box::leak(Box::new(owner)),
            false,
            0,
        )
    }
    let program = Pubkey::new_unique();
    let (registry_key, rb) = derive_settlement_signer_registry_pda(&program);
    let current_key = derive_settlement_signer_set_pda(&program, 2).0;
    let registry = SettlementSignerRegistry {
        is_initialized: true,
        bump: rb,
        account_discriminator: SettlementSignerRegistry::ACCOUNT_DISCRIMINATOR,
        account_version: SettlementSignerRegistry::ACCOUNT_VERSION,
        current_set: current_key,
        current_version: 2,
        recovery_authority: Pubkey::new_unique(),
        ..Default::default()
    };
    let mut registry_bytes = registry.try_to_vec().unwrap();
    registry_bytes.resize(SettlementSignerRegistry::LEN, 0);
    let registry_info = info(registry_key, program, registry_bytes);
    let sysvar = info(instructions::id(), solana_program::sysvar::id(), vec![0; 4]);
    for version in [1, 2, 3] {
        let (key, bump) = derive_settlement_signer_set_pda(&program, version);
        let mut members = [Pubkey::default(); MAX_SETTLEMENT_SIGNER_COUNT];
        members[0] = Pubkey::new_unique();
        let set = build_settlement_signer_set(
            registry_key,
            bump,
            version,
            1,
            1,
            members,
            MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS,
            1,
            1,
            false,
            Pubkey::new_unique(),
        )
        .unwrap();
        let mut bytes = set.try_to_vec().unwrap();
        bytes.resize(SettlementSignerSet::LEN, 0);
        let set_info = info(key, program, bytes);
        let leaf = CompressedSettlementLeaf {
            signer_set_version: version,
            signer_set_hash: set.set_hash,
            ..Default::default()
        };
        assert_eq!(
            verify_settlement_oracle_attestations(
                &program,
                &leaf,
                &registry_info,
                &set_info,
                &sysvar
            ),
            Err(if version == 2 {
                VaultError::MissingSettlementOracleSignatures
            } else {
                VaultError::SettlementSignerSetVersionMismatch
            }
            .into())
        );
    }
}

#[test]
fn update_config_rejects_uninitialized_wrong_bump_and_zero_authorities_without_mutation() {
    let base = VaultConfig {
        is_initialized: true,
        bump: 0,
        admin: Pubkey::new_unique(),
        oracle_authority: Pubkey::new_unique(),
        usdc_mint: Pubkey::new_unique(),
        vault_token_account: Pubkey::new_unique(),
        paused: true,
        account_discriminator: VaultConfig::ACCOUNT_DISCRIMINATOR,
        account_version: VaultConfig::ACCOUNT_VERSION,
    };
    for (bump_delta, initialized) in [(1, true), (0, false)] {
        let (result, stored, original) = run_test_update_config(
            base.clone(),
            bump_delta,
            initialized,
            None,
            None,
            None,
            None,
            None,
        );
        assert_eq!(
            result,
            Err(ProgramError::Custom(
                VaultError::InvalidConfigAccount as u32
            ))
        );
        assert_eq!(stored, original);
    }

    for (new_admin, new_oracle_authority) in [
        (Some(Pubkey::default()), None),
        (None, Some(Pubkey::default())),
    ] {
        let (result, stored, original) = run_test_update_config(
            base.clone(),
            0,
            true,
            new_admin,
            new_oracle_authority,
            None,
            None,
            None,
        );
        assert_eq!(
            result,
            Err(ProgramError::Custom(
                VaultError::InvalidConfigAccount as u32
            ))
        );
        assert_eq!(stored, original);
    }

    for new_vault in [Some(Pubkey::default()), Some(Pubkey::new_unique())] {
        let (result, stored, original) =
            run_test_update_config(base.clone(), 0, true, None, None, None, new_vault, None);
        assert_eq!(
            result,
            Err(ProgramError::Custom(
                VaultError::CollateralIdentityImmutable as u32
            ))
        );
        assert_eq!(stored, original);
    }

    let (result, stored, original) = run_test_update_config(
        base.clone(),
        0,
        true,
        None,
        None,
        Some(Pubkey::new_unique()),
        None,
        None,
    );
    assert_eq!(
        result,
        Err(ProgramError::Custom(
            VaultError::CollateralIdentityImmutable as u32
        ))
    );
    assert_eq!(stored, original);

    let (result, stored, original) = run_test_update_config(
        base.clone(),
        0,
        true,
        Some(base.admin),
        Some(base.oracle_authority),
        Some(base.usdc_mint),
        Some(base.vault_token_account),
        None,
    );
    assert_eq!(result, Ok(()));
    assert_eq!(stored.admin, original.admin);
    assert_eq!(stored.oracle_authority, original.oracle_authority);
    assert_eq!(stored.usdc_mint, original.usdc_mint);
    assert_eq!(stored.vault_token_account, original.vault_token_account);
    assert!(stored.has_current_layout());

    let (result, stored, original) = run_test_update_config(
        base.clone(),
        0,
        true,
        Some(Pubkey::new_unique()),
        None,
        None,
        None,
        None,
    );
    assert_eq!(
        result,
        Err(VaultError::SettlementSignerGovernanceRequired.into())
    );
    assert_eq!(stored, original);

    let (result, stored, original) = run_test_update_config(
        base.clone(),
        0,
        true,
        Some(base.oracle_authority),
        None,
        None,
        None,
        None,
    );
    assert_eq!(
        result,
        Err(VaultError::SettlementSignerGovernanceRequired.into())
    );
    assert_eq!(stored, original);

    let (result, stored, original) =
        run_test_update_config(base, 0, true, None, None, None, None, Some(false));
    assert_eq!(
        result,
        Err(VaultError::SettlementSignerGovernanceRequired.into())
    );
    assert_eq!(stored, original, "tag 2 must never unpause the vault");
}

#[test]
fn governed_three_of_five_signer_set_is_version_bound_and_member_order_independent() {
    let program_id = Pubkey::new_unique();
    let (registry, _) = derive_settlement_signer_registry_pda(&program_id);
    let (set_key, bump) = derive_settlement_signer_set_pda(&program_id, 1);
    let mut signers = [Pubkey::default(); MAX_SETTLEMENT_SIGNER_COUNT];
    for (index, slot) in signers.iter_mut().take(5).enumerate() {
        *slot = Pubkey::new_from_array([(index + 1) as u8; 32]);
    }
    let set = build_settlement_signer_set(
        registry,
        bump,
        2,
        3,
        5,
        signers,
        MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS,
        10,
        10,
        false,
        Pubkey::new_unique(),
    )
    .expect("3-of-5 governed signer set");
    assert_eq!(set.threshold, 3);
    assert_eq!(set.signer_count, 5);
    assert_eq!(set.compute_set_hash(), set.set_hash);

    let settlement = CompressedSettlementLeaf {
        schema_version: CompressedSettlementLeaf::CURRENT_SCHEMA_VERSION,
        oracle_month: Pubkey::new_unique(),
        recipe_hash: [2; 32],
        underlying_id: [3; 32],
        item_id: "ramx".to_string(),
        expiry_id: "APR26".to_string(),
        settlement_ts: 1_777_564_800,
        price_display_decimals: 2,
        computation: SettlementComputation::SpreadOracleIndexDelta,
        trailing_window_days: 0,
        observations: vec![],
        settlement_price_atomic: 10_625,
        source_uri: "https://oracle.example/spread/ramx/APR26".to_string(),
        source_digest: [4; 32],
        base_oracle_atomic: 10_000,
        index_delta_bps: 625,
        submitted_by: Pubkey::default(),
        submitted_slot: 0,
        signer_set_version: set.version,
        signer_set_hash: set.set_hash,
    };
    let digest = settlement_attestation_digest(&program_id, &registry, &set_key, &set, &settlement)
        .expect("attestation digest");
    assert_eq!(digest.len(), 32);
    for member_index in [0usize, 2, 4] {
        let instruction = test_ed25519_instruction(&set.signers[member_index], &digest);
        assert_eq!(
            parse_verified_settlement_oracle_instruction(&instruction, &digest, &set),
            Ok(member_index)
        );
    }
    let outsider = test_ed25519_instruction(&Pubkey::new_unique(), &digest);
    assert_eq!(
        parse_verified_settlement_oracle_instruction(&outsider, &digest, &set),
        Err(ProgramError::Custom(
            VaultError::InvalidSettlementOracleSigner as u32
        ))
    );

    let mut stale = settlement.clone();
    stale.signer_set_version = 3;
    assert_ne!(
        settlement_attestation_digest(&program_id, &registry, &set_key, &set, &stale).unwrap(),
        digest
    );
    assert!(build_settlement_signer_set(
        registry,
        bump,
        2,
        2,
        5,
        signers,
        MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS,
        11,
        12,
        false,
        Pubkey::new_unique(),
    )
    .is_err());
}

#[test]
fn signer_rotation_digest_and_activation_enforce_explicit_timelock_pause_and_domains() {
    let golden_current = SettlementSignerSet {
        version: 7,
        set_hash: [4; 32],
        ..SettlementSignerSet::default()
    };
    let golden_pending = SettlementSignerSet {
        version: 8,
        set_hash: [6; 32],
        activate_after_slot: 123_456_789,
        rotation_delay_slots: 216_000,
        emergency: false,
        ..SettlementSignerSet::default()
    };
    assert_eq!(
        settlement_signer_rotation_digest(
            &Pubkey::new_from_array([1; 32]),
            &Pubkey::new_from_array([2; 32]),
            &Pubkey::new_from_array([3; 32]),
            &golden_current,
            9,
            &Pubkey::new_from_array([5; 32]),
            &golden_pending,
        ),
        vec![
            0xec, 0x17, 0x11, 0x95, 0xd7, 0xfd, 0xa2, 0xbf, 0x7d, 0x7b, 0x76, 0x66, 0xf0, 0x19,
            0xe1, 0xf1, 0xb6, 0x9b, 0xe3, 0xc0, 0xfb, 0x69, 0x62, 0xc9, 0xc0, 0x2d, 0xde, 0xca,
            0xb6, 0xff, 0x1f, 0x8b,
        ],
        "on-chain rotation digest must match the CLI golden vector",
    );

    let program_id = Pubkey::new_unique();
    let (registry_key, registry_bump) = derive_settlement_signer_registry_pda(&program_id);
    let (current_key, current_bump) = derive_settlement_signer_set_pda(&program_id, 1);
    let (pending_key, pending_bump) = derive_settlement_signer_set_pda(&program_id, 2);
    let mut current_signers = [Pubkey::default(); MAX_SETTLEMENT_SIGNER_COUNT];
    let mut pending_signers = [Pubkey::default(); MAX_SETTLEMENT_SIGNER_COUNT];
    for index in 0..5 {
        current_signers[index] = Pubkey::new_from_array([(index + 1) as u8; 32]);
        pending_signers[index] = Pubkey::new_from_array([(index + 11) as u8; 32]);
    }
    let current = build_settlement_signer_set(
        registry_key,
        current_bump,
        1,
        3,
        5,
        current_signers,
        MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS,
        10,
        10,
        false,
        Pubkey::new_unique(),
    )
    .unwrap();
    let activation_slot = 1_000_000;
    let ordinary = build_settlement_signer_set(
        registry_key,
        pending_bump,
        2,
        3,
        5,
        pending_signers,
        MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS,
        20,
        activation_slot,
        false,
        Pubkey::new_unique(),
    )
    .unwrap();
    let mut emergency = ordinary.clone();
    emergency.emergency = true;
    emergency.set_hash = emergency.compute_set_hash();
    let admin = Pubkey::new_unique();
    let oracle = Pubkey::new_unique();
    let recovery = Pubkey::new_unique();
    let registry = SettlementSignerRegistry {
        is_initialized: true,
        bump: registry_bump,
        account_discriminator: SettlementSignerRegistry::ACCOUNT_DISCRIMINATOR,
        account_version: SettlementSignerRegistry::ACCOUNT_VERSION,
        current_set: current_key,
        current_version: 1,
        pending_set: pending_key,
        pending_version: 2,
        recovery_authority: recovery,
        proposal_nonce: 1,
    };
    let mut config = VaultConfig {
        is_initialized: true,
        bump: 0,
        admin,
        oracle_authority: oracle,
        usdc_mint: Pubkey::new_unique(),
        vault_token_account: Pubkey::new_unique(),
        paused: false,
        account_discriminator: VaultConfig::ACCOUNT_DISCRIMINATOR,
        account_version: VaultConfig::ACCOUNT_VERSION,
    };

    let digest = settlement_signer_rotation_digest(
        &program_id,
        &registry_key,
        &current_key,
        &current,
        1,
        &pending_key,
        &ordinary,
    );
    let mut later_execution = ordinary.clone();
    later_execution.proposed_slot += 1;
    assert_eq!(
        digest,
        settlement_signer_rotation_digest(
            &program_id,
            &registry_key,
            &current_key,
            &current,
            1,
            &pending_key,
            &later_execution,
        ),
        "the signed rotation digest must not depend on the execution clock",
    );
    assert_ne!(
        digest,
        settlement_signer_rotation_digest(
            &program_id,
            &registry_key,
            &current_key,
            &current,
            2,
            &pending_key,
            &ordinary,
        ),
        "cancel/re-propose must consume a new nonce so public old attestations cannot replay",
    );
    let mut later = ordinary.clone();
    later.activate_after_slot += 1;
    later.set_hash = later.compute_set_hash();
    assert_ne!(
        digest,
        settlement_signer_rotation_digest(
            &program_id,
            &registry_key,
            &current_key,
            &current,
            1,
            &pending_key,
            &later,
        )
    );

    assert_eq!(
        validate_settlement_signer_activation(
            &registry,
            &pending_key,
            &ordinary,
            &config,
            activation_slot - 1,
        ),
        Err(VaultError::SettlementSignerRotationNotReady.into())
    );
    assert_eq!(
        validate_settlement_signer_activation(
            &registry,
            &pending_key,
            &ordinary,
            &config,
            activation_slot,
        ),
        Ok(())
    );
    assert_eq!(
        validate_settlement_signer_activation(
            &registry,
            &pending_key,
            &emergency,
            &config,
            activation_slot,
        ),
        Err(VaultError::SettlementSignerRecoveryRequiresPause.into())
    );
    config.paused = true;
    assert_eq!(
        validate_settlement_signer_activation(
            &registry,
            &pending_key,
            &emergency,
            &config,
            activation_slot,
        ),
        Ok(())
    );
    config.admin = recovery;
    assert_eq!(
        validate_settlement_signer_activation(
            &registry,
            &pending_key,
            &emergency,
            &config,
            activation_slot,
        ),
        Err(VaultError::SettlementSignerRecoveryRequiresPause.into())
    );
}

#[test]
fn canonical_light_token_account_requires_complete_compressible_layout() {
    use light_token_interface::state::{Token as LightTokenAccount, ZExtensionStruct};

    fn official_layout_is_canonical(data: &[u8]) -> bool {
        let Ok((token, remaining)) = LightTokenAccount::zero_copy_at_checked(data) else {
            return false;
        };
        remaining.is_empty()
            && matches!(
                token.extensions.as_deref(),
                Some([ZExtensionStruct::Compressible(_)])
            )
    }

    let expected_owner = Pubkey::new_unique();
    let expected_mint = Pubkey::new_unique();
    let mut spl_prefix = vec![0_u8; SplTokenAccount::LEN];
    SplTokenAccount::pack(
        SplTokenAccount {
            mint: expected_mint,
            owner: expected_owner,
            amount: 1,
            delegate: COption::None,
            state: SplAccountState::Initialized,
            is_native: COption::None,
            delegated_amount: 0,
            close_authority: COption::None,
        },
        &mut spl_prefix,
    )
    .unwrap();
    let mut exact = spl_prefix.clone();
    exact.push(2); // Light token-account discriminator.
    exact.push(1); // Some(extensions).
    exact.extend_from_slice(&1_u32.to_le_bytes());
    exact.push(32); // Compressible extension discriminator.
    exact.resize(272, 0);
    assert!(official_layout_is_canonical(&exact));
    assert!(has_canonical_compressible_token_layout(&exact));
    let light_program = light_token_program_id();
    assert!(with_test_account_info(
        &Pubkey::new_unique(),
        &light_program,
        exact.clone(),
        |info| load_canonical_light_token_account(info, &expected_owner, &expected_mint)
    )
    .is_ok());
    assert_eq!(
        with_test_account_info(&Pubkey::new_unique(), &light_program, spl_prefix, |info| {
            load_canonical_light_token_account(info, &expected_owner, &expected_mint).unwrap_err()
        }),
        ProgramError::Custom(VaultError::InvalidLightTokenAccount as u32)
    );
    let mut overlong = exact.clone();
    overlong.push(0);
    assert!(!official_layout_is_canonical(&overlong));
    assert!(!has_canonical_compressible_token_layout(&overlong));
    assert_eq!(
        with_test_account_info(&Pubkey::new_unique(), &light_program, overlong, |info| {
            load_canonical_light_token_account(info, &expected_owner, &expected_mint).unwrap_err()
        }),
        ProgramError::Custom(VaultError::InvalidLightTokenAccount as u32)
    );
    for offset in [165, 166, 167, 171] {
        let mut malformed = exact.clone();
        malformed[offset] ^= 1;
        assert!(!official_layout_is_canonical(&malformed));
        assert!(!has_canonical_compressible_token_layout(&malformed));
    }
}

#[test]
fn market_mint_accounting_rejects_unbacked_or_overconsumed_supply() {
    let mut market = Market {
        mint_accounting: MarketMintAccounting::canonical_empty(),
        ..Market::default()
    };
    market.mint_accounting.total_issued = 100;
    market.mint_accounting.total_consumed = 40;
    market.mint_accounting.total_burned = 10;

    assert_eq!(validate_market_mint_supply(&market, 90), Ok(()));
    assert_eq!(market_outstanding_contract_amount(&market), Ok(60));
    assert_eq!(
        validate_market_mint_supply(&market, 91),
        Err(ProgramError::Custom(
            VaultError::MarketMintSupplyMismatch as u32
        ))
    );

    market.mint_accounting.total_consumed = 101;
    assert_eq!(
        validate_market_mint_supply(&market, 90),
        Err(ProgramError::Custom(
            VaultError::InvalidMarketMintAccounting as u32
        ))
    );
}

#[test]
fn external_market_burn_reconciliation_is_downward_only_and_idempotent() {
    let mut market = Market {
        mint_accounting: MarketMintAccounting::canonical_empty(),
        ..Market::default()
    };
    market.mint_accounting.total_issued = 100;
    market.mint_accounting.total_consumed = 20;
    market.mint_accounting.total_burned = 10;

    assert_eq!(reconcile_external_market_burn(&mut market, 89), Ok(()));
    assert_eq!(market.mint_accounting.total_consumed, 21);
    assert_eq!(market.mint_accounting.total_burned, 11);
    assert_eq!(validate_market_mint_supply(&market, 89), Ok(()));
    assert_eq!(reconcile_external_market_burn(&mut market, 89), Ok(()));
    assert_eq!(
        reconcile_external_market_burn(&mut market, 90),
        Err(ProgramError::Custom(
            VaultError::MarketMintSupplyMismatch as u32
        ))
    );

    market.mint_accounting.total_consumed = 100;
    assert_eq!(
        reconcile_external_market_burn(&mut market, 88),
        Err(ProgramError::Custom(
            VaultError::InsufficientBackedContractSupply as u32
        ))
    );
}

#[test]
fn canonical_market_mint_accepts_the_classic_spl_identity() {
    let program_id = Pubkey::new_unique();
    let market_key = Pubkey::new_unique();
    let (mint_key, _) = derive_contract_mint_pda(&program_id, &market_key);
    let spl_owner = spl_token_program_id();
    let mut mint_lamports = 0;
    let mut mint_data = vec![0; SplMint::LEN];
    SplMint::pack(
        SplMint {
            mint_authority: COption::Some(market_key),
            supply: 0,
            decimals: MarketMintAccounting::CANONICAL_DECIMALS,
            is_initialized: true,
            freeze_authority: COption::None,
        },
        &mut mint_data,
    )
    .unwrap();
    let mint_info = AccountInfo::new(
        &mint_key,
        false,
        false,
        &mut mint_lamports,
        &mut mint_data,
        &spl_owner,
        false,
        0,
    );
    let mut market = Market {
        long_contract_mint: Some(mint_key),
        mint_accounting: MarketMintAccounting::canonical_empty(),
        ..Market::default()
    };
    let mut market_lamports = 0;
    let mut market_data = [];
    let market_info = AccountInfo::new(
        &market_key,
        false,
        false,
        &mut market_lamports,
        &mut market_data,
        &program_id,
        false,
        0,
    );
    assert!(validate_canonical_market_mint(&market_info, &mut market, &mint_info, 1,).is_ok());
}

#[test]
fn canonical_market_mint_rejects_a_stored_noncanonical_spl_mint() {
    let program_id = Pubkey::new_unique();
    let market_key = Pubkey::new_unique();
    let noncanonical_mint_key = Pubkey::new_unique();
    let (canonical_mint_key, _) = derive_contract_mint_pda(&program_id, &market_key);
    assert_ne!(noncanonical_mint_key, canonical_mint_key);

    let spl_owner = spl_token_program_id();
    let mut mint_lamports = 0;
    let mut mint_data = vec![0; SplMint::LEN];
    SplMint::pack(
        SplMint {
            mint_authority: COption::Some(market_key),
            supply: 0,
            decimals: MarketMintAccounting::CANONICAL_DECIMALS,
            is_initialized: true,
            freeze_authority: COption::None,
        },
        &mut mint_data,
    )
    .unwrap();
    let mint_info = AccountInfo::new(
        &noncanonical_mint_key,
        false,
        false,
        &mut mint_lamports,
        &mut mint_data,
        &spl_owner,
        false,
        0,
    );
    let mut market = Market {
        long_contract_mint: Some(noncanonical_mint_key),
        mint_accounting: MarketMintAccounting::canonical_empty(),
        ..Market::default()
    };
    let mut market_lamports = 0;
    let mut market_data = [];
    let market_info = AccountInfo::new(
        &market_key,
        false,
        false,
        &mut market_lamports,
        &mut market_data,
        &program_id,
        false,
        0,
    );

    assert_eq!(
        validate_canonical_market_mint(&market_info, &mut market, &mint_info, 1,),
        Err(ProgramError::Custom(VaultError::InvalidContractMint as u32))
    );
}

#[test]
fn paused_bootstrap_setup_and_value_paths_use_their_exact_pause_guards() {
    let source = PROCESSOR_SOURCE;
    for function_name in [
        "process_configure_oracle_economics_template_v2",
        "process_configure_oracle_product_sku_manifest",
        "process_init_market_v2",
        "process_create_market_contract_mint_v3",
        "process_initialize_oracle_month_v5",
    ] {
        let function_source = top_level_function_source(source, function_name);
        assert!(
            !function_source.contains("load_active_vault_config")
                && !function_source.contains("load_active_oracle_vault_config")
                && !function_source.contains("validate_oracle_authority")
                && !function_source.contains("ensure_market_value_flow_unpaused")
                && !function_source.contains("if config.paused"),
            "{function_name} is create-only bootstrap setup and must remain possible while the vault is paused"
        );
    }

    let bootstrap_governance =
        top_level_function_source(source, "process_bootstrap_vault_governance_v2");
    assert!(bootstrap_governance.contains("!config.paused"));
    let initialize_signers =
        top_level_function_source(source, "process_initialize_settlement_signer_registry");
    assert!(initialize_signers.contains("if !config.paused"));
    let market_pause_control = top_level_function_source(source, "process_set_market_paused");
    assert!(market_pause_control.contains("if !params.paused && config.paused"));

    for function_name in ["process_initialize_oracle_month_v5"] {
        assert!(
            top_level_function_source(source, function_name)
                .contains("validate_current_oracle_authority_allow_paused"),
            "{function_name} must preserve the oracle/admin role split during paused bootstrap"
        );
    }

    let settlement_source = top_level_function_source(source, "process_upsert_settlement");
    assert!(settlement_source.contains("ensure_market_value_flow_unpaused"));
    for function_name in ["contribute", "process_publish_writer_group_settlement"] {
        assert!(
            top_level_function_source(source, function_name).contains("config.paused"),
            "{function_name} must fail closed while the current vault is paused"
        );
    }

    // Receipt claims and long-holder recovery remain available while paused.
    for function_name in ["position_action", "claim_collective_long"] {
        let function_source = top_level_function_source(source, function_name);
        assert!(
            function_source.contains("load_canonical_vault_config"),
            "{function_name}"
        );
        assert!(
            !function_source.contains("config.paused"),
            "{function_name}"
        );
    }
    let collective_claim = top_level_function_source(source, "process_claim_collective_long");
    assert!(collective_claim.contains("claim_collective_long(program_id, accounts, params, None)"));
    assert!(!collective_claim.contains("config.paused"));

    for function_name in ["process_deposit", "process_collateral_withdrawal"] {
        let function_source = top_level_function_source(source, function_name);
        assert!(
            function_source.contains("load_active_vault_config"),
            "{function_name} must load the exact canonical active config"
        );
    }
    let deposit_collateral_source = top_level_function_source(source, "process_deposit_collateral");
    assert!(deposit_collateral_source.contains("process_deposit("));
}
