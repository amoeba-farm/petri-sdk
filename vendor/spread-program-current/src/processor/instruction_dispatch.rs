use super::*;
use crate::{
    governance_gate::{self, GateValidated},
    governance_manifest::{classify_active_instruction_tag, InstructionGovernanceClass},
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::processor) enum DispatchTransport {
    TopLevel,
    CompressedInner,
}

#[cfg(all(test, feature = "phase3-synthetic-governance-controller"))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HandlerBoundaryFamily {
    OrdinaryVault,
    Dlmm,
    DlmmLightLifecycle,
    WriterSleeve,
    #[cfg(feature = "devnet-solo-backfill-2026")]
    DevnetBackfill,
    CompressedOuter,
    CompressedInnerVault,
}

#[cfg(all(test, feature = "phase3-synthetic-governance-controller"))]
#[derive(Clone, Debug, Eq, PartialEq)]
struct HandlerBoundaryAccount {
    account_info_address: usize,
    key: Pubkey,
    owner: Pubkey,
    is_signer: bool,
    is_writable: bool,
    executable: bool,
    rent_epoch: u64,
}

#[cfg(all(test, feature = "phase3-synthetic-governance-controller"))]
#[derive(Clone, Debug, Eq, PartialEq)]
struct HandlerBoundaryCapture {
    family: HandlerBoundaryFamily,
    transport: DispatchTransport,
    tag: u8,
    payload: Vec<u8>,
    accounts: Vec<HandlerBoundaryAccount>,
}

#[cfg(all(test, feature = "phase3-synthetic-governance-controller"))]
#[derive(Default)]
struct HandlerBoundaryProbe {
    capture: core::cell::RefCell<Option<HandlerBoundaryCapture>>,
}

#[cfg(all(test, feature = "phase3-synthetic-governance-controller"))]
impl HandlerBoundaryProbe {
    fn record(
        &self,
        family: HandlerBoundaryFamily,
        transport: DispatchTransport,
        tag: u8,
        payload: &[u8],
        accounts: &[AccountInfo],
    ) {
        let capture = HandlerBoundaryCapture {
            family,
            transport,
            tag,
            payload: payload.to_vec(),
            accounts: accounts
                .iter()
                .map(|account| HandlerBoundaryAccount {
                    account_info_address: account as *const AccountInfo as usize,
                    key: *account.key,
                    owner: *account.owner,
                    is_signer: account.is_signer,
                    is_writable: account.is_writable,
                    executable: account.executable,
                    rent_epoch: account.rent_epoch,
                })
                .collect(),
        };
        assert!(
            self.capture.replace(Some(capture)).is_none(),
            "a boundary probe must capture exactly one handler handoff"
        );
    }

    fn take(&self) -> HandlerBoundaryCapture {
        self.capture
            .borrow_mut()
            .take()
            .expect("handler boundary was not reached")
    }
}

/// Internal routing context. In a governance-enabled artifact there is no business-routing call
/// site that can construct this value without first receiving the private gate capability.
pub(in crate::processor) struct ExecutionContext<'a> {
    gate: &'a GateValidated,
    transport: DispatchTransport,
    #[cfg(all(test, feature = "phase3-synthetic-governance-controller"))]
    boundary_probe: Option<&'a HandlerBoundaryProbe>,
}

impl<'a> ExecutionContext<'a> {
    fn top_level(gate: &'a GateValidated) -> Self {
        Self {
            gate,
            transport: DispatchTransport::TopLevel,
            #[cfg(all(test, feature = "phase3-synthetic-governance-controller"))]
            boundary_probe: None,
        }
    }

    pub(in crate::processor) fn compressed_inner(gate: &'a GateValidated) -> Self {
        Self {
            gate,
            transport: DispatchTransport::CompressedInner,
            #[cfg(all(test, feature = "phase3-synthetic-governance-controller"))]
            boundary_probe: None,
        }
    }

    #[cfg(all(test, feature = "phase3-synthetic-governance-controller"))]
    fn with_boundary_probe(
        gate: &'a GateValidated,
        transport: DispatchTransport,
        boundary_probe: &'a HandlerBoundaryProbe,
    ) -> Self {
        Self {
            gate,
            transport,
            boundary_probe: Some(boundary_probe),
        }
    }

    pub(in crate::processor) fn gate(&self) -> &GateValidated {
        self.gate
    }

    fn is_compressed_inner(&self) -> bool {
        self.transport == DispatchTransport::CompressedInner
    }

    #[cfg(all(test, feature = "phase3-synthetic-governance-controller"))]
    fn capture_handler_boundary(
        &self,
        family: HandlerBoundaryFamily,
        tag: u8,
        payload: &[u8],
        accounts: &[AccountInfo],
    ) -> bool {
        let Some(probe) = self.boundary_probe else {
            return false;
        };
        probe.record(family, self.transport, tag, payload, accounts);
        true
    }
}

#[cfg(feature = "governance-gate-v1")]
#[inline(always)]
fn require_transaction_level_stack_height(stack_height: usize) -> ProgramResult {
    if stack_height != solana_program::instruction::TRANSACTION_LEVEL_STACK_HEIGHT {
        return Err(VaultError::InvalidInstructionData.into());
    }
    Ok(())
}

#[cfg(all(test, feature = "governance-gate-v1"))]
std::thread_local! {
    static TEST_STACK_HEIGHT_READS: core::cell::Cell<usize> = const { core::cell::Cell::new(0) };
}

#[cfg(all(test, feature = "governance-gate-v1"))]
#[inline(always)]
fn current_invocation_stack_height() -> usize {
    TEST_STACK_HEIGHT_READS.with(|reads| reads.set(reads.get().saturating_add(1)));
    // Direct native unit tests do not execute inside ProgramTest's runtime syscall stubs. Model
    // their historical direct-entry behavior as transaction-level while separately testing the
    // exact height predicate and exercising the real syscall in actual-SBF ProgramTest coverage.
    solana_program::instruction::TRANSACTION_LEVEL_STACK_HEIGHT
}

#[cfg(all(feature = "governance-gate-v1", not(test)))]
#[inline(always)]
fn current_invocation_stack_height() -> usize {
    solana_program::instruction::get_stack_height()
}

#[cfg(feature = "governance-gate-v1")]
#[inline(always)]
fn require_governed_invocation(tag: u8, accounts: &[AccountInfo]) -> ProgramResult {
    let height = current_invocation_stack_height();
    #[cfg(any(feature = "devnet-v3-governance-controller", feature = "mainnet-v3"))]
    if height == solana_program::instruction::TRANSACTION_LEVEL_STACK_HEIGHT + 1
        && tag
            == crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::InitializeLightConfig as u8
        && accounts.len() == 6
    {
        // Only the pinned council can furnish this off-curve PDA signature.
        // Its typed action fixes the payload and accounts; normal gate admission
        // and the existing Loader-authority/create-only handler still run below.
        let authority = &accounts[3];
        let expected = Pubkey::find_program_address(
            &[
                b"ameba-governance-v3",
                b"target-authority",
                crate::id().as_ref(),
            ],
            &governance_gate::PINNED_CONTROLLER_PROGRAM_ID,
        )
        .0;
        if authority.key == &expected
            && authority.is_signer
            && !authority.is_writable
            && !authority.executable
        {
            return Ok(());
        }
    }
    let _ = (tag, accounts);
    require_transaction_level_stack_height(height)
}

