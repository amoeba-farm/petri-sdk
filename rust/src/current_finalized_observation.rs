//! Lean-owned `current_finalized_observation:v1` wire contract and digest.

use std::{collections::HashSet, str::FromStr};

use serde::{Deserialize, Deserializer, Serialize, de::Error as _};
use solana_program::{hash::hash, pubkey::Pubkey};
use thiserror::Error;

pub const CURRENT_FINALIZED_OBSERVATION_SCHEMA_VERSION: u8 = 1;
pub const CURRENT_FINALIZED_OBSERVATION_SOURCE: &str = "current_finalized_rpc";
pub const CURRENT_FINALIZED_OBSERVATION_COMMITMENT: &str = "finalized";
pub const CURRENT_FINALIZED_OBSERVATION_DIGEST_DOMAIN: &str =
    "ameba_lean:current_finalized_observation:v1";
pub const CURRENT_FINALIZED_OBSERVATION_DEVNET_GENESIS_HASH: &str =
    "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
pub const CURRENT_FINALIZED_OBSERVATION_V1_FIXTURE_PATH: &str =
    "fixtures/current-finalized-observation-v1.json";
pub const CURRENT_FINALIZED_OBSERVATION_V1_FIXTURE_JSON: &str =
    include_str!("../../fixtures/current-finalized-observation-v1.json");
pub const CURRENT_STATE_UNAVAILABLE_V1_FIXTURE_PATH: &str =
    "fixtures/current-state-unavailable-v1.json";
