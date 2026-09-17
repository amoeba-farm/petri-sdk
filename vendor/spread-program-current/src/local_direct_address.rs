//! Same Light V2 address derivation, through Solana's direct Keccak syscall.
//! Experimental adapter: compare both seed and address to the pinned SDK.
use light_sdk::address::AddressSeed;
use solana_program::pubkey::Pubkey;

pub fn hash_to_bn254_field_size_be(bytes: &[u8]) -> [u8; 32] {
    let mut value = solana_program::keccak::hashv(&[bytes, &[u8::MAX]]).to_bytes();
    value[0] = 0;
    value
}

pub fn derive_address(seeds: &[&[u8]], tree: &Pubkey, program: &Pubkey) -> ([u8; 32], AddressSeed) {
    assert!(seeds.len() <= 16);
    let suffix = [u8::MAX];
    let mut parts: [&[u8]; 17] = [&[]; 17];
    parts[..seeds.len()].copy_from_slice(seeds);
    parts[seeds.len()] = &suffix;
    let mut seed = solana_program::keccak::hashv(&parts[..seeds.len() + 1]).to_bytes();
    seed[0] = 0;
    let mut address =
        solana_program::keccak::hashv(&[&seed, tree.as_ref(), program.as_ref(), &suffix])
            .to_bytes();
    address[0] = 0;
    (address, AddressSeed(seed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_address_matches_pinned_light_sdk() {
        let mut rng = 0x4f29_ea73_8174_0ebfu64;
        let mut byte = || {
            rng ^= rng << 13;
            rng ^= rng >> 7;
            rng ^= rng << 17;
            rng as u8
        };
        for count in 0..=16 {
            for len in [0, 1, 7, 32, 127, 512] {
                let program = Pubkey::new_from_array(core::array::from_fn(|_| byte()));
                let tree = Pubkey::new_from_array(core::array::from_fn(|_| byte()));
                let owned: Vec<Vec<u8>> = (0..count)
                    .map(|_| (0..len).map(|_| byte()).collect())
                    .collect();
                let seeds: Vec<&[u8]> = owned.iter().map(Vec::as_slice).collect();
                assert_eq!(
                    derive_address(&seeds, &tree, &program),
                    light_sdk::address::v2::derive_address(&seeds, &tree, &program)
                );
                for value in &owned {
                    assert_eq!(
                        hash_to_bn254_field_size_be(value),
                        light_sdk::light_hasher::hash_to_field_size::hash_to_bn254_field_size_be(
                            value
                        )
                    );
                }
            }
        }
    }
}
