//! M2's definition of done: a real Dolphin, a real ROM, and H.264 out — with no
//! frame ever touching the CPU.
//!
//! # What only this test can cover
//!
//! Every stage is already proven on its own, and the unit tests go as far as a
//! synthetic dma-buf can. Two things they cannot reach:
//!
//! - **The emulator's own tiling.** The synthetic frame asks for LINEAR, because
//!   that is the one modifier guaranteed exportable. Dolphin's slots are
//!   AMD-tiled, and a tiling mistake produces a picture rather than an error.
//! - **The ring protocol under load.** Slots are lent, released and reused sixty
//!   times a second. A unit test holds one slot, once.
//!
//! # Running it
//!
//! ```text
//! cargo test -p nel3ab-encoder --features vaapi,dolphin-integration -- --nocapture
//! ```
//!
//! Requires a GPU, the NTSC ROM, and `nel3ab/dolphin:dev` carrying the frame
//! export patch. Behind a feature flag because a test that cannot run is worse
//! than no test: it would report a pass in CI, on a machine with neither.
#![cfg(all(feature = "vaapi", feature = "dolphin-integration"))]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "a panic IS the failure signal in a test"
)]

use std::path::PathBuf;
use std::time::{Duration, Instant};

use nel3ab_emulator::{DolphinConfig, Session, SlotSet, VideoBackend};
use nel3ab_encoder::av::Encoder;
use nel3ab_encoder::frame_source::FrameListener;
use nel3ab_encoder::va::DEFAULT_RENDER_NODE;
use nel3ab_encoder::vulkan::Context;
use nel3ab_encoder::vulkan::convert::{Converter, Ownership, Source};
use nel3ab_encoder::vulkan::image::{ImportedFrame, Nv12Target};

/// How many frames to take before concluding. Enough that the ring wraps many
/// times over — three slots means this reuses each roughly forty times.
///
/// Raise it with `NEL3AB_FRAMES` when the point is the CPU measurement rather
/// than the assertions; 120 frames is two seconds, which is short enough that
/// startup noise shows up in the average.
fn frames_to_take() -> usize {
    std::env::var("NEL3AB_FRAMES")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(120)
}

/// CPU seconds this process has burned, user plus system.
///
/// Read from `/proc/self/stat` rather than timed with a clock: the whole claim
/// of this milestone is that the CPU is *not* doing the work, and wall time
/// cannot tell "waiting on the GPU" from "busy". A thread blocked on a fence
/// consumes no CPU, which is exactly what should show up here.
fn cpu_seconds() -> f64 {
    let stat = std::fs::read_to_string("/proc/self/stat").expect("procfs is mounted");
    // Field 14 and 15, one-based, AFTER the comm field — which can itself
    // contain spaces and parentheses, so the split starts past the last ')'.
    let tail = &stat[stat.rfind(')').expect("comm is parenthesised") + 1..];
    let fields: Vec<&str> = tail.split_whitespace().collect();
    let ticks: f64 =
        fields[11].parse::<f64>().expect("utime") + fields[12].parse::<f64>().expect("stime");
    // sysconf(_SC_CLK_TCK) is 100 on every Linux this runs on, and reading it
    // properly would mean another dependency for one constant.
    ticks / 100.0
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("the repository root")
}

fn rom() -> PathBuf {
    std::env::var_os("HOME").map_or_else(
        || PathBuf::from("/roms/melee-ntsc.rvz"),
        |home| PathBuf::from(home).join("roms/gc/melee-ntsc.rvz"),
    )
}

