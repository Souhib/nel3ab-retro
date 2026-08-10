//! Dolphin's named-pipe input grammar.
//!
//! # Provenance
//!
//! Every token and every conversion below was read out of Dolphin's
//! `Source/Core/InputCommon/ControllerInterface/Pipes/Pipes.cpp` at the revision
//! this project pins (`216ffb45`, 2026-08-10). It is NOT written from the wiki,
//! which is both incomplete and wrong about the trigger form.
//!
//! ```text
//! PRESS <TOKEN>          RELEASE <TOKEN>
//! SET <MAIN|C> <x> <y>   SET <L|R> <v>
//! ```
//!
//! # The two traps in that grammar
//!
//! 1. **The two `SET` forms do not scale their arguments the same way.** The
//!    four-token stick form passes `x` and `y` to `SetAxis` untouched, so `0.5`
//!    is centre. The three-token trigger form is pre-scaled by Dolphin itself
//!    (`SetAxis(tok, (v / 2.0) + 0.5)`), so its useful range is `0.0..=1.0` with
//!    `0.0` released. Two different meanings for the same literal, in the same
//!    command word.
//! 2. **A malformed line is silently discarded.** `ParseCommand` splits on a
//!    single space and returns without a word if the token count is not 2..=4 or
//!    the token is unknown. There is no error, no log line, and no dropped
//!    connection — the button simply never presses. That is why the tests here
//!    assert byte-exact output rather than "it parses".
//!
//! This module is pure: no file descriptor, no Dolphin, no clock. It is where
//! the protocol is *decided*; [`crate::pipe`] is where it is *delivered*.

use core::fmt::Write as _;

use nel3ab_protocol::{Buttons, InputFrame, Stick};

/// Full deflection on a protocol axis.
///
/// `Stick::new` already clamps `i16::MIN` away, so the range is symmetric and
/// `-AXIS_MAX ..= AXIS_MAX` is exhaustive.
const AXIS_MAX: i16 = 32_767;

/// Decimal places used for every axis value we emit.
///
/// Five is chosen against the hardware, not by taste: a GameCube stick reports
/// one signed byte per axis, so the smallest step a game can observe is
/// `1/255 ≈ 0.0039`. Five decimals resolve ~25x finer than that, and are still
/// short enough that a whole four-player frame fits far inside `PIPE_BUF` (see
/// [`MAX_BATCH_LEN`]). More digits would buy nothing a game could ever see.
const AXIS_DECIMALS: usize = 5;

/// POSIX's atomic-write guarantee for a pipe, in bytes.
///
/// A `write` of at most this many bytes to a FIFO either transfers everything or
/// transfers nothing — it is never torn in half. This is the property that lets
/// [`crate::pipe::PadPipe::send`] treat a full pipe as "frame dropped" rather
/// than "Dolphin is now reading a half-written command".
pub const PIPE_BUF: usize = 4096;

/// Upper bound on the bytes a single [`encode_delta`] or [`encode_full`] call
/// can append.
///
/// Asserted against a constructed worst case in the tests, and asserted to sit
/// below [`PIPE_BUF`] so the atomicity argument above actually holds. If a
/// future button or axis pushes past this, the test fails here rather than
/// producing a torn command on a live session.
pub const MAX_BATCH_LEN: usize = 320;

/// Dolphin's button tokens, paired with our bits.
///
/// The strings are `s_button_tokens` from `Pipes.cpp`, verbatim. Note `START`,
/// which is spelled `Start` in `GCPadNew.ini` and `START` here — the two files
/// genuinely disagree, and using one spelling in both places yields a button
/// that never presses, silently.
///
/// The order fixes the emission order, so a batch is byte-reproducible and can
/// be asserted exactly.
const BUTTON_TOKENS: [(Buttons, &str); 12] = [
    (Buttons::A, "A"),
    (Buttons::B, "B"),
    (Buttons::X, "X"),
    (Buttons::Y, "Y"),
    (Buttons::Z, "Z"),
    (Buttons::L, "L"),
    (Buttons::R, "R"),
    (Buttons::START, "START"),
    (Buttons::D_UP, "D_UP"),
    (Buttons::D_DOWN, "D_DOWN"),
    (Buttons::D_LEFT, "D_LEFT"),
    (Buttons::D_RIGHT, "D_RIGHT"),
];

