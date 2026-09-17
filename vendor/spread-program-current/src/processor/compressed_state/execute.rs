use super::*;

#[inline(never)]
pub(in crate::processor) fn process_execute_compressed_state_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    mut params: ExecuteCompressedStateParams,
    gate: &crate::governance_gate::GateValidated,
) -> ProgramResult {
    // The ordinary wrapper funds temporary classic materialization from a
    // logical core account. ScanCheckpoint is the one proof-only read pilot:
    // its domain-13 checkpoint is authenticated directly from Light, so the
    // fee payer is carried after System and the three business accounts stay
    // the exact inner handler slice.
    if params.rent_payer_index == params.core_account_count {
        return process_scan_checkpoint_readonly(program_id, accounts, params, gate);
    }
    validate_session_shape(accounts, &params)?;
    validate_compressed_initializer_contract(&params)?;
    let core_count = usize::from(params.core_account_count);
    let (core_accounts, suffix) = accounts.split_at(core_count);
    let (system_program_info, light_accounts) =
        suffix.split_first().ok_or(VaultError::InvalidAccountList)?;
    let rent_payer = core_accounts
        .get(usize::from(params.rent_payer_index))
        .ok_or(VaultError::InvalidAccountList)?;

    // Hydrate canonical addresses before binding the identity fields omitted by the adaptive
    // observations wire. Transaction rollback is still authoritative, but fail-first ordering
    // makes malformed proofs deterministic before creating even a temporary view.
    for access in &mut params.accesses {
        let target = core_accounts
            .get(usize::from(access.account_index()))
            .ok_or(VaultError::InvalidAccountList)?;
        if target.key == rent_payer.key || !target.is_writable {
            return Err(VaultError::InvalidAccountList.into());
        }
        hydrate_existing_access(program_id, target.key, access);
    }
    bind_contextual_carry_update_leaf_context(
        program_id,
        core_accounts,
        &params.inner_instruction,
        &mut params.accesses,
    )?;
    bind_observation_leaf_context(program_id, core_accounts, &mut params.accesses)?;

    for access in &params.accesses {
        let target = core_accounts
            .get(usize::from(access.account_index()))
            .ok_or(VaultError::InvalidAccountList)?;
        match access {
            CompressedStateAccess::ReadOnly { leaf, .. }
            | CompressedStateAccess::Mutable { leaf, .. } => {
                validate_leaf_target(target, leaf)?;
                super::super::validate_create_only_program_account_target(program_id, target)?;
            }
            CompressedStateAccess::Initialize { .. } => {
                super::super::validate_create_only_program_account_target(program_id, target)?;
            }
        }
    }

    for access in &params.accesses {
        match access {
            CompressedStateAccess::ReadOnly {
                account_index,
                leaf,
                ..
            }
            | CompressedStateAccess::Mutable {
                account_index,
                leaf,
                ..
            } => materialize_leaf(
                program_id,
                rent_payer,
                core_accounts,
                &core_accounts[usize::from(*account_index)],
                system_program_info,
                leaf,
            )?,
            CompressedStateAccess::Initialize { .. } => {}
        }
    }

    // This is the unchanged current transition function. Only its storage representation has
    // been adapted around it.
    let mut logical_core_accounts = core_accounts.to_vec();
    for access in &params.accesses {
        if !matches!(access, CompressedStateAccess::ReadOnly { .. }) {
            continue;
        }
        let index = access.account_index();
        let has_mutating_view = params.accesses.iter().any(|candidate| {
            candidate.account_index() == index
                && matches!(
                    candidate,
                    CompressedStateAccess::Mutable { .. }
                        | CompressedStateAccess::Initialize { .. }
                )
        });
        if !has_mutating_view
            && !read_only_access_requires_inner_writable(
                &params.inner_instruction,
                index,
                access.domain(),
            )
        {
            logical_core_accounts[usize::from(index)].is_writable = false;
        }
    }
    super::super::process_compressed_inner_instruction(
        program_id,
        &logical_core_accounts,
        &params.inner_instruction,
        gate,
    )?;

    capture_apply_and_close(
        program_id,
        core_accounts,
        rent_payer,
        light_accounts,
        &params,
    )
}

const CONTEXTUAL_ACCESS_SCHEMA_VERSION: u8 = 0;