#[test]
#[allow(
    clippy::too_many_lines,
    reason = "the point of this test is that the WHOLE chain runs in one place; \
              splitting it into helpers would hide the ordering that is the thing \
              under test — which slot is lent when, and when it is given back"
)]
fn dolphins_frames_arrive_on_the_gpu_and_leave_as_h264() {
    let session_dir = tempfile::tempdir().expect("a session directory");
    // Inside `user_dir`, which the launcher mounts at the same path on both
    // sides — so Dolphin reaches the socket by the name we bound it under.
    let socket = session_dir.path().join("frames.sock");

    let listener = FrameListener::bind(&socket).expect("the frame socket binds");

    let mut config = DolphinConfig::new(
        repo_root().join("docker/dolphin-in-docker.sh"),
        rom(),
        session_dir.path().to_path_buf(),
        SlotSet::EMPTY.with(nel3ab_protocol::PlayerSlot::new(1).expect("port 1 is valid")),
    );
    config.video_backend = VideoBackend::Vulkan;
    config.frame_socket = Some(socket);
    // A cold shader cache and a 1.1 GiB image are slow; the wait ends as soon as
    // the pipes open, so slack costs nothing on a warm start.
    config.startup_timeout = Duration::from_mins(2);

    let session = Session::start(&config).expect("Dolphin starts");

    // The ring arrives once, at startup. A generous timeout for the same reason
    // as above — and a failure here means the patch is not in the image, which
    // is worth saying rather than timing out anonymously.
    let mut frames = listener
        .accept(Duration::from_mins(2))
        .expect("the emulator connects to the frame socket and announces its ring");

    let descriptor = *frames.descriptor();
    println!(
        "ring: {} slots, {}x{}, modifier {:#018x}, pitch {}",
        frames.slot_count(),
        descriptor.width,
        descriptor.height,
        descriptor.modifier,
        descriptor.pitch
    );
    // The emulator's slots must be AMD-tiled, which is the thing no synthetic
    // dma-buf in the unit tests could produce. Asserting it here is what makes
    // this run cover more than they do.
    assert_eq!(
        descriptor.modifier >> 56,
        0x02,
        "expected an AMD modifier from the emulator, got {:#018x}",
        descriptor.modifier
    );

    let context = Context::open(DEFAULT_RENDER_NODE).expect("a Vulkan device");
    let mut encoder = Encoder::open(
        DEFAULT_RENDER_NODE,
        descriptor.width,
        descriptor.height,
        26,
        60,
        3,
    )
    .expect("an encoder at the emulator's resolution");

    // Import both rings ONCE. Re-importing per frame would work and would also
    // hide the cost this architecture exists to avoid; the slots are stable for
    // the life of the session, so this is what the worker will do.
    let sources: Vec<ImportedFrame<'_>> = (0..frames.slot_count())
        .map(|index| {
            let buffer = frames.slot(index).expect("every slot has a descriptor");
            ImportedFrame::import(&context, &descriptor, buffer)
                .expect("the emulator's slot imports")
        })
        .collect();
    let targets: Vec<Nv12Target<'_>> = (0..encoder.slots())
        .map(|slot| {
            let surface = encoder.export(slot).expect("the pool slot exports");
            Nv12Target::import(&context, &surface).expect("the encode surface imports")
        })
        .collect();
    // The tiling, checked against the emulator's own word for it. A packet size
    // cannot do this: a frame imported with the wrong layout is *scrambled*, and
    // scrambled data codes LARGER, not smaller. Only comparing what Vulkan says
    // the image is against what the producer said it is catches it.
    for (index, source) in sources.iter().enumerate() {
        assert_eq!(
            source
                .plane()
                .modifier()
                .expect("the image reports its tiling"),
            descriptor.modifier,
            "slot {index} imported with a different tiling from the one announced"
        );
    }

    let converter = Converter::new(&context).expect("the compute pipeline builds");
    let stream_path = std::env::temp_dir().join("nel3ab-dolphin-chain.h264");
    let mut stream = std::fs::File::create(&stream_path).expect("a file for the stream");

    let mut coded_total = 0_usize;
    let mut first_packet = 0_usize;
    let mut largest = (0_usize, 0_usize);
    let mut first_number = 0_u64;
    let mut last_number = 0_u64;
    // Named `wanted` rather than `frames`, which is already the FrameSource.
    let wanted = frames_to_take();
    let started = Instant::now();

    let cpu_before = cpu_seconds();

    for taken in 0..wanted {
        let frame = frames
            .next_frame()
            .expect("the emulator keeps producing frames");
        let slot = frame.slot() as usize;
        last_number = frame.frame_number();
        if taken == 0 {
            first_number = last_number;
        }

        let plane = sources[slot].plane();
        let target = &targets[taken % targets.len()];
        converter
            .convert(
                Source {
                    image: plane.image(),
                    view: plane.view(),
                    width: descriptor.width,
                    height: descriptor.height,
                    // Dolphin released it to the foreign queue family; we take
                    // it, use it, and give it back.
                    ownership: Ownership::Foreign,
                },
                target,
            )
            .expect("the conversion runs");

        // Dropping the lent frame here releases the slot back to Dolphin. The
        // conversion has already been waited on, so the release cannot let the
        // emulator overwrite pixels the shader has not read.
        drop(frame);

        #[allow(
            clippy::cast_possible_truncation,
            reason = "targets.len() is 3; the cast is exact"
        )]
        let packet = encoder
            .encode((taken % targets.len()) as u32)
            .expect("the encode succeeds")
            .expect("async_depth=1 returns a packet per frame");
        let coded = packet.len();
        std::io::Write::write_all(&mut stream, packet).expect("the stream is written");
        coded_total += coded;
        if taken == 0 {
            first_packet = coded;
        }
        if coded > largest.0 {
            largest = (coded, taken);
        }
    }

    let elapsed = started.elapsed();
    let produced = last_number - first_number + 1;
    let cpu = cpu_seconds() - cpu_before;
    #[allow(
        clippy::cast_precision_loss,
        reason = "a frame count in the thousands is exact in f64 by a wide margin"
    )]
    let counted = wanted as f64;
    let (largest_bytes, largest_at) = largest;
    println!(
        "{wanted} frames in {elapsed:?} ({fps:.1} fps of pipeline), \
         emulator produced {produced} over the same span, \
         {coded_total} bytes coded, first packet {first_packet}, \
         largest {largest_bytes} at frame {largest_at}",
        fps = counted / elapsed.as_secs_f64(),
    );
    println!(
        "worker CPU: {cpu:.3} s over {elapsed:?} = {cores:.3} of a core \
         ({per_frame:.3} ms per frame). The PNG readback this replaces cost 0.57.",
        cores = cpu / elapsed.as_secs_f64(),
        per_frame = cpu * 1000.0 / counted,
    );

    // The LARGEST packet, and it took two wrong tries to land on that.
    //
    // First attempt asserted a floor on the *smallest* packet: 35 bytes, failed.
    // Correctly — Melee sits on a static modal, and a P-frame of an unchanged
    // picture is supposed to be almost nothing. That measured the screen's
    // compressibility, not the pipeline.
    //
    // Second attempt moved to the first packet, the IDR: 322 bytes, failed
    // again. Also correctly — Dolphin's first frames are BLACK, because the
    // console is still booting, and a black IDR is genuinely tiny.
    //
    // So neither a floor per frame nor a floor on the IDR says anything here.
    // What does: somewhere in this run a real picture reached the encoder. The
    // per-frame guarantee is not this assertion's job — it belongs to the
    // modifier check above and to the pixel tests in the crate.
    assert!(
        largest_bytes > 5_000,
        "the largest of {wanted} packets was {largest_bytes} bytes; no picture ever \
         reached the encoder"
    );

    // Frame numbers are the ring protocol's own account of itself. Dolphin
    // increments on every rendered frame and skips the ones it had to drop, so
    // a run that kept up shows no more produced than taken plus the ring depth.
    assert!(
        produced >= wanted as u64,
        "the emulator numbered {produced} frames for {wanted} taken"
    );

    // And it decodes. Everything above is this side's own account of itself;
    // ffmpeg is a party with no stake in it. The plan for this milestone said
    // "look at the decoded result", and this is the machine-checkable half of
    // that — the file is left behind so the other half can be done by eye.
    drop(stream);
    let probe = std::process::Command::new("ffprobe")
        .args(["-v", "error", "-select_streams", "v:0", "-show_entries"])
        .args([
            "frame=width,height,pix_fmt",
            "-of",
            "csv=p=0",
            "-read_intervals",
        ])
        .arg("%+#1")
        .arg(&stream_path)
        .output()
        .expect("ffprobe runs");
    let report = String::from_utf8_lossy(&probe.stdout);
    println!("ffprobe on {}: {}", stream_path.display(), report.trim());
    assert!(
        report.contains(&format!("{},{}", descriptor.width, descriptor.height)),
        "ffprobe did not see a {}x{} frame; it said {report:?}",
        descriptor.width,
        descriptor.height
    );
    assert!(
        report.contains("yuv420p"),
        "the stream is not 4:2:0; ffprobe said {report:?}"
    );

    session.shutdown().expect("Dolphin stops");
}
