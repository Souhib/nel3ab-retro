//! Wire types shared across the whole system.
//!
//! # Why this crate exists
//!
//! The browser normalises every controller (DualSense, Xbox, GameCube adapter,
//! keyboard) into ONE canonical GameCube state and sends only that. The worker
//! writes it straight into Dolphin's named pipe. Nothing between the two ever
//! inspects an SDL name, an evdev index or a `js*` node — which is the entire
//! class of bug this design exists to delete.
//!
//! # Design rule
//!
//! Invalid states are unrepresentable. [`PlayerSlot`] cannot hold `0` or `5`;
//! [`Stick`] cannot hold an out-of-range axis. A caller therefore cannot pass a
//! bad slot *at all* — the compiler refuses it, so no test has to catch it.

#![forbid(unsafe_code)]

use thiserror::Error;

/// Number of bytes an [`InputFrame`] occupies on the wire.
///
/// Layout (little-endian): `buttons(2) | slot(1) | main_x(2) main_y(2) |
/// c_x(2) c_y(2) | l(1) r(1)`.
pub const WIRE_LEN: usize = 13;

/// The GameCube has exactly four controller ports.
pub const MAX_PLAYERS: u8 = 4;

/// Anything that can go wrong decoding a frame produced by a client.
///
/// Every variant is reachable from hostile or buggy input — a browser is not a
/// trusted peer.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ProtocolError {
    /// The buffer was not exactly [`WIRE_LEN`] bytes.
    #[error("frame must be exactly {expected} bytes, got {got}")]
    WrongLength {
        /// Bytes we require.
        expected: usize,
        /// Bytes the caller supplied.
        got: usize,
    },

    /// The slot byte was outside `1..=4`.
    #[error("player slot must be 1..={MAX_PLAYERS}, got {got}")]
    InvalidSlot {
        /// The rejected value.
        got: u8,
    },

    /// Unknown bits were set in the button mask.
    ///
    /// Rejected rather than masked off: a client setting bits we don't define is
    /// either a version mismatch or an attack, and silently dropping them would
    /// hide both.
    #[error("unknown button bits set: {bits:#06x}")]
    UnknownButtons {
        /// The offending bits, with the known ones cleared.
        bits: u16,
    },
}

/// A controller port, guaranteed to be within `1..=4`.
///
/// Constructed only through [`PlayerSlot::new`], so an out-of-range slot cannot
/// exist anywhere downstream.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PlayerSlot(u8);

impl PlayerSlot {
    /// Creates a slot, rejecting anything outside `1..=4`.
    ///
    /// # Errors
    /// [`ProtocolError::InvalidSlot`] when `raw` is `0` or `> 4`.
    pub const fn new(raw: u8) -> Result<Self, ProtocolError> {
        if raw == 0 || raw > MAX_PLAYERS {
            return Err(ProtocolError::InvalidSlot { got: raw });
        }
        Ok(Self(raw))
    }

    /// The port number, `1..=4`.
    #[must_use]
    pub const fn get(self) -> u8 {
        self.0
    }

    /// Zero-based index, for addressing `GCPad1..4` or an array of four.
    #[must_use]
    pub const fn index(self) -> usize {
        (self.0 - 1) as usize
    }
}

/// Analogue stick position, each axis in `-32767..=32767`.
///
/// The browser clamps to the unit circle (the Gamepad API guarantees it), so a
/// magnitude above full deflection is a malformed client, not a strong push.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Stick {
    /// Horizontal axis; positive is right.
    pub x: i16,
    /// Vertical axis; positive is up.
    pub y: i16,
}

impl Stick {
    /// Centre position.
    pub const NEUTRAL: Self = Self { x: 0, y: 0 };

    /// Builds a stick, clamping `i16::MIN` to `-32767`.
    ///
    /// `i16::MIN` (-32768) has no positive counterpart, so letting it through
    /// makes negation asymmetric — a real source of one-off drift when the
    /// value is later scaled.
    #[must_use]
    pub const fn new(x: i16, y: i16) -> Self {
        Self {
            x: if x == i16::MIN { -32767 } else { x },
            y: if y == i16::MIN { -32767 } else { y },
        }
    }
}

/// GameCube button mask.
///
/// Bit values are part of the wire format and MUST NOT be reordered — a client
/// built against an older layout would silently press the wrong button.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Buttons(u16);

