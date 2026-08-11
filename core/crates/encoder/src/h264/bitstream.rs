//! Writing H.264 bitstream syntax.
//!
//! The driver synthesises no headers — measured, by tracing what ffmpeg sends to
//! libva — so SPS, PPS and every slice header have to be written here and handed
//! over as packed headers.
//!
//! Nothing in this module touches a GPU. It is the part of the encoder that can
//! be wrong in a way no hardware would catch, so it is also the part that is
//! tested hardest.

/// Builds a bit-level H.264 syntax element stream.
///
/// Big-endian, MSB first, which is what the standard means by "bit order" — a
/// little-endian writer would produce a stream no decoder recognises while
/// looking perfectly reasonable in a hex dump.
#[derive(Debug, Default)]
pub struct BitWriter {
    bytes: Vec<u8>,
    /// The partially filled byte, left-aligned.
    partial: u8,
    /// How many bits of `partial` are used, always `0..8`.
    used: u32,
}

impl BitWriter {
    /// An empty writer.
    #[must_use]
    pub const fn new() -> Self {
        Self {
            bytes: Vec::new(),
            partial: 0,
            used: 0,
        }
    }

    /// Writes the low `count` bits of `value`, most significant first.
    ///
    /// `count` above 32 is meaningless for H.264 syntax and is clamped rather
    /// than panicking — a worker must not die over a malformed header, and the
    /// caller is this crate.
    pub fn put_bits(&mut self, value: u32, count: u32) {
        let count = count.min(32);
        for index in (0..count).rev() {
            let bit = u8::try_from((value >> index) & 1).unwrap_or(0);
            self.partial |= bit << (7 - self.used);
            self.used += 1;
            if self.used == 8 {
                self.bytes.push(self.partial);
                self.partial = 0;
                self.used = 0;
            }
        }
    }

    /// Writes a single flag.
    pub fn put_flag(&mut self, value: bool) {
        self.put_bits(u32::from(value), 1);
    }

    /// Unsigned exp-Golomb, `ue(v)`.
    ///
    /// `v + 1` in binary, prefixed by that many minus one zeros. So 0 is a lone
    /// `1`, and the code length grows by two bits per doubling.
    pub fn put_ue(&mut self, value: u32) {
        let shifted = value.saturating_add(1);
        let bits = 32 - shifted.leading_zeros();
        self.put_bits(0, bits - 1);
        self.put_bits(shifted, bits);
    }

    /// Signed exp-Golomb, `se(v)`.
    ///
    /// Zig-zags onto the unsigned code: 0, 1, -1, 2, -2 …
    pub fn put_se(&mut self, value: i32) {
        let mapped = if value > 0 {
            2_u32.wrapping_mul(value.unsigned_abs()).wrapping_sub(1)
        } else {
            2_u32.wrapping_mul(value.unsigned_abs())
        };
        self.put_ue(mapped);
    }

    /// `rbsp_trailing_bits()`: a stop bit, then zeros to the byte boundary.
    pub fn put_rbsp_trailing_bits(&mut self) {
        self.put_flag(true);
        while self.used != 0 {
            self.put_flag(false);
        }
    }

    /// How many bits have been written.
    #[must_use]
    pub const fn bit_length(&self) -> usize {
        self.bytes.len() * 8 + self.used as usize
    }

    /// The raw bytes, padding any partial byte with zeros.
    ///
    /// Callers that need a legal RBSP should have called
    /// [`Self::put_rbsp_trailing_bits`] first; this does not add it, because a
    /// packed *slice* header is deliberately not byte-aligned — the driver
    /// continues the bitstream from where it stops.
    #[must_use]
    pub fn finish(mut self) -> Vec<u8> {
        if self.used != 0 {
            self.bytes.push(self.partial);
        }
        self.bytes
    }
}

/// Wraps an RBSP payload into a NAL unit, inserting emulation-prevention bytes.
///
/// A decoder finds NAL boundaries by scanning for `00 00 01`, so any `00 00`
/// followed by a byte below 4 has an `0x03` spliced in after it. Getting this
/// wrong does not corrupt the header — it makes a decoder resynchronise in the
/// middle of one, which looks like a broken encoder rather than a broken writer.
///
/// The NAL header byte is emitted verbatim and does not take part in the scan,
/// which is how every implementation does it and what the byte stream then
/// requires.
#[must_use]
pub fn to_nal_unit(nal_ref_idc: u8, nal_unit_type: u8, rbsp: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(rbsp.len() + 8);
    out.push(((nal_ref_idc & 0x3) << 5) | (nal_unit_type & 0x1f));

    let mut zeros = 0_u32;
    for &byte in rbsp {
        if zeros >= 2 && byte <= 3 {
            out.push(0x03);
            zeros = 0;
        }
        out.push(byte);
        if byte == 0 {
            zeros += 1;
        } else {
            zeros = 0;
        }
    }
    out
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "a panic IS the failure signal in a test"
)]
#[allow(
    clippy::integer_division,
    reason = "splitting a bit index into byte and offset is exact by construction, \
              and the lint exists for arithmetic where a remainder would be lost"
)]
mod tests {
    use super::*;

