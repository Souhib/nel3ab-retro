//! Generates the Dolphin config files a session runs against.
//!
//! # Why generate instead of committing a fixture
//!
//! `GCPadNew.ini` and the FIFO names encode the same fact twice: `[GCPad2]` is
//! player 2 *because* it points at a file called `p2`. A committed fixture lets
//! those two drift, and the failure mode is not a crash — it is player 2's
//! controller quietly driving nobody. Deriving both from one [`SlotSet`] means
//! the drift cannot happen, and the golden tests below pin the bytes so an
//! accidental edit is still caught.
//!
//! Every key here is either something we depend on being non-default, or a
//! default we depend on so specifically that Dolphin changing it would be a bug
//! we want to find in a diff rather than in a game.

use std::fmt::Write as _;

use nel3ab_protocol::{MAX_PLAYERS, PlayerSlot};

use crate::slots::SlotSet;

/// Name of the directory Dolphin scans for input pipes, inside the user folder.
///
/// `File::GetUserPath(D_PIPES_IDX)`. Dolphin scans it **once**, at
/// input-backend init — a FIFO that appears afterwards is invisible for the
/// whole session.
pub const PIPES_DIR: &str = "Pipes";

/// Name of the config directory inside the Dolphin user folder.
pub const CONFIG_DIR: &str = "Config";

/// The named pipe Dolphin's sound output is written to.
///
/// It sits in the user directory because that is what the container mounts, and
/// because `HOME` inside the container IS the user directory — which is what
/// makes the ALSA configuration below reachable without touching the image.
pub const AUDIO_PIPE: &str = "audio.fifo";

/// `.asoundrc`, which turns "the default sound device" into "a pipe we read".
///
/// There is no sound card in the container and no sound server either, so the
/// usual backends have nothing to open. ALSA's `file` plugin writes the samples
/// straight through to a path, which is all we need.
///
/// The `null` slave provides no clock. Nothing paces this stream but the reader:
/// when the pipe is full Dolphin's audio thread blocks, exactly as it would on a
/// sound card whose buffer is full. So the reader must consume 48000 frames a
/// second and no faster — measured on the first attempt at 45 TIMES real time,
/// which is what an unpaced ALSA device does when the mixer keeps padding.
#[must_use]
pub fn asoundrc(pipe: &std::path::Path) -> String {
    format!(
        "pcm.!default {{\n    \
         type file\n    \
         slave.pcm \"null\"\n    \
         file \"{}\"\n    \
         format raw\n\
         }}\n",
        pipe.display()
    )
}

/// What the sound is, once it leaves Dolphin: signed 16-bit, little endian,
/// two channels, 48 kHz. Read out of the header ALSA itself writes when asked
/// for a WAV rather than assumed.
pub const AUDIO_RATE: u32 = 48_000;
/// Channels in the stream Dolphin writes.
pub const AUDIO_CHANNELS: u32 = 2;
/// Bytes per sample frame: two channels of `i16`.
pub const AUDIO_FRAME_BYTES: usize = 4;

/// `SIDEVICE_GC_CONTROLLER` in Dolphin's `SIDevices` enum.
///
/// The enum is positional and unnamed in the ini, so the number IS the
/// contract. Verified against `Source/Core/Core/HW/SI/SI_Device.h` @ 216ffb45.
const SIDEVICE_GC_CONTROLLER: u8 = 6;

/// `SIDEVICE_NONE` — an empty controller port.
const SIDEVICE_NONE: u8 = 0;

/// The backend Dolphin plays through.
///
/// ALSA, on a machine with no sound card, because [`asoundrc`] has already
/// redefined what "the default device" means: a pipe. There is no sound server
/// in the container and none is wanted — the file plugin writes the samples and
/// the worker reads them.
///
/// It used to be "No Audio Output", when nobody was listening. Nobody was
/// listening because there was nothing to listen to.
const AUDIO_BACKEND: &str = "ALSA";

/// The FIFO file name for a player, e.g. `p1`.
///
/// This name is the entire identity mechanism: Dolphin uses the file name as the
/// device's virtual name, so player 2 is player 2 because the file is called
/// `p2`. Nothing enumerates, so nothing can reorder (ADR D3).
#[must_use]
pub fn pipe_file_name(slot: PlayerSlot) -> String {
    format!("p{}", slot.get())
}

/// The Dolphin device string for a player's pipe, e.g. `Pipe/0/p1`.
///
/// Shaped `<source>/<id>/<name>`. The id is `0` for every pipe: Dolphin numbers
/// duplicates within a source *by name*, and our names are already distinct.
#[must_use]
pub fn pipe_device(slot: PlayerSlot) -> String {
    format!("Pipe/0/{}", pipe_file_name(slot))
}