#[inline(never)]
fn bind_contextual_carry_update_leaf_context(
    program_id: &Pubkey,
    core_accounts: &[AccountInfo],
    inner_instruction: &[u8],
    accesses: &mut [CompressedStateAccess],
) -> ProgramResult {
    let context = match (inner_instruction.first().copied(), core_accounts.len()) {
        (Some(199), 13 | 14)
            if inner_instruction.len() == 10
                && matches!(inner_instruction.get(1).copied(), Some(0 | 1)) =>
        {
            Some((3usize, 4u8, 5u8, 7usize, 8usize))
        }
        (Some(30), 17)
            if inner_instruction.len() == 113
                && inner_instruction[1..6] == *b"\x12CV01"
                && inner_instruction[6] == 2
                && inner_instruction[7] == 1 =>
        {
            Some((2usize, 9u8, 10u8, 8usize, 13usize))
        }
        _ => None,
    };
    let has_contextual = accesses.iter().any(|access| {
        matches!(
            access,
            CompressedStateAccess::ReadOnly { leaf, .. }
                | CompressedStateAccess::Mutable { leaf, .. }
                if leaf.schema_version == CONTEXTUAL_ACCESS_SCHEMA_VERSION
        )
    });
    if !has_contextual {
        return Ok(());
    }
    let (month_index, source_index, observations_index, claim_index, bucket_index) =
        context.ok_or(VaultError::InvalidCompressionWitness)?;
    let month_info = core_accounts
        .get(month_index)
        .ok_or(VaultError::InvalidAccountList)?;
    let source_info = core_accounts
        .get(usize::from(source_index))
        .ok_or(VaultError::InvalidAccountList)?;
    let claim_info = core_accounts
        .get(claim_index)
        .ok_or(VaultError::InvalidAccountList)?;
    let bucket_info = core_accounts
        .get(bucket_index)
        .ok_or(VaultError::InvalidAccountList)?;
    let claim = super::super::load_valid_oracle_update_claim_v2_from_account(
        program_id,
        month_info.key,
        source_info.key,
        claim_info,
    )?;
    let bucket =
        super::super::load_valid_oracle_bucket_median(program_id, month_info.key, bucket_info)?;

    let baseline = {
        let observations = accesses
            .iter()
            .find_map(|access| match access {
                CompressedStateAccess::ReadOnly {
                    account_index,
                    leaf,
                    ..
                }
                | CompressedStateAccess::Mutable {
                    account_index,
                    leaf,
                    ..
                } if *account_index == observations_index
                    && leaf.domain == CompressedStateDomain::OracleSourceObservations =>
                {
                    Some(&leaf.data)
                }
                _ => None,
            })
            .ok_or(VaultError::InvalidCompressionWitness)?;
        let observation_wire = crate::observation_wire::pack_compact(observations)
            .ok_or(VaultError::InvalidOracleObservation)?;
        let observation_count = *observation_wire
            .get(6)
            .ok_or(VaultError::InvalidOracleObservation)?;
        if observation_count == 0 {
            return Err(VaultError::InvalidOracleObservation.into());
        }

        let baseline: [u8; 8] = observations
            .get(70..78)
            .ok_or(VaultError::InvalidOracleObservation)?
            .try_into()
            .map_err(|_| VaultError::InvalidOracleObservation)?;

        baseline
    };

    let (source_rolling_hash, source_observation_count) = {
        let source_leaf = accesses
            .iter_mut()
            .find_map(|access| match access {
                CompressedStateAccess::Mutable {
                    account_index,
                    leaf,
                    ..
                } if *account_index == source_index
                    && leaf.domain == CompressedStateDomain::OracleSourceState
                    && leaf.schema_version == CONTEXTUAL_ACCESS_SCHEMA_VERSION =>
                {
                    Some(leaf)
                }
                _ => None,
            })
            .ok_or(VaultError::InvalidCompressionWitness)?;
        if source_leaf.data.len() != CompressedStateDomain::OracleSourceState.compact_data_len() {
            return Err(VaultError::InvalidCompressionWitness.into());
        }
        source_leaf.data[..32].copy_from_slice(&claim.claim.source_id);
        source_leaf.data[32..64].copy_from_slice(&bucket.bucket_id);
        source_leaf.data[96..104].copy_from_slice(&baseline);
        source_leaf.data[104..112].copy_from_slice(&claim.claim.prior_state.to_le_bytes());
        source_leaf.data[130] = OracleSourceStatus::Active as u8;
        source_leaf.data[131] = 1;

        source_leaf.schema_version = CompressedAmebaStateLeaf::CURRENT_SCHEMA_VERSION;
        let rolling_hash: [u8; 32] = source_leaf.data[184..216]
            .try_into()
            .map_err(|_| VaultError::InvalidCompressionWitness)?;
        (
            rolling_hash,
            u32::from_le_bytes(
                source_leaf.data[172..176]
                    .try_into()
                    .map_err(|_| VaultError::InvalidCompressionWitness)?,
            ),
        )
    };

    for access in accesses.iter_mut() {
        let (journal_index, journal_key) = match &*access {
            CompressedStateAccess::Mutable {
                account_index,
                leaf,
                ..
            } if leaf.domain == CompressedStateDomain::OracleCarryJournal
                && leaf.schema_version == CONTEXTUAL_ACCESS_SCHEMA_VERSION =>
            {
                let key = core_accounts
                    .get(usize::from(*account_index))
                    .ok_or(VaultError::InvalidAccountList)?
                    .key;
                (*account_index, *key)
            }
            _ => continue,
        };
        let (expected_journal, bump) =
            super::super::oracle_carry::journal_address_for_transport(program_id, source_info.key);
        if journal_key != expected_journal {
            return Err(VaultError::InvalidCompressionWitness.into());
        }
        let journal_leaf = match access {
            CompressedStateAccess::Mutable {
                account_index,
                leaf,
                ..
            } if *account_index == journal_index => leaf,
            _ => return Err(VaultError::InvalidCompressionWitness.into()),
        };
        if journal_leaf.data.len() != CompressedStateDomain::OracleCarryJournal.compact_data_len() {
            return Err(VaultError::InvalidCompressionWitness.into());
        }
        journal_leaf.data[..6].copy_from_slice(&[b'O', b'K', b'J', 2, 1, bump]);
        journal_leaf.data[6..38].copy_from_slice(source_info.key.as_ref());
        journal_leaf.data[70..102].copy_from_slice(&source_rolling_hash);
        journal_leaf.data[106..110].copy_from_slice(&source_observation_count.to_le_bytes());
        journal_leaf.schema_version = CompressedAmebaStateLeaf::CURRENT_SCHEMA_VERSION;
    }
    if accesses.iter().any(|access| {
        matches!(
            access,
            CompressedStateAccess::ReadOnly { leaf, .. }
                | CompressedStateAccess::Mutable { leaf, .. }
                if leaf.schema_version == CONTEXTUAL_ACCESS_SCHEMA_VERSION
        )
    }) {
        return Err(VaultError::InvalidCompressionWitness.into());
    }
    Ok(())
}

