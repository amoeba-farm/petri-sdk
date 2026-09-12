use super::*;
use borsh::BorshSerialize;

fn account(key: Pubkey, owner: Pubkey, data: Vec<u8>, writable: bool) -> AccountInfo<'static> {
    AccountInfo::new(
        Box::leak(Box::new(key)),
        false,
        writable,
        Box::leak(Box::new(1_000_000)),
        Box::leak(data.into_boxed_slice()),
        Box::leak(Box::new(owner)),
        false,
        0,
    )
}

fn checkpoint(
    program: &Pubkey,
    source: Pubkey,
    month: Pubkey,
    previous: Pubkey,
    sequence: u32,
    observed_at: u64,
    accepted_at: u64,
    value: u64,
) -> AccountInfo<'static> {
    let event = Pubkey::new_unique();
    let (key, bump) = checkpoint_address(program, &source, &event);
    let record = Checkpoint {
        header: header::<Checkpoint>(bump),
        source,
        month,
        event,
        previous,
        sequence,
        accepted_at,
        value,
        observed_at,
        evidence_hash: [3; 32],
        archive_hash: [4; 32],
        contributor: Pubkey::new_unique(),
        origin_source: source,
        origin_checkpoint: key,
    };
    account(key, *program, record.try_to_vec().unwrap(), false)
}

fn selection(
    program: &Pubkey,
    parent: Pubkey,
    parent_month: Pubkey,
    head: Pubkey,
    count: u32,
) -> (AccountInfo<'static>, AccountInfo<'static>) {
    let source = Pubkey::new_unique();
    let (key, bump) = address(program, SOURCE_SEED, source.as_ref());
    let carry = CarrySource {
        header: header::<CarrySource>(bump),
        month: Pubkey::new_unique(),
        source,
        parent_month,
        parent_source: parent,
        definition_hash: [1; 32],
        cursor: head,
        selected_checkpoint: Pubkey::default(),
        origin_source: Pubkey::default(),
        origin_checkpoint: Pubkey::default(),
        contributor: Pubkey::default(),
        evidence_hash: [0; 32],
        archive_hash: [0; 32],
        cutoff: 100,
        deadline: 200,
        value: 0,
        observed_at: 0,
        accepted_at: 0,
        remaining: count,
        selected_sequence: 0,
        status: SELECTING,
    };
    (
        account(source, system_program::id(), vec![], false),
        account(key, *program, carry.try_to_vec().unwrap(), true),
    )
}

#[test]
fn critical_proof_contracts_require_descriptors_sku_and_bounded_batches() {
    use crate::processor::compressed_state::build_required_access_contract as contract;
    use CompressedStateDomain::{
        OracleSourceDescriptor as Descriptor, OracleSourceState as Source, OracleUsdcSkuPool as Sku,
    };
    use RequiredAccessKind::ReadOnly as Read;
    let expected = RequiredAccesses::from_slice(&[
        RequiredAccessSpec::new(3, Source, Read),
        RequiredAccessSpec::new(3, Descriptor, Read),
    ]);
    assert_eq!(contract(&[198], 7).unwrap().as_slice(), expected.as_slice());
    let actual = contract(&[122], 12).unwrap(); // SKU + three source/descriptor pairs.
    let mut expected = vec![RequiredAccessSpec::new(5, Sku, Read)];
    for index in 7..10 {
        expected.push(RequiredAccessSpec::new(index, Source, Read));
        expected.push(RequiredAccessSpec::new(index, Descriptor, Read));
    }
    assert_eq!(
        actual.as_slice(),
        RequiredAccesses::from_slice(&expected).as_slice()
    );
    assert_eq!(actual.len(), 7);
    assert!(contract(&[122], 13).is_err()); // Fourth source would need nine records.
    assert_eq!(contract(&[30, 3, 0, 0, 0], 18).unwrap().len(), 6);
    assert!(contract(&[30, 3, 0, 0, 255], 18).is_err());
    assert!(contract(&[30, 5], 9).is_err()); // Missing parent-month/rent-payer context.
}

