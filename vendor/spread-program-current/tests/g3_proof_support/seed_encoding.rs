// Test-only encoding for the genesis fixture producer.
use light_compressed_account::{compressed_account::PackedMerkleContext, InstructionDiscriminator};
use light_sdk::cpi::v2::LightSystemProgramCpi;
#[inline(always)]
fn push_vec_len(output: &mut Vec<u8>, len: usize) {
    output.extend_from_slice(&(len as u32).to_le_bytes());
}

#[inline(always)]
fn push_packed_merkle_context(output: &mut Vec<u8>, context: &PackedMerkleContext) {
    output.push(context.merkle_tree_pubkey_index);
    output.push(context.queue_pubkey_index);
    output.extend_from_slice(&context.leaf_index.to_le_bytes());
    output.push(context.prove_by_index as u8);
}

pub(super) fn encode(instruction: &LightSystemProgramCpi) -> Vec<u8> {
    let mut output = Vec::new();
    output.extend_from_slice(instruction.discriminator());
    output.push(instruction.mode);
    output.push(instruction.bump);
    output.extend_from_slice(instruction.invoking_program_id.array_ref());
    output.extend_from_slice(&instruction.compress_or_decompress_lamports.to_le_bytes());
    output.push(instruction.is_compress as u8);
    output.push(instruction.with_cpi_context as u8);
    output.push(instruction.with_transaction_hash as u8);
    output.push(instruction.cpi_context.set_context as u8);
    output.push(instruction.cpi_context.first_set_context as u8);
    output.push(instruction.cpi_context.cpi_context_account_index);

    if let Some(proof) = &instruction.proof {
        output.push(1);
        output.extend_from_slice(&proof.a);
        output.extend_from_slice(&proof.b);
        output.extend_from_slice(&proof.c);
    } else {
        output.push(0);
    }

    push_vec_len(&mut output, instruction.new_address_params.len());
    for address in &instruction.new_address_params {
        output.extend_from_slice(&address.seed);
        output.push(address.address_queue_account_index);
        output.push(address.address_merkle_tree_account_index);
        output.extend_from_slice(&address.address_merkle_tree_root_index.to_le_bytes());
        output.push(address.assigned_to_account as u8);
        output.push(address.assigned_account_index);
    }

    push_vec_len(&mut output, instruction.account_infos.len());
    for account in &instruction.account_infos {
        if let Some(address) = &account.address {
            output.push(1);
            output.extend_from_slice(address);
        } else {
            output.push(0);
        }
        if let Some(input) = &account.input {
            output.push(1);
            output.extend_from_slice(&input.discriminator);
            output.extend_from_slice(&input.data_hash);
            push_packed_merkle_context(&mut output, &input.merkle_context);
            output.extend_from_slice(&input.root_index.to_le_bytes());
            output.extend_from_slice(&input.lamports.to_le_bytes());
        } else {
            output.push(0);
        }
        if let Some(account_output) = &account.output {
            output.push(1);
            output.extend_from_slice(&account_output.discriminator);
            output.extend_from_slice(&account_output.data_hash);
            output.push(account_output.output_merkle_tree_index);
            output.extend_from_slice(&account_output.lamports.to_le_bytes());
            push_vec_len(&mut output, account_output.data.len());
            output.extend_from_slice(&account_output.data);
        } else {
            output.push(0);
        }
    }

    push_vec_len(&mut output, instruction.read_only_addresses.len());
    for address in &instruction.read_only_addresses {
        output.extend_from_slice(&address.address);
        output.extend_from_slice(&address.address_merkle_tree_root_index.to_le_bytes());
        output.push(address.address_merkle_tree_account_index);
    }

    push_vec_len(&mut output, instruction.read_only_accounts.len());
    for account in &instruction.read_only_accounts {
        output.extend_from_slice(&account.account_hash);
        push_packed_merkle_context(&mut output, &account.merkle_context);
        output.extend_from_slice(&account.root_index.to_le_bytes());
    }
    output
}
