//! Experimental wire codec only, not a new deployed account or Light domain.
//! Month/source must come from the authenticated enclosing access contract.
//! Values and timestamps retain all 64 bits; timestamp width adapts without a cap.

const COUNT: usize = 32;
const BODY: usize = 582;
const ALLOCATION: usize = 592;
#[cfg(test)]
const MAX_WIRE_LEN: usize = 8 + COUNT * 8 + 2 * 8 + (COUNT - 2) * 8;

fn number(bytes: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_le_bytes(
        bytes.get(at..at.checked_add(8)?)?.try_into().ok()?,
    ))
}

struct WireCursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> WireCursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take(&mut self, len: usize) -> Option<&'a [u8]> {
        let end = self.offset.checked_add(len)?;
        let bytes = self.bytes.get(self.offset..end)?;
        self.offset = end;
        Some(bytes)
    }

    fn read_u64(&mut self, width: usize) -> Option<u64> {
        if width > 8 {
            return None;
        }
        let bytes = self.take(width)?;
        let mut value = [0u8; 8];
        value[..width].copy_from_slice(bytes);
        Some(u64::from_le_bytes(value))
    }

    fn is_exhausted(&self) -> bool {
        self.offset == self.bytes.len()
    }
}

fn required_width(delta: u64) -> usize {
    if delta == 0 {
        0
    } else {
        (64 - delta.leading_zeros()).div_ceil(8) as usize
    }
}

/// Decodes and checks the one canonical transport form directly into the complete logical
/// projection. The previous implementation reconstructed a logical Vec and called `pack` again;
/// this cursor performs the same canonicality checks while reading the wire bytes, so malformed
/// or non-minimal input does not allocate a second wire buffer.
fn decode_canonical(
    wire: &[u8],
    month: &[u8; 32],
    source: &[u8; 32],
    logical: &mut [u8; ALLOCATION],
) -> Option<()> {
    let count = usize::from(*wire.get(6)?);
    let width = usize::from(*wire.get(7)?);
    if count > COUNT || width > 8 || (count <= 2 && width != 0) || (count > 2 && width == 0) {
        return None;
    }
    let expected = 8 + count * 8 + count.min(2) * 8 + count.saturating_sub(2) * width;
    if wire.len() != expected {
        return None;
    }

    logical.fill(0);
    logical[..6].copy_from_slice(&wire[..6]);
    logical[6..38].copy_from_slice(month);
    logical[38..70].copy_from_slice(source);

    let mut cursor = WireCursor::new(&wire[8..]);
    for i in 0..count {
        let state = cursor.read_u64(8)?;
        if state == 0 {
            return None;
        }
        logical[70 + i * 8..78 + i * 8].copy_from_slice(&state.to_le_bytes());
    }

    let mut previous = 0u64;
    for i in 0..count.min(2) {
        let time = cursor.read_u64(8)?;
        if time == 0 || time <= previous {
            return None;
        }
        logical[326 + i * 8..334 + i * 8].copy_from_slice(&time.to_le_bytes());
        previous = time;
    }

    let base = if count > 1 { previous } else { 0 };
    let mut last_delta = 0u64;
    for i in 2..count {
        let delta = cursor.read_u64(width)?;
        let time = base.checked_add(delta)?;
        if time == 0 || time <= previous {
            return None;
        }
        logical[326 + i * 8..334 + i * 8].copy_from_slice(&time.to_le_bytes());
        previous = time;
        last_delta = delta;
    }
    if !cursor.is_exhausted() || (count > 2 && required_width(last_delta) != width) {
        return None;
    }
    Some(())
}

pub fn pack(logical: &[u8]) -> Option<Vec<u8>> {
    if logical.len() != ALLOCATION || logical[BODY..].iter().any(|b| *b != 0) {
        return None;
    }
    let mut count: usize = 0;
    let mut previous = 0;
    let mut empty = false;
    for i in 0..COUNT {
        let state = number(logical, 70 + i * 8)?;
        let time = number(logical, 326 + i * 8)?;
        if state == 0 && time == 0 {
            empty = true;
        } else {
            if empty || state == 0 || time == 0 || time <= previous {
                return None;
            }
            previous = time;
            count += 1;
        }
    }
    let base = if count > 1 { number(logical, 334)? } else { 0 };
    let delta = if count > 2 {
        previous.checked_sub(base)?
    } else {
        0
    };
    let width = if delta == 0 {
        0
    } else {
        (64 - delta.leading_zeros()).div_ceil(8) as usize
    };
    let mut wire =
        Vec::with_capacity(8 + count * 8 + count.min(2) * 8 + count.saturating_sub(2) * width);
    wire.extend_from_slice(&logical[..6]);
    wire.push(count as u8);
    wire.push(width as u8);
    wire.extend_from_slice(&logical[70..70 + count * 8]);
    wire.extend_from_slice(&logical[326..326 + count.min(2) * 8]);
    for i in 2..count {
        let delta = number(logical, 326 + i * 8)?.checked_sub(base)?;
        wire.extend_from_slice(&delta.to_le_bytes()[..width]);
    }
    Some(wire)
}