/// Execute the bounded ScanCheckpoint proof-only adapter. The canonical
/// checkpoint account must be absent and system-owned; no AccountInfo is
/// fabricated and no rent-funded temporary view is created.
#[inline(never)]
fn process_scan_checkpoint_readonly(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    mut params: ExecuteCompressedStateParams,
    _gate: &crate::governance_gate::GateValidated,
) -> ProgramResult {
    let core_count = usize::from(params.core_account_count);
    if core_count != 3
        || params.rent_payer_index != params.core_account_count
        || params.inner_instruction.as_slice()
            != [VaultInstructionTag::OracleCarryForwardV1 as u8, 6]
        || accounts.len() < core_count + 2
    {
        return Err(VaultError::InvalidInstructionData.into());
    }
    // Reuse the ordinary action/access contract before hydrating the omitted
    // canonical PDA fields. This admits exactly one domain-13 read at index 2.
    validate_compressed_initializer_contract(&params)?;
    if params.accesses.len() != 1 {
        return Err(VaultError::InvalidCompressionWitness.into());
    }
    let core_accounts = &accounts[..core_count];
    let suffix = &accounts[core_count..];
    let system_program_info = suffix.first().ok_or(VaultError::InvalidAccountList)?;
    let fee_payer = suffix.get(1).ok_or(VaultError::InvalidAccountList)?;
    let light_accounts = suffix
        .get(2..)
        .ok_or(VaultError::InvalidRemainingAccounts)?;
    if *system_program_info.key != system_program::id()
        || !fee_payer.is_signer
        || !fee_payer.is_writable
        || light_accounts.len() < 6
    {
        return Err(VaultError::InvalidAccountList.into());
    }
    if core_accounts
        .iter()
        .any(|account| account.key == fee_payer.key)
    {
        return Err(VaultError::InvalidAccountList.into());
    }

    let (source_key, carry_info, checkpoint_info) =
        (&core_accounts[0].key, &core_accounts[1], &core_accounts[2]);
    if !carry_info.is_writable {
        return Err(VaultError::InvalidAccountList.into());
    }
    if !matches!(
        &params.accesses[0],
        CompressedStateAccess::ReadOnly {
            account_index,
            leaf,
            ..
        } if *account_index == 2
            && leaf.domain == CompressedStateDomain::OracleCarryCheckpoint
    ) {
        return Err(VaultError::InvalidCompressionWitness.into());
    }

    // Keep classic carry loading/cursor precedence ahead of target and leaf
    // authentication, then require the exact absent canonical PDA target.
    super::super::oracle_carry::validate_scan_checkpoint_cursor_for_transport(
        program_id,
        source_key,
        carry_info,
        checkpoint_info.key,
    )?;
    super::super::validate_canonical_system_zero_pda_proof(checkpoint_info.key, checkpoint_info)?;
    if checkpoint_info.is_signer {
        return Err(VaultError::InvalidPda.into());
    }

    // The adaptive envelope omits canonical identity/address fields. Bind
    // them only to the exact account key selected above before any Light CPI.
    hydrate_existing_access(program_id, checkpoint_info.key, &mut params.accesses[0]);
    let (meta, leaf) = match &params.accesses[0] {
        CompressedStateAccess::ReadOnly { meta, leaf, .. } => (meta, leaf),
        _ => return Err(VaultError::InvalidCompressionWitness.into()),
    };
    super::super::oracle_carry::validate_scan_checkpoint_leaf_for_transport(
        program_id,
        source_key,
        carry_info,
        checkpoint_info.key,
        &leaf.data,
    )?;

    let witness = CompressedStateLeafReadOnly { meta, leaf };
    let checkpoint_data = leaf.data.clone();
    // This existing builder performs the real proof-bound read-only CPI. It
    // consumes only the Light account suffix and the outer fee payer; the
    // absent canonical AccountInfo is never materialized or passed to Light.
    apply_compressed_state_leaf_mutations(
        program_id,
        fee_payer,
        light_accounts,
        &params.proof,
        std::slice::from_ref(&witness),
        &[],
        &[],
        &[],
    )?;

    // Re-load and transition only after the proof CPI succeeds. Transaction
    // rollback retains atomicity if this final typed validation fails.
    super::super::oracle_carry::apply_scan_checkpoint_leaf_for_transport(
        program_id,
        source_key,
        carry_info,
        checkpoint_info.key,
        &checkpoint_data,
    )
}