pub(super) fn process_top_level_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.len() > MAX_INSTRUCTION_DATA_BYTES {
        return Err(VaultError::InvalidInstructionData.into());
    }
    let tag = *instruction_data
        .first()
        .ok_or(VaultError::InvalidInstructionData)?;
    match classify_active_instruction_tag(tag) {
        InstructionGovernanceClass::Unknown | InstructionGovernanceClass::Reserved => {
            return Err(VaultError::InvalidInstructionData.into());
        }
        // The exhaustive Phase 3 manifest has no ordinary read-only entries. Keeping this arm
        // explicit ensures a future classification cannot silently acquire a mutating route.
        InstructionGovernanceClass::RecognizedReadOnly => {
            return Err(VaultError::InvalidInstructionData.into());
        }
        InstructionGovernanceClass::RecognizedMutating
        | InstructionGovernanceClass::FeatureGatedMutating => {}
    }

    #[cfg(feature = "governance-gate-v1")]
    {
        require_governed_invocation(tag, accounts)?;
        let (legacy_accounts, legacy_data, gate) =
            governance_gate::validate_top_level_envelope(program_id, accounts, instruction_data)?;
        let context = ExecutionContext::top_level(&gate);
        process_instruction_with_context(
            program_id,
            legacy_accounts,
            crate::business_generation::strip_current_message(legacy_data)?,
            &context,
        )
    }

    #[cfg(not(feature = "governance-gate-v1"))]
    {
        let gate = governance_gate::disabled_build_capability();
        let context = ExecutionContext::top_level(&gate);
        process_instruction_with_context(
            program_id,
            accounts,
            crate::business_generation::strip_current_message(instruction_data)?,
            &context,
        )
    }
}

pub(super) fn process_instruction_with_context(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
    context: &ExecutionContext<'_>,
) -> ProgramResult {
    let _validated_epoch = context.gate().expected_epoch();
    if instruction_data.len() > MAX_INSTRUCTION_DATA_BYTES {
        return Err(VaultError::InvalidInstructionData.into());
    }
    let (tag_bytes, payload) = instruction_data
        .split_first()
        .ok_or(VaultError::InvalidInstructionData)?;
    if !context.is_compressed_inner() {
        if let Some(tag) =
            crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::from_byte(*tag_bytes)
        {
            if matches!(
                tag,
                crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::InitializeLightConfig
                    | crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::UpdateLightConfig
                    | crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::CompressLightState
                    | crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::DecompressLightState
            ) {
                #[cfg(all(test, feature = "phase3-synthetic-governance-controller"))]
                if context.capture_handler_boundary(
                    HandlerBoundaryFamily::DlmmLightLifecycle,
                    *tag_bytes,
                    payload,
                    accounts,
                ) {
                    return Ok(());
                }
                return ameba_dlmm_light::process_lifecycle_instruction(
                    program_id, accounts, tag, payload,
                );
            }
            #[cfg(all(test, feature = "phase3-synthetic-governance-controller"))]
            if context.capture_handler_boundary(
                HandlerBoundaryFamily::Dlmm,
                *tag_bytes,
                payload,
                accounts,
            ) {
                return Ok(());
            }
            return ameba_dlmm::process_instruction(program_id, accounts, tag, payload);
        }
    }
    #[cfg(feature = "devnet-solo-backfill-2026")]
    if devnet_solo_backfill_2026::is_instruction_tag(*tag_bytes) {
        if context.is_compressed_inner()
            && !devnet_solo_backfill_2026::is_compressed_state_transport_tag(*tag_bytes)
        {
            return Err(VaultError::InvalidInstructionData.into());
        }
        #[cfg(all(test, feature = "phase3-synthetic-governance-controller"))]
        if context.capture_handler_boundary(
            HandlerBoundaryFamily::DevnetBackfill,
            *tag_bytes,
            payload,
            accounts,
        ) {
            return Ok(());
        }
        return devnet_solo_backfill_2026::process_instruction(
            program_id, accounts, *tag_bytes, payload,
        );
    }
    let tag =
        VaultInstructionTag::from_byte(*tag_bytes).ok_or(VaultError::InvalidInstructionData)?;
    if context.is_compressed_inner() && tag == VaultInstructionTag::ExecuteCompressedStateV1 {
        return Err(VaultError::InvalidInstructionData.into());
    }

    match tag as u8 {
        0..=63 => dispatch_0_63(program_id, accounts, tag, payload, context),
        64..=124 => dispatch_64_124(program_id, accounts, tag, payload, context),
        128..=158 => dispatch_128_158(program_id, accounts, tag, payload, context),
        161..=187 | 189..=205 => dispatch_161_205(program_id, accounts, tag, payload, context),
        159 | 160 | 188 | 220..=251 => {
            #[cfg(all(test, feature = "phase3-synthetic-governance-controller"))]
            if context.capture_handler_boundary(
                HandlerBoundaryFamily::WriterSleeve,
                *tag_bytes,
                payload,
                accounts,
            ) {
                return Ok(());
            }
            writer_sleeve::process_instruction(
                program_id,
                accounts,
                tag,
                payload,
                context.is_compressed_inner(),
            )
        }
        _ => Err(VaultError::InvalidInstructionData.into()),
    }
}

#[inline(never)]
pub(super) fn dispatch_0_63(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    tag: VaultInstructionTag,
    payload: &[u8],
    context: &ExecutionContext<'_>,
) -> ProgramResult {
    // OracleCarryForwardV1 is tag 30 and therefore belongs to this low-tag bucket.  Keep its
    // context-aware transport check on the existing carry handler; the old arm in
    // dispatch_64_124 was unreachable because the outer range split is exhaustive.
    if tag == VaultInstructionTag::OracleCarryForwardV1 {
        #[cfg(all(test, feature = "phase3-synthetic-governance-controller"))]
        if context.capture_handler_boundary(
            HandlerBoundaryFamily::OrdinaryVault,
            tag as u8,
            payload,
            accounts,
        ) {
            return Ok(());
        }
        return oracle_carry::process(program_id, accounts, payload, context.is_compressed_inner());
    }
    let handler: fn(&Pubkey, &[AccountInfo], &[u8]) -> ProgramResult = match tag {
        VaultInstructionTag::Initialize => process_initialize_instruction,
        VaultInstructionTag::UpdateConfig => process_update_config_instruction,
        VaultInstructionTag::DepositUsdc => process_deposit_instruction,
        VaultInstructionTag::InitUserCollateral => process_init_user_collateral_instruction,
        VaultInstructionTag::DepositCollateral => process_deposit_collateral_instruction,
        VaultInstructionTag::WithdrawCollateral => process_withdraw_collateral_instruction,

        VaultInstructionTag::CloseOracleMonth => process_close_oracle_month_instruction,
        _ => return Err(VaultError::InvalidInstructionData.into()),
    };
    #[cfg(all(test, feature = "phase3-synthetic-governance-controller"))]
    if context.capture_handler_boundary(
        HandlerBoundaryFamily::OrdinaryVault,
        tag as u8,
        payload,
        accounts,
    ) {
        return Ok(());
    }
    #[cfg(not(all(test, feature = "phase3-synthetic-governance-controller")))]
    let _ = context;
    handler(program_id, accounts, payload)
}

