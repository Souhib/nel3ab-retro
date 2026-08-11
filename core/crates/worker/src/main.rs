//! The session worker binary.
//!
//! # Architectural rule (mirrors "NO logic in routes")
//!
//! **This binary contains orchestration ONLY.** Every behaviour lives in a
//! library crate, so it can be tested without spawning a process, a GPU or a
//! network. If a function here does more than wire two crates together, it
//! belongs in a crate instead.
//!
//! What it wires, as of M3:
//!
//! ```text
//! emulator ──frame──▶ encoder::vulkan ──NV12──▶ encoder::av ──H.264──▶ transport ──▶ browser
//!    ▲                                                                                  │
//!    └────────────────────────── InputFrame ────────────────────────────────────────────┘
//! ```

#![forbid(unsafe_code)]

use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result, bail};
use nel3ab_emulator::{DolphinConfig, Session, SlotSet, VideoBackend};
use nel3ab_encoder::av::Encoder;
use nel3ab_encoder::frame_source::FrameListener;
use nel3ab_encoder::va::DEFAULT_RENDER_NODE;
use nel3ab_encoder::vulkan::Context;
use nel3ab_encoder::vulkan::convert::{Converter, Ownership, Source};
use nel3ab_encoder::vulkan::image::{ImportedFrame, Nv12Target};
use nel3ab_protocol::PlayerSlot;
use nel3ab_transport::{BrowserServer, Packet};
use tracing_subscriber::EnvFilter;

/// The page served at `/`. Compiled in rather than read at run time: a worker
/// that could not find its own UI at start-up is a worker that fails in a way
/// nobody sees until a player opens a tab.
const PAGE: &str = include_str!("play.html");

/// Constant quantiser. Fixed for now — rate control is a later decision, and one
/// that wants a real network to react to before it is written.
const QP: u32 = 26;

fn main() -> Result<()> {
    init_tracing();
    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        "nel3ab worker starting"
    );

    let settings = Settings::from_environment()?;
    run(&settings)
}

/// Everything the worker needs, and where each piece comes from.
struct Settings {
    rom: PathBuf,
    dolphin: PathBuf,
    session_dir: PathBuf,
    bind: SocketAddr,
    render_node: PathBuf,
}

impl Settings {
    /// Read from the environment, with the values lgf actually uses as
    /// defaults. A config file belongs with the control plane in M4; inventing
    /// one now would be a format to migrate later for no gain today.
    fn from_environment() -> Result<Self> {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_owned());
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
        Ok(Self {
            rom: env_path("NEL3AB_ROM")
                .unwrap_or_else(|| PathBuf::from(&home).join("roms/gc/melee-ntsc.rvz")),
            dolphin: env_path("NEL3AB_DOLPHIN")
                .unwrap_or_else(|| repo.join("docker/dolphin-in-docker.sh")),
            session_dir: env_path("NEL3AB_SESSION_DIR")
                .unwrap_or_else(|| PathBuf::from("/tmp/nel3ab-session")),
            bind: std::env::var("NEL3AB_BIND")
                .unwrap_or_else(|_| "0.0.0.0:8100".to_owned())
                .parse()
                .context("NEL3AB_BIND is not a socket address")?,
            render_node: env_path("NEL3AB_RENDER_NODE")
                .unwrap_or_else(|| PathBuf::from(DEFAULT_RENDER_NODE)),
        })
    }
}

fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name).map(PathBuf::from)
}

