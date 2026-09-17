use super::*;
use crate::{error::VaultError, state::OracleSourceObservations};
use solana_program::entrypoint::ProgramResult;

fn require(valid: bool) -> ProgramResult {
    if valid {
        Ok(())
    } else {
        Err(VaultError::InvalidOracleState.into())
    }
}

pub(super) fn reference_observations(data: &[u8]) -> ProgramResult {
    let value = OracleSourceObservations::try_from_slice(data)
        .map_err(|_| VaultError::InvalidOracleObservation)?;
    require(
        value.is_initialized
            && value.account_discriminator == *b"OSO"
            && [3, 4].contains(&value.account_version)
            && value.month != Pubkey::default()
            && value.source != Pubkey::default(),
    )?;
    let populated = value.states.iter().take_while(|state| **state != 0).count();
    require(
        value.states[populated..].iter().all(|state| *state == 0)
            && value.source_times[populated..]
                .iter()
                .all(|time| *time == 0)
            && value.source_times[..populated]
                .iter()
                .all(|time| *time != 0)
            && value.source_times[..populated]
                .windows(2)
                .all(|pair| pair[0] < pair[1]),
    )
}

// Independent Borsh records freeze the carry transport ABI rather than calling its validator.
#[derive(BorshDeserialize, BorshSerialize)]
struct Header {
    discriminator: [u8; 3],
    version: u8,
    initialized: bool,
    bump: u8,
}
#[derive(BorshDeserialize, BorshSerialize)]
struct Journal {
    header: Header,
    source: Pubkey,
    head: Pubkey,
    hash: [u8; 32],
    count: u32,
    observations: u32,
}
#[derive(BorshDeserialize, BorshSerialize)]
struct Checkpoint {
    header: Header,
    source: Pubkey,
    month: Pubkey,
    event: Pubkey,
    previous: Pubkey,
    sequence: u32,
    accepted: u64,
    value: u64,
    observed: u64,
    evidence: [u8; 32],
    archive: [u8; 32],
    contributor: Pubkey,
    origin_source: Pubkey,
    origin_checkpoint: Pubkey,
}

fn header_valid(header: &Header, discriminator: [u8; 3]) -> bool {
    header.discriminator == discriminator
        && header.version == if discriminator == *b"OKJ" { 2 } else { 1 }
        && header.initialized
}
pub(super) fn reference_journal(data: &[u8]) -> ProgramResult {
    let value = Journal::try_from_slice(data).map_err(|_| VaultError::InvalidOracleState)?;
    require(
        header_valid(&value.header, *b"OKJ")
            && value.count > 0
            && value.count == value.observations
            && value.observations > 0
            && value.head != Pubkey::default()
            && value.hash != [0; 32],
    )
}
pub(super) fn reference_checkpoint(data: &[u8]) -> ProgramResult {
    let value = Checkpoint::try_from_slice(data).map_err(|_| VaultError::InvalidOracleState)?;
    require(
        header_valid(&value.header, *b"OKC")
            && value.sequence > 0
            && value.value > 0
            && value.observed > 0
            && value.accepted >= value.observed
            && value.evidence != [0; 32]
            && value.archive != [0; 32]
            && value.contributor != Pubkey::default()
            && value.origin_source != Pubkey::default()
            && value.origin_checkpoint != Pubkey::default()
            && (value.sequence == 1) == (value.previous == Pubkey::default()),
    )
}

#[test]
fn all_new_domains_accept_valid_bytes_and_reject_malformed_projections() {
    let header = |discriminator| Header {
        discriminator,
        version: if discriminator == *b"OKJ" { 2 } else { 1 },
        initialized: true,
        bump: 254,
    };
    let journal = Journal {
        header: header(*b"OKJ"),
        source: Pubkey::new_unique(),
        head: Pubkey::new_unique(),
        hash: [7; 32],
        count: 1,
        observations: 1,
    }
    .try_to_vec()
    .unwrap();
    let checkpoint = Checkpoint {
        header: header(*b"OKC"),
        source: Pubkey::new_unique(),
        month: Pubkey::new_unique(),
        event: Pubkey::new_unique(),
        previous: Pubkey::default(),
        sequence: 1,
        accepted: 20,
        value: 123,
        observed: 10,
        evidence: [8; 32],
        archive: [9; 32],
        contributor: Pubkey::new_unique(),
        origin_source: Pubkey::new_unique(),
        origin_checkpoint: Pubkey::new_unique(),
    }
    .try_to_vec()
    .unwrap();
    let mut observations = OracleSourceObservations {
        is_initialized: true,
        account_discriminator: *b"OSO",
        account_version: OracleSourceObservations::ACCOUNT_VERSION,
        month: Pubkey::new_unique(),
        source: Pubkey::new_unique(),
        ..Default::default()
    };
    observations.states[..2].copy_from_slice(&[100, 101]);
    observations.source_times[..2].copy_from_slice(&[10, 20]);
    assert_compact_codec_matches_borsh(super::super::CompactOracleSourceObservations::from_full(
        &observations,
    ));
    for (domain, data) in [
        (CompressedStateDomain::OracleCarryJournal, journal),
        (CompressedStateDomain::OracleCarryCheckpoint, checkpoint),
        (
            CompressedStateDomain::OracleSourceObservations,
            observations.try_to_vec().unwrap(),
        ),
    ] {
        validate_compact_state_data(domain, &data).unwrap();
        assert_compact_validator_parity(domain, &data);
    }
}