#[inline(never)]
pub(super) fn dispatch_64_124(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    tag: VaultInstructionTag,
    payload: &[u8],
    context: &ExecutionContext<'_>,
) -> ProgramResult {
    let compressed_state_transport = context.is_compressed_inner();
    match tag {
        VaultInstructionTag::RotateVaultAuthoritiesV2 => {
            let params: RotateVaultAuthoritiesV2Params = decode_instruction_payload(payload)?;
            process_rotate_vault_authorities_v2(program_id, accounts, params)
        }
        VaultInstructionTag::InitMarketV2 => {
            process_init_market_v2_instruction(program_id, accounts, payload)
        }
        VaultInstructionTag::SetMarketPaused => {
            process_set_market_paused_instruction(program_id, accounts, payload)
        }
        VaultInstructionTag::InitializeSettlementSignerRegistry => {
            process_initialize_settlement_signer_registry_instruction(program_id, accounts, payload)
        }
        VaultInstructionTag::ProposeSettlementSignerRotation => {
            process_propose_settlement_signer_rotation_instruction(
                program_id, accounts, payload, false,
            )
        }
        VaultInstructionTag::ActivateSettlementSignerRotation => {
            expect_empty_payload(payload)?;
            process_activate_settlement_signer_rotation(program_id, accounts)
        }
        VaultInstructionTag::CancelSettlementSignerRotation => {
            expect_empty_payload(payload)?;
            process_cancel_settlement_signer_rotation(program_id, accounts)
        }
        VaultInstructionTag::ProposeEmergencySettlementSignerRecovery => {
            process_propose_settlement_signer_rotation_instruction(
                program_id, accounts, payload, true,
            )
        }
        VaultInstructionTag::UpsertSettlementV3 => {
            process_upsert_settlement_v3_instruction(program_id, accounts, payload)
        }
        VaultInstructionTag::UpsertMarketPageV2 => {
            process_upsert_market_page_instruction(program_id, accounts, payload)
        }
        VaultInstructionTag::ConfigureOracleEconomicsTemplateV2 => {
            process_configure_oracle_economics_template_v2_instruction(
                program_id, accounts, payload,
            )
        }

        VaultInstructionTag::AccumulateOracleRecipeBucketV2 => {
            require_compressed_state_transport(compressed_state_transport)?;
            process_accumulate_oracle_recipe_bucket_v2_instruction(program_id, accounts, payload)
        }
        VaultInstructionTag::FinalizeOracleRecipeWeightsV2 => {
            process_finalize_oracle_recipe_weights_v2_instruction(program_id, accounts, payload)
        }
        VaultInstructionTag::AccumulateOracleSettlementSourceBucket => {
            process_accumulate_oracle_settlement_source_bucket_instruction(
                program_id, accounts, payload,
            )
        }
        VaultInstructionTag::BeginOracleActiveWeights => {
            process_begin_oracle_active_weights_instruction(program_id, accounts, payload)
        }
        VaultInstructionTag::AccumulateOracleActiveWeightGroup => {
            require_compressed_state_transport(compressed_state_transport)?;
            process_accumulate_oracle_active_weight_group_instruction(program_id, accounts, payload)
        }
        VaultInstructionTag::FinalizeOracleActiveWeights => {
            process_finalize_oracle_active_weights_instruction(program_id, accounts, payload)
        }
        VaultInstructionTag::FinalizeOracleOpeningPhase => {
            process_finalize_oracle_opening_phase_instruction(program_id, accounts, payload)
        }
        VaultInstructionTag::ExpireOracleOpeningSource => {
            require_compressed_state_transport(compressed_state_transport)?;
            process_expire_oracle_opening_source_instruction(program_id, accounts, payload)
        }
        VaultInstructionTag::FinalizeOracleMonth => {
            process_finalize_oracle_month_instruction(program_id, accounts, payload)
        }
        _ => Err(VaultError::InvalidInstructionData.into()),
    }
}

#[inline(never)]
pub(super) fn dispatch_128_158(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    tag: VaultInstructionTag,
    payload: &[u8],
    context: &ExecutionContext<'_>,
) -> ProgramResult {
    let compressed_state_transport = context.is_compressed_inner();
    match tag {
        VaultInstructionTag::BootstrapVaultGovernanceV2 => {
            let params = BootstrapVaultGovernanceV2Params {
                new_oracle_authority: Pubkey::new_from_array(decode_bytes32_payload(payload)?),
            };
            process_bootstrap_vault_governance_v2(program_id, accounts, params)
        }
        VaultInstructionTag::ActivateVaultV2 => {
            let params = ActivateVaultV2Params {
                expected_collateral_freeze_authority: decode_optional_bytes32_payload(payload)?
                    .map(Pubkey::new_from_array),
            };
            process_activate_vault_v2(program_id, accounts, params)
        }
        VaultInstructionTag::AdminAssistedWithdrawCollateral => {
            process_admin_assisted_withdraw_collateral_instruction(program_id, accounts, payload)
        }
        VaultInstructionTag::InitializeOracleUsdcRewardVault => {
            expect_empty_payload(payload)?;
            oracle_usdc::process_initialize_oracle_usdc_reward_vault(program_id, accounts)
        }
        VaultInstructionTag::DepositOracleUsdcRewards => {
            let params = DepositOracleUsdcRewardsParams {
                amount: decode_u64_payload(payload)?,
            };
            oracle_usdc::process_deposit_oracle_usdc_rewards(program_id, accounts, params)
        }
        VaultInstructionTag::BeginOracleUsdcRewardSchedule => {
            expect_empty_payload(payload)?;
            oracle_usdc::process_begin_oracle_usdc_reward_schedule(program_id, accounts)
        }
        VaultInstructionTag::AddOracleUsdcSkuBudget => {
            let params: AddOracleUsdcSkuBudgetParams = decode_instruction_payload(payload)?;
            require_compressed_state_transport(compressed_state_transport)?;
            oracle_usdc::process_add_oracle_usdc_sku_budget(program_id, accounts, params)
        }
        VaultInstructionTag::FinalizeOracleUsdcRewardSchedule => {
            expect_empty_payload(payload)?;
            oracle_usdc::process_finalize_oracle_usdc_reward_schedule(program_id, accounts)
        }

        _ => Err(VaultError::InvalidInstructionData.into()),
    }
}