/// One controller's state, with the player slot deliberately removed.
///
/// An [`InputFrame`] carries a slot because it arrives over a network from a
/// client that must say who it is. Once the frame has been routed to a pipe the
/// slot is settled, and carrying it further would only create the opportunity to
/// diff one player's state against another's. Dropping the field makes that
/// mistake unrepresentable instead of merely unlikely.
///
/// `Eq` is derived and used for the frame-to-frame diff: every field is
/// integer-backed, so the comparison is exact and no float ever meets `==`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PadState {
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

impl PadState {
    /// Nothing held, both sticks centred, both triggers released.
    pub const NEUTRAL: Self = Self {
        buttons: Buttons::NONE,
        main: Stick::NEUTRAL,
        c: Stick::NEUTRAL,
        l: 0,
        r: 0,
    };

    /// Drops the routing information from a client frame.
    #[must_use]
    pub const fn from_frame(frame: &InputFrame) -> Self {
        Self {
            buttons: frame.buttons,
            main: frame.main,
            c: frame.c,
            l: frame.l,
            r: frame.r,
        }
    }
}

impl Default for PadState {
    fn default() -> Self {
        Self::NEUTRAL
    }
}

/// Maps a protocol axis (`-32767..=32767`) onto Dolphin's `0.0..=1.0`.
///
/// `2 * AXIS_MAX` is exactly representable and the midpoint lands on exactly
/// `0.5`, so a centred stick emits `0.50000` and Dolphin's `SetAxis` drives both
/// half-axes to zero — a true neutral, not a rounding artefact.
fn axis_to_pipe(value: i16) -> f64 {
    (f64::from(value) + f64::from(AXIS_MAX)) / (2.0 * f64::from(AXIS_MAX))
}

/// Maps an analogue trigger (`0..=255`) onto the three-token `SET` range.
///
/// Dolphin re-scales this form by `(v / 2) + 0.5` before splitting it around the
/// midpoint, which composes back to the identity on `0.0..=1.0`: `SET L 1.0` is
/// a fully pressed trigger and `SET L 0.0` a released one.
fn trigger_to_pipe(value: u8) -> f64 {
    f64::from(value) / f64::from(u8::MAX)
}

/// `core::fmt::Write for String` cannot fail — its impl returns `Ok`
/// unconditionally — so there is no error here to propagate or log. The wrapper
/// exists so that fact is stated once instead of at each of the four call sites.
fn append(out: &mut String, args: core::fmt::Arguments<'_>) {
    let _ = out.write_fmt(args);
}

/// Appends the commands that move Dolphin from `previous` to `next`.
///
/// Emits nothing at all when the two states are equal. That is the overwhelmingly
/// common case at 60 Hz — a player is not changing all twelve buttons every
/// frame — and skipping it keeps the pipe empty enough that the "dropped frame"
/// path below is effectively unreachable in normal play.
pub fn encode_delta(previous: PadState, next: PadState, out: &mut String) {
    for (button, token) in BUTTON_TOKENS {
        let was = previous.buttons.contains(button);
        let is = next.buttons.contains(button);
        if was == is {
            continue;
        }
        let verb = if is { "PRESS" } else { "RELEASE" };
        append(out, format_args!("{verb} {token}\n"));
    }

    if previous.main != next.main {
        append_stick(out, "MAIN", next.main);
    }
    if previous.c != next.c {
        append_stick(out, "C", next.c);
    }
    if previous.l != next.l {
        append_trigger(out, "L", next.l);
    }
    if previous.r != next.r {
        append_trigger(out, "R", next.r);
    }
}

/// Appends the commands that set `state` unconditionally, ignoring any history.
///
/// Used for the first write to a freshly opened pipe. Diffing there would be
/// wrong: the encoder's idea of "previous" is an assumption about a process it
/// has never spoken to, and a wrong assumption leaves a button stuck down for
/// the rest of the session with nothing to correct it.
pub fn encode_full(state: PadState, out: &mut String) {
    for (button, token) in BUTTON_TOKENS {
        let verb = if state.buttons.contains(button) {
            "PRESS"
        } else {
            "RELEASE"
        };
        append(out, format_args!("{verb} {token}\n"));
    }
    append_stick(out, "MAIN", state.main);
    append_stick(out, "C", state.c);
    append_trigger(out, "L", state.l);
    append_trigger(out, "R", state.r);
}

fn append_stick(out: &mut String, token: &str, stick: Stick) {
    let x = axis_to_pipe(stick.x);
    let y = axis_to_pipe(stick.y);
    append(
        out,
        format_args!("SET {token} {x:.AXIS_DECIMALS$} {y:.AXIS_DECIMALS$}\n"),
    );
}

