use super::*;

#[test]
fn actual_js_flat_hot_and_absent_destination_require_fresh_exact_signing_accounts() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let output = std::process::Command::new("node")
        .arg("scripts/emit-flat-rust-fixture.mjs")
        .current_dir(root)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let generated: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(generated["status"], "offline-unattested");
    let fixture = Fixture::new();
    let context =
        observe_current_governed_write_context_v1(&fixture.release, fixture.observation(1001), 101)
            .unwrap();
    for case in generated["cases"].as_array().unwrap() {
        let encoded = serde_json::to_string(&case["plan"]).unwrap();
        let operation =
            crate::parse_current_governed_flat_transfer_operation_json_v1(&context, &encoded, &[])
                .unwrap();
        assert_eq!(
            operation
                .flat_operation()
                .unwrap()
                .plan
                .prepared_plan_digest,
            case["plan"]["preparedPlanDigest"]
        );
        let raw = case["rawAccounts"].as_array().unwrap();
        let bytes = raw
            .iter()
            .map(|account| {
                account["dataBase64"]
                    .as_str()
                    .map(|value| BASE64.decode(value).unwrap())
            })
            .collect::<Vec<_>>();
        let accounts = raw
            .iter()
            .zip(&bytes)
            .map(|(account, data)| {
                let address = Pubkey::from_str(account["address"].as_str().unwrap()).unwrap();
                CurrentGovernedOptionalAccountObservationV1 {
                    address,
                    account: data
                        .as_ref()
                        .map(|data| CurrentGovernedAccountObservationV1 {
                            address,
                            owner: Pubkey::from_str(account["owner"].as_str().unwrap()).unwrap(),
                            executable: false,
                            data,
                        }),
                }
            })
            .collect::<Vec<_>>();
        let signing = prepare_current_governed_signing_v1(
            &operation,
            &fixture.release,
            CurrentGovernedSigningObservationV1 {
                deployment: fixture.observation(1002),
                business_accounts: &accounts,
            },
            0,
            Hash::new_unique(),
        )
        .unwrap();
        let tx = solana_transaction::Transaction::new_unsigned(signing.message().clone());
        revalidate_current_governed_signed_transaction_v1(
            &signing,
            &fixture.release,
            CurrentGovernedSigningObservationV1 {
                deployment: fixture.observation(1003),
                business_accounts: &accounts,
            },
            &tx,
        )
        .unwrap();
        let mut changed = accounts.clone();
        changed[0].account.as_mut().unwrap().owner = CURRENT_LIVE_PROGRAM_ID;
        assert!(
            prepare_current_governed_signing_v1(
                &operation,
                &fixture.release,
                CurrentGovernedSigningObservationV1 {
                    deployment: fixture.observation(1002),
                    business_accounts: &changed
                },
                0,
                Hash::new_unique()
            )
            .is_err()
        );
        assert!(
            revalidate_current_governed_signed_transaction_v1(
                &signing,
                &fixture.release,
                CurrentGovernedSigningObservationV1 {
                    deployment: fixture.observation(1003),
                    business_accounts: &changed
                },
                &tx
            )
            .is_err()
        );
        let mut forged = case["plan"].clone();
        forged["semantic"]["amountAtoms"] = Value::from("8");
        assert!(
            crate::parse_current_governed_flat_transfer_operation_json_v1(
                &context,
                &serde_json::to_string(&forged).unwrap(),
                &[]
            )
            .is_err()
        );
    }
}
