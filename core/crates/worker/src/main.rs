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
use std::sync::{Arc, Mutex};
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

    let server = Arc::new(BrowserServer::start(settings.bind, PAGE)?);
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
    // Dolphin compiles a specialised shader the first time it meets a new
    // material, and stops the world while it does. Measured on this machine:
    // the pipeline waited 1.4 s, 1.7 s, 2.5 s and 2.7 s for a frame in separate
    // ten-second windows, with nothing dropped anywhere else — the emulator
    // itself was the stall, and it matches the 2.2 s gap a browser reported.
    //
    // Asynchronous ubershaders draw with a general-purpose shader while the
    // specialised one compiles in the background. It costs some fidelity for the
    // frames in between and a little GPU; it buys a stream that does not freeze
    // for two seconds, which is not a trade worth thinking about for a game.
    for (section, key, value) in [
        ("Settings", "ShaderCompilationMode", "2"),
        // And do not stall at boot waiting for the whole cache either.
        ("Settings", "WaitForShadersBeforeStarting", "False"),
    ] {
        match nel3ab_emulator::ConfigOverride::new("Graphics", section, key, value) {
            Ok(over) => config.overrides.push(over),
            Err(error) => tracing::warn!(%error, key, "a graphics override was refused"),
        }
    }
    config.frame_socket = Some(socket);
    config.startup_timeout = Duration::from_mins(2);

    let session = Session::start(&config)?;
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

    // Input runs on its own thread, writing the moment a frame lands rather than
    // once per picture. Measured before: a full frame period of avoidable lag,
    // p50 15.55 ms, because a write locked to the frame notification always
    // landed just after the emulator polled its pipe.
    let pad = session.pad_writer();
    let applied = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let last_input = Arc::new(Mutex::new(None::<Instant>));
    let input_thread = {
        let applied = Arc::clone(&applied);
        let last_input = Arc::clone(&last_input);
        let server = Arc::clone(&server);
        std::thread::Builder::new()
            .name("pad".to_owned())
            .spawn(move || {
                loop {
                    // A deadline rather than a wait forever, so this notices the
                    // session ending instead of outliving it.
                    let frames = server.wait_input(Duration::from_millis(250));
                    if frames.is_empty() {
                        if Arc::strong_count(&server) == 1 {
                            break;
                        }
                        continue;
                    }
                    for frame in &frames {
                        if let Err(error) = pad.send(frame) {
                            tracing::warn!(%error, "an input frame could not be delivered");
                        }
                    }
                    applied.fetch_add(
                        u64::try_from(frames.len()).unwrap_or(0),
                        std::sync::atomic::Ordering::Relaxed,
                    );
                    if let Ok(mut at) = last_input.lock() {
                        *at = Some(Instant::now());
                    }
                }
            })
            .context("starting the pad thread")?
    };

    let started = Instant::now();
    let mut produced = 0_u64;
    let mut reported = Instant::now();
    // When a pad state was last handed to the emulator, so the wait until the
    // next picture can be measured. This is the plumbing's share of input
    // latency and nothing more: the game's own logic adds frames on top, and
    // that part is the game's to spend.
    let mut input_to_frame: Vec<f64> = Vec::new();
    // Where the time goes, per window. A stutter has to be attributable before
    // it can be fixed, and "the pipeline slowed down" names nothing.
    let mut worst = Worst::default();

    loop {
        // Input first. A pad frame that arrived while the last picture was
        // encoding should reach the emulator before it renders the next one —
        // half a frame of latency, free, for putting this line above the wait.
        //
        // The transport hands back at most one state per port, because a pad is
        // a level and only the newest can ever be applied. The coalescing used
        // to live here over a 64-deep queue; it belongs where the states are
        // written, which is also where a queue could overflow and did.
        let iteration = Instant::now();
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
        // The first frame after an input: how long the plumbing made it wait.
        if let Ok(mut slot) = last_input.lock()
            && let Some(at) = slot.take()
        {
            input_to_frame.push(at.elapsed().as_secs_f64() * 1000.0);
        }
        let waited = iteration.elapsed();
        let shading = Instant::now();
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
        let shader_took = shading.elapsed();
        // Released only now: the conversion has been waited on, so the emulator
        // cannot overwrite pixels the shader has not read.
        drop(frame);
        // Somebody just opened the page. Without this they see nothing until the
        // next scheduled IDR — up to a second with a one-second GOP.
        if server.take_joined() {
            encoder.force_key_frame();
        }
        let encoding = Instant::now();

        let captured = started.elapsed();
        let slot_index = u32::try_from(index).unwrap_or(0);
        if let Some(coded) = encoder.encode(slot_index)? {
            // The return value says whether a watcher was behind. Counted by
            // the server itself and reported below, so it is deliberately
            // discarded here rather than branched on.
            let _delivered = server.send(&Packet {
                captured_micros: u64::try_from(captured.as_micros()).unwrap_or(u64::MAX),
                annex_b: coded.to_vec(),
            });
        }
        produced += 1;
        worst.observe(waited, shader_took, encoding.elapsed());

        if reported.elapsed() >= Duration::from_secs(10) {
            tracing::info!(
                produced,
                dropped = server.dropped(),
                inputs_received = server.inputs_received(),
                inputs_applied = applied.load(std::sync::atomic::Ordering::Relaxed),
                slowest_ms = worst.total_ms(),
                slowest_waiting_ms = worst.waited_ms(),
                slowest_converting_ms = worst.converted_ms(),
                slowest_encoding_ms = worst.encoded_ms(),
                input_to_frame_p50_ms = percentile(&mut input_to_frame, 0.50),
                input_to_frame_p95_ms = percentile(&mut input_to_frame, 0.95),
                "streaming"
            );
            reported = Instant::now();
            worst = Worst::default();
            input_to_frame.clear();
        }
    }

    // Dropping our handle lets the pad thread see it is alone and stand down.
    drop(server);
    let _ = input_thread.join();
    session.shutdown()?;
    Ok(())
}

/// A percentile of a sample set, in the units the samples carry.
///
/// Sorts in place: the caller clears the set each window and has no use for the
/// order it collected them in. Zero for an empty set, which reads as "nobody
/// pressed anything" rather than as a suspiciously good number.
fn percentile(samples: &mut [f64], quantile: f64) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    samples.sort_by(f64::total_cmp);
    #[allow(
        clippy::cast_precision_loss,
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "an index into a few hundred samples; nothing here is near a limit"
    )]
    let index = ((samples.len() - 1) as f64 * quantile) as usize;
    samples[index]
}

/// The slowest iteration of a reporting window, and where its time went.
///
/// The whole iteration rather than a per-stage maximum: three stages each
/// peaking in different frames would report three alarming numbers and describe
/// no single slow frame. What a player feels is one frame taking too long.
#[derive(Default)]
struct Worst {
    total: Duration,
    waited: Duration,
    converted: Duration,
    encoded: Duration,
}

impl Worst {
    fn observe(&mut self, waited: Duration, converted: Duration, encoded: Duration) {
        let total = waited + converted + encoded;
        if total > self.total {
            *self = Self {
                total,
                waited,
                converted,
                encoded,
            };
        }
    }

    fn total_ms(&self) -> f64 {
        self.total.as_secs_f64() * 1000.0
    }
    fn waited_ms(&self) -> f64 {
        self.waited.as_secs_f64() * 1000.0
    }
    fn converted_ms(&self) -> f64 {
        self.converted.as_secs_f64() * 1000.0
    }
    fn encoded_ms(&self) -> f64 {
        self.encoded.as_secs_f64() * 1000.0
    }
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