#[inline(never)]
pub(super) fn dispatch_161_205(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    tag: VaultInstructionTag,
    payload: &[u8],
    context: &ExecutionContext<'_>,
) -> ProgramResult {
    let compressed_state_transport = context.is_compressed_inner();
    match tag {
        VaultInstructionTag::CreateMarketContractMintV3 => {
            process_create_market_contract_mint_v3_instruction(program_id, accounts, payload)
        }
        VaultInstructionTag::InitializeOracleMonthV5 => {
            let params: InitializeOracleMonthV5Params = decode_instruction_payload(payload)?;
            process_initialize_oracle_month_v5(program_id, accounts, params)
        }
        VaultInstructionTag::ConfigureOracleProductSkuManifest => {
            let params: ConfigureOracleProductSkuManifestParams =
                decode_instruction_payload(payload)?;
            process_configure_oracle_product_sku_manifest(program_id, accounts, params)
        }
        VaultInstructionTag::ExecuteCompressedStateV1 => {
            let params: ExecuteCompressedStateParams = decode_instruction_payload(payload)?;
            #[cfg(all(test, feature = "phase3-synthetic-governance-controller"))]
            if context.capture_handler_boundary(
                HandlerBoundaryFamily::CompressedOuter,
                tag as u8,
                payload,
                accounts,
            ) {
                return Ok(());
            }
            compressed_state::process_execute_compressed_state_v1(
                program_id,
                accounts,
                params,
                context.gate(),
            )
        }
        VaultInstructionTag::ExpireUnlistableOracleSourceV2 => {
            expect_empty_payload(payload)?;
            require_compressed_state_transport(compressed_state_transport)?;
            process_expire_unlistable_oracle_source_v2(program_id, accounts)
        }
        VaultInstructionTag::CancelStaleOracleSourceChallengeV2 => {
            expect_empty_payload(payload)?;
            process_cancel_stale_oracle_source_challenge_v2(program_id, accounts)
        }

        VaultInstructionTag::SettleFailedOracleMonthEscrowV2 => {
            let params = SettleOracleEscrowParams {
                kind: match decode_u8_payload(payload)? {
                    0 => OracleEscrowKind::ListingBond,
                    1 => OracleEscrowKind::SupportStake,
                    2 => OracleEscrowKind::SourceChallenge,
                    3 => OracleEscrowKind::OpeningClaim,
                    4 => OracleEscrowKind::OpeningChallenge,
                    5 => OracleEscrowKind::UpdateClaim,
                    6 => OracleEscrowKind::UpdateChallenge,
                    _ => return Err(VaultError::InvalidInstructionData.into()),
                },
            };
            if matches!(
                params.kind,
                OracleEscrowKind::ListingBond
                    | OracleEscrowKind::SupportStake
                    | OracleEscrowKind::SourceChallenge
            ) {
                require_compressed_state_transport(compressed_state_transport)?;
            }
            oracle_usdc_rewards::process_settle_failed_oracle_month_escrow_v2(
                program_id, accounts, params,
            )
        }
        VaultInstructionTag::AbortOracleUsdcRewardScheduleV2 => {
            expect_empty_payload(payload)?;
            oracle_usdc_rewards::process_abort_oracle_usdc_reward_schedule_v2(program_id, accounts)
        }
        VaultInstructionTag::TimeoutUnsupportedOracleSourceV2 => {
            expect_empty_payload(payload)?;
            require_compressed_state_transport(compressed_state_transport)?;
            oracle_usdc::process_timeout_unsupported_oracle_source_v2(program_id, accounts)
        }
        VaultInstructionTag::RecomputeOracleBucketMedianV1 => {
            let params: RecomputeOracleBucketMedianV1Params = decode_instruction_payload(payload)?;
            require_compressed_state_transport(compressed_state_transport)?;
            process_recompute_oracle_bucket_median_v1(program_id, accounts, params)
        }
        VaultInstructionTag::IndexOracleRecipeSourceV1 => {
            let params: crate::instruction::IndexOracleRecipeSourceV1Params =
                decode_instruction_payload(payload)?;
            oracle_membership::process_index_oracle_recipe_source(program_id, accounts, params)
        }
        VaultInstructionTag::RevealOracleUpdateClaimV3 => {
            let params: RevealOracleUpdateClaimV3Params = decode_instruction_payload(payload)?;
            require_compressed_state_transport(compressed_state_transport)?;
            oracle_usdc::process_reveal_oracle_update_claim_v3(program_id, accounts, params)
        }
        VaultInstructionTag::FinalizeOracleUpdateClaimV2 => {
            let (outcome, current_step) = decode_u8_u64_payload(payload)?;
            let params = FinalizeOracleUpdateClaimV2Params {
                outcome: match outcome {
                    0 => OracleUpdateClaimOutcome::AcceptClaim,
                    1 => OracleUpdateClaimOutcome::RejectClaim,
                    2 => OracleUpdateClaimOutcome::RuleReviewUnresolved,
                    _ => return Err(VaultError::InvalidInstructionData.into()),
                },
                current_step,
            };
            require_compressed_state_transport(compressed_state_transport)?;
            oracle_usdc::process_finalize_oracle_update_claim_v2(program_id, accounts, params)
        }
        VaultInstructionTag::ProposeOracleSourceV3 => {
            let params: ProposeOracleSourceV3Params = decode_instruction_payload(payload)?;
            require_compressed_state_transport(compressed_state_transport)?;
            oracle_usdc::process_propose_oracle_source_v3(program_id, accounts, params)
        }
        VaultInstructionTag::SupportOracleSourceV3 => {
            let params: SupportOracleSourceV3Params = decode_instruction_payload(payload)?;
            require_compressed_state_transport(compressed_state_transport)?;
            oracle_usdc::process_support_oracle_source_v3(program_id, accounts, params)
        }
        VaultInstructionTag::FinalizeOracleSkuCoverage => {
            expect_empty_payload(payload)?;
            process_finalize_oracle_sku_coverage(program_id, accounts)
        }
        VaultInstructionTag::ChallengeOracleSourceV2 => {
            let params: ChallengeOracleSourceParams = decode_instruction_payload(payload)?;
            require_compressed_state_transport(compressed_state_transport)?;
            oracle_usdc::process_challenge_oracle_source_v2(program_id, accounts, params)
        }
        VaultInstructionTag::ResolveOracleSourceChallengeV2 => {
            let params = ResolveOracleSourceChallengeParams {
                outcome: match decode_u8_payload(payload)? {
                    0 => OracleSourceChallengeOutcome::KeepSource,
                    1 => OracleSourceChallengeOutcome::RejectSource,
                    2 => OracleSourceChallengeOutcome::RuleReviewUnresolved,
                    3 => OracleSourceChallengeOutcome::MergeSource,
                    _ => return Err(VaultError::InvalidInstructionData.into()),
                },
            };
            require_compressed_state_transport(compressed_state_transport)?;
            process_resolve_oracle_source_challenge(program_id, accounts, params)
        }
        VaultInstructionTag::CancelStaleOracleUpdateClaimV2 => {
            expect_empty_payload(payload)?;
            require_compressed_state_transport(compressed_state_transport)?;
            oracle_usdc::process_cancel_stale_oracle_update_claim_v2(program_id, accounts)
        }

        VaultInstructionTag::ReopenOracleSkuCoverage => {
            expect_empty_payload(payload)?;
            process_reopen_oracle_sku_coverage(program_id, accounts)
        }
        VaultInstructionTag::BeginOracleRecipeWeightsV3 => {
            let (expected_source_count, expected_bucket_count) = decode_u16_pair_payload(payload)?;
            let params = BeginOracleRecipeWeightsV2Params {
                expected_source_count,
                expected_bucket_count,
            };
            process_begin_oracle_recipe_weights_v2(program_id, accounts, params)
        }
        VaultInstructionTag::SubmitOracleOpeningClaimV2 => {
            let params: SubmitOracleOpeningClaimParams = decode_instruction_payload(payload)?;
            require_compressed_state_transport(compressed_state_transport)?;
            oracle_usdc::process_submit_oracle_opening_claim_v2(program_id, accounts, params)
        }
        VaultInstructionTag::ChallengeOracleOpeningClaimV2 => {
            let params: ChallengeOracleOpeningClaimParams = decode_instruction_payload(payload)?;
            require_compressed_state_transport(compressed_state_transport)?;
            oracle_usdc::process_challenge_oracle_opening_claim_v2(program_id, accounts, params)
        }
        VaultInstructionTag::ResolveOracleOpeningClaimChallengeV2 => {
            let params = ResolveOracleOpeningClaimChallengeParams {
                outcome: match decode_u8_payload(payload)? {
                    0 => OracleOpeningChallengeOutcome::KeepOpening,
                    1 => OracleOpeningChallengeOutcome::AcceptAlternativeOpening,
                    2 => OracleOpeningChallengeOutcome::SourceInactiveForMonth,
                    3 => OracleOpeningChallengeOutcome::RuleReviewUnresolved,
                    4 => OracleOpeningChallengeOutcome::RejectOpeningForRetry,
                    _ => return Err(VaultError::InvalidInstructionData.into()),
                },
            };
            require_compressed_state_transport(compressed_state_transport)?;
            oracle_usdc::process_resolve_oracle_opening_claim_challenge_v2(
                program_id, accounts, params,
            )
        }
        VaultInstructionTag::FinalizeOracleOpeningClaimV2 => {
            expect_empty_payload(payload)?;
            require_compressed_state_transport(compressed_state_transport)?;
            oracle_usdc::process_finalize_oracle_opening_claim_v2(program_id, accounts)
        }
        VaultInstructionTag::CommitOracleUpdateClaimV3 => {
            let params: CommitOracleUpdateClaimV2Params = decode_instruction_payload(payload)?;
            require_compressed_state_transport(compressed_state_transport)?;
            oracle_usdc::process_commit_oracle_update_claim_v3(program_id, accounts, params)
        }
        VaultInstructionTag::SettleExpiredOracleUpdateCommitmentV3 => {
            expect_empty_payload(payload)?;
            require_compressed_state_transport(compressed_state_transport)?;
            oracle_usdc::process_settle_expired_oracle_update_commitment_v3(program_id, accounts)
        }
        VaultInstructionTag::ChallengeOracleUpdateClaimV2 => {
            let params: ChallengeOracleUpdateClaimParams = decode_instruction_payload(payload)?;
            require_compressed_state_transport(compressed_state_transport)?;
            oracle_usdc::process_challenge_oracle_update_claim_v2(program_id, accounts, params)
        }

        VaultInstructionTag::SettleOracleUsdcEscrow => {
            let params = SettleOracleEscrowParams {
                kind: match decode_u8_payload(payload)? {
                    0 => OracleEscrowKind::ListingBond,
                    1 => OracleEscrowKind::SupportStake,
                    2 => OracleEscrowKind::SourceChallenge,
                    3 => OracleEscrowKind::OpeningClaim,
                    4 => OracleEscrowKind::OpeningChallenge,
                    5 => OracleEscrowKind::UpdateClaim,
                    6 => OracleEscrowKind::UpdateChallenge,
                    _ => return Err(VaultError::InvalidInstructionData.into()),
                },
            };
            if !matches!(params.kind, OracleEscrowKind::UpdateChallenge) {
                require_compressed_state_transport(compressed_state_transport)?;
            }
            oracle_usdc_rewards::process_settle_oracle_usdc_escrow(program_id, accounts, params)
        }
        VaultInstructionTag::RegisterOracleUsdcRewardSource => {
            expect_empty_payload(payload)?;
            require_compressed_state_transport(compressed_state_transport)?;
            #[cfg(all(test, feature = "phase3-synthetic-governance-controller"))]
            if context.capture_handler_boundary(
                HandlerBoundaryFamily::CompressedInnerVault,
                tag as u8,
                payload,
                accounts,
            ) {
                return Ok(());
            }
            oracle_usdc_rewards::process_register_oracle_usdc_reward_source(program_id, accounts)
        }
        VaultInstructionTag::RegisterOracleUsdcRewardUpdate => {
            expect_empty_payload(payload)?;
            require_compressed_state_transport(compressed_state_transport)?;
            oracle_usdc_rewards::process_register_oracle_usdc_reward_update(program_id, accounts)
        }
        VaultInstructionTag::FinalizeOracleUsdcRewardEntitlements => {
            expect_empty_payload(payload)?;
            oracle_usdc_rewards::process_finalize_oracle_usdc_reward_entitlements(
                program_id, accounts,
            )
        }
        VaultInstructionTag::ClaimOracleUsdcReward => {
            let params = ClaimOracleUsdcRewardParams {
                kind: match decode_u8_payload(payload)? {
                    0 => OracleUsdcRewardKind::SourceProposer,
                    1 => OracleUsdcRewardKind::SourceSupport,
                    2 => OracleUsdcRewardKind::Opening,
                    3 => OracleUsdcRewardKind::Update,
                    _ => return Err(VaultError::InvalidInstructionData.into()),
                },
            };
            require_compressed_state_transport(compressed_state_transport)?;
            oracle_usdc_rewards::process_claim_oracle_usdc_reward(program_id, accounts, params)
        }
        _ => Err(VaultError::InvalidInstructionData.into()),
    }
}