impl Buttons {
    /// The `A` button.
    pub const A: Self = Self(1 << 0);
    /// The `B` button.
    pub const B: Self = Self(1 << 1);
    /// The `X` button.
    pub const X: Self = Self(1 << 2);
    /// The `Y` button.
    pub const Y: Self = Self(1 << 3);
    /// The `Z` shoulder button.
    pub const Z: Self = Self(1 << 4);
    /// Digital `L` click.
    pub const L: Self = Self(1 << 5);
    /// Digital `R` click.
    pub const R: Self = Self(1 << 6);
    /// `Start`/`Pause`.
    pub const START: Self = Self(1 << 7);
    /// D-pad up.
    pub const D_UP: Self = Self(1 << 8);
    /// D-pad down.
    pub const D_DOWN: Self = Self(1 << 9);
    /// D-pad left.
    pub const D_LEFT: Self = Self(1 << 10);
    /// D-pad right.
    pub const D_RIGHT: Self = Self(1 << 11);

    /// Every bit this version understands.
    pub const KNOWN: Self = Self(0b0000_1111_1111_1111);

    /// No button held.
    pub const NONE: Self = Self(0);

    /// Builds a mask, rejecting undefined bits.
    ///
    /// # Errors
    /// [`ProtocolError::UnknownButtons`] if any bit outside [`Buttons::KNOWN`] is set.
    pub const fn from_bits(bits: u16) -> Result<Self, ProtocolError> {
        let unknown = bits & !Self::KNOWN.0;
        if unknown != 0 {
            return Err(ProtocolError::UnknownButtons { bits: unknown });
        }
        Ok(Self(bits))
    }

    /// The raw mask.
    #[must_use]
    pub const fn bits(self) -> u16 {
        self.0
    }

    /// True when every button in `other` is held.
    #[must_use]
    pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }

    /// Union of two masks.
    #[must_use]
    pub const fn union(self, other: Self) -> Self {
        Self(self.0 | other.0)
    }
}

/// One controller state for one player, at one instant.
///
/// This is the ONLY thing a client is allowed to send on the input channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InputFrame {
    /// Which port this state drives.
    pub slot: PlayerSlot,
    /// Buttons currently held.
    pub buttons: Buttons,
    /// Main analogue stick.
    pub main: Stick,
    /// C-stick.
    pub c: Stick,
    /// Analogue `L`, `0..=255`.
    pub l: u8,
    /// Analogue `R`, `0..=255`.
    pub r: u8,
}

impl InputFrame {
    /// A neutral frame — nothing held, sticks centred.
    #[must_use]
    pub const fn neutral(slot: PlayerSlot) -> Self {
        Self {
            slot,
            buttons: Buttons::NONE,
            main: Stick::NEUTRAL,
            c: Stick::NEUTRAL,
            l: 0,
            r: 0,
        }
    }

    /// Serialises to exactly [`WIRE_LEN`] bytes.
    #[must_use]
    pub fn encode(&self) -> [u8; WIRE_LEN] {
        let mut out = [0u8; WIRE_LEN];
        out[0..2].copy_from_slice(&self.buttons.bits().to_le_bytes());
        out[2] = self.slot.get();
        out[3..5].copy_from_slice(&self.main.x.to_le_bytes());
        out[5..7].copy_from_slice(&self.main.y.to_le_bytes());
        out[7..9].copy_from_slice(&self.c.x.to_le_bytes());
        out[9..11].copy_from_slice(&self.c.y.to_le_bytes());
        out[11] = self.l;
        out[12] = self.r;
        out
    }

