//! M1's definition of done: a real Dolphin, a real ROM, and an assertion that
//! the GAME reacted — not that no error was returned.
//!
//! # The observable, and why it has its own control
//!
//! Melee boots, finds no memory card, and stops on a modal asking "Create Game
//! Data?". It then does nothing whatsoever: measured at 7037 byte-identical
//! frames over roughly two minutes on lgf, 2026-08-10. The game is blocked on
//! input.
//!
//! So the test does not merely assert "the screen changed after we pressed A".
//! It first asserts, in the same run, that the screen does **not** change on its
//! own across hundreds of frames. Without that control the assertion would pass
//! just as happily against an attract-mode animation, an intro movie, or a
//! flashing cursor — which is to say it would prove nothing about our input.
//!
//! # Running it
//!
//! ```text
//! cargo test -p nel3ab-emulator --features dolphin-integration -- --nocapture
//! ```
//!
//! Requires a GPU, `nel3ab/dolphin:dev` (see `docker/Dockerfile.dolphin`) and
//! the NTSC ROM. It is behind a feature flag because a test that cannot run is
//! worse than no test: it would report a pass in CI, on a machine with neither.
#![cfg(feature = "dolphin-integration")]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "a panic IS the failure signal in a test"
)]

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use nel3ab_emulator::{ConfigOverride, Delivery, DolphinConfig, Session, SlotSet, VideoBackend};
use nel3ab_protocol::{Buttons, InputFrame, PlayerSlot};

/// A frame this far behind the newest one is closed and flushed.
///
/// Hashing the newest file reads it while Dolphin is still writing it. A torn
/// PNG differs from its predecessor and is indistinguishable from the screen
/// changing — it produced a false "the screen changed by itself" the first time
/// this was attempted by hand. The `IEND` check below is the second guard.
const READ_LAG_FRAMES: u32 = 8;

/// Every complete PNG ends with this chunk.
const PNG_IEND: &[u8] = &[0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

/// How long the screen must hold still before it counts as "the game is waiting".
const SETTLE_FOR: Duration = Duration::from_secs(6);

fn env_path(key: &str, default: impl Into<PathBuf>) -> PathBuf {
    std::env::var_os(key).map_or_else(|| default.into(), PathBuf::from)
}

fn repo_root() -> PathBuf {
    // CARGO_MANIFEST_DIR is <repo>/core/crates/emulator.
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("the manifest is three levels below the repository root")
        .to_path_buf()
}

/// Reads the newest frame that is definitely finished being written.
fn settled_frame(frames_dir: &Path) -> Option<(u32, Vec<u8>)> {
    let newest = std::fs::read_dir(frames_dir)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            entry
                .file_name()
                .to_str()?
                .strip_prefix("framedump_")?
                .strip_suffix(".png")?
                .parse::<u32>()
                .ok()
        })
        .max()?;

    let target = newest.checked_sub(READ_LAG_FRAMES)?;
    if target == 0 {
        return None;
    }
    let bytes = std::fs::read(frames_dir.join(format!("framedump_{target}.png"))).ok()?;
    bytes.ends_with(PNG_IEND).then_some((target, bytes))
}