pub(super) fn require_compressed_state_transport(enabled: bool) -> ProgramResult {
    if enabled {
        Ok(())
    } else {
        Err(VaultError::CompressedStateTransportRequired.into())
    }
}

#[cfg(all(test, feature = "governance-gate-v1"))]
mod oracle_carry_dispatch_tests {
    use super::{process_instruction_with_context, ExecutionContext};
    use crate::{
        governance_gate::{
            derive_controller_config_pda, derive_protocol_gate_pda, derive_target_programdata_pda,
            validate_top_level_envelope, GovernanceInstructionTailV1, PINNED_CONTROLLER_PROGRAM_ID,
            PROTOCOL_GATE_DISCRIMINATOR, PROTOCOL_GATE_LEN, PROTOCOL_GATE_VERSION_V1,
        },
        instruction::VaultInstructionTag,
    };
    use solana_program::{account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey};

    #[test]
    fn tag_30_reaches_oracle_carry_router_before_account_validation() {
        let program = crate::id();
        let (gate_key, bump) = derive_protocol_gate_pda(&PINNED_CONTROLLER_PROGRAM_ID, &program);
        let controller_config =
            derive_controller_config_pda(&PINNED_CONTROLLER_PROGRAM_ID, &program).0;
        let mut gate_data = vec![0u8; PROTOCOL_GATE_LEN];
        gate_data[0..8].copy_from_slice(&PROTOCOL_GATE_DISCRIMINATOR);
        gate_data[8] = PROTOCOL_GATE_VERSION_V1;
        gate_data[9] = bump;
        gate_data[10] = 1;
        gate_data[11] = 0;
        gate_data[12..44].copy_from_slice(controller_config.as_ref());
        gate_data[44..76].copy_from_slice(program.as_ref());
        gate_data[76..108].copy_from_slice(derive_target_programdata_pda(&program).as_ref());
        gate_data[108..116].copy_from_slice(&1u64.to_le_bytes());
        let gate_owner = PINNED_CONTROLLER_PROGRAM_ID;
        let mut gate_lamports = 1;
        let gate_info = AccountInfo::new(
            &gate_key,
            false,
            false,
            &mut gate_lamports,
            &mut gate_data,
            &gate_owner,
            false,
            0,
        );

        // Seven accounts satisfy RegisterRoot's carry access contract. The first is deliberately
        // non-signing, so the intended carry handler returns its first authority error. The old
        // unreachable placement instead returned generic InvalidInstructionData from dispatch_0_63.
        let business_key = Pubkey::new_unique();
        let business_owner = Pubkey::new_unique();
        let mut business_lamports = 1;
        let mut business_data = [0u8; 1];
        let business = AccountInfo::new(
            &business_key,
            false,
            false,
            &mut business_lamports,
            &mut business_data,
            &business_owner,
            false,
            0,
        );
        let business_accounts = vec![business; 7];
        let mut instruction_data = vec![VaultInstructionTag::OracleCarryForwardV1 as u8, 0];
        instruction_data.extend_from_slice(&GovernanceInstructionTailV1::for_epoch(1).encode());
        let all_accounts = business_accounts
            .iter()
            .cloned()
            .chain(std::iter::once(gate_info))
            .collect::<Vec<_>>();
        let (legacy_accounts, legacy_data, gate) =
            validate_top_level_envelope(&program, &all_accounts, &instruction_data).unwrap();
        let context = ExecutionContext::top_level(&gate);
        assert_eq!(
            legacy_data,
            &[VaultInstructionTag::OracleCarryForwardV1 as u8, 0]
        );
        assert_eq!(
            process_instruction_with_context(&program, legacy_accounts, legacy_data, &context),
            Err(ProgramError::MissingRequiredSignature)
        );
    }
}

