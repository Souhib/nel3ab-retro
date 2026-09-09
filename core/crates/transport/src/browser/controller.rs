//! One seat lifecycle for both formats. A server chooses its format at startup;
//! accepting either based on length would let a client change the room's device.
use nel3ab_protocol::{InputFrame, PlayerSlot, switch::SwitchFrame};

/// The immutable input contract of a browser server.
#[derive(Debug, Clone, Copy)]
pub enum InputKind {
    /// The original thirteen-byte GameCube/Wii state.
    Dolphin,
    /// A versioned Switch state with sixteen independent buttons.
    Switch,
}

/// Latest controller state held for a seat.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControllerFrame {
    /// Dolphin's existing canonical state.
    Dolphin(InputFrame),
    /// Switch gameplay controls.
    Switch(SwitchFrame),
}
impl InputKind {
    pub(super) fn decode(self, bytes: &[u8], slot: PlayerSlot) -> Option<ControllerFrame> {
        match self {
            Self::Dolphin => InputFrame::decode(bytes)
                .ok()
                .map(|frame| ControllerFrame::Dolphin(InputFrame { slot, ..frame })),
            Self::Switch => SwitchFrame::decode(bytes)
                .ok()
                .map(|frame| ControllerFrame::Switch(SwitchFrame { slot, ..frame })),
        }
    }
    pub(super) const fn neutral(self, slot: PlayerSlot) -> ControllerFrame {
        match self {
            Self::Dolphin => ControllerFrame::Dolphin(InputFrame::neutral(slot)),
            Self::Switch => ControllerFrame::Switch(SwitchFrame::neutral(slot)),
        }
    }
}
impl ControllerFrame {
    pub(super) fn is_neutral(self) -> bool {
        match self {
            Self::Dolphin(f) => f.is_neutral(),
            Self::Switch(f) => f.is_neutral(),
        }
    }
    pub(super) const fn dolphin(self) -> Option<InputFrame> {
        match self {
            Self::Dolphin(f) => Some(f),
            Self::Switch(_) => None,
        }
    }
}
impl From<InputFrame> for ControllerFrame {
    fn from(frame: InputFrame) -> Self {
        Self::Dolphin(frame)
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, reason = "invalid fixtures must fail the test")]
mod tests {
    use super::*;
    use crate::browser::{
        BrowserServer,
        harness::{eventually, four, hold, no_art, nobody},
    };
    use nel3ab_protocol::{Stick, switch::SwitchButtons};
    use std::{sync::Arc, time::Duration};
    use tungstenite::Message;
    #[test]
    fn switch_connections_keep_seats_and_release_the_actual_virtual_controller() {
        let server = BrowserServer::start_with_input(
            ([127, 0, 0, 1], 0).into(),
            "",
            Arc::from("[]"),
            no_art(),
            four(),
            &nobody(),
            InputKind::Switch,
        )
        .unwrap();
        let mut sockets = Vec::new();
        for expected in 1..=4 {
            let (mut socket, seat) = hold(server.address());
            assert_eq!(seat, expected);
            let frame = SwitchFrame {
                slot: PlayerSlot::new(1).unwrap(),
                buttons: SwitchButtons::from_bits(1 << expected).unwrap(),
                left: Stick::new(8192, 0),
                ..SwitchFrame::neutral(PlayerSlot::new(1).unwrap())
            };
            socket
                .send(Message::Binary(frame.encode().to_vec().into()))
                .unwrap();
            let frames = server.wait_controller_input(Duration::from_secs(2));
            assert_eq!(
                frames,
                vec![ControllerFrame::Switch(SwitchFrame {
                    slot: PlayerSlot::new(expected).unwrap(),
                    ..frame
                })]
            );
            sockets.push(socket);
        }
        // A frame's forged P1 never touches the first player's slot.
        assert!(server.wait_controller_input(Duration::ZERO).is_empty());
        sockets[1].close(None).unwrap();
        let released = server.wait_controller_input(Duration::from_secs(2));
        assert_eq!(
            released,
            vec![InputKind::Switch.neutral(PlayerSlot::new(2).unwrap())]
        );
        let (_, seat) = hold(server.address());
        assert_eq!(seat, 2);
    }
    #[test]
    fn each_room_rejects_the_other_format_and_releases_its_own() {
        for kind in [InputKind::Dolphin, InputKind::Switch] {
            let server = BrowserServer::start_with_input(
                ([127, 0, 0, 1], 0).into(),
                "",
                Arc::from("[]"),
                no_art(),
                four(),
                &nobody(),
                kind,
            )
            .unwrap();
            let (mut socket, seat) = hold(server.address());
            let slot = PlayerSlot::new(seat).unwrap();
            let foreign = match kind {
                InputKind::Dolphin => SwitchFrame::neutral(slot).encode().to_vec(),
                InputKind::Switch => InputFrame::neutral(slot).encode().to_vec(),
            };
            socket.send(Message::Binary(foreign.into())).unwrap();
            assert_eq!(
                server.wait_controller_input(Duration::from_secs(2)),
                vec![kind.neutral(slot)]
            );
            assert_eq!(server.inputs_received(), 0);
            assert!(eventually(|| server.pads_held() == 0));
        }
    }
}
