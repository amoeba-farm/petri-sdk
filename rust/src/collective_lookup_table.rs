//! One exact finalized lookup table for typed collective transaction assembly.
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use solana_program::{hash::hash, pubkey::Pubkey};
use std::str::FromStr;
use crate::{current_finalized_observation::CurrentFinalizedObservation, protocol::CurrentProtocolError};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurrentCollectiveLookupTableWitnessV1 {
    pub address: String,
    pub data_base64: String,
}

pub fn decode_current_collective_lookup_table_v1(witness: &CurrentCollectiveLookupTableWitnessV1,
    observation: &CurrentFinalizedObservation) -> Result<solana_message::AddressLookupTableAccount, CurrentProtocolError> {
    let invalid = CurrentProtocolError::InvalidInvariant;
    let key = Pubkey::from_str(&witness.address).map_err(|_| CurrentProtocolError::InvalidIdentity)?;
    if key == Pubkey::default() || key.to_string() != witness.address || witness.data_base64.len() > 11_000 { return Err(invalid); }
    let bytes = BASE64.decode(&witness.data_base64).map_err(|_| CurrentProtocolError::InvalidInvariant)?;
    if BASE64.encode(&bytes) != witness.data_base64 || bytes.len() < 88 || bytes.len() > 8248
        || (bytes.len() - 56) % 32 != 0 || bytes[..4] != 1_u32.to_le_bytes() { return Err(invalid); }
    let observed = observation.ordered_accounts.iter().find(|value| value.address == witness.address)
        .ok_or(CurrentProtocolError::InvalidIdentity)?;
    let digest = hash(&bytes).to_bytes().iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    if observed.owner.as_deref() != Some("AddressLookupTab1e1111111111111111111111111") || observed.executable != Some(false)
        || observed.data_length.as_deref() != Some(bytes.len().to_string().as_str()) || observed.data_sha256.as_deref() != Some(digest.as_str()) {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    let read_u64 = |offset: usize| u64::from_le_bytes(bytes[offset..offset + 8].try_into().expect("bounded lookup metadata"));
    let extended = read_u64(12);
    let slot = observation.observed_at_slot.parse::<u64>().map_err(|_| CurrentProtocolError::InvalidInvariant)?;
    let count = (bytes.len() - 56) / 32;
    let authority = bytes[21];
    if read_u64(4) != u64::MAX || extended >= slot || extended > 9_007_199_254_740_991
        || usize::from(bytes[20]) > count || authority > 1
        || bytes[if authority == 0 { 22 } else { 54 }..56].iter().any(|byte| *byte != 0) { return Err(invalid); }
    let addresses = bytes[56..].chunks_exact(32).map(|value| Pubkey::new_from_array(value.try_into().expect("bounded lookup key"))).collect();
    Ok(solana_message::AddressLookupTableAccount { key, addresses })
}