/// Renders `GCPadNew.ini` for the given ports.
///
/// # The two spellings of Start
///
/// The ini key is `Buttons/Start` (Dolphin's `START_BUTTON = "Start"`) while the
/// pipe token is `START` (`s_button_tokens`). They are genuinely different
/// strings in two different files, and using either spelling in both places
/// produces a button that never presses and never complains.
#[must_use]
pub fn gcpad_ini(slots: SlotSet) -> String {
    let mut out = String::new();
    for slot in slots.iter() {
        // `fmt::Write for String` is infallible; see `wire::append`.
        let _ = write!(out, "{}", gcpad_section(slot));
    }
    out
}

fn gcpad_section(slot: PlayerSlot) -> String {
    let mut out = String::new();
    let w = &mut out;
    let _ = writeln!(w, "[GCPad{}]", slot.get());
    let _ = writeln!(w, "Device = {}", pipe_device(slot));

    for (key, token) in [
        ("Buttons/A", "A"),
        ("Buttons/B", "B"),
        ("Buttons/X", "X"),
        ("Buttons/Y", "Y"),
        ("Buttons/Z", "Z"),
        ("Buttons/Start", "START"),
        ("D-Pad/Up", "D_UP"),
        ("D-Pad/Down", "D_DOWN"),
        ("D-Pad/Left", "D_LEFT"),
        ("D-Pad/Right", "D_RIGHT"),
        ("Triggers/L", "L"),
        ("Triggers/R", "R"),
    ] {
        // Backticks quote a control name literally. Without them the expression
        // parser reads `Button D_UP` as two terms and binds nothing.
        let _ = writeln!(w, "{key} = `Button {token}`");
    }

    // Dolphin models each stick as two opposed half-axes, so a single pipe axis
    // feeds two keys. `Up` takes the `+` half and `Down` the `-` half, which is
    // what makes our "positive y is up" convention true rather than aspirational.
    for (group, axis) in [("Main Stick", "MAIN"), ("C-Stick", "C")] {
        let _ = writeln!(w, "{group}/Up = `Axis {axis} Y +`");
        let _ = writeln!(w, "{group}/Down = `Axis {axis} Y -`");
        let _ = writeln!(w, "{group}/Left = `Axis {axis} X -`");
        let _ = writeln!(w, "{group}/Right = `Axis {axis} X +`");
        // Zero is already Dolphin's default, and it is stated anyway because we
        // depend on it: the browser has already applied the player's dead zone
        // (ADR D3), and a second one here would silently compound the first.
        let _ = writeln!(w, "{group}/Dead Zone = 0.0");
    }

    let _ = writeln!(w, "Triggers/L-Analog = `Axis L +`");
    let _ = writeln!(w, "Triggers/R-Analog = `Axis R +`");

    // Default is off, which ties the emulated pad's connection state to the real
    // device. We want the opposite: the room decides who is player 2 (ADR D4),
    // and a pad that vanishes mid-match because of a device-enumeration hiccup
    // is far worse than one that stays plugged in. Pipe absence is detected by
    // us instead, at attach time, where it can be reported properly.
    let _ = writeln!(w, "Options/Always Connected = True");
    let _ = writeln!(w);
    out
}