fn append_trigger(out: &mut String, token: &str, value: u8) {
    let v = trigger_to_pipe(value);
    append(out, format_args!("SET {token} {v:.AXIS_DECIMALS$}\n"));
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;
    use rstest::rstest;

    fn encoded_full(state: PadState) -> String {
        let mut out = String::new();
        encode_full(state, &mut out);
        out
    }

    fn encoded_delta(previous: PadState, next: PadState) -> String {
        let mut out = String::new();
        encode_delta(previous, next, &mut out);
        out
    }

    // ── The literal grammar ───────────────────────────────────────────────
    // These are golden tests on purpose. Dolphin answers a malformed command by
    // ignoring it in silence, so "the encoder still compiles" and "the button
    // still works" are completely independent facts. Only byte-exactness links
    // them.

    #[test]
    fn a_neutral_pad_serialises_to_the_documented_batch() {
        assert_eq!(
            encoded_full(PadState::NEUTRAL),
            "RELEASE A\nRELEASE B\nRELEASE X\nRELEASE Y\nRELEASE Z\nRELEASE L\nRELEASE R\n\
             RELEASE START\nRELEASE D_UP\nRELEASE D_DOWN\nRELEASE D_LEFT\nRELEASE D_RIGHT\n\
             SET MAIN 0.50000 0.50000\nSET C 0.50000 0.50000\nSET L 0.00000\nSET R 0.00000\n"
        );
    }

    #[test]
    fn a_centred_stick_is_exactly_one_half() {
        // Not cosmetic. Dolphin turns this value into two half-axes with
        // `max(0, v - 0.5) * 2` and `(0.5 - min(0.5, v)) * 2`; anything but an
        // exact 0.5 leaves the stick very slightly deflected, forever, which
        // reads as analogue drift and is miserable to trace back to a rounding
        // choice made here.
        assert!(encoded_full(PadState::NEUTRAL).contains("SET MAIN 0.50000 0.50000\n"));
    }

    #[rstest]
    #[case(AXIS_MAX, "1.00000")]
    #[case(-AXIS_MAX, "0.00000")]
    #[case(0, "0.50000")]
    fn axis_endpoints_map_to_the_full_dolphin_range(#[case] raw: i16, #[case] expected: &str) {
        let state = PadState {
            main: Stick::new(raw, raw),
            ..PadState::NEUTRAL
        };
        assert!(
            encoded_full(state).contains(&format!("SET MAIN {expected} {expected}\n")),
            "got: {}",
            encoded_full(state)
        );
    }

    #[rstest]
    #[case(255, "1.00000")]
    #[case(0, "0.00000")]
    #[case(128, "0.50196")]
    fn trigger_endpoints_map_to_the_three_token_range(#[case] raw: u8, #[case] expected: &str) {
        let state = PadState {
            l: raw,
            ..PadState::NEUTRAL
        };
        assert!(encoded_full(state).contains(&format!("SET L {expected}\n")));
    }

    #[test]
    fn the_digital_and_analogue_shoulders_use_different_commands() {
        // `PRESS L` and `SET L ...` address two different maps inside Dolphin
        // (`m_buttons` and `m_axes`), so the shared token name is not a
        // collision — but emitting the wrong one is a silent no-op.
        let state = PadState {
            buttons: Buttons::L,
            l: 255,
            ..PadState::NEUTRAL
        };
        let out = encoded_full(state);
        assert!(out.contains("PRESS L\n"), "digital click missing: {out}");
        assert!(out.contains("SET L 1.00000\n"), "analogue missing: {out}");
    }

    #[test]
    fn every_line_is_newline_terminated_and_single_spaced() {
        // Dolphin splits on a single space and dequeues on '\n'. A double space
        // produces an empty token, which changes the token COUNT and makes the
        // whole command fall off the end of the parser without a word.
        let busy = PadState {
            buttons: Buttons::from_bits(Buttons::KNOWN.bits()).unwrap(),
            main: Stick::new(-1234, 5678),
            c: Stick::new(9, -9),
            l: 40,
            r: 200,
        };
        for line in encoded_full(busy).lines() {
            assert!(!line.contains("  "), "double space in {line:?}");
            assert!(
                !line.starts_with(' ') && !line.ends_with(' '),
                "pad: {line:?}"
            );
            assert!(!line.contains('\r'), "CR would corrupt the token: {line:?}");
            let tokens = line.split(' ').count();
            assert!((2..=4).contains(&tokens), "{tokens} tokens in {line:?}");
        }
    }

    // ── The diff ──────────────────────────────────────────────────────────

    #[test]
    fn an_unchanged_state_emits_nothing() {
        assert_eq!(encoded_delta(PadState::NEUTRAL, PadState::NEUTRAL), "");
    }

    /// Negative twin of the test above: "emits nothing when equal" is worthless
    /// if it also emits nothing when a single bit changed.
    #[test]
    fn a_single_button_change_emits_exactly_one_line() {
        let pressed = PadState {
            buttons: Buttons::A,
            ..PadState::NEUTRAL
        };
        assert_eq!(encoded_delta(PadState::NEUTRAL, pressed), "PRESS A\n");
        assert_eq!(encoded_delta(pressed, PadState::NEUTRAL), "RELEASE A\n");
    }

    #[test]
    fn an_unchanged_axis_is_not_resent_when_a_button_moves() {
        let before = PadState {
            main: Stick::new(1000, 2000),
            ..PadState::NEUTRAL
        };
        let after = PadState {
            buttons: Buttons::B,
            ..before
        };
        assert_eq!(encoded_delta(before, after), "PRESS B\n");
    }

    #[test]
    fn applying_a_delta_to_its_predecessor_reproduces_the_full_encoding() {
        // The property that makes diffing safe: whatever path Dolphin took to
        // reach `previous`, replaying the delta must leave it in the state a
        // full sync would have produced.
        let previous = PadState {
            buttons: Buttons::A.union(Buttons::Z),
            main: Stick::new(-500, 500),
            c: Stick::NEUTRAL,
            l: 10,
            r: 0,
        };
        let next = PadState {
            buttons: Buttons::A.union(Buttons::START),
            main: Stick::new(-500, 500),
            c: Stick::new(1, 2),
            l: 10,
            r: 250,
        };

        let mut replayed = last_command_per_input(&encoded_full(previous));
        for (key, value) in last_command_per_input(&encoded_delta(previous, next)) {
            replayed.insert(key, value);
        }
        assert_eq!(replayed, last_command_per_input(&encoded_full(next)));
    }

    /// Collapses a batch the way Dolphin's state map does: keyed by the input
    /// being addressed, last write wins.
    fn last_command_per_input(batch: &str) -> std::collections::BTreeMap<String, String> {
        batch
            .lines()
            .map(|line| {
                let mut tokens = line.split(' ');
                let verb = tokens.next().unwrap_or_default();
                let target = tokens.next().unwrap_or_default();
                // PRESS/RELEASE address the button; SET addresses the axis. Key
                // on the target alone so a press and a release collapse together.
                let kind = if verb == "SET" { "axis" } else { "button" };
                (format!("{kind} {target}"), line.to_owned())
            })
            .collect()
    }

    // ── The atomicity bound ───────────────────────────────────────────────

    #[test]
    fn the_worst_case_batch_fits_the_declared_bound() {
        // Worst case for a delta: every button goes from held to released
        // (`RELEASE` is the longer verb) and all four axes move.
        let all_held = PadState {
            buttons: Buttons::from_bits(Buttons::KNOWN.bits()).unwrap(),
            main: Stick::new(-AXIS_MAX, -AXIS_MAX),
            c: Stick::new(-AXIS_MAX, -AXIS_MAX),
            l: 0,
            r: 0,
        };
        let all_released = PadState {
            buttons: Buttons::NONE,
            main: Stick::new(AXIS_MAX, AXIS_MAX),
            c: Stick::new(AXIS_MAX, AXIS_MAX),
            l: 255,
            r: 255,
        };

        let worst = encoded_delta(all_held, all_released).len();
        let worst_full = encoded_full(all_held).len();
        assert!(
            worst <= MAX_BATCH_LEN && worst_full <= MAX_BATCH_LEN,
            "delta {worst} / full {worst_full} exceed MAX_BATCH_LEN {MAX_BATCH_LEN}"
        );
    }

    #[test]
    fn the_declared_bound_stays_inside_the_atomic_write_window() {
        // If this ever fails, `PadPipe::send` may write half a command into a
        // live session and the "dropped frame" story stops being true.
        const { assert!(MAX_BATCH_LEN <= PIPE_BUF) };
    }
}