/// Wires the four crates together and runs until the emulator stops.
#[allow(
    clippy::too_many_lines,
    reason = "this IS the wiring, and the ORDER is the content: the ring must be \
              imported before the first frame is taken, and the frame released \
              only after the conversion has been waited on. Splitting it into \
              helpers would hide the one thing worth reading."
)]
fn run(settings: &Settings) -> Result<()> {
    std::fs::create_dir_all(&settings.session_dir)
        .with_context(|| format!("creating {}", settings.session_dir.display()))?;
    let socket = settings.session_dir.join("frames.sock");
    // A stale socket from a previous run would make `bind` fail with EADDRINUSE
    // on a path nothing is listening on, which reads as a mystery.
    let _ = std::fs::remove_file(&socket);

    let server = BrowserServer::start(settings.bind, PAGE)?;
    tracing::info!(address = %server.address(), "open this in a browser");

    let listener = FrameListener::bind(&socket)?;

    let slot = PlayerSlot::new(1).map_err(|error| anyhow::anyhow!("{error}"))?;
    let mut config = DolphinConfig::new(
        settings.dolphin.clone(),
        settings.rom.clone(),
        settings.session_dir.clone(),
        SlotSet::EMPTY.with(slot),
    );
    config.video_backend = VideoBackend::Vulkan;
    config.frame_socket = Some(socket);
    config.startup_timeout = Duration::from_mins(2);

    let mut session = Session::start(&config)?;
    let mut frames = listener.accept(Duration::from_mins(2))?;
    let descriptor = *frames.descriptor();
    tracing::info!(
        slots = frames.slot_count(),
        width = descriptor.width,
        height = descriptor.height,
        modifier = format!("{:#018x}", descriptor.modifier),
        "the emulator announced its frame ring"
    );

    let context = Context::open(&settings.render_node)?;
    let mut encoder = Encoder::open(
        &settings.render_node,
        descriptor.width,
        descriptor.height,
        QP,
        60,
        3,
    )?;

    // Both rings are imported ONCE. The slots are stable for the life of the
    // session, and re-importing per frame would reintroduce the per-frame cost
    // this whole architecture exists to remove.
    let mut sources = Vec::with_capacity(frames.slot_count());
    for index in 0..frames.slot_count() {
        let Some(buffer) = frames.slot(index) else {
            bail!("the ring announced slot {index} without a descriptor");
        };
        sources.push(ImportedFrame::import(&context, &descriptor, buffer)?);
    }
    let mut targets = Vec::with_capacity(encoder.slots() as usize);
    for index in 0..encoder.slots() {
        let surface = encoder.export(index)?;
        targets.push(Nv12Target::import(&context, &surface)?);
    }
    let converter = Converter::new(&context)?;

    let started = Instant::now();
    let mut produced = 0_u64;
    let mut reported = Instant::now();

    loop {
        // Input first. A pad frame that arrived while the last picture was
        // encoding should reach the emulator before it renders the next one —
        // half a frame of latency, free, for putting this line above the wait.
        for frame in server.drain_input() {
            if let Err(error) = session.send(&frame) {
                tracing::warn!(%error, "an input frame could not be delivered");
            }
        }

        let frame = match frames.next_frame() {
            Ok(frame) => frame,
            Err(error) => {
                tracing::info!(%error, "the emulator stopped producing frames");
                break;
            }
        };
        let Some(source) = sources.get(frame.slot() as usize) else {
            bail!(
                "the emulator announced slot {} outside its own ring",
                frame.slot()
            );
        };

        // The modulo first, so the value cast is always small:
        // grows without bound over a long session and the pool has three slots.
        let index = usize::try_from(produced % targets.len() as u64).unwrap_or(0);
        let Some(target) = targets.get(index) else {
            bail!("the encode pool shrank underneath us");
        };
        let plane = source.plane();
        converter.convert(
            Source {
                image: plane.image(),
                view: plane.view(),
                width: descriptor.width,
                height: descriptor.height,
                ownership: Ownership::Foreign,
            },
            target,
        )?;
        // Released only now: the conversion has been waited on, so the emulator
        // cannot overwrite pixels the shader has not read.
        drop(frame);

        let captured = started.elapsed();
        let slot_index = u32::try_from(index).unwrap_or(0);
        if let Some(coded) = encoder.encode(slot_index)? {
            // The return value says whether a watcher was behind. Counted by
            // the server itself and reported below, so it is deliberately
            // discarded here rather than branched on.
            let _delivered = server.send(Packet {
                captured_micros: u64::try_from(captured.as_micros()).unwrap_or(u64::MAX),
                annex_b: coded.to_vec(),
            });
        }
        produced += 1;

        if reported.elapsed() >= Duration::from_secs(10) {
            tracing::info!(produced, dropped = server.dropped(), "streaming");
            reported = Instant::now();
        }
    }

    session.shutdown()?;
    Ok(())
}

/// Structured JSON logs, level driven by `RUST_LOG`.
///
/// JSON because these lines are consumed by a log store, not read by a human on
/// a terminal — the same reason the Python side sets `serialize=True` outside dev.
fn init_tracing() {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
}