    /// The exp-Golomb codes are published in the standard's own table. Pinning
    /// them against those values rather than against our own decoder is the
    /// difference between "we are self-consistent" and "we are correct".
    #[test]
    fn unsigned_exp_golomb_matches_the_standards_table() {
        let expected: [(u32, &str); 9] = [
            (0, "1"),
            (1, "010"),
            (2, "011"),
            (3, "00100"),
            (4, "00101"),
            (5, "00110"),
            (6, "00111"),
            (7, "0001000"),
            (8, "0001001"),
        ];
        for (value, bits) in expected {
            let mut writer = BitWriter::new();
            writer.put_ue(value);
            assert_eq!(writer.bit_length(), bits.len(), "length for ue({value})");
            let produced = writer.finish();
            let mut rendered = String::new();
            for (index, _) in bits.chars().enumerate() {
                let byte = produced[index / 8];
                rendered.push(if byte & (0x80 >> (index % 8)) == 0 {
                    '0'
                } else {
                    '1'
                });
            }
            assert_eq!(rendered, bits, "ue({value})");
        }
    }

    #[test]
    fn signed_exp_golomb_zigzags_the_way_the_standard_says() {
        // se(v) maps 0,1,-1,2,-2 onto ue(0..4). Checked through the mapping
        // rather than the bits, which the test above already pins.
        for (value, mapped) in [(0, 0), (1, 1), (-1, 2), (2, 3), (-2, 4), (3, 5), (-3, 6)] {
            let mut signed = BitWriter::new();
            signed.put_se(value);
            let mut unsigned = BitWriter::new();
            unsigned.put_ue(mapped);
            assert_eq!(signed.finish(), unsigned.finish(), "se({value})");
        }
    }

    #[test]
    fn bits_are_written_most_significant_first() {
        // A little-endian writer produces a stream no decoder recognises while
        // looking entirely plausible in a hex dump.
        let mut writer = BitWriter::new();
        writer.put_bits(0b1011, 4);
        writer.put_bits(0b0001, 4);
        assert_eq!(writer.finish(), vec![0b1011_0001]);
    }

    #[test]
    fn trailing_bits_stop_then_pad() {
        let mut writer = BitWriter::new();
        writer.put_bits(0b101, 3);
        writer.put_rbsp_trailing_bits();
        assert_eq!(writer.finish(), vec![0b1011_0000]);
    }

    #[test]
    fn emulation_prevention_escapes_exactly_the_dangerous_sequences() {
        // 00 00 followed by 00..03 gets an 0x03 spliced in; anything else does
        // not. The 00 00 03 case matters most: an unescaped 03 there would be
        // read back as the escape byte and silently swallow a byte of payload.
        for (raw, expected) in [
            (vec![0x00, 0x00, 0x00], vec![0x00, 0x00, 0x03, 0x00]),
            (vec![0x00, 0x00, 0x01], vec![0x00, 0x00, 0x03, 0x01]),
            (vec![0x00, 0x00, 0x02], vec![0x00, 0x00, 0x03, 0x02]),
            (vec![0x00, 0x00, 0x03], vec![0x00, 0x00, 0x03, 0x03]),
            (vec![0x00, 0x00, 0x04], vec![0x00, 0x00, 0x04]),
            (vec![0x00, 0x01, 0x00], vec![0x00, 0x01, 0x00]),
            (
                vec![0x00, 0x00, 0x00, 0x00],
                vec![0x00, 0x00, 0x03, 0x00, 0x00],
            ),
        ] {
            let nal = to_nal_unit(0, 1, &raw);
            assert_eq!(&nal[1..], &expected[..], "escaping {raw:02x?}");
        }
    }

    #[test]
    fn the_nal_header_byte_carries_ref_idc_and_type() {
        // ffmpeg's SPS starts 0x67: nal_ref_idc 3, type 7. Its PPS starts 0x68.
        assert_eq!(to_nal_unit(3, 7, &[])[0], 0x67);
        assert_eq!(to_nal_unit(3, 8, &[])[0], 0x68);
        assert_eq!(to_nal_unit(0, 1, &[])[0], 0x01);
    }
}
