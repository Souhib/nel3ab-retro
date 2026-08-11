//! What libavcodec's queueing costs, measured rather than assumed.
//!
//! ADR **D7** traded direct control of submission timing for libavcodec's
//! encoder, on the grounds that the cost was *measurable* rather than unknown.
//! This is the measurement, and it is an example rather than a test because it
//! reports a number instead of asserting one — a latency threshold pinned in CI
//! would only be pinning this machine's mood.
//!
//! Run it where the GPU is:
//! ```text
//! sg render -c 'cargo run --release -p nel3ab-encoder \
//!     --features vaapi --example encode_latency'
//! ```
//!
//! It encodes surfaces nothing has written, so the byte counts are a floor and
//! mean nothing; what it measures is the round trip through libavcodec and the
//! video engine, and whether any frame is held back.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "an example is run by hand; a panic here is a legible failure"
)]

use std::time::Instant;

use nel3ab_encoder::av::Encoder;
use nel3ab_encoder::va::DEFAULT_RENDER_NODE;

/// Frames discarded before measuring, so clock ramp and the first IDR do not
/// colour the percentiles.
const WARMUP: u32 = 60;
/// Frames measured after the warm-up.
const MEASURED: u32 = 240;

fn main() {
    for (width, height) in [(640_u32, 480_u32), (1920, 1088)] {
        let mut encoder = Encoder::open(DEFAULT_RENDER_NODE, width, height, 26, 60, 3)
            .expect("a VAAPI encoder on the render node");

        let mut samples = Vec::with_capacity(MEASURED as usize);
        let mut held_back = 0_u32;
        for frame in 0..(WARMUP + MEASURED) {
            let slot = frame % encoder.slots();
            let started = Instant::now();
            let packet = encoder.encode(slot).expect("the encode succeeds");
            let elapsed = started.elapsed();
            if packet.is_none() {
                held_back += 1;
            }
            if frame >= WARMUP {
                samples.push(elapsed.as_secs_f64() * 1000.0);
            }
        }

        samples.sort_by(f64::total_cmp);
        #[allow(
            clippy::cast_precision_loss,
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "an index into 240 samples; no value here is near a float's limits"
        )]
        let at = |quantile: f64| samples[((samples.len() - 1) as f64 * quantile) as usize];

        println!(
            "{width}x{height}: n={} p50={:.2}ms p95={:.2}ms p99={:.2}ms max={:.2}ms \
             | frames held back: {held_back}",
            samples.len(),
            at(0.50),
            at(0.95),
            at(0.99),
            samples[samples.len() - 1],
        );
    }
}
