#![cfg(any(feature = "devnet-v3-governance-controller", feature = "mainnet-v3"))]
#[path = "g3_proof_support/capacity.rs"]
mod capacity;
#[path = "g3_proof_support/emergency.rs"]
mod emergency;
#[allow(dead_code)]
mod g3_light_support;
#[path = "g3_proof_support/mod.rs"]
mod proof;
#[path = "g3_proof_support/vault.rs"]
mod vault;

#[path = "g3_proof_support/evidence.rs"]
mod evidence;