pub const CURRENT_STATE_UNAVAILABLE_V1_FIXTURE_JSON: &str =
    include_str!("../../fixtures/current-state-unavailable-v1.json");

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurrentStateProviderIdentity {
    pub kind: String,
    pub origin: String,
    pub origin_sha256: String,
    pub genesis_hash: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentFinalizedObservedAccount {
    pub address: String,
    pub owner: Option<String>,
    pub executable: Option<bool>,
    pub data_length: Option<String>,
    pub data_sha256: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentFinalizedObservation {
    pub schema_version: u8,
    pub observation_source: String,
    pub commitment: String,
    pub observed_at_slot: String,
    pub current_finalized_slot: String,
    pub observed_block_time_unix_seconds: Option<String>,
    pub state_provider: CurrentStateProviderIdentity,
    pub ordered_accounts: Vec<CurrentFinalizedObservedAccount>,
    pub current_observation_digest: String,
}

fn deserialize_present_nullable<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

impl<'de> Deserialize<'de> for CurrentFinalizedObservedAccount {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Wire {
            address: String,
            #[serde(default, deserialize_with = "deserialize_present_nullable")]
            owner: Option<Option<String>>,
            #[serde(default, deserialize_with = "deserialize_present_nullable")]
            executable: Option<Option<bool>>,
            #[serde(default, deserialize_with = "deserialize_present_nullable")]
            data_length: Option<Option<String>>,
            #[serde(default, deserialize_with = "deserialize_present_nullable")]
            data_sha256: Option<Option<String>>,
        }

        let wire = Wire::deserialize(deserializer)?;
        Ok(Self {
            address: wire.address,
            owner: wire.owner.ok_or_else(|| D::Error::missing_field("owner"))?,
            executable: wire
                .executable
                .ok_or_else(|| D::Error::missing_field("executable"))?,
            data_length: wire
                .data_length
                .ok_or_else(|| D::Error::missing_field("dataLength"))?,
            data_sha256: wire
                .data_sha256
                .ok_or_else(|| D::Error::missing_field("dataSha256"))?,
        })
    }
}

impl<'de> Deserialize<'de> for CurrentFinalizedObservation {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Wire {
            schema_version: u8,
            observation_source: String,
            commitment: String,
            observed_at_slot: String,
            current_finalized_slot: String,
            #[serde(default, deserialize_with = "deserialize_present_nullable")]
            observed_block_time_unix_seconds: Option<Option<String>>,
            state_provider: CurrentStateProviderIdentity,
            ordered_accounts: Vec<CurrentFinalizedObservedAccount>,
            current_observation_digest: String,
        }

        let wire = Wire::deserialize(deserializer)?;
        Ok(Self {
            schema_version: wire.schema_version,
            observation_source: wire.observation_source,
            commitment: wire.commitment,
            observed_at_slot: wire.observed_at_slot,
            current_finalized_slot: wire.current_finalized_slot,
            observed_block_time_unix_seconds: wire
                .observed_block_time_unix_seconds
                .ok_or_else(|| D::Error::missing_field("observedBlockTimeUnixSeconds"))?,
            state_provider: wire.state_provider,
            ordered_accounts: wire.ordered_accounts,
            current_observation_digest: wire.current_observation_digest,
        })
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CurrentFinalizedObservationError {
    #[error("current finalized observation JSON is invalid: {0}")]
    InvalidJson(String),
    #[error("current finalized observation is invalid: {0}")]
    InvalidObservation(&'static str),
    #[error("current finalized observation digest does not match")]
    DigestMismatch,
}

/// Parse and validate the exact JSON object. Custom deserialization rejects
/// missing nullable keys instead of conflating them with explicit `null`.
pub fn parse_current_finalized_observation_json(
    json: &str,
) -> Result<CurrentFinalizedObservation, CurrentFinalizedObservationError> {
    let observation: CurrentFinalizedObservation = serde_json::from_str(json)
        .map_err(|error| CurrentFinalizedObservationError::InvalidJson(error.to_string()))?;
    validate_current_finalized_observation(&observation)?;
    Ok(observation)
}

/// Return Lean's exact v1 netstring preimage. Account order is never sorted.
pub fn current_finalized_observation_preimage(
    observation: &CurrentFinalizedObservation,
) -> Result<Vec<u8>, CurrentFinalizedObservationError> {
    validate_shape(observation, false, false)?;
    let mut fields = vec![
        ("schemaVersion".to_owned(), "1".to_owned()),
        (
            "observationSource".to_owned(),
            observation.observation_source.clone(),
        ),
        ("commitment".to_owned(), observation.commitment.clone()),
        (
            "observedAtSlot".to_owned(),
            observation.observed_at_slot.clone(),
        ),
        (
            "currentFinalizedSlot".to_owned(),
            observation.current_finalized_slot.clone(),
        ),
        (
            "observedBlockTimeUnixSeconds".to_owned(),
            observation
                .observed_block_time_unix_seconds
                .clone()
                .unwrap_or_else(|| "null".to_owned()),
        ),
        (
            "stateProvider.kind".to_owned(),
            observation.state_provider.kind.clone(),
        ),
        (
            "stateProvider.origin".to_owned(),
            observation.state_provider.origin.clone(),
        ),
        (
            "stateProvider.originSha256".to_owned(),
            observation.state_provider.origin_sha256.clone(),
        ),
        (
            "stateProvider.genesisHash".to_owned(),
            observation.state_provider.genesis_hash.clone(),
        ),
        (
            "orderedAccountCount".to_owned(),
            observation.ordered_accounts.len().to_string(),
        ),
    ];
    for (index, account) in observation.ordered_accounts.iter().enumerate() {
        fields.extend([
            (
                format!("orderedAccounts[{index}].address"),
                account.address.clone(),
            ),
            (
                format!("orderedAccounts[{index}].owner"),
                account
                    .owner
                    .as_ref()
                    .map(|owner| format!("pubkey:{owner}"))
                    .unwrap_or_else(|| "null".to_owned()),
            ),
            (
                format!("orderedAccounts[{index}].executable"),
                account
                    .executable
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "null".to_owned()),
            ),
            (
                format!("orderedAccounts[{index}].dataLength"),
                account
                    .data_length
                    .clone()
                    .unwrap_or_else(|| "null".to_owned()),
            ),
            (
                format!("orderedAccounts[{index}].dataSha256"),
                account
                    .data_sha256
                    .as_ref()
                    .map(|digest| format!("sha256:{digest}"))
                    .unwrap_or_else(|| "null".to_owned()),
            ),
        ]);
    }
    let mut preimage = CURRENT_FINALIZED_OBSERVATION_DIGEST_DOMAIN
        .as_bytes()
        .to_vec();
    preimage.push(0);
    for (name, value) in fields {
        append_netstring(&mut preimage, &name);
        append_netstring(&mut preimage, &value);
    }
    Ok(preimage)
}

pub fn compute_current_finalized_observation_digest(
    observation: &CurrentFinalizedObservation,
) -> Result<String, CurrentFinalizedObservationError> {
    Ok(sha256_hex(&current_finalized_observation_preimage(
        observation,
    )?))
}

pub fn validate_current_finalized_observation(
    observation: &CurrentFinalizedObservation,
) -> Result<(), CurrentFinalizedObservationError> {
    validate_shape(observation, true, true)?;
    if compute_current_finalized_observation_digest(observation)?
        != observation.current_observation_digest
    {
        return Err(CurrentFinalizedObservationError::DigestMismatch);
    }
    Ok(())
}

fn validate_shape(
    observation: &CurrentFinalizedObservation,
    require_block_time: bool,
    require_digest: bool,
) -> Result<(), CurrentFinalizedObservationError> {
    if observation.schema_version != CURRENT_FINALIZED_OBSERVATION_SCHEMA_VERSION
        || observation.observation_source != CURRENT_FINALIZED_OBSERVATION_SOURCE
        || observation.commitment != CURRENT_FINALIZED_OBSERVATION_COMMITMENT
    {
        return invalid("schema, source, or commitment changed");
    }
    positive_decimal(&observation.observed_at_slot)?;
    positive_decimal(&observation.current_finalized_slot)?;
    if observation.observed_at_slot != observation.current_finalized_slot {
        return invalid("observed and current finalized slots differ");
    }
    if let Some(block_time) = &observation.observed_block_time_unix_seconds {
        positive_decimal(block_time)?;
    } else if require_block_time {
        return invalid("finalized block time is unavailable");
    }
    validate_provider(&observation.state_provider)?;
    if !(1..=256).contains(&observation.ordered_accounts.len()) {
        return invalid("ordered account count is outside 1..256");
    }
    let mut addresses = HashSet::new();
    for account in &observation.ordered_accounts {
        canonical_pubkey(&account.address)?;
        if !addresses.insert(account.address.as_str()) {
            return invalid("ordered account addresses are not unique");
        }
        let present = [
            account.owner.is_some(),
            account.executable.is_some(),
            account.data_length.is_some(),
            account.data_sha256.is_some(),
        ];
        if !present.iter().all(|value| *value == present[0]) {
            return invalid("account state is partially null");
        }
        if present[0] {
            canonical_pubkey(account.owner.as_deref().expect("presence checked"))?;
            unsigned_decimal(account.data_length.as_deref().expect("presence checked"))?;
            lowercase_sha256(account.data_sha256.as_deref().expect("presence checked"))?;
        }
    }
    if require_digest {
        lowercase_sha256(&observation.current_observation_digest)?;
    }
    Ok(())
}

fn validate_provider(
    provider: &CurrentStateProviderIdentity,
) -> Result<(), CurrentFinalizedObservationError> {
    if provider.kind != "solana_json_rpc"
        || provider.genesis_hash != CURRENT_FINALIZED_OBSERVATION_DEVNET_GENESIS_HASH
    {
        return invalid("provider kind or genesis changed");
    }
    let authority = provider.origin.strip_prefix("https://").ok_or(
        CurrentFinalizedObservationError::InvalidObservation("provider origin is not HTTPS"),
    )?;
    if authority.is_empty() {
        return invalid("provider host is empty");
    }
    let mut parts = authority.split(':');
    let host = parts.next().expect("nonempty split");
    let port = parts.next();
    if parts.next().is_some()
        || host.is_empty()
        || !host.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'.' || byte == b'-'
        })
    {
        return invalid("provider origin host or port form is invalid");
    }
    if let Some(port) = port {
        unsigned_decimal(port)?;
        if port == "0" {
            return invalid("provider port is zero");
        }
        let parsed = port.parse::<u32>().map_err(|_| {
            CurrentFinalizedObservationError::InvalidObservation("provider port is out of range")
        })?;
        if parsed > 65_535 || parsed == 443 || parsed.to_string() != port {
            return invalid("provider port is noncanonical, default, or out of range");
        }
    }
    lowercase_sha256(&provider.origin_sha256)?;
    if sha256_hex(provider.origin.as_bytes()) != provider.origin_sha256 {
        return invalid("provider origin hash changed");
    }
    Ok(())
}

