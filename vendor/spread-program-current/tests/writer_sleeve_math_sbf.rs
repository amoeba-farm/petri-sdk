#![cfg(feature = "writer-math-benchmark")]

use light_token_minter::writer_sleeve_math::WRITER_MATH_BENCHMARK_DOMAIN;
use solana_program_test::ProgramTest;
use solana_sdk::{
    instruction::Instruction,
    signature::Signer,
    transaction::{Transaction, TransactionError},
};

const TRANSACTION_COMPUTE_LIMIT: u64 = 1_400_000;

#[tokio::test]
async fn twenty_series_close_preview_fits_sbf_compute_budget() {
    let mut program_test = ProgramTest::new("light_token_minter", light_token_minter::id(), None);
    program_test.set_compute_max_units(TRANSACTION_COMPUTE_LIMIT);
    let context = program_test.start_with_context().await;

    let series_count = 20u8;
    let mut data = WRITER_MATH_BENCHMARK_DOMAIN.to_vec();
    data.push(series_count);
    let instruction = Instruction {
        program_id: light_token_minter::id(),
        accounts: Vec::new(),
        data,
    };
    let transaction = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&context.payer.pubkey()),
        &[&context.payer],
        context.last_blockhash,
    );
    let simulation = context
        .banks_client
        .simulate_transaction(transaction)
        .await
        .expect("SBF simulation transport");
    assert_eq!(
        simulation.result,
        Some(Ok::<(), TransactionError>(())),
        "series_count={series_count} {simulation:?}"
    );
    let details = simulation
        .simulation_details
        .expect("successful SBF simulation details");
    let return_data = details.return_data.expect("benchmark return data");
    assert_eq!(return_data.program_id, light_token_minter::id());
    assert_eq!(return_data.data.len(), 26);
    let candidate_count = u16::from_le_bytes(return_data.data[..2].try_into().unwrap());
    let reserve_before = u64::from_le_bytes(return_data.data[2..10].try_into().unwrap());
    let withdrawal = u64::from_le_bytes(return_data.data[10..18].try_into().unwrap());
    let gross = u64::from_le_bytes(return_data.data[18..26].try_into().unwrap());
    assert_eq!(candidate_count, 127);
    assert!(reserve_before > 0);
    assert!(withdrawal > 0);
    assert!(withdrawal <= 100_000_000);
    assert!(gross >= reserve_before);
    assert!(details.units_consumed <= TRANSACTION_COMPUTE_LIMIT);
    println!(
        "writer_sleeve_math_sbf series={series_count} candidates={candidate_count} \
         reserve={reserve_before} withdrawal={withdrawal} gross={gross} compute_units={}",
        details.units_consumed
    );
}