#[cfg(all(test, not(feature = "governance-gate-v1")))]
mod compressed_transport_gate_tests {
    use super::{process_instruction, process_instruction_with_context, ExecutionContext};
    use crate::{
        ameba_dlmm_instruction::AmoebaDlmmInstructionTag,
        error::VaultError,
        instruction::{AddOracleUsdcSkuBudgetParams, VaultInstruction, VaultInstructionTag},
    };
    use borsh::BorshSerialize;
    use solana_program::{program_error::ProgramError, pubkey::Pubkey};

    fn current_message(mut data: Vec<u8>) -> Vec<u8> {
        if crate::business_generation::requires_generation(data[0]) {
            data.extend_from_slice(crate::business_generation::BUSINESS_MESSAGE_SUFFIX);
        }
        data
    }

    #[test]
    #[cfg(not(feature = "devnet-solo-backfill-2026"))]
    fn unknown_instruction_bytes_use_the_generic_invalid_instruction_path() {
        let program_id = Pubkey::new_unique();
        for tag in [29u8, 31, 34, 35, 69, 97, 189, 204, 206, 211, 212, 214] {
            assert!(VaultInstructionTag::from_byte(tag).is_none());
            assert!(AmoebaDlmmInstructionTag::from_byte(tag).is_none());
            assert_eq!(
                process_instruction(&program_id, &[], &[tag, 0xff, 0xff]),
                Err(ProgramError::Custom(
                    VaultError::InvalidInstructionData as u32
                )),
                "unknown tag {tag}"
            );
        }
    }

    #[test]
    fn reserved_writer_tags_remain_generic_invalid_instructions() {
        let program_id = Pubkey::new_unique();
        for tag in 250u8..=251 {
            assert_eq!(
                process_instruction(&program_id, &[], &[tag, 0xff]),
                Err(ProgramError::Custom(
                    VaultError::InvalidInstructionData as u32
                )),
                "reserved tag {tag}"
            );
        }
    }

    #[test]
    fn high_rent_create_decodes_before_requiring_compressed_transport() {
        let data = VaultInstruction::AddOracleUsdcSkuBudget {
            params: AddOracleUsdcSkuBudgetParams {
                bucket_id: [1; 32],
                source_reward_budget: 1,
                opening_reward_budget: 1,
                update_reward_budget: 1,
                proposer_reward_bps: 1,
                listing_bond: 1,
                support_bond: 1,
                opening_bond: 1,
                update_min_bond: 1,
                challenge_min_bond: 1,
                challenge_max_bond: 1,
                challenge_bond_bps: 1,
            },
        }
        .try_to_vec()
        .unwrap();
        assert_eq!(
            process_instruction(&Pubkey::new_unique(), &[], &current_message(data.to_vec())),
            Err(ProgramError::Custom(
                VaultError::CompressedStateTransportRequired as u32
            ))
        );
        assert_eq!(
            process_instruction(
                &Pubkey::new_unique(),
                &[],
                &[crate::instruction::VaultInstructionTag::AddOracleUsdcSkuBudget as u8],
            ),
            Err(ProgramError::Custom(
                VaultError::InvalidInstructionData as u32
            ))
        );
    }

    #[test]
    fn compressed_consumers_cannot_fall_back_to_classic_accounts() {
        let program_id = Pubkey::new_unique();
        for data in [
            vec![VaultInstructionTag::RegisterOracleUsdcRewardSource as u8],
            vec![VaultInstructionTag::RegisterOracleUsdcRewardUpdate as u8],
            vec![VaultInstructionTag::ClaimOracleUsdcReward as u8, 0],
            vec![VaultInstructionTag::ResolveOracleSourceChallengeV2 as u8, 0],
            vec![VaultInstructionTag::SettleOracleUsdcEscrow as u8, 0],
            vec![VaultInstructionTag::SettleOracleUsdcEscrow as u8, 1],
            vec![
                VaultInstructionTag::SettleFailedOracleMonthEscrowV2 as u8,
                2,
            ],
            vec![
                VaultInstructionTag::SettleFailedOracleMonthEscrowV2 as u8,
                1,
            ],
        ] {
            assert_eq!(
                process_instruction(&program_id, &[], &current_message(data.to_vec())),
                Err(ProgramError::Custom(
                    VaultError::CompressedStateTransportRequired as u32
                )),
                "tag {} did not fail closed",
                data[0],
            );
        }

        assert_eq!(
            process_instruction(
                &program_id,
                &[],
                &[VaultInstructionTag::ClaimOracleUsdcReward as u8],
            ),
            Err(ProgramError::Custom(
                VaultError::InvalidInstructionData as u32
            ))
        );
    }

    #[test]
    fn zero_byte_instruction_payloads_reject_trailing_data_before_account_access() {
        let program_id = Pubkey::new_unique();
        for tag in [VaultInstructionTag::BeginOracleUsdcRewardSchedule] {
            assert_eq!(
                process_instruction(&program_id, &[], &[tag as u8, 0]),
                Err(ProgramError::Custom(
                    VaultError::InvalidInstructionData as u32
                )),
                "tag {} accepted a nonempty zero-byte payload",
                tag as u8,
            );
        }
    }

    #[test]
    fn light_lifecycle_uses_current_tags_and_cannot_be_nested() {
        let program_id = Pubkey::new_unique();
        for tag in [
            AmoebaDlmmInstructionTag::InitializeLightConfig,
            AmoebaDlmmInstructionTag::UpdateLightConfig,
            AmoebaDlmmInstructionTag::CompressLightState,
            AmoebaDlmmInstructionTag::DecompressLightState,
        ] {
            assert_eq!(AmoebaDlmmInstructionTag::from_byte(tag as u8), Some(tag));
            assert_eq!(
                process_instruction(&program_id, &[], &[tag as u8]),
                Err(ProgramError::Custom(
                    VaultError::InvalidAmoebaDlmmLightLifecycle as u32
                )),
                "current lifecycle tag {} did not reach lifecycle validation",
                tag as u8,
            );
            let gate = crate::governance_gate::test_capability(0);
            let context = ExecutionContext::compressed_inner(&gate);
            assert_eq!(
                process_instruction_with_context(&program_id, &[], &[tag as u8], &context),
                Err(ProgramError::Custom(
                    VaultError::InvalidInstructionData as u32
                )),
                "current lifecycle tag {} was accepted inside compressed transport",
                tag as u8,
            );
        }
    }

    #[test]
    fn former_light_discriminators_use_the_ordinary_one_byte_decoder() {
        let program_id = Pubkey::new_unique();

        // The former compression discriminator began with unassigned tag 70.
        assert_eq!(
            process_instruction(&program_id, &[], &[70, 236, 171, 120, 164, 93, 113, 181],),
            Err(ProgramError::Custom(
                VaultError::InvalidInstructionData as u32
            )),
        );

        // The former decompression prefix began with retired tag 114. With no
        // compatibility dispatch it fails as an invalid instruction.
        assert_eq!(
            process_instruction(&program_id, &[], &[114, 67, 61, 123, 234, 31, 1, 112]),
            Err(ProgramError::Custom(
                VaultError::InvalidInstructionData as u32
            )),
        );

        // The other former prefixes are current zero-payload tags. Their seven
        // trailing bytes therefore fail the ordinary payload decoder, not the
        // Light lifecycle validator.
        for data in [
            [133, 228, 12, 169, 56, 76, 222, 61],
            [135, 215, 243, 81, 163, 146, 33, 70],
        ] {
            assert_eq!(
                process_instruction(&program_id, &[], &current_message(data.to_vec())),
                Err(ProgramError::Custom(
                    VaultError::InvalidInstructionData as u32
                )),
            );
        }
    }
}