fn canonical_pubkey(value: &str) -> Result<(), CurrentFinalizedObservationError> {
    let key = Pubkey::from_str(value).map_err(|_| {
        CurrentFinalizedObservationError::InvalidObservation("public key is invalid")
    })?;
    if key.to_string() != value {
        return invalid("public key is not canonical Base58");
    }
    Ok(())
}

fn positive_decimal(value: &str) -> Result<(), CurrentFinalizedObservationError> {
    unsigned_decimal(value)?;
    if value == "0" {
        return invalid("positive decimal is zero");
    }
    Ok(())
}

fn unsigned_decimal(value: &str) -> Result<(), CurrentFinalizedObservationError> {
    if value.is_empty()
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return invalid("unsigned decimal is not canonical");
    }
    Ok(())
}

fn lowercase_sha256(value: &str) -> Result<(), CurrentFinalizedObservationError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return invalid("SHA-256 digest is not lowercase hex");
    }
    Ok(())
}

fn append_netstring(output: &mut Vec<u8>, value: &str) {
    output.extend_from_slice(value.len().to_string().as_bytes());
    output.push(b':');
    output.extend_from_slice(value.as_bytes());
    output.push(b',');
}

fn sha256_hex(bytes: &[u8]) -> String {
    hash(bytes)
        .to_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn invalid<T>(message: &'static str) -> Result<T, CurrentFinalizedObservationError> {
    Err(CurrentFinalizedObservationError::InvalidObservation(
        message,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vector() -> CurrentFinalizedObservation {
        let fixture: serde_json::Value =
            serde_json::from_str(CURRENT_FINALIZED_OBSERVATION_V1_FIXTURE_JSON)
                .expect("canonical Lean fixture JSON");
        serde_json::from_value(fixture["observation"].clone()).expect("canonical Lean observation")
    }

    #[test]
    fn matches_the_frozen_lean_vector() {
        let fixture: serde_json::Value =
            serde_json::from_str(CURRENT_FINALIZED_OBSERVATION_V1_FIXTURE_JSON)
                .expect("canonical Lean fixture JSON");
        let observation = vector();
        let preimage = current_finalized_observation_preimage(&observation).unwrap();
        assert_eq!(
            preimage.len(),
            fixture["canonicalPreimageByteLength"].as_u64().unwrap() as usize
        );
        assert_eq!(
            preimage
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>(),
            fixture["canonicalPreimageHex"].as_str().unwrap()
        );
        assert_eq!(
            compute_current_finalized_observation_digest(&observation).unwrap(),
            fixture["expectedCurrentObservationDigest"]
                .as_str()
                .unwrap()
        );
        assert_eq!(
            observation.current_observation_digest,
            fixture["expectedCurrentObservationDigest"]
                .as_str()
                .unwrap()
        );
        validate_current_finalized_observation(&observation).unwrap();
        let parsed =
            parse_current_finalized_observation_json(&serde_json::to_string(&observation).unwrap())
                .unwrap();
        assert_eq!(parsed, observation);
    }

    #[test]
    fn unavailable_fixture_is_the_exact_separate_lean_dto() {
        let unavailable: serde_json::Value =
            serde_json::from_str(CURRENT_STATE_UNAVAILABLE_V1_FIXTURE_JSON)
                .expect("canonical Lean unavailable fixture JSON");
        assert_eq!(unavailable.as_object().unwrap().len(), 3);
        assert_eq!(unavailable["ok"], false);
        assert_eq!(
            unavailable["message"],
            "current Market discovery is not authoritative"
        );
        assert_eq!(unavailable["code"], "CURRENT_STATE_UNAVAILABLE");
        assert_eq!(
            CURRENT_STATE_UNAVAILABLE_V1_FIXTURE_JSON.as_bytes().len(),
            119
        );
        assert_eq!(
            sha256_hex(CURRENT_STATE_UNAVAILABLE_V1_FIXTURE_JSON.as_bytes()),
            "a25b86fffb085a3b0d3e8a2e69375320803607f4eed888de8c678cb46a696a51"
        );
    }

    #[test]
    fn rejects_every_forbidden_provider_origin_form() {
        let fixture: serde_json::Value =
            serde_json::from_str(CURRENT_FINALIZED_OBSERVATION_V1_FIXTURE_JSON)
                .expect("canonical Lean fixture JSON");
        for item in fixture["providerOriginVectors"]["accepted"]
            .as_array()
            .unwrap()
        {
            let mut accepted = vector();
            accepted.state_provider.origin = item["origin"].as_str().unwrap().to_owned();
            accepted.state_provider.origin_sha256 =
                item["originSha256"].as_str().unwrap().to_owned();
            accepted.current_observation_digest =
                compute_current_finalized_observation_digest(&accepted).unwrap();
            validate_current_finalized_observation(&accepted).unwrap();
        }

        for item in fixture["providerOriginVectors"]["rejected"]
            .as_array()
            .unwrap()
        {
            let origin = item["origin"].as_str().unwrap();
            let mut observation = vector();
            observation.state_provider.origin = origin.to_owned();
            observation.state_provider.origin_sha256 = sha256_hex(origin.as_bytes());
            assert!(current_finalized_observation_preimage(&observation).is_err());
        }
    }

    #[test]
    fn rejects_missing_nullable_keys_partial_state_and_null_block_time() {
        let mut value = serde_json::to_value(vector()).unwrap();
        value["orderedAccounts"][1]
            .as_object_mut()
            .unwrap()
            .remove("owner");
        assert!(serde_json::from_value::<CurrentFinalizedObservation>(value.clone()).is_err());
        assert!(parse_current_finalized_observation_json(&value.to_string()).is_err());

        let mut missing_block_time = serde_json::to_value(vector()).unwrap();
        missing_block_time
            .as_object_mut()
            .unwrap()
            .remove("observedBlockTimeUnixSeconds");
        assert!(serde_json::from_value::<CurrentFinalizedObservation>(missing_block_time).is_err());

        let mut partial = vector();
        partial.ordered_accounts[1].owner = Some(Pubkey::new_unique().to_string());
        assert!(validate_current_finalized_observation(&partial).is_err());

        let mut unavailable = vector();
        unavailable.observed_block_time_unix_seconds = None;
        unavailable.current_observation_digest =
            compute_current_finalized_observation_digest(&unavailable).unwrap();
        assert!(validate_current_finalized_observation(&unavailable).is_err());
    }
}