#[cfg(test)]
fn unpack(wire: &[u8], month: &[u8; 32], source: &[u8; 32]) -> Option<Vec<u8>> {
    let mut logical = [0u8; ALLOCATION];
    decode_canonical(wire, month, source, &mut logical)?;
    Some(logical.to_vec())
}

/// Packs the 582-byte compact projection used by the compressed-state leaf envelope.
///
/// Month and source are authenticated context fields in this projection. They are intentionally
/// omitted from the wire and rebound by the program after the source PDA has been checked.
pub fn pack_compact(compact: &[u8]) -> Option<Vec<u8>> {
    if compact.len() != BODY {
        return None;
    }
    let mut logical = vec![0; ALLOCATION];
    logical[..BODY].copy_from_slice(compact);
    pack(&logical)
}

/// Unpacks a transport value into the canonical 582-byte projection with zero identity
/// placeholders. The caller must bind month and source from authenticated current accounts before
/// validating or materializing the leaf.
pub fn unpack_compact(wire: &[u8]) -> Option<Vec<u8>> {
    unpack_compact_with_context(wire, &[0; 32], &[0; 32])
}

/// Unpacks a transport value into the canonical 582-byte projection with an authenticated month
/// and source context.
pub fn unpack_compact_with_context(
    wire: &[u8],
    month: &[u8; 32],
    source: &[u8; 32],
) -> Option<Vec<u8>> {
    let mut logical = [0u8; ALLOCATION];
    decode_canonical(wire, month, source, &mut logical)?;
    Some(logical[..BODY].to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Independent copy of the frozen pre-cursor implementation. It is test-only and exists to
    // compare both acceptance and rejection, rather than merely checking the new implementation
    // against itself.
    fn legacy_number(bytes: &[u8], at: usize) -> Option<u64> {
        Some(u64::from_le_bytes(
            bytes.get(at..at.checked_add(8)?)?.try_into().ok()?,
        ))
    }

    fn legacy_pack(logical: &[u8]) -> Option<Vec<u8>> {
        if logical.len() != ALLOCATION || logical[BODY..].iter().any(|b| *b != 0) {
            return None;
        }
        let mut count: usize = 0;
        let mut previous = 0;
        let mut empty = false;
        for i in 0..COUNT {
            let state = legacy_number(logical, 70 + i * 8)?;
            let time = legacy_number(logical, 326 + i * 8)?;
            if state == 0 && time == 0 {
                empty = true;
            } else {
                if empty || state == 0 || time == 0 || time <= previous {
                    return None;
                }
                previous = time;
                count += 1;
            }
        }
        let base = if count > 1 {
            legacy_number(logical, 334)?
        } else {
            0
        };
        let delta = if count > 2 {
            previous.checked_sub(base)?
        } else {
            0
        };
        let width = if delta == 0 {
            0
        } else {
            (64 - delta.leading_zeros()).div_ceil(8) as usize
        };
        let mut wire =
            Vec::with_capacity(8 + count * 8 + count.min(2) * 8 + count.saturating_sub(2) * width);
        wire.extend_from_slice(&logical[..6]);
        wire.push(count as u8);
        wire.push(width as u8);
        wire.extend_from_slice(&logical[70..70 + count * 8]);
        wire.extend_from_slice(&logical[326..326 + count.min(2) * 8]);
        for i in 2..count {
            let delta = legacy_number(logical, 326 + i * 8)?.checked_sub(base)?;
            wire.extend_from_slice(&delta.to_le_bytes()[..width]);
        }
        Some(wire)
    }

    fn legacy_unpack(wire: &[u8], month: &[u8; 32], source: &[u8; 32]) -> Option<Vec<u8>> {
        let count = usize::from(*wire.get(6)?);
        let width = usize::from(*wire.get(7)?);
        if count > COUNT || width > 8 || (count <= 2 && width != 0) || (count > 2 && width == 0) {
            return None;
        }
        let expected = 8 + count * 8 + count.min(2) * 8 + count.saturating_sub(2) * width;
        if wire.len() != expected {
            return None;
        }
        let mut logical = vec![0; ALLOCATION];
        logical[..6].copy_from_slice(&wire[..6]);
        logical[6..38].copy_from_slice(month);
        logical[38..70].copy_from_slice(source);
        logical[70..70 + count * 8].copy_from_slice(&wire[8..8 + count * 8]);
        let time_offset = 8 + count * 8;
        logical[326..326 + count.min(2) * 8]
            .copy_from_slice(&wire[time_offset..time_offset + count.min(2) * 8]);
        let base = if count > 1 {
            legacy_number(&logical, 334)?
        } else {
            0
        };
        for i in 2..count {
            let at = time_offset + 16 + (i - 2) * width;
            let mut delta = [0; 8];
            delta[..width].copy_from_slice(&wire[at..at + width]);
            let time = base.checked_add(u64::from_le_bytes(delta))?;
            logical[326 + i * 8..334 + i * 8].copy_from_slice(&time.to_le_bytes());
        }
        if legacy_pack(&logical)?.as_slice() != wire {
            return None;
        }
        Some(logical)
    }

    fn history(times: &[u64], inherited: bool) -> Vec<u8> {
        let mut logical = vec![0; ALLOCATION];
        logical[..6].copy_from_slice(&[1, 249, b'O', b'S', b'O', if inherited { 2 } else { 1 }]);
        logical[6..38].fill(31);
        logical[38..70].fill(47);
        for (i, time) in times.iter().enumerate() {
            // Values deliberately exercise high bits: no price narrowing.
            logical[70 + i * 8..78 + i * 8].copy_from_slice(&(u64::MAX - i as u64).to_le_bytes());
            logical[326 + i * 8..334 + i * 8].copy_from_slice(&time.to_le_bytes());
        }
        logical
    }

    #[test]
    fn cursor_decoder_matches_legacy_reference_for_all_capacities_and_versions() {
        let month = [0x31; 32];
        let source = [0x47; 32];
        for count in 0..=COUNT {
            for inherited in [false, true] {
                let times: Vec<_> = (0..count)
                    .map(|i| {
                        if i == 0 {
                            1
                        } else {
                            1_789_000_000 + i as u64 * 86400
                        }
                    })
                    .collect();
                let logical = history(&times, inherited);
                let wire = pack(&logical).expect("valid history must pack");
                assert_eq!(
                    wire,
                    legacy_pack(&logical).expect("legacy pack must accept valid history"),
                    "pack changed for count={count}"
                );
                assert!(wire.len() <= MAX_WIRE_LEN);
                assert_eq!(
                    unpack(&wire, &month, &source),
                    legacy_unpack(&wire, &month, &source),
                    "decoder mismatch for count={count}, inherited={inherited}, wire={wire:?}"
                );
                assert_eq!(
                    unpack_compact_with_context(&wire, &month, &source),
                    legacy_unpack(&wire, &month, &source).map(|decoded| decoded[..BODY].to_vec())
                );
                let mut expected = logical[..BODY].to_vec();
                expected[6..38].copy_from_slice(&month);
                expected[38..70].copy_from_slice(&source);
                assert_eq!(
                    unpack_compact_with_context(&wire, &month, &source),
                    Some(expected)
                );
            }
        }
    }

    #[test]
    fn cursor_decoder_matches_legacy_for_arbitrary_timestamp_widths() {
        let month = [0x52; 32];
        let source = [0x68; 32];
        for width in 1..=8 {
            let delta = if width == 8 {
                u64::MAX - 3
            } else {
                1u64 << (width * 8 - 1)
            };
            let full = history(&[1, 2, 2 + delta], true);
            let wire = pack(&full).expect("valid arbitrary-width history must pack");
            assert_eq!(usize::from(wire[7]), width);
            assert_eq!(
                wire,
                legacy_pack(&full).expect("legacy pack must accept valid history")
            );
            assert_eq!(
                unpack(&wire, &month, &source),
                legacy_unpack(&wire, &month, &source),
                "width={width}, wire={wire:?}"
            );
        }
    }

    #[test]
    fn cursor_decoder_rejection_parity_for_truncation_extension_and_noncanonical_wire() {
        let month = [0x63; 32];
        let source = [0x79; 32];
        let logical = history(&[1, 2, 3, 4, 5], true);
        let wire = pack(&logical).expect("valid history must pack");
        let mut candidates = (0..wire.len())
            .map(|end| wire[..end].to_vec())
            .collect::<Vec<_>>();
        let mut extended = wire.clone();
        extended.push(0);
        candidates.push(extended);

        let mut bad_count = wire.clone();
        bad_count[6] = (COUNT + 1) as u8;
        candidates.push(bad_count);
        let mut bad_width = wire.clone();
        bad_width[7] = 9;
        candidates.push(bad_width);
        let mut nonminimal = wire.clone();
        nonminimal[7] = 8;
        candidates.push(nonminimal);
        let mut zero_delta = wire.clone();
        let delta_offset = 8 + 5 * 8;
        zero_delta[delta_offset..delta_offset + wire[7] as usize].fill(0);
        candidates.push(zero_delta);

        for (index, candidate) in candidates.iter().enumerate() {
            assert_eq!(
                unpack(candidate, &month, &source),
                legacy_unpack(candidate, &month, &source),
                "rejection parity mismatch at case {index}, wire={candidate:?}"
            );
        }
    }

    #[test]
    fn cursor_decoder_rejection_parity_for_deterministic_byte_mutations() {
        let month = [0x2a; 32];
        let source = [0x5c; 32];
        for count in [0usize, 1, 2, 3, 5, COUNT] {
            let times: Vec<_> = (0..count)
                .map(|index| {
                    if index == 0 {
                        1
                    } else {
                        1_789_000_000 + index as u64 * 86400
                    }
                })
                .collect();
            let wire = pack(&history(&times, count % 2 == 1)).expect("valid history must pack");
            for offset in 0..wire.len() {
                for value in [0u8, 1, 0x7f, 0xff] {
                    if value == wire[offset] {
                        continue;
                    }
                    let mut candidate = wire.clone();
                    candidate[offset] = value;
                    assert_eq!(
                        unpack(&candidate, &month, &source),
                        legacy_unpack(&candidate, &month, &source),
                        "byte mutation mismatch count={count}, offset={offset}, value={value:#x}"
                    );
                }
            }
        }
    }

    #[test]
    fn every_capacity_round_trips_both_anchor_versions() {
        for count in 0..=COUNT {
            for inherited in [false, true] {
                let times: Vec<_> = (0..count)
                    .map(|i| {
                        if i == 0 {
                            1
                        } else {
                            1_789_000_000 + i as u64 * 86400
                        }
                    })
                    .collect();
                let full = history(&times, inherited);
                let wire = pack(&full).unwrap();
                assert_eq!(unpack(&wire, &[31; 32], &[47; 32]).unwrap(), full);
                if count == 32 {
                    assert_eq!(wire.len(), 370);
                    assert_eq!(wire[7], 3);
                }
            }
        }
    }

    #[test]
    fn arbitrary_u64_timestamps_preserve_all_bits() {
        for width in 1..=8 {
            let delta = if width == 8 {
                u64::MAX - 3
            } else {
                1u64 << (width * 8 - 1)
            };
            let full = history(&[1, 2, 2 + delta], true);
            let wire = pack(&full).unwrap();
            assert_eq!(usize::from(wire[7]), width);
            assert_eq!(unpack(&wire, &[31; 32], &[47; 32]).unwrap(), full);
        }
    }

    #[test]
    fn truncation_extension_bad_width_count_and_overflow_reject() {
        let wire = pack(&history(&[1, 2, 600], false)).unwrap();
        for end in 0..wire.len() {
            assert!(unpack(&wire[..end], &[31; 32], &[47; 32]).is_none());
        }
        let mut extended = wire.clone();
        extended.push(0);
        assert!(unpack(&extended, &[31; 32], &[47; 32]).is_none());
        for (offset, value) in [(6, 33), (7, 0), (7, 9)] {
            let mut bad = wire.clone();
            bad[offset] = value;
            assert!(unpack(&bad, &[31; 32], &[47; 32]).is_none());
        }
        let mut overflow = pack(&history(&[1, 2, u64::MAX], false)).unwrap();
        overflow[40..48].copy_from_slice(&u64::MAX.to_le_bytes());
        assert!(unpack(&overflow, &[31; 32], &[47; 32]).is_none());
        let mut nonminimal = pack(&history(&[1, 2, 3], false)).unwrap();
        nonminimal[7] = 2;
        nonminimal.push(0);
        assert!(unpack(&nonminimal, &[31; 32], &[47; 32]).is_none());
    }

    #[test]
    fn holes_nonzero_padding_and_nonmonotonic_histories_reject() {
        for times in [&[2, 1][..], &[1, 0, 3][..], &[1, 1][..]] {
            assert!(pack(&history(times, false)).is_none());
        }
        let mut full = history(&[1], false);
        full[591] = 1;
        assert!(pack(&full).is_none());
    }

    #[test]
    fn typescript_differential_three_sample_golden() {
        let full = history(&[1, 2, 600], false);
        let wire = pack(&full).unwrap();
        let hex: String = wire.iter().map(|byte| format!("{byte:02x}")).collect();
        assert_eq!(
            hex,
            "01f94f534f010302fffffffffffffffffefffffffffffffffdffffffffffffff010000000000000002000000000000005602"
        );
        assert_eq!(
            unpack_compact_with_context(&wire, &[31; 32], &[47; 32]).unwrap(),
            full[..BODY].to_vec(),
        );
        assert_eq!(pack_compact(&full[..BODY]).unwrap(), wire);
    }
}
