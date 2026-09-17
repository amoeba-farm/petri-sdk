//! Offline schema-3 reconstruction. Expected instructions must come from independent
//! canonical construction/admission, never from the untrusted plan itself.
//! Runtime identity, fresh business admission and expiry remain the submitter's job.
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use solana_message::{AddressLookupTableAccount, VersionedMessage};
#[path = "g3_message.rs"]
mod message;
use solana_program::{
    hash::{Hash, hash},
    instruction::Instruction,
    pubkey::Pubkey,
};
use solana_transaction::versioned::VersionedTransaction;
use std::str::FromStr;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct G3LookupTable {
    pub address: String,
    pub data_base64: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct G3OperationPlan {
    pub schema_version: u8,
    pub operation: String,
    pub owner: String,
    pub profile_sha256: String,
    pub source_commit: String,
    pub epoch: String,
    pub observed_slot: u64,
    pub blockhash: String,
    pub last_valid_block_height: u64,
    pub serialized_transaction_base64: String,
    pub message_sha256: String,
    pub prepared_plan_digest: String,
    pub operation_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lookup_table: Option<G3LookupTable>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn typescript_legacy_v0_signatures_and_mutations() {
        let rows: Vec<serde_json::Value> = serde_json::from_str(include_str!(
            "../../fixtures/g3-native-operation-vectors.json"
        ))
        .unwrap();
        assert_eq!(rows.len(), 7);
        for row in rows {
            let plan: G3OperationPlan = serde_json::from_value(row["plan"].clone()).unwrap();
            let instructions: Vec<Instruction> = row["instructions"]
                .as_array()
                .unwrap()
                .iter()
                .map(|ix| Instruction {
                    program_id: key(ix["programId"].as_str().unwrap()).unwrap(),
                    data: serde_json::from_value(ix["data"].clone()).unwrap(),
                    accounts: ix["accounts"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|a| solana_program::instruction::AccountMeta {
                            pubkey: key(a["address"].as_str().unwrap()).unwrap(),
                            is_signer: a["signer"].as_bool().unwrap(),
                            is_writable: a["writable"].as_bool().unwrap(),
                        })
                        .collect(),
                })
                .collect();
            let signed = row["signed"].as_str().unwrap();
            plan.validate_signed(&instructions, signed).unwrap();
            let mut altered = instructions.clone();
            altered.last_mut().unwrap().accounts[0].is_signer = false;
            assert!(plan.validate_signed(&altered, signed).is_err());
            let mut changed = plan.clone();
            changed.operation_id = "0".repeat(64);
            assert!(changed.validate_signed(&instructions, signed).is_err());
            let mut forged = transaction(signed).unwrap();
            forged.signatures[0] = Default::default();
            assert!(
                plan.validate_signed(
                    &instructions,
                    &BASE64.encode(bincode::serialize(&forged).unwrap())
                )
                .is_err()
            );
        }
    }
}
fn digest(bytes: &[u8]) -> String {
    hash(bytes)
        .to_bytes()
        .iter()
        .map(|n| format!("{n:02x}"))
        .collect()
}
fn bytes(text: &str, maximum: usize) -> Result<Vec<u8>, String> {
    if text.len() > maximum.div_ceil(3) * 4 {
        return Err("G3 oversized bytes".into());
    }
    let value = BASE64.decode(text).map_err(|_| "G3 base64")?;
    if value.len() > maximum || BASE64.encode(&value) != text {
        return Err("G3 noncanonical bytes".into());
    }
    Ok(value)
}
fn key(text: &str) -> Result<Pubkey, String> {
    let result = Pubkey::from_str(text).map_err(|_| "G3 address")?;
    if result.to_string() != text {
        return Err("G3 noncanonical address".into());
    }
    Ok(result)
}
fn transaction(text: &str) -> Result<VersionedTransaction, String> {
    let wire = bytes(text, 1232)?;
    let tx: VersionedTransaction = bincode::deserialize(&wire).map_err(|_| "G3 transaction")?;
    if bincode::serialize(&tx).map_err(|_| "G3 transaction")? != wire {
        return Err("G3 trailing/noncanonical transaction".into());
    }
    Ok(tx)
}
impl G3OperationPlan {
    pub fn commitment(&self) -> Result<String, String> {
        let lookup = self
            .lookup_table
            .as_ref()
            .map(|t| serde_json::json!([t.address, t.data_base64]));
        let fields = serde_json::json!([
            "amoeba.g3.user-operation.v1",
            self.schema_version,
            self.operation,
            self.owner,
            self.profile_sha256,
            self.source_commit,
            self.epoch,
            self.observed_slot,
            self.blockhash,
            self.last_valid_block_height,
            self.serialized_transaction_base64,
            self.message_sha256,
            lookup
        ]);
        Ok(digest(
            &serde_json::to_vec(&fields).map_err(|_| "G3 commitment")?,
        ))
    }
    fn lookup(&self) -> Result<Vec<AddressLookupTableAccount>, String> {
        let Some(table) = &self.lookup_table else {
            return Ok(vec![]);
        };
        let data = bytes(&table.data_base64, 8248)?;
        if data.len() < 56
            || (data.len() - 56) % 32 != 0
            || data[..4] != 1u32.to_le_bytes()
            || data[4..12] != u64::MAX.to_le_bytes()
            || data[21] > 1
        {
            return Err("G3 lookup metadata".into());
        }
        let extended = u64::from_le_bytes(data[12..20].try_into().map_err(|_| "G3 lookup slot")?);
        if extended >= self.observed_slot
            || usize::from(data[20]) > (data.len() - 56) / 32
            || data[if data[21] == 0 { 22 } else { 54 }..56]
                .iter()
                .any(|n| *n != 0)
        {
            return Err("G3 lookup is not active and mature".into());
        }
        Ok(vec![AddressLookupTableAccount {
            key: key(&table.address)?,
            addresses: data[56..]
                .chunks_exact(32)
                .map(|a| Pubkey::new_from_array(a.try_into().expect("32 byte chunk")))
                .collect(),
        }])
    }
    /// Rebuilds the entire legacy/v0 message, including account privileges and ALT indexes.
    pub fn reconstruct(&self, expected: &[Instruction]) -> Result<VersionedMessage, String> {
        let lock: serde_json::Value =
            serde_json::from_str(include_str!("../../release/g3-integration-lock.v1.json"))
                .map_err(|_| "G3 package lock")?;
        if self.schema_version != 3
            || self.profile_sha256 != lock["profile"]["profileSha256"]
            || self.source_commit != lock["spread"]["sourceCommit"]
            || self.observed_slot > 9_007_199_254_740_991
            || self.last_valid_block_height > 9_007_199_254_740_991
            || self.commitment()? != self.prepared_plan_digest
            || self.operation_id != self.prepared_plan_digest
        {
            return Err("G3 plan identity".into());
        }
        let owner = key(&self.owner)?;
        let program = key(lock["profile"]["programId"].as_str().ok_or("G3 program")?)?;
        let gate = key(lock["profile"]["gate"].as_str().ok_or("G3 gate")?)?;
        let epoch = crate::g3::parse_u128_decimal(&self.epoch)
            .and_then(|v| u64::try_from(v).ok())
            .ok_or("G3 epoch")?;
        let business_index = if self.operation == "order" {
            if expected.len() != 2
                || expected[0].program_id != key("ComputeBudget111111111111111111111111111111")?
                || !expected[0].accounts.is_empty()
                || expected[0].data != [2, 64, 66, 15, 0]
            {
                return Err("G3 order compute budget mismatch".into());
            }
            1
        } else {
            if expected.len() != 1 {
                return Err("G3 one receipt instruction required".into());
            }
            0
        };
        let ix = &expected[business_index];
        if ix.program_id != program
            || ix.data.len() < 22
            || !ix.accounts.iter().any(|m| m.is_signer)
            || ix.accounts.iter().any(|m| m.is_signer && m.pubkey != owner)
        {
            return Err("G3 program/signer".into());
        }
        let tail = ix.data.len() - 16;
        if &ix.data[tail - 4..tail] != b"AMG3"
            || &ix.data[tail..tail + 4] != b"AGV1"
            || ix.data[tail + 4..tail + 8] != [1, 0, 0, 0]
            || ix.data[tail + 8..] != epoch.to_le_bytes()
            || ix
                .accounts
                .last()
                .is_none_or(|m| m.pubkey != gate || m.is_writable || m.is_signer)
            || ix.accounts[..ix.accounts.len() - 1]
                .iter()
                .any(|m| m.pubkey == gate)
        {
            return Err("G3 envelope".into());
        }
        let business = &ix.data[..tail - 4];
        let selector = match self.operation.as_str() {
            "receipt_contribute" => 1,
            "receipt_transfer" => 2,
            "receipt_split" => 3,
            "receipt_claim" => 4,
            "receipt_close" => 5,
            "receipt_expire" => 6,
            "order" if business[0] == 188 && business[1] <= 7 => 0,
            _ => return Err("G3 operation".into()),
        };
        let sizes = if selector == 0 {
            [2, 22, 10, 10, 10, 4, 29, 2][business[1] as usize]
        } else {
            if business[0] != 160 || business[1] != selector {
                return Err("G3 selector".into());
            }
            if selector == 1 || selector == 3 {
                18
            } else {
                2
            }
        };
        if business.len() != sizes {
            return Err("G3 payload length".into());
        }
        let blockhash = Hash::from_str(&self.blockhash).map_err(|_| "G3 blockhash")?;
        let tables = self.lookup()?;
        let rebuilt = message::compile(
            owner,
            expected,
            &tables,
            blockhash,
            self.lookup_table.is_some(),
        )?;
        let prepared = transaction(&self.serialized_transaction_base64)?;
        if prepared.message != rebuilt
            || digest(&rebuilt.serialize()) != self.message_sha256
            || prepared.signatures.len() != 1
            || prepared.signatures[0].as_ref().iter().any(|b| *b != 0)
        {
            return Err("G3 reconstructed message mismatch".into());
        }
        Ok(rebuilt)
    }
    pub fn validate_signed(&self, expected: &[Instruction], signed: &str) -> Result<(), String> {
        let message = self.reconstruct(expected)?;
        let signed = transaction(signed)?;
        if signed.message != message
            || signed.signatures.len() != 1
            || !signed.signatures[0].verify(key(&self.owner)?.as_ref(), &message.serialize())
        {
            return Err("G3 owner signature/message mismatch".into());
        }
        Ok(())
    }
}