/// Binds the two identities omitted from an observations wire value to the exact source access
/// and month account already required by the inner instruction. A caller cannot select a month or
/// source by supplying bytes in the adaptive payload: nonzero supplied identities must match the
/// PDA-derived context, while zero placeholders are filled only after that context is found.
#[inline(never)]
fn bind_observation_leaf_context(
    program_id: &Pubkey,
    core_accounts: &[AccountInfo],
    accesses: &mut [CompressedStateAccess],
) -> ProgramResult {
    for observation_position in 0..accesses.len() {
        let observation_account_index = match &accesses[observation_position] {
            CompressedStateAccess::ReadOnly {
                account_index,
                leaf,
                ..
            }
            | CompressedStateAccess::Mutable {
                account_index,
                leaf,
                ..
            } if leaf.domain == CompressedStateDomain::OracleSourceObservations => *account_index,
            _ => continue,
        };
        let observation_target = core_accounts
            .get(usize::from(observation_account_index))
            .ok_or(VaultError::InvalidAccountList)?;

        let mut source_context: Option<(Pubkey, [u8; 32])> = None;
        for candidate in accesses.iter() {
            let (source_account_index, source_leaf) = match candidate {
                CompressedStateAccess::ReadOnly {
                    account_index,
                    leaf,
                    ..
                }
                | CompressedStateAccess::Mutable {
                    account_index,
                    leaf,
                    ..
                } if leaf.domain == CompressedStateDomain::OracleSourceState => {
                    (*account_index, leaf)
                }
                _ => continue,
            };
            if source_account_index == observation_account_index || source_leaf.data.len() < 32 {
                continue;
            }
            let source_target = core_accounts
                .get(usize::from(source_account_index))
                .ok_or(VaultError::InvalidAccountList)?;
            let expected_observations =
                super::super::derive_oracle_source_observations_pda(program_id, source_target.key)
                    .0;
            if expected_observations != *observation_target.key {
                continue;
            }
            if source_leaf.canonical_pda != *source_target.key || source_context.is_some() {
                return Err(VaultError::InvalidOracleObservation.into());
            }
            let mut source_id = [0; 32];
            source_id.copy_from_slice(&source_leaf.data[..32]);
            if crate::bytes32_is_zero(&source_id) {
                return Err(VaultError::InvalidOracleObservation.into());
            }
            source_context = Some((*source_target.key, source_id));
        }
        let (source_key, source_id) = source_context.ok_or(VaultError::InvalidOracleObservation)?;

        let mut month_context = None;
        for candidate in core_accounts {
            let expected_source =
                super::super::derive_oracle_source_pda(program_id, candidate.key, &source_id).0;
            if expected_source == source_key {
                if month_context.is_some() {
                    return Err(VaultError::InvalidOracleObservation.into());
                }
                month_context = Some(*candidate.key);
            }
        }
        let month = month_context.ok_or(VaultError::InvalidOracleObservation)?;
        let (expected_observations, _) =
            super::super::derive_oracle_source_observations_pda(program_id, &source_key);
        if expected_observations != *observation_target.key {
            return Err(VaultError::InvalidOracleObservation.into());
        }

        let access = &mut accesses[observation_position];
        let leaf = match access {
            CompressedStateAccess::ReadOnly { leaf, .. }
            | CompressedStateAccess::Mutable { leaf, .. } => leaf,
            _ => return Err(VaultError::InvalidOracleObservation.into()),
        };
        if leaf.data.len() != OracleSourceObservations::REQUIRED_DATA_LEN {
            return Err(VaultError::InvalidOracleObservation.into());
        }
        bind_context_bytes(&mut leaf.data[6..38], month.as_ref())?;
        bind_context_bytes(&mut leaf.data[38..70], source_key.as_ref())?;
    }
    Ok(())
}

#[inline(never)]
fn bind_context_bytes(destination: &mut [u8], expected: &[u8]) -> ProgramResult {
    if destination.len() != 32 || expected.len() != 32 {
        return Err(VaultError::InvalidOracleObservation.into());
    }
    if destination.iter().all(|byte| *byte == 0) {
        destination.copy_from_slice(expected);
    } else if destination != expected {
        return Err(VaultError::InvalidOracleObservation.into());
    }
    Ok(())
}

