//! Local genesis fixture producer only. Never a deployment candidate.
//! Forward a prebuilt Light CPI under the local fixture owner, then replace this
//! executable with the independently hashed production artifact before testing.
#![allow(unexpected_cfgs)]
use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    pubkey::Pubkey,
};
entrypoint!(seed);
fn seed(program: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let (_, bump) = Pubkey::find_program_address(&[b"cpi_authority"], program);
    let ix = Instruction {
        program_id: *accounts[0].key,
        accounts: accounts[1..]
            .iter()
            .enumerate()
            .map(|(i, a)| AccountMeta {
                pubkey: *a.key,
                is_signer: a.is_signer || i == 1,
                is_writable: a.is_writable,
            })
            .collect(),
        data: data.to_vec(),
    };
    invoke_signed(&ix, &accounts[1..], &[&[b"cpi_authority", &[bump]]])
}