    /// Parses a frame produced by a client.
    ///
    /// # Errors
    /// See [`ProtocolError`] — wrong length, bad slot, or undefined button bits.
    pub fn decode(buf: &[u8]) -> Result<Self, ProtocolError> {
        let bytes: [u8; WIRE_LEN] = buf.try_into().map_err(|_| ProtocolError::WrongLength {
            expected: WIRE_LEN,
            got: buf.len(),
        })?;

        // Helper keeps the endianness in ONE place; a per-field `try_into` would
        // be four more places to get it wrong.
        let le16 = |a: usize| i16::from_le_bytes([bytes[a], bytes[a + 1]]);

        Ok(Self {
            buttons: Buttons::from_bits(u16::from_le_bytes([bytes[0], bytes[1]]))?,
            slot: PlayerSlot::new(bytes[2])?,
            main: Stick::new(le16(3), le16(5)),
            c: Stick::new(le16(7), le16(9)),
            l: bytes[11],
            r: bytes[12],
        })
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use rstest::rstest;

    // ── PlayerSlot ────────────────────────────────────────────────────────
    #[rstest]
    #[case(1)]
    #[case(4)]
    fn slot_accepts_the_four_real_ports(#[case] raw: u8) {
        // Act
        let slot = PlayerSlot::new(raw).unwrap();
        // Assert
        assert_eq!(slot.get(), raw);
        assert_eq!(slot.index(), usize::from(raw) - 1);
    }

    /// Negative twin of the test above: the boundaries on BOTH sides must fail,
    /// otherwise "accepts 1..=4" could pass while accepting 0..=255.
    #[rstest]
    #[case(0)]
    #[case(5)]
    #[case(u8::MAX)]
    fn slot_rejects_everything_outside_the_four_ports(#[case] raw: u8) {
        assert_eq!(
            PlayerSlot::new(raw),
            Err(ProtocolError::InvalidSlot { got: raw })
        );
    }

    // ── Buttons ───────────────────────────────────────────────────────────
    #[test]
    fn buttons_reject_undefined_bits_instead_of_masking_them() {
        // Prepare — bit 12 is not assigned in this version.
        let bits = Buttons::A.bits() | (1 << 12);
        // Act
        let result = Buttons::from_bits(bits);
        // Assert — the UNKNOWN bits are reported, not the whole mask.
        assert_eq!(result, Err(ProtocolError::UnknownButtons { bits: 1 << 12 }));
    }

    #[test]
    fn button_bit_values_are_frozen() {
        // The wire format is a contract with already-deployed clients: changing a
        // value here silently remaps every player's buttons. Red-first: flip any
        // constant and this fails.
        assert_eq!(Buttons::A.bits(), 0x0001);
        assert_eq!(Buttons::START.bits(), 0x0080);
        assert_eq!(Buttons::D_RIGHT.bits(), 0x0800);
        assert_eq!(Buttons::KNOWN.bits(), 0x0FFF);
    }

    // ── Stick ─────────────────────────────────────────────────────────────
    #[test]
    fn stick_clamps_i16_min_so_negation_stays_symmetric() {
        let s = Stick::new(i16::MIN, i16::MIN);
        assert_eq!(
            s,
            Stick {
                x: -32767,
                y: -32767
            }
        );
    }

    // ── Wire format ───────────────────────────────────────────────────────
    #[test]
    fn encode_produces_the_documented_layout() {
        // Prepare
        let frame = InputFrame {
            slot: PlayerSlot::new(2).unwrap(),
            buttons: Buttons::A.union(Buttons::START),
            main: Stick::new(-1, 256),
            c: Stick::new(2, -3),
            l: 7,
            r: 255,
        };
        // Act
        let wire = frame.encode();
        // Assert — byte-exact, so a field reorder cannot pass unnoticed.
        assert_eq!(wire.len(), WIRE_LEN);
        assert_eq!(&wire[0..2], &0x0081u16.to_le_bytes());
        assert_eq!(wire[2], 2);
        assert_eq!(wire[11], 7);
        assert_eq!(wire[12], 255);
    }

    #[rstest]
    #[case(WIRE_LEN - 1)]
    #[case(WIRE_LEN + 1)]
    #[case(0)]
    fn decode_rejects_any_length_but_the_exact_one(#[case] len: usize) {
        let result = InputFrame::decode(&vec![0u8; len]);
        assert_eq!(
            result,
            Err(ProtocolError::WrongLength {
                expected: WIRE_LEN,
                got: len
            })
        );
    }

    #[test]
    fn decode_rejects_a_zero_slot_from_a_well_formed_buffer() {
        // A truncation test alone would not catch this: the buffer is the right
        // size and the buttons are valid — only the slot is wrong.
        let mut wire = InputFrame::neutral(PlayerSlot::new(1).unwrap()).encode();
        wire[2] = 0;
        assert_eq!(
            InputFrame::decode(&wire),
            Err(ProtocolError::InvalidSlot { got: 0 })
        );
    }

    proptest! {
        /// Round-trip over the WHOLE valid input space, including values no
        /// hand-written case would think to try.
        #[test]
        fn encode_decode_round_trips(
            slot in 1u8..=MAX_PLAYERS,
            bits in 0u16..=0x0FFF,
            mx in i16::MIN + 1..=i16::MAX, my in i16::MIN + 1..=i16::MAX,
            cx in i16::MIN + 1..=i16::MAX, cy in i16::MIN + 1..=i16::MAX,
            l in 0u8..=255, r in 0u8..=255,
        ) {
            let original = InputFrame {
                slot: PlayerSlot::new(slot).unwrap(),
                buttons: Buttons::from_bits(bits).unwrap(),
                main: Stick::new(mx, my),
                c: Stick::new(cx, cy),
                l, r,
            };
            prop_assert_eq!(InputFrame::decode(&original.encode()).unwrap(), original);
        }

        /// No client-supplied buffer may ever panic the worker — it must return
        /// an error or a valid frame, never abort the session.
        #[test]
        fn decode_never_panics_on_arbitrary_bytes(raw in prop::collection::vec(any::<u8>(), 0..64)) {
            let _ = InputFrame::decode(&raw);
        }
    }
}
