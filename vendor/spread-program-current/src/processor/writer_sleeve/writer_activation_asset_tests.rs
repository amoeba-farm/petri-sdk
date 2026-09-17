use super::*;

#[test]
fn recorded_surplus_remains_valid_activation_backing() {
    let sleeve = WriterSleeveV1 {
        writer_principal_atoms: 999_999,
        locked_primary_premium_atoms: 0,
        accounted_asset_atoms: 1_000_000,
        ..WriterSleeveV1::default()
    };
    assert!(writer_activation_assets_are_sufficient(&sleeve).unwrap());

    let underfunded = WriterSleeveV1 {
        accounted_asset_atoms: 999_998,
        ..sleeve
    };
    assert!(!writer_activation_assets_are_sufficient(&underfunded).unwrap());
}
