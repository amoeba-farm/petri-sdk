use super::*;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrivilegeFixtureSet {
    schema_version: u8,
    cases: Vec<PrivilegeFixture>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrivilegeFixture {
    name: String,
    tag: u8,
    account_count: usize,
    privileges: String,
    #[serde(default)]
    payload: Vec<u8>,
}

fn fixtures() -> PrivilegeFixtureSet {
    serde_json::from_str(include_str!(
        "../../../../../fixtures/writer_account_privileges_v1.json"
    ))
    .expect("writer privilege fixture must decode")
}

fn pattern(value: &str) -> Vec<(bool, bool)> {
    value
        .split_ascii_whitespace()
        .map(|symbol| match symbol {
            "R" => (false, false),
            "W" => (false, true),
            "S" => (true, false),
            "X" => (true, true),
            _ => panic!("unknown account privilege symbol {symbol}"),
        })
        .collect()
}

fn account_infos(flags: &[(bool, bool)]) -> Vec<AccountInfo<'static>> {
    flags
        .iter()
        .map(|(is_signer, is_writable)| {
            let key = Box::leak(Box::new(Pubkey::new_unique()));
            let owner = Box::leak(Box::new(Pubkey::new_unique()));
            let lamports = Box::leak(Box::new(0u64));
            let data = Box::leak(Vec::<u8>::new().into_boxed_slice());
            AccountInfo::new(
                key,
                *is_signer,
                *is_writable,
                lamports,
                data,
                owner,
                false,
                0,
            )
        })
        .collect()
}

#[test]
fn writer_pack_effective_privilege_matrix_allows_only_fee_payer_writable_promotion() {
    let fixture_set = fixtures();
    assert_eq!(fixture_set.schema_version, 1);
    assert_eq!(fixture_set.cases.len(), 8);
    for fixture in fixture_set.cases {
        let tag = VaultInstructionTag::from_byte(fixture.tag)
            .unwrap_or_else(|| panic!("unknown writer tag {}", fixture.tag));
        let canonical = pattern(&fixture.privileges);
        assert_eq!(canonical.len(), fixture.account_count, "{}", fixture.name);
        assert_eq!(
            validate_pack_writer_account_privileges(
                tag,
                &account_infos(&canonical),
                &fixture.payload
            ),
            Ok(()),
            "canonical {} ({tag:?})",
            fixture.name,
        );
        for index in 0..canonical.len() {
            let mut signer_mutation = canonical.clone();
            signer_mutation[index].0 = !signer_mutation[index].0;
            assert_eq!(
                validate_pack_writer_account_privileges(
                    tag,
                    &account_infos(&signer_mutation),
                    &fixture.payload,
                ),
                Err(VaultError::InvalidAccountList.into()),
                "{} ({tag:?}) signer mutation at {index}",
                fixture.name,
            );

            let mut writable_mutation = canonical.clone();
            writable_mutation[index].1 = !writable_mutation[index].1;
            let result = validate_pack_writer_account_privileges(
                tag,
                &account_infos(&writable_mutation),
                &fixture.payload,
            );
            if canonical[index] == (true, false) {
                assert_eq!(
                    result,
                    Ok(()),
                    "{} ({tag:?}) fee-payer writable promotion at {index}",
                    fixture.name,
                );
            } else {
                assert_eq!(
                    result,
                    Err(VaultError::InvalidAccountList.into()),
                    "{} ({tag:?}) writable mutation at {index}",
                    fixture.name,
                );
            }
        }
    }
}

#[test]
fn writer_pack_dynamic_privilege_shapes_cover_the_twenty_series_boundary() {
    let mut settlement = pattern("S R W R W R R R");
    settlement.extend(core::iter::repeat_n((false, false), 20));
    assert_eq!(settlement.len(), 28);
    assert_eq!(
        validate_pack_writer_account_privileges(
            VaultInstructionTag::FinalizeWriterSleeveSettlementV1,
            &account_infos(&settlement),
            &[],
        ),
        Ok(()),
    );

    for tag in [
        227, 228, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 247, 249,
    ] {
        assert!(VaultInstructionTag::from_byte(tag).is_none());
    }
}

#[test]
fn writer_pack_duplicate_keys_are_rejected_in_every_current_role() {
    let fixture_set = fixtures();
    for fixture in fixture_set.cases {
        let tag = VaultInstructionTag::from_byte(fixture.tag)
            .unwrap_or_else(|| panic!("unknown writer tag {}", fixture.tag));
        let canonical = pattern(&fixture.privileges);
        for left in 0..canonical.len() {
            for right in left + 1..canonical.len() {
                let mut aliased = account_infos(&canonical);
                aliased[right].key = aliased[left].key;
                assert_eq!(
                    validate_pack_writer_account_privileges(tag, &aliased, &fixture.payload),
                    Err(VaultError::InvalidAccountList.into()),
                    "{} ({tag:?}) duplicate pair {left}/{right}",
                    fixture.name,
                );
            }
        }
    }

    let mut non_pack = account_infos(&pattern("R R"));
    non_pack[1].key = non_pack[0].key;
    assert_eq!(
        validate_pack_writer_account_privileges(VaultInstructionTag::Initialize, &non_pack, &[],),
        Ok(())
    );
}