#[cfg(all(test, feature = "phase3-synthetic-governance-controller"))]
mod governance_precedence_tests {
    use super::{
        process_instruction_with_context, process_top_level_instruction, DispatchTransport,
        ExecutionContext, HandlerBoundaryAccount, HandlerBoundaryCapture, HandlerBoundaryFamily,
        HandlerBoundaryProbe, TEST_STACK_HEIGHT_READS,
    };
    use crate::{
        ameba_dlmm_instruction::AmoebaDlmmInstructionTag,
        error::VaultError,
        governance_gate::{
            derive_controller_config_pda, derive_protocol_gate_pda, derive_target_programdata_pda,
            validate_top_level_envelope, GovernanceInstructionTailV1, GOVERNANCE_TAIL_LEN,
            PINNED_CONTROLLER_PROGRAM_ID, PROTOCOL_GATE_DISCRIMINATOR, PROTOCOL_GATE_LEN,
            PROTOCOL_GATE_VERSION_V1,
        },
        governance_manifest::{classify_active_instruction_tag, InstructionGovernanceClass},
        instruction::{ExecuteCompressedStateParams, VaultInstructionTag},
    };
    use light_sdk::proof::borsh_compat::ValidityProof;
    use solana_program::{account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey};

    const TEST_EPOCH: u64 = 41;

    fn active_gate_bytes(epoch: u64) -> [u8; PROTOCOL_GATE_LEN] {
        let target = crate::id();
        let (_, bump) = derive_protocol_gate_pda(&PINNED_CONTROLLER_PROGRAM_ID, &target);
        let controller_config =
            derive_controller_config_pda(&PINNED_CONTROLLER_PROGRAM_ID, &target).0;
        let mut bytes = [0u8; PROTOCOL_GATE_LEN];
        bytes[0..8].copy_from_slice(&PROTOCOL_GATE_DISCRIMINATOR);
        bytes[8] = PROTOCOL_GATE_VERSION_V1;
        bytes[9] = bump;
        bytes[10] = 1;
        bytes[11] = 0;
        bytes[12..44].copy_from_slice(controller_config.as_ref());
        bytes[44..76].copy_from_slice(target.as_ref());
        bytes[76..108].copy_from_slice(derive_target_programdata_pda(&target).as_ref());
        bytes[108..116].copy_from_slice(&epoch.to_le_bytes());
        bytes
    }

    fn account_boundary(accounts: &[AccountInfo]) -> Vec<HandlerBoundaryAccount> {
        accounts
            .iter()
            .map(|account| HandlerBoundaryAccount {
                account_info_address: account as *const AccountInfo as usize,
                key: *account.key,
                owner: *account.owner,
                is_signer: account.is_signer,
                is_writable: account.is_writable,
                executable: account.executable,
                rent_epoch: account.rent_epoch,
            })
            .collect()
    }

    fn capture_top_level_handler_boundary(
        accounts: &[AccountInfo],
        legacy_data: &[u8],
    ) -> HandlerBoundaryCapture {
        let mut governed_data = legacy_data.to_vec();
        governed_data
            .extend_from_slice(&GovernanceInstructionTailV1::for_epoch(TEST_EPOCH).encode());
        let (legacy_accounts, stripped_data, gate) =
            validate_top_level_envelope(&crate::id(), accounts, &governed_data)
                .expect("representative governance envelope validates");
        let probe = HandlerBoundaryProbe::default();
        let context =
            ExecutionContext::with_boundary_probe(&gate, DispatchTransport::TopLevel, &probe);
        assert_eq!(
            process_instruction_with_context(
                &crate::id(),
                legacy_accounts,
                stripped_data,
                &context,
            ),
            Ok(())
        );
        probe.take()
    }

    fn compressed_outer_legacy_data(inner_instruction: Vec<u8>) -> Vec<u8> {
        let params = ExecuteCompressedStateParams {
            core_account_count: 1,
            rent_payer_index: 0,
            proof: ValidityProof::default(),
            accesses: Vec::new(),
            inner_instruction,
        };
        let mut data = vec![VaultInstructionTag::ExecuteCompressedStateV1 as u8];
        data.extend_from_slice(
            &borsh::to_vec(&params).expect("serialize compressed outer payload"),
        );
        data
    }

    fn assert_boundary_equivalence(
        capture: HandlerBoundaryCapture,
        expected_family: HandlerBoundaryFamily,
        expected_accounts: &[AccountInfo],
        expected_legacy_data: &[u8],
        expected_transport: DispatchTransport,
    ) {
        assert_eq!(capture.family, expected_family);
        assert_eq!(capture.transport, expected_transport);
        assert_eq!(capture.tag, expected_legacy_data[0]);
        assert_eq!(capture.payload, expected_legacy_data[1..]);
        assert_eq!(capture.accounts, account_boundary(expected_accounts));
    }

    #[test]
    fn every_assigned_top_level_tag_requires_the_envelope() {
        for tag in 0u8..=u8::MAX {
            TEST_STACK_HEIGHT_READS.with(|reads| reads.set(0));
            let result = process_top_level_instruction(&crate::id(), &[], &[tag]);
            let class = classify_active_instruction_tag(tag);
            match class {
                InstructionGovernanceClass::RecognizedMutating
                | InstructionGovernanceClass::FeatureGatedMutating => assert_eq!(
                    result,
                    Err(ProgramError::Custom(
                        VaultError::MissingGovernanceTail as u32
                    )),
                    "assigned byte {tag}"
                ),
                InstructionGovernanceClass::Unknown
                | InstructionGovernanceClass::Reserved
                | InstructionGovernanceClass::RecognizedReadOnly => assert_eq!(
                    result,
                    Err(ProgramError::Custom(
                        VaultError::InvalidInstructionData as u32
                    )),
                    "unassigned byte {tag}"
                ),
            }
            let stack_height_reads = TEST_STACK_HEIGHT_READS.with(core::cell::Cell::get);
            assert_eq!(
                stack_height_reads,
                usize::from(matches!(
                    class,
                    InstructionGovernanceClass::RecognizedMutating
                        | InstructionGovernanceClass::FeatureGatedMutating
                )),
                "byte {tag} stack-height precedence"
            );
        }
    }

    #[test]
    fn governance_gate_accepts_only_transaction_level_stack_height() {
        let transaction_level = solana_program::instruction::TRANSACTION_LEVEL_STACK_HEIGHT;
        assert_eq!(
            super::require_transaction_level_stack_height(transaction_level),
            Ok(())
        );
        for rejected_height in [0, transaction_level + 1, usize::MAX] {
            assert_eq!(
                super::require_transaction_level_stack_height(rejected_height),
                Err(ProgramError::Custom(
                    VaultError::InvalidInstructionData as u32
                )),
                "stack height {rejected_height}"
            );
        }
    }

    #[test]
    fn unknown_and_reserved_tags_reject_before_borrowing_any_account_data() {
        let key = Pubkey::new_unique();
        let owner = Pubkey::new_unique();
        let mut lamports = 1;
        let mut data = [0u8; 1];
        let account = AccountInfo::new(
            &key,
            false,
            false,
            &mut lamports,
            &mut data,
            &owner,
            false,
            0,
        );
        let poison_borrow = account.try_borrow_mut_data().unwrap();
        for tag in 0u8..=u8::MAX {
            if matches!(
                classify_active_instruction_tag(tag),
                InstructionGovernanceClass::Unknown | InstructionGovernanceClass::Reserved
            ) {
                assert_eq!(
                    process_top_level_instruction(&crate::id(), &[account.clone()], &[tag]),
                    Err(ProgramError::Custom(
                        VaultError::InvalidInstructionData as u32
                    )),
                    "byte {tag} borrowed account data before rejection"
                );
            }
        }
        drop(poison_borrow);
    }

