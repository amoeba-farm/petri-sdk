//! Local pilot: retain the exact classic carry record bytes inside Light leaves.
//! This module changes storage only; the acceptance and selection rules stay in
//! their original handlers. Domains are appended after observations (11).
use super::*;

pub(in crate::processor) fn validate_carry_body(
    domain: CompressedStateDomain,
    data: &[u8],
) -> ProgramResult {
    match domain {
        CompressedStateDomain::OracleCarryJournal => {
            let value =
                Journal::try_from_slice(data).map_err(|_| VaultError::InvalidOracleState)?;
            if !valid_header::<Journal>(&value.header)
                || value.count == 0
                || value.count != value.observation_count
                || value.head == Pubkey::default()
                || value.observation_count == 0
                || value.rolling_observation_hash == [0; 32]
            {
                return invalid();
            }
        }
        CompressedStateDomain::OracleCarryCheckpoint => {
            let value =
                Checkpoint::try_from_slice(data).map_err(|_| VaultError::InvalidOracleState)?;
            if !valid_header::<Checkpoint>(&value.header)
                || value.sequence == 0
                || value.value == 0
                || value.observed_at == 0
                || value.accepted_at < value.observed_at
                || value.evidence_hash == [0; 32]
                || value.archive_hash == [0; 32]
                || value.contributor == Pubkey::default()
                || value.origin_source == Pubkey::default()
                || value.origin_checkpoint == Pubkey::default()
                || (value.sequence == 1) != (value.previous == Pubkey::default())
            {
                return invalid();
            }
        }
        _ => return invalid(),
    }
    Ok(())
}

fn valid_header<T: Record>(header: &Header) -> bool {
    header.initialized && header.discriminator == T::DISCRIMINATOR && header.version == T::VERSION
}

pub(in crate::processor) fn validate_carry_payload(
    program: &Pubkey,
    canonical: &Pubkey,
    domain: CompressedStateDomain,
    data: &[u8],
) -> ProgramResult {
    validate_carry_body(domain, data)?;
    let (expected, bump) = match domain {
        CompressedStateDomain::OracleCarryJournal => {
            let value =
                Journal::try_from_slice(data).map_err(|_| VaultError::InvalidOracleState)?;
            (
                address(program, JOURNAL_SEED, value.source.as_ref()),
                value.header.bump,
            )
        }
        CompressedStateDomain::OracleCarryCheckpoint => {
            let value =
                Checkpoint::try_from_slice(data).map_err(|_| VaultError::InvalidOracleState)?;
            (
                checkpoint_address(program, &value.source, &value.event),
                value.header.bump,
            )
        }
        _ => return invalid(),
    };
    if expected.0 != *canonical || expected.1 != bump {
        return invalid();
    }
    Ok(())
}

pub(in crate::processor) fn materialize_carry<'a>(
    program: &Pubkey,
    payer: &AccountInfo<'a>,
    target: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    domain: CompressedStateDomain,
    data: &[u8],
) -> ProgramResult {
    validate_carry_payload(program, target.key, domain, data)?;
    match domain {
        CompressedStateDomain::OracleCarryJournal => {
            let value =
                Journal::try_from_slice(data).map_err(|_| VaultError::InvalidOracleState)?;
            create(
                program,
                payer,
                target,
                system,
                &[JOURNAL_SEED, value.source.as_ref(), &[value.header.bump]],
                &value,
            )
        }
        CompressedStateDomain::OracleCarryCheckpoint => {
            let value =
                Checkpoint::try_from_slice(data).map_err(|_| VaultError::InvalidOracleState)?;
            create(
                program,
                payer,
                target,
                system,
                &[
                    CHECKPOINT_SEED,
                    value.source.as_ref(),
                    value.event.as_ref(),
                    &[value.header.bump],
                ],
                &value,
            )
        }
        _ => invalid(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use borsh::BorshSerialize;

    fn compare_classic_and_leaf(
        domain: CompressedStateDomain,
        data: Vec<u8>,
        key: Pubkey,
        source: Pubkey,
        program: Pubkey,
    ) {
        let cases = (0..data.len()).flat_map(|index| [0, 1, 2, 255].map(move |byte| (index, byte)));
        for change in std::iter::once(None).chain(cases.map(Some)) {
            let mut bytes = data.clone();
            if let Some((index, byte)) = change {
                bytes[index] = byte;
            }
            let candidate = validate_carry_payload(&program, &key, domain, &bytes);
            let mut lamports = 1;
            let info = AccountInfo::new(
                &key,
                false,
                false,
                &mut lamports,
                &mut bytes,
                &program,
                false,
                0,
            );
            let classic = match domain {
                CompressedStateDomain::OracleCarryJournal => {
                    load_journal(&program, &source, &info).map(|_| ())
                }
                CompressedStateDomain::OracleCarryCheckpoint => {
                    load_checkpoint(&program, &info, &source).map(|_| ())
                }
                _ => unreachable!(),
            };
            assert_eq!(candidate, classic, "domain={domain:?} change={change:?}");
        }
        for length in 0..data.len() {
            assert!(validate_carry_payload(&program, &key, domain, &data[..length]).is_err());
        }
        let mut extended = data;
        extended.push(0);
        assert!(validate_carry_payload(&program, &key, domain, &extended).is_err());
        assert!(validate_carry_payload(
            &program,
            &Pubkey::new_unique(),
            domain,
            &extended[..extended.len() - 1]
        )
        .is_err());
    }

    #[test]
    fn full_carry_bodies_preserve_classic_validation_and_encoding() {
        let program = Pubkey::new_unique();
        let source = Pubkey::new_unique();
        let event = Pubkey::new_unique();
        let journal_key = address(&program, JOURNAL_SEED, source.as_ref());
        let checkpoint_key = checkpoint_address(&program, &source, &event);
        let journal = Journal {
            header: header::<Journal>(journal_key.1),
            source,
            head: checkpoint_key.0,
            rolling_observation_hash: [7; 32],
            count: 1,
            observation_count: 1,
        };
        let checkpoint = Checkpoint {
            header: header::<Checkpoint>(checkpoint_key.1),
            source,
            month: Pubkey::new_unique(),
            event,
            previous: Pubkey::default(),
            sequence: 1,
            accepted_at: u64::MAX,
            value: u64::MAX,
            observed_at: u64::MAX,
            evidence_hash: [8; 32],
            archive_hash: [9; 32],
            contributor: Pubkey::new_unique(),
            origin_source: source,
            origin_checkpoint: checkpoint_key.0,
        };
        for (domain, bytes, key) in [
            (
                CompressedStateDomain::OracleCarryJournal,
                journal.try_to_vec().unwrap(),
                journal_key.0,
            ),
            (
                CompressedStateDomain::OracleCarryCheckpoint,
                checkpoint.try_to_vec().unwrap(),
                checkpoint_key.0,
            ),
        ] {
            assert_eq!(bytes.len(), domain.compact_data_len());
            compare_classic_and_leaf(domain, bytes, key, source, program);
        }
    }
}