#[test]
fn critical_selection_is_ordered_cutoff_bound_and_keeps_original_provenance() {
    let program = Pubkey::new_unique();
    let parent = Pubkey::new_unique();
    let month = Pubkey::new_unique();
    let first = checkpoint(&program, parent, month, Pubkey::default(), 1, 80, 110, 10);
    let chosen = checkpoint(&program, parent, month, *first.key, 2, 90, 199, 20);
    let too_late = checkpoint(&program, parent, month, *chosen.key, 3, 100, 200, 999);
    let too_new = checkpoint(&program, parent, month, *too_late.key, 4, 101, 201, 888);
    let (source, carry) = selection(&program, parent, month, *too_new.key, 4);
    let before = carry.try_borrow_data().unwrap().to_vec();
    assert!(scan_checkpoint(&program, &[source.clone(), carry.clone(), chosen.clone()]).is_err());
    assert_eq!(carry.try_borrow_data().unwrap().as_ref(), before.as_slice());
    for next in [&too_new, &too_late, &chosen, &first] {
        let immutable = next.try_borrow_data().unwrap().to_vec();
        scan_checkpoint(&program, &[source.clone(), carry.clone(), next.clone()]).unwrap();
        assert_eq!(
            next.try_borrow_data().unwrap().as_ref(),
            immutable.as_slice()
        );
    }
    let selected = load_carry(&program, source.key, &carry).unwrap();
    assert_eq!(
        (
            selected.remaining,
            selected.value,
            selected.observed_at,
            selected.accepted_at
        ),
        (0, 20, 90, 199)
    );
    assert_eq!(selected.selected_checkpoint, *chosen.key);
    let original = load_checkpoint(&program, &chosen, &parent).unwrap();
    assert_eq!(selected.origin_checkpoint, original.origin_checkpoint);
    assert_eq!(selected.contributor, original.contributor);
    assert_eq!(
        (selected.evidence_hash, selected.archive_hash),
        (original.evidence_hash, original.archive_hash)
    );
    assert!(scan_checkpoint(&program, &[source, carry, first]).is_err()); // No replay or double count.
}

#[test]
fn critical_no_eligible_checkpoint_cannot_invent_an_opening() {
    let program = Pubkey::new_unique();
    let parent = Pubkey::new_unique();
    let month = Pubkey::new_unique();
    for (observed_at, accepted_at, eligible) in [(101, 150, false), (100, 200, false), (100, 199, true)] {
        let head = checkpoint(&program, parent, month, Pubkey::default(), 1, observed_at, accepted_at, 90);
        let (source, carry) = selection(&program, parent, month, *head.key, 1);
        scan_checkpoint(&program, &[source.clone(), carry.clone(), head]).unwrap();
        let result = load_carry(&program, source.key, &carry).unwrap();
        assert_eq!(result.remaining, 0);
        if eligible {
            assert_eq!(result.status, SELECTING); // Eligible, but still requires the explicit freeze.
            assert_ne!(result.selected_checkpoint, Pubkey::default());
            assert_eq!((result.value, result.observed_at), (90, 100));
        } else {
            assert_eq!(result.status, NO_ELIGIBLE_CHECKPOINT);
            assert_eq!(result.selected_checkpoint, Pubkey::default());
            assert_eq!((result.value, result.observed_at), (0, 0));
        }
    }
}

