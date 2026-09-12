use super::*;

#[test]
fn every_current_compressed_lifecycle_has_an_exact_fail_closed_contract() {
    let sku = CompressedStateDomain::OracleUsdcSkuPool;
    let reward = CompressedStateDomain::OracleUsdcSourceReward;
    let coverage = CompressedStateDomain::OracleSkuCoverageRecord;
    let support = CompressedStateDomain::OracleSupportPosition;
    let source = CompressedStateDomain::OracleSourceState;
    let source_descriptor = CompressedStateDomain::OracleSourceDescriptor;
    let read = RequiredAccessKind::ReadOnly;
    let mutable = RequiredAccessKind::Mutable;
    let initialize = RequiredAccessKind::Initialize;
    let mutable_or_initialize = RequiredAccessKind::MutableOrInitialize;
    let spec = RequiredAccessSpec::new;
    let contract = |tag: u8, count: usize, payload: &[u8]| {
        let mut data = vec![tag];
        data.extend_from_slice(payload);
        required_access_contract(&data, count)
            .unwrap_or_else(|error| panic!("contract tag {tag} count {count}: {error:?}"))
    };
    let pair = |index, kind| {
        vec![
            spec(index, source, kind),
            spec(index, source_descriptor, read),
        ]
    };

    assert_eq!(contract(157, 6, &[]), vec![spec(5, sku, initialize)]);
    assert_eq!(
        contract(182, 11, &[]),
        vec![
            spec(4, sku, read),
            spec(5, source, initialize),
            spec(5, source_descriptor, initialize),
            spec(7, reward, initialize),
        ]
    );
    assert_eq!(
        contract(183, 12, &[]),
        vec![
            spec(4, sku, read),
            spec(5, source, mutable),
            spec(6, reward, mutable),
            spec(8, support, initialize),
            spec(11, coverage, mutable_or_initialize),
        ]
    );
    assert_eq!(
        contract(161, 10, &[]),
        vec![spec(3, sku, read), spec(4, source, read)]
    );
    assert_eq!(
        contract(161, 12, &[]),
        vec![
            spec(3, sku, read),
            spec(4, source, read),
            spec(9, source, read),
        ]
    );
    assert_eq!(
        contract(162, 8, &[]),
        vec![
            spec(3, sku, read),
            spec(4, source, mutable),
            spec(4, source_descriptor, read),
        ]
    );
    assert_eq!(
        contract(163, 9, &[]),
        vec![
            spec(3, sku, read),
            spec(4, source, read),
            spec(4, source_descriptor, read),
        ]
    );
    assert_eq!(
        contract(164, 9, &[]),
        vec![
            spec(3, sku, read),
            spec(4, source, mutable),
            spec(4, source_descriptor, read),
        ]
    );
    assert_eq!(contract(165, 7, &[]), pair(3, mutable));
    assert_eq!(
        contract(166, 9, &[]),
        vec![spec(3, source, read), spec(5, sku, read)]
    );
    assert_eq!(contract(167, 6, &[]), vec![spec(3, source, read)]);
    assert_eq!(
        contract(168, 10, &[]),
        vec![spec(3, sku, read), spec(5, source, read)]
    );
    assert_eq!(contract(196, 5, &[]), vec![spec(4, source, mutable)]);
    assert_eq!(contract(198, 7, &[]), vec![spec(3, source, read)]);
    assert_eq!(contract(199, 10, &[]), vec![spec(4, source, mutable)]);
    assert_eq!(contract(201, 6, &[]), vec![spec(3, source, read)]);
    assert_eq!(contract(202, 11, &[]), vec![spec(3, source, read)]);
    assert_eq!(
        contract(170, 9, &[]),
        vec![
            spec(3, sku, mutable),
            spec(5, source, read),
            spec(5, source_descriptor, read),
            spec(6, reward, mutable),
        ]
    );
    assert_eq!(
        contract(171, 8, &[]),
        vec![
            spec(3, sku, mutable),
            spec(4, source, read),
            spec(
                6,
                CompressedStateDomain::OracleUsdcRewardRegistration,
                initialize,
            ),
        ]
    );
    for tag in [169, 194] {
        assert_eq!(
            contract(tag, 7, &[0]),
            vec![spec(4, source, mutable), spec(5, reward, mutable)]
        );
        assert_eq!(
            contract(tag, 7, &[1]),
            vec![spec(4, source, read), spec(5, support, mutable)]
        );
        assert_eq!(
            contract(tag, 10, &[2]),
            vec![spec(4, source, mutable), spec(5, reward, mutable)]
        );
    }
    assert_eq!(contract(169, 6, &[3]), pair(3, read));
    assert_eq!(contract(169, 8, &[4]), pair(3, read));
    assert_eq!(contract(169, 7, &[5]), vec![spec(3, source, read)]);
    assert!(required_access_contract(&[169, 6], 8).is_err());
    assert_eq!(
        contract(174, 16, &[0]),
        vec![
            spec(
                10,
                CompressedStateDomain::OracleUsdcRewardReceipt,
                initialize,
            ),
            spec(13, sku, mutable),
            spec(14, source, read),
            spec(15, reward, read),
        ]
    );
    assert_eq!(
        contract(174, 19, &[1]),
        vec![
            spec(
                10,
                CompressedStateDomain::OracleUsdcRewardReceipt,
                initialize,
            ),
            spec(13, sku, mutable),
            spec(14, source, read),
            spec(15, reward, read),
            spec(18, support, read),
        ]
    );
    assert_eq!(
        contract(174, 16, &[2]),
        vec![
            spec(
                10,
                CompressedStateDomain::OracleUsdcRewardReceipt,
                initialize,
            ),
            spec(13, sku, mutable),
            spec(14, source, read),
            spec(14, source_descriptor, read),
            spec(15, reward, read),
        ]
    );
    assert_eq!(
        contract(174, 16, &[3]),
        vec![
            spec(
                10,
                CompressedStateDomain::OracleUsdcRewardReceipt,
                initialize,
            ),
            spec(13, sku, mutable),
            spec(
                14,
                CompressedStateDomain::OracleUsdcRewardRegistration,
                read,
            ),
        ]
    );
    assert_eq!(
        contract(185, 8, &[0]),
        vec![spec(3, source, mutable), spec(7, coverage, mutable)]
    );
    assert_eq!(
        contract(185, 10, &[2]),
        vec![spec(3, source, mutable), spec(9, coverage, mutable)]
    );
    assert_eq!(
        contract(185, 13, &[3]),
        vec![
            spec(3, source, mutable),
            spec(5, source, mutable),
            spec(6, sku, read),
            spec(7, reward, mutable),
            spec(8, reward, mutable),
            spec(12, coverage, mutable),
        ]
    );
    assert_eq!(contract(81, 4, &[]), vec![spec(3, source, mutable)]);
    assert_eq!(contract(84, 6, &[0; 35]), pair(5, mutable));
    assert_eq!(contract(84, 9, &[0; 35]).len(), 8);
    assert!(required_access_contract(&[84], 10).is_err());
    let mut settlement_bucket = vec![113];
    settlement_bucket.extend_from_slice(&[0; 33]);
    assert!(required_access_contract(&settlement_bucket, 8).is_err());
    assert_eq!(contract(122, 8, &[0; 33]), pair(7, read));
    assert_eq!(contract(122, 11, &[0; 33]).len(), 8);
    assert!(required_access_contract(&[122], 12).is_err());
    for retired_tag in [85, 112, 114, 115, 123] {
        assert!(required_access_contract(&[retired_tag], 10).is_err());
    }
    let mut live_median_payload = [0; 33];
    live_median_payload[32] = 0;
    assert_eq!(
        contract(197, 7, &live_median_payload),
        vec![spec(5, source, read)]
    );
    let mut invalid_live_median = vec![197];
    invalid_live_median.extend_from_slice(&live_median_payload);
    assert!(required_access_contract(&invalid_live_median, 8).is_err());
    let mut grace_median_payload = [0; 33];
    grace_median_payload[32] = 1;
    assert_eq!(
        contract(197, 10, &grace_median_payload),
        vec![spec(5, source, read)]
    );
    let mut invalid_grace_median = vec![197];
    invalid_grace_median.extend_from_slice(&grace_median_payload);
    assert!(required_access_contract(&invalid_grace_median, 11).is_err());
    assert!(required_access_contract(&[206], 17).is_err());
    assert!(required_access_contract(&[206], 19).is_err());
    assert_eq!(contract(191, 5, &[]), vec![spec(4, source, mutable)]);
    assert_eq!(
        contract(191, 6, &[]),
        vec![spec(4, source, mutable), spec(5, coverage, mutable)]
    );
    assert_eq!(contract(175, 15, &[0]), vec![spec(13, source, read)]);
    assert_eq!(
        contract(175, 17, &[0]),
        vec![spec(13, source, read), spec(15, source, read)]
    );
    assert_eq!(contract(175, 19, &[1]), vec![spec(14, source, read)]);
    assert_eq!(contract(175, 15, &[2]), pair(14, read));
    assert_eq!(contract(178, 10, &[]), pair(9, mutable));
    assert_eq!(contract(178, 14, &[]), vec![spec(9, source, mutable)]);
    assert_eq!(
        contract(193, 12, &[]),
        vec![spec(8, source, mutable), spec(11, coverage, mutable)]
    );
    assert_eq!(
        contract(193, 17, &[]),
        vec![
            spec(8, source, mutable),
            spec(10, source, mutable),
            spec(12, sku, read),
            spec(13, reward, mutable),
            spec(14, reward, mutable),
            spec(16, coverage, mutable),
        ]
    );
    assert_eq!(
        contract(179, 6, &[]),
        vec![spec(
            4,
            CompressedStateDomain::OracleSambaWinningVote,
            initialize,
        )]
    );
    assert_eq!(
        contract(180, 10, &[]),
        vec![spec(
            7,
            CompressedStateDomain::OracleSambaVoteSettlementReceipt,
            initialize,
        )]
    );
    assert_eq!(
        contract(180, 11, &[]),
        vec![
            spec(
                7,
                CompressedStateDomain::OracleSambaVoteSettlementReceipt,
                initialize,
            ),
            spec(10, CompressedStateDomain::OracleSambaWinningVote, read,),
        ]
    );
    assert!(required_access_contract(&[180], 12).is_err());
    assert!(required_access_contract(&[193], 13).is_err());
    assert!(required_access_contract(&[178], 11).is_err());
    assert!(required_access_contract(&[205], 10).is_err());
}
