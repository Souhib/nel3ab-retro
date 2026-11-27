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
    /// The digital buttons held, as the wire numbers them.
    #[must_use]
    pub fn buttons(self) -> u32 {
        match self {
            Self::Dolphin(f) => u32::from(f.buttons.bits()),
            Self::Switch(f) => f.buttons.bits(),
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

/// What a seat sent since its slot was last taken.
///
/// The newest state wins, because only the newest can still be applied. The
/// buttons do not quite follow that rule: a press and its release written
/// between two takes used to leave only the release, and the game never saw
/// the press (audit ENT-2, 2026-11-27). The slot now also remembers which
/// buttons went down and up on the way, and the Switch input thread keeps
/// those edges ([`crate::edges`]). Two masks, never a queue: a burst after a
/// gap must not become a delay that piles up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Unread {
    /// The newest state, the only one an emulator can still apply.
    pub latest: ControllerFrame,
    /// Every button held in at least one state written since the last take.
    pub went_down: u32,
    /// Every button released in at least one of them.
    pub went_up: u32,
}
impl Unread {
    /// The first state written since the last take.
    #[must_use]
    pub fn new(frame: ControllerFrame) -> Self {
        let held = frame.buttons();
        Self {
            latest: frame,
            went_down: held,
            went_up: !held,
        }
    }
    /// A newer state written before anybody took this one.
    #[must_use]
    pub fn then(self, frame: ControllerFrame) -> Self {
        let newer = Self::new(frame);
        Self {
            latest: frame,
            went_down: self.went_down | newer.went_down,
            went_up: self.went_up | newer.went_up,
        }
    }
}
impl From<ControllerFrame> for Unread {
    fn from(frame: ControllerFrame) -> Self {
        Self::new(frame)
    }
}
impl From<InputFrame> for Unread {
    fn from(frame: InputFrame) -> Self {
        Self::new(ControllerFrame::Dolphin(frame))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, reason = "invalid fixtures must fail the test")]
mod tests {
    use super::*;
    use crate::browser::PadArrivals;
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
    /// Le fil de la socket date les trames: un trou de 120 ms entre deux
    /// trames d'une place se lit dans le relevé de CETTE place.
    #[test]
    fn a_seat_that_goes_quiet_shows_its_gap_and_no_other_seat_does() {
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
        let (mut socket, seat) = hold(server.address());
        // As a browser does. Without it, Nagle held the frames sent before the
        // pause behind a delayed acknowledgement, and the 120 ms silence read
        // 91.5 ms at the server (first run, 2026-11-27).
        socket.get_ref().set_nodelay(true).unwrap();
        let frame = SwitchFrame::neutral(PlayerSlot::new(seat).unwrap())
            .encode()
            .to_vec();
        for pause in [4, 4, 4, 120, 0] {
            socket.send(Message::Binary(frame.clone().into())).unwrap();
            std::thread::sleep(Duration::from_millis(pause));
        }
        assert!(eventually(|| server.inputs_received() == 5));
        let all = server.take_pad_arrivals();
        let mine = all[usize::from(seat - 1)];
        let Some(gap) = mine.gap_max_ms else {
            panic!("the socket thread dated no gap");
        };
        assert!(gap >= 120.0, "a 120 ms silence read {gap} ms");
        assert_eq!((mine.frames, mine.over_50_ms), (5, 1));
        // Le jumeau: une place que personne ne tient n'a rien reçu.
        for (index, other) in all.iter().enumerate() {
            if index != usize::from(seat - 1) {
                assert_eq!(*other, PadArrivals::default());
            }
        }
    }
    /// Un appui et son relâchement écrits avant toute lecture: l'emplacement
    /// garde le dernier état, et se souvient que le bouton est descendu
    /// (audit ENT-2).
    #[test]
    fn a_press_written_before_its_release_is_remembered_by_the_slot() {
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
        let (mut socket, seat) = hold(server.address());
        let slot = PlayerSlot::new(seat).unwrap();
        // Whatever the seat's arrival left in its slot is not under test.
        let _ = server.wait_unread(Duration::from_millis(100));
        let neutral = SwitchFrame::neutral(slot);
        let pressed = SwitchFrame {
            buttons: SwitchButtons::from_bits(1).unwrap(),
            ..neutral
        };
        let send = |socket: &mut tungstenite::WebSocket<std::net::TcpStream>,
                    frame: SwitchFrame| {
            socket
                .send(Message::Binary(frame.encode().to_vec().into()))
                .unwrap();
        };
        send(&mut socket, pressed);
        send(&mut socket, neutral);
        assert!(eventually(|| server.inputs_received() == 2));
        let taken = server.wait_unread(Duration::ZERO);
        assert_eq!(taken.len(), 1, "one state per seat, not one per arrival");
        assert_eq!(taken[0].latest, ControllerFrame::Switch(neutral));
        assert_eq!(
            taken[0].went_down & 1,
            1,
            "the press written before the release was forgotten by the slot"
        );
        // The twin: a take starts afresh, and a release alone went nowhere down.
        send(&mut socket, neutral);
        assert!(eventually(|| server.inputs_received() == 3));
        let taken = server.wait_unread(Duration::ZERO);
        assert_eq!((taken[0].went_down & 1, taken[0].went_up & 1), (0, 1));
    }
    /// Le jumeau de la main qui change: le silence entre le départ d'un joueur
    /// et l'arrivée du suivant sur la même place n'est pas un trou de liaison.
    #[test]
    fn the_silence_between_two_holders_of_a_seat_is_not_a_gap() {
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
        let send_three = |socket: &mut tungstenite::WebSocket<std::net::TcpStream>, seat| {
            socket.get_ref().set_nodelay(true).unwrap();
            let frame = SwitchFrame::neutral(PlayerSlot::new(seat).unwrap())
                .encode()
                .to_vec();
            for _ in 0..3 {
                socket.send(Message::Binary(frame.clone().into())).unwrap();
                std::thread::sleep(Duration::from_millis(4));
            }
        };
        let (mut first, seat) = hold(server.address());
        send_three(&mut first, seat);
        assert!(eventually(|| server.inputs_received() == 3));
        first.close(None).unwrap();
        // La place est rendue quand le serveur y a remis l'état neutre.
        assert!(eventually(|| {
            server
                .wait_controller_input(Duration::from_millis(50))
                .contains(&InputKind::Switch.neutral(PlayerSlot::new(seat).unwrap()))
        }));
        std::thread::sleep(Duration::from_millis(120));
        let (mut second, again) = hold(server.address());
        assert_eq!(again, seat, "the next holder took the same seat");
        send_three(&mut second, again);
        assert!(eventually(|| server.inputs_received() == 6));
        let mine = server.take_pad_arrivals()[usize::from(seat - 1)];
        assert_eq!(mine.frames, 6);
        assert_eq!(
            mine.over_50_ms, 0,
            "the {:?} ms between two holders counted as a gap",
            mine.gap_max_ms
        );
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