#[test]
fn critical_fresh_claims_and_import_guards_prevent_carry_and_duplicate_rewards() {
    let program = Pubkey::new_unique();
    let source_key = Pubkey::new_unique();
    let source = OracleSourceState {
        month: Pubkey::new_unique(),
        source_id: [1; 32],
        canonical_locator_hash: [2; 32],
        source_definition_hash: [3; 32],
        ..Default::default()
    };
    let (claim_key, bump) = derive_oracle_opening_claim_pda(&program, &source.month, &source_key);
    for (status, escrow, allowed) in [
        (
            OracleOpeningClaimStatus::Accepted,
            OracleEscrowDisposition::Refunded,
            false,
        ),
        (
            OracleOpeningClaimStatus::Pending,
            OracleEscrowDisposition::Unsettled,
            false,
        ),
        (
            OracleOpeningClaimStatus::Challenged,
            OracleEscrowDisposition::Unsettled,
            false,
        ),
        (
            OracleOpeningClaimStatus::Rejected,
            OracleEscrowDisposition::Unsettled,
            false,
        ),
        (
            OracleOpeningClaimStatus::Rejected,
            OracleEscrowDisposition::Refunded,
            true,
        ),
        (
            OracleOpeningClaimStatus::TimedOut,
            OracleEscrowDisposition::Refunded,
            true,
        ),
    ] {
        let claim = OracleOpeningClaim {
            is_initialized: true,
            bump,
            month: source.month,
            source: source_key,
            source_id: source.source_id,
            canonical_locator_hash: source.canonical_locator_hash,
            source_definition_hash: source.source_definition_hash,
            archive_url_hash: [4; 32],
            evidence_hash: [5; 32],
            status,
            escrow_disposition: escrow,
            ..Default::default()
        };
        let mut data = claim.try_to_vec().unwrap();
        data.resize(OracleOpeningClaim::LEN, 0);
        let info = account(claim_key, program, data, false);
        assert_eq!(
            require_no_fresh_claim(&program, &source_key, &source, &info).is_ok(),
            allowed,
            "{status:?}/{escrow:?}"
        );
    }
    let absent = account(claim_key, system_program::id(), vec![], false);
    require_no_fresh_claim(&program, &source_key, &source, &absent).unwrap();
    let wrong_absence = account(Pubkey::new_unique(), system_program::id(), vec![], false);
    assert!(require_no_fresh_claim(&program, &source_key, &source, &wrong_absence).is_err());
    let (period_key, bump) = address(&program, PERIOD_SEED, source.month.as_ref());
    let mut period = Period {
        header: header::<Period>(bump),
        month: source.month,
        underlying: [1; 32],
        predecessor: Pubkey::new_unique(),
        predecessor_recipe: [2; 32],
        expiry: 1000,
        registered_at: 10,
        expected_imports: 2,
        next_import: 1,
    };
    let info = account(period_key, program, period.try_to_vec().unwrap(), true);
    assert!(require_import_complete(&program, &source.month, &info).is_err());
    period.next_import = 2;
    save(&program, &info, &period).unwrap();
    require_import_complete(&program, &source.month, &info).unwrap();
    let companion_key = address(&program, SOURCE_SEED, source_key.as_ref()).0;
    let absent = account(companion_key, system_program::id(), vec![], false);
    require_fresh_discovery(&program, &source_key, &absent).unwrap();
    let imported = account(companion_key, program, vec![0; CarrySource::LEN], false);
    assert!(require_fresh_discovery(&program, &source_key, &imported).is_err());
}

#[test]
fn critical_inherited_anchor_keeps_age_without_becoming_a_median_sample() {
    let mut source = OracleSourceState {
        baseline_state: 1000,
        current_state: 10,
        observation_count: 2,
        rolling_observation_hash: [1; 32],
        ..Default::default()
    };
    let mut observations = OracleSourceObservations::default();
    observations.account_version = OracleSourceObservations::INHERITED_ANCHOR_VERSION;
    observations.states[..2].copy_from_slice(&[1000, 10]);
    observations.source_times[..2].copy_from_slice(&[10, 20]);
    assert_eq!(
        oracle_temporal_median_state(&source, &observations, 1, 30).unwrap(),
        Some(10)
    );
    observations.account_version = OracleSourceObservations::ACCOUNT_VERSION;
    assert_eq!(
        oracle_temporal_median_state(&source, &observations, 1, 30).unwrap(),
        Some(505)
    );
    observations.account_version = OracleSourceObservations::INHERITED_ANCHOR_VERSION;
    assert_eq!(
        oracle_temporal_median_state(&source, &observations, 1, 9).unwrap(),
        None
    );
    assert_eq!(
        oracle_temporal_median_state(&source, &observations, 1, 15).unwrap(),
        Some(1000)
    );
    assert_eq!(
        oracle_temporal_median_state(&source, &observations, 30, 40).unwrap(),
        Some(10)
    );
    append_oracle_source_observation(&mut source, &mut observations, 30, 40, &[2; 32], &[3; 32])
        .unwrap();
    source.current_state = 30;
    assert_eq!(source.observation_count, 3);
    assert_eq!(observations.source_times[0], 10);
    assert_eq!(
        oracle_temporal_median_state(&source, &observations, 1, 50).unwrap(),
        Some(20)
    );
    assert!(append_oracle_source_observation(
        &mut source,
        &mut observations,
        30,
        40,
        &[2; 32],
        &[3; 32]
    )
    .is_err());
}
