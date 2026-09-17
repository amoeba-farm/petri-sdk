//! Owner-supplied integer anchors against production math, complementary to SBF.
//! These unit anchors are never counted as fresh-market lifecycle completion.
use light_token_minter::{
    oracle_rank::{encode_signed, MedianRank},
    writer_participation_math::{final_payout, ParticipationTotals},
};
use serde_json::Value;

fn vectors() -> Value {
    serde_json::from_str(include_str!(
        "../../../docs/governance/q1-q7-closure/AMOEBA_Q1_Q7_REFERENCE_VECTORS.json"
    ))
    .unwrap()
}
fn u(value: &Value) -> u64 {
    value.as_str().unwrap().parse().unwrap()
}

#[test]
fn provided_temporal_medians_match_complete_streams() {
    for case in vectors()["temporal_median"].as_array().unwrap() {
        let values = case["values"]
            .as_array()
            .unwrap()
            .iter()
            .map(u)
            .collect::<Vec<_>>();
        let mut sorted = values.clone();
        sorted.sort_unstable();
        let mut rank = MedianRank {
            lower: sorted[(sorted.len() - 1) / 2],
            upper: sorted[sorted.len() / 2],
            ..Default::default()
        };
        for value in values {
            rank.observe(value).unwrap();
        }
        assert_eq!(rank.median().unwrap(), u(&case["expected"]));
    }
}

#[test]
fn provided_signed_medians_preserve_rounding_and_extremes() {
    let data = vectors();
    let cases = data["bucket_median"]
        .as_array()
        .expect("fixed owner vector section");
    for case in cases {
        let mut values = case["values"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().parse::<i64>().unwrap())
            .collect::<Vec<_>>();
        values.sort_unstable();
        let mut rank = MedianRank {
            lower: encode_signed(values[(values.len() - 1) / 2]),
            upper: encode_signed(values[values.len() / 2]),
            ..Default::default()
        };
        for value in values {
            rank.observe(encode_signed(value)).unwrap();
        }
        assert_eq!(
            rank.signed_median().unwrap(),
            case["expected"].as_str().unwrap().parse::<i64>().unwrap()
        );
    }
}

#[test]
fn provided_writer_profit_loss_zero_boundary_conserve_after_split() {
    for case in vectors()["receipt_allocations"].as_array().unwrap() {
        let expiry = 3_000_000;
        let mut total = ParticipationTotals::default();
        let mut lots = vec![];
        for input in case["lots"].as_array().unwrap() {
            let (next, lot) = total
                .contribute(
                    u(&input["principal_atoms"]),
                    expiry - u(&input["duration_seconds"]),
                    1,
                    expiry,
                )
                .unwrap();
            total = next;
            lots.push(lot);
        }
        assert_eq!(total.principal, u(&case["total_principal_atoms"]));
        let residual = u(&case["writer_residual_atoms"]);
        total.admit(residual, 0).unwrap();
        let expected = case["expected_payouts_atoms"]
            .as_array()
            .unwrap()
            .iter()
            .map(u)
            .collect::<Vec<_>>();
        let mut sum = 0;
        for (lot, want) in lots.into_iter().zip(expected) {
            let payout =
                |l| final_payout(l, total.principal, total.capital_seconds, residual).unwrap();
            assert_eq!(payout(lot), want);
            let (left, right) = lot.split(lot.principal / 4).unwrap();
            assert_eq!(payout(left) + payout(right), want);
            sum += want;
        }
        assert_eq!(sum, residual);
        if residual < total.principal {
            assert!(total.admit(residual - 1, 0).is_err());
        }
    }
}
