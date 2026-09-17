use super::*;

#[tokio::test(flavor = "multi_thread")]
async fn test_reject_spoofed_vault_token_account() {
    let mut harness = setup_harness().await;

    let fake_vault = create_token_account(
        &mut harness.context,
        &harness.usdc_mint,
        &harness.attacker.pubkey(),
    )
    .await;

    let err = send_ix(
        &mut harness.context,
        deposit_ix(
            harness.user.pubkey(),
            harness.user_token_account,
            fake_vault,
            harness.vault_pda,
            harness.usdc_mint,
            100_000,
        ),
        &[&harness.user],
    )
    .await
    .unwrap_err();

    assert_custom_error(err, VaultError::InvalidTokenAccount);
}