/// Waits until the same frame content repeats for [`SETTLE_FOR`].
fn wait_until_static(frames_dir: &Path, timeout: Duration) -> (u32, Vec<u8>) {
    let deadline = Instant::now() + timeout;
    let mut stable: Option<(u32, Vec<u8>)> = None;
    let mut since = Instant::now();

    while Instant::now() < deadline {
        if let Some((index, bytes)) = settled_frame(frames_dir) {
            match &stable {
                Some((_, previous)) if *previous == bytes => {
                    if since.elapsed() > SETTLE_FOR {
                        return (index, bytes);
                    }
                }
                _ => {
                    stable = Some((index, bytes));
                    since = Instant::now();
                }
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    panic!("the picture never settled: Dolphin may not be dumping frames at all");
}

/// Boots Melee headless with frame dumping, and returns the live session plus
/// its frame directory.
///
/// `tag` keeps two concurrently-running tests from sharing a user directory,
/// which would also mean sharing a memory card — and the whole observable rests
/// on there NOT being one.
fn boot_melee(tag: &str) -> (Session, PathBuf, PathBuf, PlayerSlot) {
    let rom = env_path(
        "NEL3AB_ROM",
        std::env::var("HOME").map_or_else(
            |_| PathBuf::from("/roms/melee-ntsc.rvz"),
            |home| PathBuf::from(home).join("roms/gc/melee-ntsc.rvz"),
        ),
    );
    assert!(
        rom.is_file(),
        "ROM not found at {}; set NEL3AB_ROM",
        rom.display()
    );

    let binary = env_path(
        "NEL3AB_DOLPHIN_BIN",
        repo_root().join("docker/dolphin-in-docker.sh"),
    );
    assert!(
        binary.is_file(),
        "emulator launcher not found at {}",
        binary.display()
    );

    // A fresh user directory every run. It is what makes the observable
    // reproducible: no memory card means the "Create Game Data?" modal, every
    // time, on the same boot path.
    let session_dir = std::env::temp_dir().join(format!("nel3ab-it-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&session_dir);
    std::fs::create_dir_all(&session_dir).unwrap();

    // Nothing to export: the launcher reads `--user` and `--exec` out of the
    // arguments the crate builds and bind-mounts those at their own host paths.
    // `std::env::set_var` is `unsafe` in edition 2024 and forbidden here, which
    // is a good prompt not to have hidden coupling in the first place.

    let slot = PlayerSlot::new(1).unwrap();
    let mut config =
        DolphinConfig::new(binary, rom, session_dir.clone(), SlotSet::EMPTY.with(slot));
    config.video_backend = VideoBackend::Vulkan;
    // A cold shader cache plus a 1.1 GiB image is slow; the attach loop returns
    // the moment the pipes open, so a generous bound costs nothing.
    config.startup_timeout = Duration::from_mins(2);
    config.overrides = vec![
        // The master switch lives under Main/"Dolphin", NOT under Graphics —
        // an override on the wrong system is dropped without a word.
        ConfigOverride::new("Dolphin", "Movie", "DumpFrames", "True").unwrap(),
        // PNG per frame rather than an AVI: a video would have to be decoded
        // before it could be compared, and a partially muxed one cannot be
        // compared at all.
        ConfigOverride::new("Graphics", "Settings", "DumpFramesAsImages", "True").unwrap(),
        // 1x internal resolution: ~40 KiB a frame instead of megabytes, and the
        // test compares whole files.
        ConfigOverride::new("Graphics", "Settings", "InternalResolution", "1").unwrap(),
    ];

    let mut session = Session::start(&config).expect("Dolphin should start and open the pipes");
    let frames_dir = session_dir.join("Dump/Frames");

    // Dolphin's initial pad state is only accidentally neutral, so state the
    // whole thing before relying on any of it.
    assert_eq!(
        session.send(&InputFrame::neutral(slot)).unwrap(),
        Delivery::Written
    );
    (session, session_dir, frames_dir, slot)
}

#[test]
fn a_pipe_write_changes_what_the_emulated_game_does() {
    let (mut session, session_dir, frames_dir, slot) = boot_melee("press");

    // 1. Wait for the game to block on the modal.
    let (baseline_index, baseline) = wait_until_static(&frames_dir, Duration::from_mins(3));
    println!(
        "BASELINE: frame {baseline_index} static, {} bytes",
        baseline.len()
    );

    // 2. THE CONTROL. If the screen moves on its own, the experiment is void and
    //    step 4 would prove nothing.
    let mut samples = 0_u32;
    let mut last_index = baseline_index;
    for _ in 0..40 {
        std::thread::sleep(Duration::from_millis(200));
        if let Some((index, bytes)) = settled_frame(&frames_dir) {
            samples += 1;
            last_index = index;
            assert_eq!(
                bytes, baseline,
                "the screen changed by itself at frame {index}: this game state is not \
                 input-gated, so the assertion below would prove nothing"
            );
        }
    }
    assert!(samples > 20, "only {samples} frames could be read");
    assert!(
        last_index > baseline_index,
        "the frame counter never advanced ({baseline_index} -> {last_index}); \
         emulation is stalled rather than waiting for input"
    );
    println!("CONTROL: {samples} samples, frames {baseline_index}->{last_index}, all identical");

    // 3. The intervention: one button, through the whole real path.
    let pressed = InputFrame {
        buttons: Buttons::A,
        ..InputFrame::neutral(slot)
    };
    assert_eq!(session.send(&pressed).unwrap(), Delivery::Written);
    std::thread::sleep(Duration::from_millis(150));
    assert_eq!(
        session.send(&InputFrame::neutral(slot)).unwrap(),
        Delivery::Written
    );

    // 4. The game must react.
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut reacted = None;
    while Instant::now() < deadline {
        if let Some((index, bytes)) = settled_frame(&frames_dir)
            && bytes != baseline
        {
            reacted = Some(index);
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    let status = session.shutdown().expect("Dolphin should stop cleanly");

    let reacted = reacted.expect(
        "the screen never changed after A: the pipe accepted the write but the emulated \
         controller never saw it",
    );
    println!(
        "PASS: reacted at frame {reacted}, {} frames after the last identical one; \
         Dolphin exited with {status}",
        reacted - last_index
    );

    let _ = std::fs::remove_dir_all(&session_dir);
}

/// The negative twin of the test above, and much cheaper to run.
///
/// "The game reacted when we pressed A" is only evidence about our pipe if a
/// session that presses nothing leaves the game where it was. This pins the
/// other half: the same session, same duration, no input, no change.
#[test]
fn a_session_that_sends_nothing_leaves_the_game_where_it_was() {
    // The pipe is opened and the neutral state sent, exactly as in the test
    // above — and then nothing else is. That is the whole point: the only
    // difference between the two runs is the button.
    let (session, session_dir, frames_dir, _slot) = boot_melee("quiet");

    let (index, baseline) = wait_until_static(&frames_dir, Duration::from_mins(3));

    // Hold still for as long as the other test takes to press its button, and
    // then some.
    let deadline = Instant::now() + Duration::from_secs(15);
    let mut last = index;
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(200));
        if let Some((i, bytes)) = settled_frame(&frames_dir) {
            last = i;
            assert_eq!(
                bytes, baseline,
                "the screen changed at frame {i} with no input sent"
            );
        }
    }
    assert!(last > index, "emulation stalled instead of idling");

    session.shutdown().expect("Dolphin should stop cleanly");
    println!("PASS: frames {index}->{last} unchanged with no input");
    let _ = std::fs::remove_dir_all(&session_dir);
}
