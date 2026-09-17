//! Exact current G3 types and arithmetic from the pinned Spread source.
//! Historical root modules retain their old type identity for offline reconciliation.
pub use ameba_spread_program::writer_participation_state::{
    WriterContributionV2, WriterParticipationActionV2, derive_contribution,
};
pub use ameba_spread_program::{
    dlmm_order_math, dlmm_order_state, writer_participation_math, writer_participation_state,
};
pub const SPREAD_SOURCE_COMMIT: &str = "7d22fd9a55199b54c099b842ec705571abeb27ac";
pub const BUSINESS_GENERATION: u8 = 3;
pub const SOURCE_MATERIALIZED_BYTES: usize = 352;
pub const SOURCE_COMPACT_BYTES: usize = 216;

/// Strict wire integer: no sign, padding, leading zero, exponent or truncation.
pub fn parse_u128_decimal(value: &str) -> Option<u128> {
    if value.is_empty()
        || (value.len() > 1 && value.starts_with('0'))
        || !value.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    value.parse().ok()
}
#[cfg(test)]
mod tests {
    use super::writer_participation_math::{ContributionInterval, final_payout};
    #[test]
    fn canonical_typescript_vectors_match_native_g3_math() {
        let rows: Vec<serde_json::Value> = serde_json::from_str(include_str!(
            "../../fixtures/g3-receipt-payout-vectors.json"
        ))
        .unwrap();
        assert_eq!(rows.len(), 1683);
        for row in rows {
            let n = |key: &str| row[key].as_str().unwrap().parse::<u128>().unwrap();
            let lot = ContributionInterval {
                principal: u64::try_from(n("principal")).unwrap(),
                entry_ts: u64::try_from(n("entryTs")).unwrap(),
                expiry_ts: u64::try_from(n("expiryTs")).unwrap(),
                weight_offset: n("weightOffset"),
            };
            let actual = final_payout(
                lot,
                u64::try_from(n("poolPrincipal")).unwrap(),
                n("poolWeight"),
                u64::try_from(n("residual")).unwrap(),
            )
            .ok()
            .map(|n| n.to_string());
            let expected = row["result"].as_str().map(str::to_owned);
            assert_eq!(actual, expected, "{row}");
        }
    }
}
