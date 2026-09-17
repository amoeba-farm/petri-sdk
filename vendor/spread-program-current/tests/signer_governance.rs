#![cfg(feature = "test-sbf")]

use borsh::{BorshDeserialize, BorshSerialize};
use light_token_minter::{
    constants::{
        CURRENT_STATE_NAMESPACE_SEED, EMERGENCY_SETTLEMENT_SIGNER_DELAY_MULTIPLIER,
        MAX_SETTLEMENT_SIGNER_COUNT, MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS, VAULT_PDA_SEED,
    },
    error::VaultError,
    instruction::{
        ActivateVaultV2Params, InitializeSettlementSignerRegistryParams,
        ProposeSettlementSignerRotationParams, RotateVaultAuthoritiesV2Params, VaultInstruction,
    },
    processor::process_instruction,
    state::{
        derive_settlement_signer_registry_pda, derive_settlement_signer_set_pda,
        SettlementSignerRegistry, SettlementSignerSet, VaultConfig,
    },
};
use solana_program::hash::hashv;
use solana_program::{program_option::COption, program_pack::Pack};
use solana_program_test::{processor, BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use spl_token::state::{Account as TokenAccount, AccountState, Mint};

#[path = "signer_governance/support.rs"]
mod support;

use support::*;

#[tokio::test(flavor = "multi_thread")]
async fn governed_three_of_five_rotation_and_emergency_recovery_are_enforced_on_chain() {
    let admin = Keypair::new();
    let oracle_authority = Keypair::new();
    let recovery_authority = Keypair::new();
    let collateral_mint = Pubkey::new_unique();
    let collateral_vault = Pubkey::new_unique();
    let (config_key, config_bump) = Pubkey::find_program_address(
        &[CURRENT_STATE_NAMESPACE_SEED, VAULT_PDA_SEED],
        &light_token_minter::id(),
    );
    let config = VaultConfig {
        is_initialized: true,
        bump: config_bump,
        admin: admin.pubkey(),
        oracle_authority: oracle_authority.pubkey(),
        usdc_mint: collateral_mint,
        vault_token_account: collateral_vault,
        paused: true,
        account_discriminator: VaultConfig::ACCOUNT_DISCRIMINATOR,
        account_version: VaultConfig::ACCOUNT_VERSION,
    };

    let mut program_test = ProgramTest::new(
        "light_token_minter",
        light_token_minter::id(),
        processor!(process_instruction),
    );
    program_test.prefer_bpf(false);
    program_test.add_account(
        admin.pubkey(),
        Account {
            lamports: 50_000_000,
            data: vec![],
            owner: solana_sdk::system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );
    program_test.add_account(config_key, typed_config_account(&config));
    program_test.add_account(collateral_mint, mint_account());
    program_test.add_account(collateral_vault, token_account(collateral_mint, config_key));
    let mut context = program_test.start_with_context().await;

    let current_signers = sorted_signers();
    let current_signer_keys = signer_array(&current_signers);
    let (registry_key, _) = derive_settlement_signer_registry_pda(&light_token_minter::id());
    let (set_v1_key, _) = derive_settlement_signer_set_pda(&light_token_minter::id(), 1);

    send_instructions(
        &mut context,
        vec![initialize_registry_instruction(
            admin.pubkey(),
            oracle_authority.pubkey(),
            recovery_authority.pubkey(),
            config_key,
            registry_key,
            set_v1_key,
            current_signer_keys,
        )],
        &[&admin, &oracle_authority, &recovery_authority],
    )
    .await
    .unwrap();

    let initialized_registry: SettlementSignerRegistry =
        read_state(&mut context, registry_key).await;
    let set_v1: SettlementSignerSet = read_state(&mut context, set_v1_key).await;
    assert_eq!(initialized_registry.current_set, set_v1_key);
    assert_eq!(initialized_registry.current_version, 1);
    assert_eq!(initialized_registry.pending_set, Pubkey::default());
    assert_eq!(initialized_registry.proposal_nonce, 0);
    assert_eq!(set_v1.threshold, 3);
    assert_eq!(set_v1.signer_count, 5);
    assert_eq!(set_v1.signers, current_signer_keys);
    assert_eq!(set_v1.set_hash, set_v1.compute_set_hash());

    let replacement_signers_a = sorted_signers();
    let replacement_keys_a = signer_array(&replacement_signers_a);
    let (set_v2_key, _) = derive_settlement_signer_set_pda(&light_token_minter::id(), 2);
    let clock = context
        .banks_client
        .get_sysvar::<solana_sdk::clock::Clock>()
        .await
        .unwrap();
    let first_activate_after = clock
        .slot
        .saturating_add(MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS)
        .saturating_add(10);
    let pending_v2_a = pending_set_for_digest(
        registry_key,
        set_v2_key,
        2,
        replacement_keys_a,
        MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS,
        first_activate_after,
        false,
        admin.pubkey(),
    );
    let first_digest = rotation_digest(
        registry_key,
        set_v1_key,
        &set_v1,
        1,
        set_v2_key,
        &pending_v2_a,
    );
    let mut first_proposal = current_signers
        .iter()
        .take(3)
        .map(|signer| ed25519_verify_instruction(signer, &first_digest))
        .collect::<Vec<_>>();
    first_proposal.push(propose_rotation_instruction(
        admin.pubkey(),
        oracle_authority.pubkey(),
        None,
        config_key,
        registry_key,
        set_v1_key,
        set_v2_key,
        replacement_keys_a,
        2,
        first_activate_after,
    ));
    send_instructions(&mut context, first_proposal, &[&admin, &oracle_authority])
        .await
        .unwrap();

    let proposed_registry: SettlementSignerRegistry = read_state(&mut context, registry_key).await;
    assert_eq!(proposed_registry.pending_set, set_v2_key);
    assert_eq!(proposed_registry.pending_version, 2);
    assert_eq!(proposed_registry.proposal_nonce, 1);

    send_instructions(
        &mut context,
        vec![cancel_rotation_instruction(
            admin.pubkey(),
            oracle_authority.pubkey(),
            config_key,
            registry_key,
        )],
        &[&admin, &oracle_authority],
    )
    .await
    .unwrap();
    let canceled_registry: SettlementSignerRegistry = read_state(&mut context, registry_key).await;
    assert_eq!(canceled_registry.current_set, set_v1_key);
    assert_eq!(canceled_registry.pending_set, Pubkey::default());
    assert_eq!(canceled_registry.pending_version, 0);
    assert_eq!(canceled_registry.proposal_nonce, 1);

    // The canceled V2 PDA remains allocated. A fresh quorum may overwrite only this never-active
    // orphan for the same next version. Replaying the canceled proposal's signatures fails because
    // the registry's next proposal nonce is now two.
    let mut replayed_proposal = current_signers
        .iter()
        .take(3)
        .map(|signer| ed25519_verify_instruction(signer, &first_digest))
        .collect::<Vec<_>>();
    replayed_proposal.push(propose_rotation_instruction(
        admin.pubkey(),
        oracle_authority.pubkey(),
        None,
        config_key,
        registry_key,
        set_v1_key,
        set_v2_key,
        replacement_keys_a,
        2,
        first_activate_after,
    ));
    let replay_error = send_instructions(
        &mut context,
        replayed_proposal,
        &[&admin, &oracle_authority],
    )
    .await
    .unwrap_err();
    assert_custom_error(replay_error, VaultError::SettlementOraclePayloadMismatch);
    let replay_rejected_registry: SettlementSignerRegistry =
        read_state(&mut context, registry_key).await;
    assert_eq!(replay_rejected_registry.pending_set, Pubkey::default());
    assert_eq!(replay_rejected_registry.proposal_nonce, 1);

    let replacement_signers_b = sorted_signers();
    let replacement_keys_b = signer_array(&replacement_signers_b);
    let clock = context
        .banks_client
        .get_sysvar::<solana_sdk::clock::Clock>()
        .await
        .unwrap();
    let second_activate_after = clock
        .slot
        .saturating_add(MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS)
        .saturating_add(10);
    let pending_v2_b = pending_set_for_digest(
        registry_key,
        set_v2_key,
        2,
        replacement_keys_b,
        MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS,
        second_activate_after,
        false,
        admin.pubkey(),
    );
    let second_digest = rotation_digest(
        registry_key,
        set_v1_key,
        &set_v1,
        2,
        set_v2_key,
        &pending_v2_b,
    );
    let mut second_proposal = current_signers
        .iter()
        .take(3)
        .map(|signer| ed25519_verify_instruction(signer, &second_digest))
        .collect::<Vec<_>>();
    second_proposal.push(propose_rotation_instruction(
        admin.pubkey(),
        oracle_authority.pubkey(),
        None,
        config_key,
        registry_key,
        set_v1_key,
        set_v2_key,
        replacement_keys_b,
        2,
        second_activate_after,
    ));
    send_instructions(&mut context, second_proposal, &[&admin, &oracle_authority])
        .await
        .unwrap();
    let rewritten_v2: SettlementSignerSet = read_state(&mut context, set_v2_key).await;
    let reproposed_registry: SettlementSignerRegistry =
        read_state(&mut context, registry_key).await;
    assert_eq!(rewritten_v2.signers, replacement_keys_b);
    assert_ne!(rewritten_v2.signers, replacement_keys_a);
    assert_eq!(reproposed_registry.proposal_nonce, 2);

    context
        .warp_to_slot(second_activate_after.saturating_add(1))
        .unwrap();
    send_instructions(
        &mut context,
        vec![activate_rotation_instruction(
            registry_key,
            set_v2_key,
            config_key,
        )],
        &[],
    )
    .await
    .unwrap();
    let active_v2_registry: SettlementSignerRegistry = read_state(&mut context, registry_key).await;
    assert_eq!(active_v2_registry.current_set, set_v2_key);
    assert_eq!(active_v2_registry.current_version, 2);
    assert_eq!(active_v2_registry.pending_set, Pubkey::default());

    let emergency_signers = sorted_signers();
    let emergency_signer_keys = signer_array(&emergency_signers);
    let (set_v3_key, _) = derive_settlement_signer_set_pda(&light_token_minter::id(), 3);
    let clock = context
        .banks_client
        .get_sysvar::<solana_sdk::clock::Clock>()
        .await
        .unwrap();
    let emergency_activate_after = clock
        .slot
        .saturating_add(
            MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS
                .saturating_mul(EMERGENCY_SETTLEMENT_SIGNER_DELAY_MULTIPLIER),
        )
        .saturating_add(10);
    send_instructions(
        &mut context,
        vec![propose_rotation_instruction(
            admin.pubkey(),
            oracle_authority.pubkey(),
            Some(recovery_authority.pubkey()),
            config_key,
            registry_key,
            set_v2_key,
            set_v3_key,
            emergency_signer_keys,
            3,
            emergency_activate_after,
        )],
        &[&admin, &oracle_authority, &recovery_authority],
    )
    .await
    .unwrap();
    let pending_v3: SettlementSignerSet = read_state(&mut context, set_v3_key).await;
    assert!(pending_v3.emergency);
    assert_eq!(pending_v3.version, 3);
    assert_eq!(pending_v3.activate_after_slot, emergency_activate_after);
    let emergency_registry: SettlementSignerRegistry = read_state(&mut context, registry_key).await;
    assert_eq!(emergency_registry.proposal_nonce, 3);

    let ungoverned_unpause_error = send_instructions(
        &mut context,
        vec![update_pause_instruction(
            admin.pubkey(),
            config_key,
            collateral_mint,
            collateral_vault,
            false,
        )],
        &[&admin],
    )
    .await
    .unwrap_err();
    assert_custom_error(
        ungoverned_unpause_error,
        VaultError::SettlementSignerGovernanceRequired,
    );
    send_instructions(
        &mut context,
        vec![activate_vault_v2_instruction(
            admin.pubkey(),
            config_key,
            registry_key,
            set_v2_key,
            collateral_mint,
            collateral_vault,
            None,
        )],
        &[&admin],
    )
    .await
    .unwrap();
    let unpaused_config: VaultConfig = read_state(&mut context, config_key).await;
    assert!(!unpaused_config.paused);
    context
        .warp_to_slot(emergency_activate_after.saturating_add(1))
        .unwrap();
    let unpaused_error = send_instructions(
        &mut context,
        vec![activate_rotation_instruction(
            registry_key,
            set_v3_key,
            config_key,
        )],
        &[],
    )
    .await
    .unwrap_err();
    assert_custom_error(
        unpaused_error,
        VaultError::SettlementSignerRecoveryRequiresPause,
    );

    send_instructions(
        &mut context,
        vec![update_pause_instruction(
            admin.pubkey(),
            config_key,
            collateral_mint,
            collateral_vault,
            true,
        )],
        &[&admin],
    )
    .await
    .unwrap();
    let repaused_config: VaultConfig = read_state(&mut context, config_key).await;
    assert!(repaused_config.paused);
    assert!(repaused_config.has_current_layout());
    assert_eq!(repaused_config.admin, admin.pubkey());
    assert_eq!(repaused_config.oracle_authority, oracle_authority.pubkey());
    let repaused_registry: SettlementSignerRegistry = read_state(&mut context, registry_key).await;
    assert_eq!(
        repaused_registry.recovery_authority,
        recovery_authority.pubkey()
    );
    assert_ne!(repaused_registry.recovery_authority, repaused_config.admin);
    assert_ne!(
        repaused_registry.recovery_authority,
        repaused_config.oracle_authority
    );
    // Advance once so the successful retry cannot reuse the signature/cache entry from the
    // deliberately failed activation transaction above.
    context
        .warp_to_slot(emergency_activate_after.saturating_add(2))
        .unwrap();
    send_instructions(
        &mut context,
        vec![activate_rotation_instruction(
            registry_key,
            set_v3_key,
            config_key,
        )],
        &[],
    )
    .await
    .unwrap();
    let active_v3_registry: SettlementSignerRegistry = read_state(&mut context, registry_key).await;
    assert_eq!(active_v3_registry.current_set, set_v3_key);
    assert_eq!(active_v3_registry.current_version, 3);
    assert_eq!(active_v3_registry.pending_set, Pubkey::default());
    assert_eq!(active_v3_registry.pending_version, 0);

    let incoming_admin = Keypair::new();
    let incoming_oracle = Keypair::new();
    let single_admin_rotation_error = send_instructions(
        &mut context,
        vec![single_admin_authority_update_instruction(
            admin.pubkey(),
            config_key,
            collateral_mint,
            collateral_vault,
            incoming_admin.pubkey(),
        )],
        &[&admin],
    )
    .await
    .unwrap_err();
    assert_custom_error(
        single_admin_rotation_error,
        VaultError::SettlementSignerGovernanceRequired,
    );

    let missing_signature_cases: [([bool; 4], Vec<&Keypair>); 4] = [
        (
            [false, true, true, true],
            vec![&oracle_authority, &incoming_admin, &incoming_oracle],
        ),
        (
            [true, false, true, true],
            vec![&admin, &incoming_admin, &incoming_oracle],
        ),
        (
            [true, true, false, true],
            vec![&admin, &oracle_authority, &incoming_oracle],
        ),
        (
            [true, true, true, false],
            vec![&admin, &oracle_authority, &incoming_admin],
        ),
    ];
    for (signer_flags, present_signers) in missing_signature_cases {
        let error = send_instructions(
            &mut context,
            vec![rotate_authorities_v2_instruction(
                admin.pubkey(),
                oracle_authority.pubkey(),
                incoming_admin.pubkey(),
                incoming_oracle.pubkey(),
                signer_flags,
                config_key,
                registry_key,
                set_v3_key,
            )],
            &present_signers,
        )
        .await
        .unwrap_err();
        assert_instruction_error(
            error,
            solana_sdk::instruction::InstructionError::MissingRequiredSignature,
        );
    }

    send_instructions(
        &mut context,
        vec![activate_vault_v2_instruction(
            admin.pubkey(),
            config_key,
            registry_key,
            set_v3_key,
            collateral_mint,
            collateral_vault,
            None,
        )],
        &[&admin],
    )
    .await
    .unwrap();
    let unpaused_rotation_error = send_instructions(
        &mut context,
        vec![rotate_authorities_v2_instruction(
            admin.pubkey(),
            oracle_authority.pubkey(),
            incoming_admin.pubkey(),
            incoming_oracle.pubkey(),
            [true; 4],
            config_key,
            registry_key,
            set_v3_key,
        )],
        &[&admin, &oracle_authority, &incoming_admin, &incoming_oracle],
    )
    .await
    .unwrap_err();
    assert_custom_error(
        unpaused_rotation_error,
        VaultError::SettlementSignerGovernanceRequired,
    );
    send_instructions(
        &mut context,
        vec![update_pause_instruction(
            admin.pubkey(),
            config_key,
            collateral_mint,
            collateral_vault,
            true,
        )],
        &[&admin],
    )
    .await
    .unwrap();

    let collision_oracle = Keypair::new();
    let recovery_collision_error = send_instructions(
        &mut context,
        vec![rotate_authorities_v2_instruction(
            admin.pubkey(),
            oracle_authority.pubkey(),
            recovery_authority.pubkey(),
            collision_oracle.pubkey(),
            [true; 4],
            config_key,
            registry_key,
            set_v3_key,
        )],
        &[
            &admin,
            &oracle_authority,
            &recovery_authority,
            &collision_oracle,
        ],
    )
    .await
    .unwrap_err();
    assert_custom_error(
        recovery_collision_error,
        VaultError::SettlementSignerGovernanceRequired,
    );

    let active_signer_collision_oracle = Keypair::new();
    let active_signer_collision_error = send_instructions(
        &mut context,
        vec![rotate_authorities_v2_instruction(
            admin.pubkey(),
            oracle_authority.pubkey(),
            emergency_signers[0].pubkey(),
            active_signer_collision_oracle.pubkey(),
            [true; 4],
            config_key,
            registry_key,
            set_v3_key,
        )],
        &[
            &admin,
            &oracle_authority,
            &emergency_signers[0],
            &active_signer_collision_oracle,
        ],
    )
    .await
    .unwrap_err();
    assert_custom_error(
        active_signer_collision_error,
        VaultError::InvalidSettlementSignerConfiguration,
    );

    let config_before_rotation: VaultConfig = read_state(&mut context, config_key).await;
    send_instructions(
        &mut context,
        vec![rotate_authorities_v2_instruction(
            admin.pubkey(),
            oracle_authority.pubkey(),
            incoming_admin.pubkey(),
            incoming_oracle.pubkey(),
            [true; 4],
            config_key,
            registry_key,
            set_v3_key,
        )],
        &[&admin, &oracle_authority, &incoming_admin, &incoming_oracle],
    )
    .await
    .unwrap();
    let config_after_rotation: VaultConfig = read_state(&mut context, config_key).await;
    let mut expected_config = config_before_rotation;
    expected_config.admin = incoming_admin.pubkey();
    expected_config.oracle_authority = incoming_oracle.pubkey();
    assert_eq!(config_after_rotation, expected_config);
}
