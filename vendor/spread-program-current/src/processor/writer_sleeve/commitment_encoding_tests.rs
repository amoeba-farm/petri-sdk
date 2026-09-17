use super::*;

#[test]
fn fixed_stack_commitments_match_the_original_byte_contract() {
    let mut book = WriterSeriesBookV1 {
        sleeve: Pubkey::new_unique(),
        settlement_group: Pubkey::new_unique(),
        series_count: crate::constants::WRITER_MAX_LIVE_SERIES as u8,
        ..WriterSeriesBookV1::default()
    };
    for (index, record) in book
        .records
        .iter_mut()
        .take(crate::constants::WRITER_MAX_LIVE_SERIES)
        .enumerate()
    {
        let value = u64::try_from(index + 1).unwrap();
        record.series_id = [u8::try_from(index + 1).unwrap(); 32];
        record.payoff_digest = [u8::try_from(index + 41).unwrap(); 32];
        record.total_physical_supply_atoms = value * 11;
        record.issuer_controlled_atoms = value * 13;
        record.external_open_interest_atoms = value * 17;
        record.primary_premium_collected_atoms = value * 19;
        record.settlement_external_oi_snapshot_atoms = value * 23;
        record.settlement_liability_initial_atoms = value * 29;
        record.settlement_liability_remaining_atoms = value * 31;
    }

    let mut family = Vec::new();
    family.extend_from_slice(WRITER_SERIES_FAMILY_HASH_DOMAIN);
    family.extend_from_slice(&u32::from(book.series_count).to_le_bytes());
    for record in book.records.iter().take(usize::from(book.series_count)) {
        family.extend_from_slice(&record.series_id);
        family.extend_from_slice(&record.payoff_digest);
    }
    assert_eq!(
        writer_series_family_hash(&book),
        hashv(&[family.as_slice()]).to_bytes()
    );

    let mut encoded_book = Vec::new();
    encoded_book.extend_from_slice(WRITER_BOOK_HASH_DOMAIN);
    encoded_book.extend_from_slice(book.sleeve.as_ref());
    encoded_book.extend_from_slice(book.settlement_group.as_ref());
    encoded_book.extend_from_slice(&u32::from(book.series_count).to_le_bytes());
    for record in book.records.iter().take(usize::from(book.series_count)) {
        encoded_book.extend_from_slice(&record.series_id);
        encoded_book.extend_from_slice(&record.payoff_digest);
        encoded_book.extend_from_slice(&record.total_physical_supply_atoms.to_le_bytes());
        encoded_book.extend_from_slice(&record.issuer_controlled_atoms.to_le_bytes());
        encoded_book.extend_from_slice(&record.external_open_interest_atoms.to_le_bytes());
        encoded_book.extend_from_slice(&record.primary_premium_collected_atoms.to_le_bytes());
        encoded_book.extend_from_slice(&record.settlement_external_oi_snapshot_atoms.to_le_bytes());
        encoded_book.extend_from_slice(&record.settlement_liability_initial_atoms.to_le_bytes());
        encoded_book.extend_from_slice(&record.settlement_liability_remaining_atoms.to_le_bytes());
    }
    assert_eq!(
        writer_book_digest(&book),
        hashv(&[encoded_book.as_slice()]).to_bytes()
    );

    let group_key = Pubkey::new_unique();
    let group = WriterSettlementGroupV1 {
        underlying_id: [1; 32],
        expiry_ts: 2,
        settlement_mint: Pubkey::new_unique(),
        anchor_market: Pubkey::new_unique(),
        anchor_oracle_month: Pubkey::new_unique(),
        oracle_methodology_version: 3,
        product_manifest_root: [4; 32],
        coverage_manifest_hash: [5; 32],
        recipe_hash: [6; 32],
        settlement_source_digest: [7; 32],
        active_weight_manifest_hash: [8; 32],
        security_cap_atoms: 9,
        signer_registry: Pubkey::new_unique(),
        signer_set: Pubkey::new_unique(),
        signer_set_version: 10,
        signer_set_hash: [11; 32],
        settlement_ts: 12,
        ..WriterSettlementGroupV1::default()
    };
    let mut encoded_group = Vec::new();
    encoded_group.extend_from_slice(b"ameba-writer-settlement-group-g3");
    encoded_group.extend_from_slice(group_key.as_ref());
    encoded_group.extend_from_slice(&group.underlying_id);
    encoded_group.extend_from_slice(&group.expiry_ts.to_le_bytes());
    encoded_group.extend_from_slice(group.settlement_mint.as_ref());
    encoded_group.extend_from_slice(group.anchor_market.as_ref());
    encoded_group.extend_from_slice(group.anchor_oracle_month.as_ref());
    encoded_group.extend_from_slice(&group.oracle_methodology_version.to_le_bytes());
    encoded_group.extend_from_slice(&group.product_manifest_root);
    encoded_group.extend_from_slice(&group.coverage_manifest_hash);
    encoded_group.extend_from_slice(&group.recipe_hash);
    encoded_group.extend_from_slice(&group.settlement_source_digest);
    encoded_group.extend_from_slice(&group.active_weight_manifest_hash);
    encoded_group.extend_from_slice(&group.security_cap_atoms.to_le_bytes());
    encoded_group.extend_from_slice(group.signer_registry.as_ref());
    encoded_group.extend_from_slice(group.signer_set.as_ref());
    encoded_group.extend_from_slice(&group.signer_set_version.to_le_bytes());
    encoded_group.extend_from_slice(&group.signer_set_hash);
    encoded_group.extend_from_slice(&group.settlement_ts.to_le_bytes());
    assert_eq!(
        writer_group_commitment(&group_key, &group),
        hashv(&[encoded_group.as_slice()]).to_bytes()
    );
}
