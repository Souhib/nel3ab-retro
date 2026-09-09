//! Canonical Switch gameplay controls.
//!
//! Separate from the 13-byte Dolphin frame:
//! four shoulders, minus/plus and both stick clicks must keep distinct bits.
use crate::{PlayerSlot, ProtocolError, Stick};
use thiserror::Error;

/// A versioned Switch controller frame occupies fifteen bytes.
pub const SWITCH_LEN: usize = 15;

/// Invalid Switch wire input, rejected before it can affect a seat.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum SwitchError {
    /// The common length or seat validation failed.
    #[error(transparent)]
    Protocol(#[from] ProtocolError),
    /// The tag or version belongs to another protocol.
    #[error("expected Switch tag 0x53 and version 1")]
    Version,
    /// Only the sixteen gameplay buttons are implemented.
    #[error("unknown Switch button bits {0:#x}")]
    Buttons(u32),
}

/// The sixteen gameplay buttons, in a mask independent of GameCube labels.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SwitchButtons(u32);

impl SwitchButtons {
    /// A, B, X, Y, L, R, ZL, ZR, minus, plus, left/right click, up/down/left/right.
    pub const KNOWN: u32 = 0xffff;
    /// Validate every bit; a newer sender cannot silently lose a command.
    pub const fn from_bits(bits: u32) -> Result<Self, SwitchError> {
        if bits & !Self::KNOWN != 0 {
            return Err(SwitchError::Buttons(bits & !Self::KNOWN));
        }
        Ok(Self(bits))
    }
    /// The frozen bit order documented on the wire.
    #[must_use]
    pub const fn bits(self) -> u32 {
        self.0
    }
}

/// Layout: tag 0x53, version 1, seat, buttons u32 LE, four stick axes i16 LE.
/// Sticks point right/up positively, exactly as in the Dolphin protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SwitchFrame {
    /// Restamped by the server with the connection's seat.
    pub slot: PlayerSlot,
    /// The gameplay buttons.
    pub buttons: SwitchButtons,
    /// Left stick.
    pub left: Stick,
    /// Right stick.
    pub right: Stick,
}

impl SwitchFrame {
    /// Release everything on a seat.
    #[must_use]
    pub const fn neutral(slot: PlayerSlot) -> Self {
        Self {
            slot,
            buttons: SwitchButtons(0),
            left: Stick::new(0, 0),
            right: Stick::new(0, 0),
        }
    }
    /// A heartbeat is not proof that somebody is playing.
    #[must_use]
    pub fn is_neutral(self) -> bool {
        self == Self::neutral(self.slot)
    }
    /// Decode only this format and version, including all bounds.
    pub fn decode(bytes: &[u8]) -> Result<Self, SwitchError> {
        if bytes.len() != SWITCH_LEN {
            return Err(ProtocolError::WrongLength {
                expected: SWITCH_LEN,
                got: bytes.len(),
            }
            .into());
        }
        if bytes[0..2] != [0x53, 1] {
            return Err(SwitchError::Version);
        }
        let axis = |at| i16::from_le_bytes([bytes[at], bytes[at + 1]]);
        Ok(Self {
            slot: PlayerSlot::new(bytes[2])?,
            buttons: SwitchButtons::from_bits(u32::from_le_bytes([
                bytes[3], bytes[4], bytes[5], bytes[6],
            ]))?,
            left: Stick::new(axis(7), axis(9)),
            right: Stick::new(axis(11), axis(13)),
        })
    }
    /// Encode without allocating; a frame cannot contain an unknown button.
    #[must_use]
    pub fn encode(self) -> [u8; SWITCH_LEN] {
        let mut bytes = [0; SWITCH_LEN];
        bytes[0] = 0x53;
        bytes[1] = 1;
        bytes[2] = self.slot.get();
        bytes[3..7].copy_from_slice(&self.buttons.bits().to_le_bytes());
        for (at, value) in [
            (7, self.left.x),
            (9, self.left.y),
            (11, self.right.x),
            (13, self.right.y),
        ] {
            bytes[at..at + 2].copy_from_slice(&value.to_le_bytes());
        }
        bytes
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    reason = "a rejected fixture must fail its assertion"
)]
mod tests {
    use super::*;
    use crate::InputFrame;
    #[test]
    fn frozen_wire_and_fractional_axes() {
        let f = SwitchFrame {
            slot: PlayerSlot::new(3).unwrap(),
            buttons: SwitchButtons::from_bits(0x8421).unwrap(),
            left: Stick::new(8192, -4096),
            right: Stick::new(-16384, 2048),
        };
        let wire = [0x53, 1, 3, 0x21, 0x84, 0, 0, 0, 32, 0, 240, 0, 192, 0, 8];
        assert_eq!(f.encode(), wire);
        assert_eq!(SwitchFrame::decode(&wire).unwrap(), f);
        assert!(InputFrame::decode(&wire).is_err());
        assert!(!f.is_neutral());
        assert!(SwitchFrame::neutral(f.slot).is_neutral());
    }
    #[test]
    fn rejects_another_version_size_seat_and_unknown_buttons() {
        let good = SwitchFrame::neutral(PlayerSlot::new(1).unwrap()).encode();
        for (at, value) in [(0, 0), (1, 2), (2, 0), (2, 5), (5, 1)] {
            let mut bad = good;
            bad[at] = value;
            assert!(SwitchFrame::decode(&bad).is_err(), "byte {at}");
        }
        for length in 0..SWITCH_LEN {
            assert!(SwitchFrame::decode(&good[..length]).is_err());
        }
        assert!(SwitchFrame::decode(&[0; SWITCH_LEN + 1]).is_err());
        for slot in 1..=4 {
            let mut wire = good;
            wire[2] = slot;
            assert!(SwitchFrame::decode(&wire).is_ok());
        }
    }
    #[test]
    fn every_button_survives_alone_and_in_combination() {
        for bits in (0..16).map(|bit| 1 << bit).chain([0, 0xffff]) {
            let f = SwitchFrame {
                buttons: SwitchButtons::from_bits(bits).unwrap(),
                ..SwitchFrame::neutral(PlayerSlot::new(1).unwrap())
            };
            assert_eq!(
                SwitchFrame::decode(&f.encode()).unwrap().buttons.bits(),
                bits
            );
        }
        assert!(SwitchButtons::from_bits(1 << 16).is_err());
    }
}