    #[test]
    fn valid_tail_without_a_gate_reports_the_missing_gate() {
        let mut data = vec![crate::instruction::VaultInstructionTag::UpdateConfig as u8];
        data.extend_from_slice(&GovernanceInstructionTailV1::for_epoch(41).encode());
        assert_eq!(data.len(), GOVERNANCE_TAIL_LEN + 1);
        assert_eq!(
            process_top_level_instruction(&crate::id(), &[], &data),
            Err(ProgramError::Custom(
                VaultError::MissingGovernanceGate as u32
            ))
        );
    }

    #[test]
    fn governed_top_level_routes_preserve_exact_handler_boundary_inputs() {
        let legacy_key_a = Pubkey::new_unique();
        let legacy_owner_a = Pubkey::new_unique();
        let mut legacy_lamports_a = 11;
        let mut legacy_data_a = [0xabu8; 3];
        let legacy_key_b = Pubkey::new_unique();
        let legacy_owner_b = Pubkey::new_unique();
        let mut legacy_lamports_b = 13;
        let mut legacy_data_b = [0xcdu8; 5];
        let gate_key = derive_protocol_gate_pda(&PINNED_CONTROLLER_PROGRAM_ID, &crate::id()).0;
        let gate_owner = PINNED_CONTROLLER_PROGRAM_ID;
        let mut gate_lamports = 17;
        let mut gate_data = active_gate_bytes(TEST_EPOCH);
        let accounts = vec![
            AccountInfo::new(
                &legacy_key_a,
                true,
                true,
                &mut legacy_lamports_a,
                &mut legacy_data_a,
                &legacy_owner_a,
                false,
                7,
            ),
            AccountInfo::new(
                &legacy_key_b,
                false,
                false,
                &mut legacy_lamports_b,
                &mut legacy_data_b,
                &legacy_owner_b,
                true,
                9,
            ),
            AccountInfo::new(
                &gate_key,
                false,
                false,
                &mut gate_lamports,
                &mut gate_data,
                &gate_owner,
                false,
                0,
            ),
        ];
        let representatives = [
            (
                HandlerBoundaryFamily::OrdinaryVault,
                VaultInstructionTag::UpdateConfig as u8,
            ),
            (
                HandlerBoundaryFamily::Dlmm,
                AmoebaDlmmInstructionTag::InitializeBinPageV1 as u8,
            ),
            (
                HandlerBoundaryFamily::DlmmLightLifecycle,
                AmoebaDlmmInstructionTag::InitializeLightConfig as u8,
            ),
            (
                HandlerBoundaryFamily::WriterSleeve,
                VaultInstructionTag::InitializeWriterPolicyRegistryV1 as u8,
            ),
        ];

        for (index, (family, tag)) in representatives.into_iter().enumerate() {
            let legacy_data = vec![tag, 0x10 + index as u8, 0x20, 0x30];
            let capture = capture_top_level_handler_boundary(&accounts, &legacy_data);
            assert_boundary_equivalence(
                capture,
                family,
                &accounts[..accounts.len() - 1],
                &legacy_data,
                DispatchTransport::TopLevel,
            );
        }

        let compressed_outer_data = compressed_outer_legacy_data(vec![
            VaultInstructionTag::RegisterOracleUsdcRewardSource as u8,
        ]);
        let capture = capture_top_level_handler_boundary(&accounts, &compressed_outer_data);
        assert_boundary_equivalence(
            capture,
            HandlerBoundaryFamily::CompressedOuter,
            &accounts[..accounts.len() - 1],
            &compressed_outer_data,
            DispatchTransport::TopLevel,
        );
    }

    #[test]
    fn validated_outer_capability_preserves_exact_compressed_inner_boundary_inputs() {
        let inner_key = Pubkey::new_unique();
        let inner_owner = Pubkey::new_unique();
        let mut inner_lamports = 19;
        let mut inner_account_data = [0xefu8; 7];
        let gate_key = derive_protocol_gate_pda(&PINNED_CONTROLLER_PROGRAM_ID, &crate::id()).0;
        let gate_owner = PINNED_CONTROLLER_PROGRAM_ID;
        let mut gate_lamports = 23;
        let mut gate_data = active_gate_bytes(TEST_EPOCH);
        let accounts = vec![
            AccountInfo::new(
                &inner_key,
                true,
                true,
                &mut inner_lamports,
                &mut inner_account_data,
                &inner_owner,
                false,
                5,
            ),
            AccountInfo::new(
                &gate_key,
                false,
                false,
                &mut gate_lamports,
                &mut gate_data,
                &gate_owner,
                false,
                0,
            ),
        ];
        let mut outer_data = compressed_outer_legacy_data(vec![
            VaultInstructionTag::RegisterOracleUsdcRewardSource as u8,
        ]);
        outer_data.extend_from_slice(&GovernanceInstructionTailV1::for_epoch(TEST_EPOCH).encode());
        let (outer_legacy_accounts, _, gate) =
            validate_top_level_envelope(&crate::id(), &accounts, &outer_data)
                .expect("outer compressed envelope validates");
        let inner_accounts = &outer_legacy_accounts[..1];
        let inner_data = vec![VaultInstructionTag::RegisterOracleUsdcRewardSource as u8];
        let probe = HandlerBoundaryProbe::default();
        let context = ExecutionContext::with_boundary_probe(
            &gate,
            DispatchTransport::CompressedInner,
            &probe,
        );
        assert_eq!(
            process_instruction_with_context(&crate::id(), inner_accounts, &inner_data, &context),
            Ok(())
        );
        assert_boundary_equivalence(
            probe.take(),
            HandlerBoundaryFamily::CompressedInnerVault,
            inner_accounts,
            &inner_data,
            DispatchTransport::CompressedInner,
        );
        assert!(inner_accounts
            .iter()
            .all(|account| account.key != &gate_key));
    }

    #[test]
    #[cfg(feature = "devnet-solo-backfill-2026")]
    fn governed_backfill_preserves_exact_handler_boundary_inputs() {
        let legacy_key = Pubkey::new_unique();
        let legacy_owner = Pubkey::new_unique();
        let mut legacy_lamports = 29;
        let mut legacy_account_data = [0x31u8; 2];
        let gate_key = derive_protocol_gate_pda(&PINNED_CONTROLLER_PROGRAM_ID, &crate::id()).0;
        let gate_owner = PINNED_CONTROLLER_PROGRAM_ID;
        let mut gate_lamports = 31;
        let mut gate_data = active_gate_bytes(TEST_EPOCH);
        let accounts = vec![
            AccountInfo::new(
                &legacy_key,
                false,
                true,
                &mut legacy_lamports,
                &mut legacy_account_data,
                &legacy_owner,
                false,
                11,
            ),
            AccountInfo::new(
                &gate_key,
                false,
                false,
                &mut gate_lamports,
                &mut gate_data,
                &gate_owner,
                false,
                0,
            ),
        ];
        let legacy_data = vec![
            crate::governance_manifest::DEVNET_SOLO_BACKFILL_INITIALIZE_SIDECAR_TAG,
            0x61,
            0x62,
        ];
        let capture = capture_top_level_handler_boundary(&accounts, &legacy_data);
        assert_boundary_equivalence(
            capture,
            HandlerBoundaryFamily::DevnetBackfill,
            &accounts[..accounts.len() - 1],
            &legacy_data,
            DispatchTransport::TopLevel,
        );
    }
}
