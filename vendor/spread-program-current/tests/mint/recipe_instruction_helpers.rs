use super::*;

pub(super) async fn send_ix(
    context: &mut ProgramTestContext,
    instruction: Instruction,
    extra_signers: &[&Keypair],
) -> Result<(), BanksClientError> {
    send_ixs(context, vec![instruction], extra_signers).await
}

pub(super) async fn send_ixs(
    context: &mut ProgramTestContext,
    instructions: Vec<Instruction>,
    extra_signers: &[&Keypair],
) -> Result<(), BanksClientError> {
    let recent_blockhash = context.banks_client.get_latest_blockhash().await.unwrap();
    let mut signers: Vec<&Keypair> = vec![&context.payer];
    signers.extend_from_slice(extra_signers);

    let tx = Transaction::new_signed_with_payer(
        &instructions,
        Some(&context.payer.pubkey()),
        &signers,
        recent_blockhash,
    );

    context.banks_client.process_transaction(tx).await
}