/// A read-only compressed leaf may still need a writable temporary account when the unchanged
/// inner handler explicitly requires that privilege. Bucket recomputation reads the source
/// through a writable account but requires its observations account to remain read-only; keep
/// those two logical privileges distinct from the physical materialization requirement.
#[inline(always)]
fn read_only_access_requires_inner_writable(
    inner_instruction: &[u8],
    account_index: u8,
    domain: CompressedStateDomain,
) -> bool {
    matches!(
        (
            inner_instruction.first().copied(),
            account_index,
            domain,
        ),
        (
            Some(tag),
            super::super::bucket_medians::RECOMPUTE_SOURCE_ACCOUNT_INDEX,
            CompressedStateDomain::OracleSourceState,
        ) if tag == VaultInstructionTag::RecomputeOracleBucketMedianV1 as u8
    )
}

#[inline(never)]
pub(in crate::processor) fn capture_apply_and_close<'a>(
    program_id: &Pubkey,
    core_accounts: &[AccountInfo<'a>],
    rent_payer: &AccountInfo<'a>,
    light_accounts: &[AccountInfo<'a>],
    params: &ExecuteCompressedStateParams,
) -> ProgramResult {
    let mut read_only_captures = CaptureVec::new();
    let mut mutable_captures = CaptureVec::new();
    let mut close_captures = CaptureVec::new();
    let mut initialize_captures = CaptureVec::new();
    let mut retained_classic_mask = 0u8;
    for (access_position, access) in params.accesses.iter().enumerate() {
        let target = &core_accounts[usize::from(access.account_index())];
        match access {
            CompressedStateAccess::ReadOnly { meta, leaf, .. } => {
                let captured = capture_leaf(program_id, target, leaf.domain, leaf.revision)?;
                if captured.data != leaf.data {
                    return Err(VaultError::InvalidCompressionWitness.into());
                }
                read_only_captures.push(CompressedStateLeafReadOnly { meta, leaf });
            }
            CompressedStateAccess::Mutable { meta, leaf, .. } => {
                let revision = leaf
                    .revision
                    .checked_add(1)
                    .ok_or(VaultError::ArithmeticOverflow)?;
                let captured = capture_leaf(program_id, target, leaf.domain, revision)?;
                if retain_classic_merged_reward(target, leaf.domain)? {
                    close_captures.push(CompressedStateLeafClose {
                        meta,
                        old_leaf: leaf,
                    });
                    retained_classic_mask |= 1u8 << access_position;
                } else {
                    mutable_captures.push(CompressedStateLeafUpdate {
                        meta,
                        old_leaf: leaf,
                        new_leaf: captured,
                    });
                }
            }
            CompressedStateAccess::Initialize { domain, output, .. } => {
                initialize_captures.push(CompressedStateLeafCreate {
                    output,
                    leaf: capture_leaf(program_id, target, *domain, 0)?,
                });
            }
        }
    }

    apply_compressed_state_leaf_mutations(
        program_id,
        rent_payer,
        light_accounts,
        &params.proof,
        read_only_captures.as_slice(),
        mutable_captures.as_slice(),
        close_captures.as_slice(),
        initialize_captures.as_slice(),
    )?;

    let mut last_closed_index = None;
    for (access_position, access) in params.accesses.iter().enumerate() {
        if retained_classic_mask & (1u8 << access_position) != 0 {
            continue;
        }
        if last_closed_index == Some(access.account_index()) {
            continue;
        }
        let target = &core_accounts[usize::from(access.account_index())];
        super::super::close_program_account(program_id, target, rent_payer)?;
        last_closed_index = Some(access.account_index());
    }
    Ok(())
}

pub(in crate::processor) fn hydrate_existing_access(
    program_id: &Pubkey,
    canonical_pda: &Pubkey,
    access: &mut CompressedStateAccess,
) {
    match access {
        CompressedStateAccess::ReadOnly { meta, leaf, .. } => {
            leaf.canonical_pda = *canonical_pda;
            meta.address = derive_compressed_state_leaf_address(
                program_id,
                &crate::constants::LIGHT_DEFAULT_ADDRESS_TREE_V2,
                leaf.domain,
                canonical_pda,
            )
            .0;
        }
        CompressedStateAccess::Mutable { meta, leaf, .. } => {
            leaf.canonical_pda = *canonical_pda;
            meta.address = derive_compressed_state_leaf_address(
                program_id,
                &crate::constants::LIGHT_DEFAULT_ADDRESS_TREE_V2,
                leaf.domain,
                canonical_pda,
            )
            .0;
        }
        CompressedStateAccess::Initialize { .. } => {}
    }
}

pub(in crate::processor) fn retain_classic_merged_reward(
    target: &AccountInfo,
    domain: CompressedStateDomain,
) -> Result<bool, ProgramError> {
    if domain != CompressedStateDomain::OracleUsdcSourceReward {
        return Ok(false);
    }
    let data = target.try_borrow_data()?;
    Ok(!fixed_bytes32_is_zero(&data, 244))
}

pub(in crate::processor) fn validate_session_shape(
    accounts: &[AccountInfo],
    params: &ExecuteCompressedStateParams,
) -> ProgramResult {
    let core_count = usize::from(params.core_account_count);
    if core_count == 0
        || accounts.len() <= core_count
        || params.accesses.is_empty()
        || params.accesses.len() > MAX_COMPRESSED_STATE_SESSION_RECORDS
        || params.inner_instruction.is_empty()
        || params.inner_instruction.len() > MAX_COMPRESSED_INNER_INSTRUCTION_BYTES
        || usize::from(params.rent_payer_index) >= core_count
    {
        return Err(VaultError::InvalidInstructionData.into());
    }
    let inner_tag = VaultInstructionTag::from_byte(params.inner_instruction[0]);
    if inner_tag == Some(VaultInstructionTag::ExecuteCompressedStateV1) {
        return Err(VaultError::InvalidInstructionData.into());
    }
    if inner_tag.is_none() {
        #[cfg(feature = "devnet-solo-backfill-2026")]
        if !super::super::devnet_solo_backfill_2026::is_compressed_state_transport_tag(
            params.inner_instruction[0],
        ) {
            return Err(VaultError::InvalidInstructionData.into());
        }
        #[cfg(not(feature = "devnet-solo-backfill-2026"))]
        return Err(VaultError::InvalidInstructionData.into());
    }
    let payer = &accounts[usize::from(params.rent_payer_index)];
    if !payer.is_signer || !payer.is_writable || *accounts[core_count].key != system_program::id() {
        return Err(VaultError::InvalidAccountList.into());
    }
    let mut previous_access: Option<&CompressedStateAccess> = None;
    for access in &params.accesses {
        let index = usize::from(access.account_index());
        if index >= core_count
            || previous_access.is_some_and(|previous| index < usize::from(previous.account_index()))
        {
            return Err(VaultError::InvalidCompressionWitness.into());
        }
        if previous_access.is_some_and(|previous| {
            previous.account_index() == access.account_index()
                && !is_source_descriptor_pair(previous, access)
        }) {
            return Err(VaultError::InvalidCompressionWitness.into());
        }
        previous_access = Some(access);
    }
    Ok(())
}

pub(in crate::processor) fn is_source_descriptor_pair(
    source: &CompressedStateAccess,
    descriptor: &CompressedStateAccess,
) -> bool {
    source.domain() == CompressedStateDomain::OracleSourceState
        && descriptor.domain() == CompressedStateDomain::OracleSourceDescriptor
        && matches!(
            (source, descriptor),
            (
                CompressedStateAccess::ReadOnly { .. },
                CompressedStateAccess::ReadOnly { .. }
            ) | (
                CompressedStateAccess::Mutable { .. },
                CompressedStateAccess::ReadOnly { .. }
            ) | (
                CompressedStateAccess::Initialize { .. },
                CompressedStateAccess::Initialize { .. }
            )
        )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::processor) enum RequiredAccessKind {
    ReadOnly,
    Mutable,
    Initialize,
    MutableOrInitialize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::processor) struct RequiredAccessSpec {
    pub(in crate::processor) account_index: u8,
    pub(in crate::processor) domain: CompressedStateDomain,
    pub(in crate::processor) kind: RequiredAccessKind,
}

impl RequiredAccessSpec {
    pub(in crate::processor) const fn new(
        account_index: u8,
        domain: CompressedStateDomain,
        kind: RequiredAccessKind,
    ) -> Self {
        Self {
            account_index,
            domain,
            kind,
        }
    }

    pub(in crate::processor) const fn packed(self) -> u16 {
        (self.account_index as u16) | ((self.domain as u16) << 8) | ((self.kind as u16) << 12)
    }

    #[cfg(test)]
    pub(in crate::processor) fn from_packed(value: u16) -> Self {
        let domain = match ((value >> 8) & 0xf) as u8 {
            1 => CompressedStateDomain::OracleSkuCoverageRecord,
            2 => CompressedStateDomain::OracleUsdcSkuPool,
            3 => CompressedStateDomain::OracleUsdcSourceReward,
            4 => CompressedStateDomain::OracleUsdcRewardRegistration,
            5 => CompressedStateDomain::OracleUsdcRewardReceipt,
            8 => CompressedStateDomain::OracleSupportPosition,
            9 => CompressedStateDomain::OracleSourceState,
            10 => CompressedStateDomain::OracleSourceDescriptor,
            11 => CompressedStateDomain::OracleSourceObservations,
            12 => CompressedStateDomain::OracleCarryJournal,
            13 => CompressedStateDomain::OracleCarryCheckpoint,
            _ => CompressedStateDomain::OracleSourceDescriptor,
        };
        let kind = match value >> 12 {
            0 => RequiredAccessKind::ReadOnly,
            1 => RequiredAccessKind::Mutable,
            2 => RequiredAccessKind::Initialize,
            _ => RequiredAccessKind::MutableOrInitialize,
        };
        Self::new(value as u8, domain, kind)
    }
}

pub(in crate::processor) const MAX_REQUIRED_ACCESSES: usize = 8;

#[derive(Clone, Copy)]
pub(in crate::processor) struct RequiredAccesses {
    items: [u16; MAX_REQUIRED_ACCESSES],
    len: u8,
}

impl RequiredAccesses {
    #[inline(never)]
    pub(in crate::processor) fn from_slice(items: &[RequiredAccessSpec]) -> Self {
        let mut required = Self {
            items: [0; MAX_REQUIRED_ACCESSES],
            len: items.len() as u8,
        };
        for (target, item) in required.items.iter_mut().zip(items) {
            *target = item.packed();
        }
        required
    }

    #[inline(never)]
    pub(in crate::processor) fn push(&mut self, item: RequiredAccessSpec) {
        let index = usize::from(self.len);
        self.items[index] = item.packed();
        self.len += 1;
    }

    #[inline(never)]
    pub(in crate::processor) fn extend(&mut self, other: Self) {
        for index in 0..other.len() {
            let target = usize::from(self.len);
            self.items[target] = other.items[index];
            self.len += 1;
        }
    }

    #[inline(never)]
    pub(in crate::processor) fn extend_from_slice(&mut self, items: &[RequiredAccessSpec]) {
        for item in items {
            self.push(*item);
        }
    }

    #[inline(always)]
    pub(in crate::processor) fn as_slice(&self) -> &[u16] {
        &self.items[..usize::from(self.len)]
    }

    #[inline(always)]
    pub(in crate::processor) fn len(&self) -> usize {
        usize::from(self.len)
    }
}

#[cfg(test)]
mod contextual_update_tests {
    use super::*;
    use crate::constants::{
        ORACLE_UPDATE_MIN_REVEAL_DELAY_SLOTS, ORACLE_UPDATE_REVEAL_WINDOW_SLOTS,
    };
    use crate::fixed_codec::FixedStateEncode;
    use crate::state::{
        derive_oracle_bucket_median_pda, derive_oracle_update_claim_v2_pda,
        OracleBucketMedianState, OracleClaimStatus, OracleEscrowDisposition, OracleUpdateClaimV2,
    };
    use light_sdk::instruction::{account_meta::CompressedAccountMeta, PackedStateTreeInfo};

    fn account(key: Pubkey, owner: Pubkey, data: Vec<u8>) -> AccountInfo<'static> {
        let key = Box::leak(Box::new(key));
        let owner = Box::leak(Box::new(owner));
        let lamports = Box::leak(Box::new(1_u64));
        let data = Box::leak(data.into_boxed_slice());
        AccountInfo::new(key, false, true, lamports, data, owner, false, 0)
    }

    fn mutable_access(
        account_index: u8,
        domain: CompressedStateDomain,
        schema_version: u8,
        data: Vec<u8>,
    ) -> CompressedStateAccess {
        CompressedStateAccess::Mutable {
            account_index,
            meta: CompressedAccountMeta {
                tree_info: PackedStateTreeInfo {
                    root_index: 1,
                    prove_by_index: false,
                    merkle_tree_pubkey_index: 1,
                    queue_pubkey_index: 2,
                    leaf_index: u32::from(account_index),
                },
                address: [0; 32],
                output_state_tree_index: 3,
            },
            leaf: CompressedAmebaStateLeaf {
                schema_version,
                domain,
                canonical_pda: Pubkey::default(),
                revision: 1,
                data,
            },
        }
    }

    #[test]
    fn contextual_update_reconstruction_matches_the_full_logical_leaves() {
        let program_id = Pubkey::new_unique();
        let month = Pubkey::new_unique();
        let source = Pubkey::new_unique();
        let claimant = Pubkey::new_unique();
        let source_id = [0x31; 32];
        let bucket_id = [0x32; 32];
        let claim_id = [0x33; 32];

        let (claim_key, claim_bump) =
            derive_oracle_update_claim_v2_pda(&program_id, &month, &source, &claimant, &claim_id);
        let commit_slot = 10;
        let earliest_reveal_slot = commit_slot + ORACLE_UPDATE_MIN_REVEAL_DELAY_SLOTS;
        let mut claim = OracleUpdateClaimV2::default();
        claim.claim.is_initialized = true;
        claim.claim.bump = claim_bump;
        claim.claim.month = month;
        claim.claim.claim_id = claim_id;
        claim.claim.source = source;
        claim.claim.source_id = source_id;
        claim.claim.claimant = claimant;
        claim.claim.prior_state = 10_031;
        claim.claim.new_state = 10_031;
        claim.claim.source_time = 20_000;
        claim.claim.stake = 1;
        claim.claim.status = OracleClaimStatus::Revealed;
        claim.claim.evidence_hash = [0x34; 32];
        claim.claim.archive_url_hash = [0x35; 32];
        claim.claim.escrow_disposition = OracleEscrowDisposition::Unsettled;
        claim.claim.account_discriminator = OracleUpdateClaimV2::ACCOUNT_DISCRIMINATOR;
        claim.claim.account_version = OracleUpdateClaimV2::ACCOUNT_VERSION;
        claim.revealed_at_ts = 200;
        claim.commit_hash = [0x36; 32];
        claim.commit_slot = commit_slot;
        claim.earliest_reveal_slot = earliest_reveal_slot;
        claim.reveal_deadline_slot = earliest_reveal_slot + ORACLE_UPDATE_REVEAL_WINDOW_SLOTS;
        claim.revealed_slot = earliest_reveal_slot;
        claim.freshness_reward_multiplier = 1;
        let mut claim_data = vec![0; OracleUpdateClaimV2::LEN];
        claim.encode_fixed(&mut claim_data);

        let (bucket_key, bucket_bump) =
            derive_oracle_bucket_median_pda(&program_id, &month, &bucket_id);
        let bucket = OracleBucketMedianState {
            is_initialized: true,
            bump: bucket_bump,
            account_discriminator: OracleBucketMedianState::ACCOUNT_DISCRIMINATOR,
            account_version: OracleBucketMedianState::ACCOUNT_VERSION,
            month,
            bucket_id,
            bucket_weight_bps: 10_000,
            frozen_source_count: 1,
            active_source_count: 1,
            eligible_source_count: 1,
            ..OracleBucketMedianState::default()
        };
        let mut bucket_data = vec![0; OracleBucketMedianState::LEN];
        bucket.encode_fixed(&mut bucket_data);

        let (journal, journal_bump) =
            super::super::super::oracle_carry::journal_address_for_transport(&program_id, &source);
        let mut core_accounts = (0..13)
            .map(|_| account(Pubkey::new_unique(), program_id, Vec::new()))
            .collect::<Vec<_>>();
        core_accounts[3] = account(month, program_id, Vec::new());
        core_accounts[4] = account(source, program_id, Vec::new());
        core_accounts[7] = account(claim_key, program_id, claim_data);
        core_accounts[8] = account(bucket_key, program_id, bucket_data);
        core_accounts[10] = account(journal, program_id, Vec::new());

        let mut observations = vec![0; 582];
        observations[..6].copy_from_slice(&[1, 7, b'O', b'S', b'O', 3]);
        for index in 0..32 {
            observations[70 + index * 8..78 + index * 8]
                .copy_from_slice(&(10_000_u64 + index as u64).to_le_bytes());
            observations[326 + index * 8..334 + index * 8]
                .copy_from_slice(&(20_000_u64 + index as u64).to_le_bytes());
        }

        let mut source_data = vec![0; 216];
        source_data[64..96].copy_from_slice(Pubkey::new_unique().as_ref());
        source_data[112..130].fill(0x41);
        source_data[132..172].fill(0x42);
        source_data[184..216].fill(0x43);
        source_data[172..176].copy_from_slice(&32u32.to_le_bytes());
        source_data[176..184].copy_from_slice(&20_031u64.to_le_bytes());
        let mut journal_data = vec![0; 110];
        journal_data[38..70].fill(0x51);
        journal_data[102..106].copy_from_slice(&31_u32.to_le_bytes());
        let mut accesses = vec![
            mutable_access(
                4,
                CompressedStateDomain::OracleSourceState,
                CONTEXTUAL_ACCESS_SCHEMA_VERSION,
                source_data.clone(),
            ),
            mutable_access(
                5,
                CompressedStateDomain::OracleSourceObservations,
                CompressedAmebaStateLeaf::CURRENT_SCHEMA_VERSION,
                observations,
            ),
            mutable_access(
                10,
                CompressedStateDomain::OracleCarryJournal,
                CONTEXTUAL_ACCESS_SCHEMA_VERSION,
                journal_data.clone(),
            ),
        ];

        bind_contextual_carry_update_leaf_context(
            &program_id,
            &core_accounts,
            &[199, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            &mut accesses,
        )
        .unwrap();

        source_data[..32].copy_from_slice(&source_id);
        source_data[32..64].copy_from_slice(&bucket_id);
        source_data[96..104].copy_from_slice(&10_000_u64.to_le_bytes());
        source_data[104..112].copy_from_slice(&10_031_u64.to_le_bytes());
        source_data[130] = OracleSourceStatus::Active as u8;
        source_data[131] = 1;
        source_data[172..176].copy_from_slice(&32u32.to_le_bytes());
        let source_leaf = match &accesses[0] {
            CompressedStateAccess::Mutable { leaf, .. } => leaf,
            _ => unreachable!(),
        };
        assert_eq!(source_leaf.schema_version, 1);
        assert_eq!(source_leaf.data, source_data);

        journal_data[..6].copy_from_slice(&[b'O', b'K', b'J', 2, 1, journal_bump]);
        journal_data[6..38].copy_from_slice(source.as_ref());
        journal_data[70..102].fill(0x43);
        journal_data[106..110].copy_from_slice(&32u32.to_le_bytes());
        let journal_leaf = match &accesses[2] {
            CompressedStateAccess::Mutable { leaf, .. } => leaf,
            _ => unreachable!(),
        };
        assert_eq!(journal_leaf.schema_version, 1);
        assert_eq!(journal_leaf.data, journal_data);
    }
}