/// Renders `Dolphin.ini` for the given ports.
#[must_use]
pub fn dolphin_ini(slots: SlotSet) -> String {
    let mut out = String::new();
    let w = &mut out;

    let _ = writeln!(w, "[Core]");
    // Only the ports the room actually serves get a controller. An unserved port
    // holding a phantom pad changes what the GAME does — a four-player title
    // opens four split-screen viewports for one player.
    for raw in 1..=MAX_PLAYERS {
        let device = PlayerSlot::new(raw).map_or(SIDEVICE_NONE, |slot| {
            if slots.contains(slot) {
                SIDEVICE_GC_CONTROLLER
            } else {
                SIDEVICE_NONE
            }
        });
        let _ = writeln!(w, "SIDevice{} = {device}", raw - 1);
    }

    let _ = writeln!(w);
    let _ = writeln!(w, "[DSP]");
    let _ = writeln!(w, "Backend = {AUDIO_BACKEND}");

    let _ = writeln!(w);
    let _ = writeln!(w, "[Analytics]");
    // Unasked, this prompts on first run. A prompt on a headless server is a
    // process that never becomes ready and no message saying why.
    let _ = writeln!(w, "Enabled = False");
    let _ = writeln!(w, "PermissionAsked = True");

    let _ = writeln!(w);
    let _ = writeln!(w, "[Interface]");
    // Same reason: a confirmation dialog is unanswerable with no display, and
    // it would turn our SIGTERM shutdown into a hang.
    let _ = writeln!(w, "ConfirmStop = False");

    out
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;

    fn slot(raw: u8) -> PlayerSlot {
        PlayerSlot::new(raw).unwrap()
    }

    #[test]
    fn a_single_player_pad_renders_exactly_this() {
        // Golden. Dolphin answers an unbindable expression by binding nothing and
        // saying nothing, so "the file was written" and "the controller works"
        // are unrelated facts until the bytes are pinned.
        assert_eq!(
            gcpad_ini(SlotSet::EMPTY.with(slot(1))),
            "\
[GCPad1]
Device = Pipe/0/p1
Buttons/A = `Button A`
Buttons/B = `Button B`
Buttons/X = `Button X`
Buttons/Y = `Button Y`
Buttons/Z = `Button Z`
Buttons/Start = `Button START`
D-Pad/Up = `Button D_UP`
D-Pad/Down = `Button D_DOWN`
D-Pad/Left = `Button D_LEFT`
D-Pad/Right = `Button D_RIGHT`
Triggers/L = `Button L`
Triggers/R = `Button R`
Main Stick/Up = `Axis MAIN Y +`
Main Stick/Down = `Axis MAIN Y -`
Main Stick/Left = `Axis MAIN X -`
Main Stick/Right = `Axis MAIN X +`
Main Stick/Dead Zone = 0.0
C-Stick/Up = `Axis C Y +`
C-Stick/Down = `Axis C Y -`
C-Stick/Left = `Axis C X -`
C-Stick/Right = `Axis C X +`
C-Stick/Dead Zone = 0.0
Triggers/L-Analog = `Axis L +`
Triggers/R-Analog = `Axis R +`
Options/Always Connected = True

"
        );
    }

    #[test]
    fn the_ini_section_and_the_fifo_name_agree_for_every_port() {
        // The one invariant this module exists to hold: `[GCPadN]` must point at
        // the file the pipe layer will create for slot N.
        let ini = gcpad_ini(SlotSet::ALL);
        for raw in 1..=MAX_PLAYERS {
            let s = slot(raw);
            assert!(ini.contains(&format!("[GCPad{raw}]\nDevice = Pipe/0/p{raw}\n")));
            assert_eq!(pipe_file_name(s), format!("p{raw}"));
            assert_eq!(pipe_device(s), format!("Pipe/0/p{raw}"));
        }
    }

    #[test]
    fn only_the_configured_ports_appear() {
        let ini = gcpad_ini(SlotSet::EMPTY.with(slot(1)).with(slot(3)));
        assert!(ini.contains("[GCPad1]") && ini.contains("[GCPad3]"));
        // Negative twin: rendering the requested ports is worthless if it also
        // renders the others.
        assert!(!ini.contains("[GCPad2]") && !ini.contains("[GCPad4]"));
    }

    #[test]
    fn an_empty_session_renders_no_pads() {
        assert_eq!(gcpad_ini(SlotSet::EMPTY), "");
    }

    #[test]
    fn the_two_spellings_of_start_are_both_present_and_not_swapped() {
        let ini = gcpad_ini(SlotSet::EMPTY.with(slot(1)));
        assert!(ini.contains("Buttons/Start = `Button START`"));
        // Negative twin for the exact confusion this guards against.
        assert!(!ini.contains("Buttons/START"));
        assert!(!ini.contains("`Button Start`"));
    }

    #[test]
    fn si_devices_track_the_served_ports() {
        let ini = dolphin_ini(SlotSet::EMPTY.with(slot(1)).with(slot(4)));
        assert!(ini.contains("SIDevice0 = 6"), "{ini}");
        assert!(ini.contains("SIDevice1 = 0"), "{ini}");
        assert!(ini.contains("SIDevice2 = 0"), "{ini}");
        assert!(ini.contains("SIDevice3 = 6"), "{ini}");
    }

    #[test]
    fn every_port_is_declared_even_when_unserved() {
        // An omitted SIDevice key falls back to Dolphin's default, which is a
        // connected standard controller on port 1 — a phantom player.
        let ini = dolphin_ini(SlotSet::EMPTY);
        for port in 0..MAX_PLAYERS {
            assert!(ini.contains(&format!("SIDevice{port} = 0")), "{ini}");
        }
    }

    #[test]
    fn the_headless_hazards_are_all_disabled() {
        let ini = dolphin_ini(SlotSet::ALL);
        for key in [
            "Enabled = False",
            "PermissionAsked = True",
            "ConfirmStop = False",
        ] {
            assert!(ini.contains(key), "missing {key} in:\n{ini}");
        }
    }

    /// Sound is played through ALSA on a machine that has no sound card, and
    /// that is safe for exactly one reason: the configuration beside it has
    /// already redefined the default device as a pipe. The two belong together,
    /// so they are asserted together — asking for ALSA without the redirection
    /// is a headless Dolphin hunting for hardware that is not there.
    #[test]
    fn the_sound_goes_to_a_pipe_rather_than_a_sound_card() {
        let ini = dolphin_ini(SlotSet::ALL);
        assert!(ini.contains("Backend = ALSA"), "not ALSA in:\n{ini}");

        let rc = asoundrc(std::path::Path::new("/somewhere/audio.fifo"));
        assert!(
            rc.contains("pcm.!default"),
            "the default device is untouched"
        );
        assert!(rc.contains("type file"), "not the file plugin");
        assert!(
            rc.contains("/somewhere/audio.fifo"),
            "the pipe is not named in:\n{rc}"
        );
    }
}
