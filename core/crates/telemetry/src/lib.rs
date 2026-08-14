//! What the pipeline measures about itself.
//!
//! This exists because the worker used to report **maxima** — "the slowest frame
//! in the last ten seconds was 19 ms" — and a maximum is not a statistic anybody
//! can act on. It moves with the length of the run, it says nothing about the
//! shape of the distribution, and two of them cannot be compared to decide
//! whether a change helped. A benchmark needs percentiles and the number of
//! samples they were drawn from; so does anyone reading a log at three in the
//! morning.
#![forbid(unsafe_code)]

use std::time::Duration;

/// A window of durations, kept so their distribution can be reported.
///
/// Bounded on purpose: a session runs for hours, and an unbounded vector of
/// per-frame samples is a leak with a graph attached. The window is the
/// reporting period — samples are drained when they are reported — and the cap
/// is the safety net if nobody ever reports.
#[derive(Debug)]
pub struct Timings {
    samples: Vec<f64>,
    cap: usize,
    /// Samples dropped because the cap was reached, so a truncated window says
    /// so instead of quietly reporting the first N.
    dropped: u64,
}

impl Timings {
    /// A window holding at most `cap` samples.
    #[must_use]
    pub fn new(cap: usize) -> Self {
        Self {
            samples: Vec::with_capacity(cap.min(4096)),
            cap,
            dropped: 0,
        }
    }

    /// Records one duration, in milliseconds.
    pub fn observe(&mut self, value: Duration) {
        self.record(value.as_secs_f64() * 1000.0);
    }

    /// Records one plain number, for the windows that are not durations: bytes
    /// per frame reads exactly like milliseconds per frame once the unit is
    /// stated by the caller.
    pub fn record(&mut self, value: f64) {
        if self.samples.len() >= self.cap {
            self.dropped += 1;
            return;
        }
        self.samples.push(value);
    }

    /// How many observations this window holds.
    #[must_use]
    pub const fn len(&self) -> usize {
        self.samples.len()
    }

    /// Whether nothing has been observed yet.
    #[must_use]
    pub const fn is_empty(&self) -> bool {
        self.samples.is_empty()
    }

    /// How many observations were refused because the window was full.
    #[must_use]
    pub const fn dropped(&self) -> u64 {
        self.dropped
    }

    /// The distribution, sorted in place. Empty windows report zeros, and the
    /// caller can tell that case apart by [`len`](Self::len).
    #[must_use]
    pub fn summary(&mut self) -> Summary {
        self.samples.sort_by(f64::total_cmp);
        Summary {
            samples: self.samples.len(),
            p50: self.quantile(0.50),
            p95: self.quantile(0.95),
            p99: self.quantile(0.99),
            max: self.samples.last().copied().unwrap_or(0.0),
        }
    }

    /// Starts a new window, keeping the count of what could not be held.
    pub fn clear(&mut self) {
        self.samples.clear();
        self.dropped = 0;
    }

    /// Nearest-rank on the already-sorted samples.
    fn quantile(&self, quantile: f64) -> f64 {
        if self.samples.is_empty() {
            return 0.0;
        }
        #[expect(
            clippy::cast_precision_loss,
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "an index into at most a few thousand samples: the cast is \
                      exact far beyond any window this holds"
        )]
        let index = ((self.samples.len() - 1) as f64 * quantile).round() as usize;
        self.samples.get(index).copied().unwrap_or(0.0)
    }
}

/// What a window of timings looked like.
///
/// `max` is carried because it is a useful diagnostic, and it is deliberately
/// NOT what a comparison should be made on: it is one observation, chosen by
/// the length of the run.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Summary {
    /// How many observations this was drawn from. A percentile without it is
    /// not a number anybody can weigh.
    pub samples: usize,
    /// Median.
    pub p50: f64,
    /// The common tail.
    pub p95: f64,
    /// The severe tail. Needs a hundred samples before it means much.
    pub p99: f64,
    /// The single worst observation seen.
    pub max: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(value: f64) -> Duration {
        Duration::from_secs_f64(value / 1000.0)
    }

    /// The quantiles are nearest-rank, and the point of the type is that they
    /// are NOT the maximum: a hundred fast frames and one slow one must leave
    /// p50 fast and say so.
    #[test]
    fn one_slow_frame_moves_the_maximum_and_not_the_median() {
        let mut timings = Timings::new(1024);
        for _ in 0..99 {
            timings.observe(ms(16.0));
        }
        timings.observe(ms(500.0));

        let summary = timings.summary();
        assert_eq!(summary.samples, 100);
        assert!(
            (summary.p50 - 16.0).abs() < 0.001,
            "the median must ignore the outlier, got {}",
            summary.p50
        );
        assert!(
            (summary.max - 500.0).abs() < 0.001,
            "the maximum must see it, got {}",
            summary.max
        );
    }

    /// Nearest-rank, stated exactly, because the definition is the contract.
    ///
    /// A hundred samples, of which the two slowest are 100 ms and 200 ms:
    /// the 95th of a hundred is still a fast frame, the 99th is the first slow
    /// one, and the maximum is the other. Written out because the first version
    /// of this test expected p99 to be the WORST sample — which is the very
    /// confusion the type exists to remove. On a hundred samples p99 is one
    /// observation, not an estimate of the tail.
    #[test]
    fn the_tail_separates_from_the_body() {
        let mut timings = Timings::new(1024);
        for _ in 0..98 {
            timings.observe(ms(10.0));
        }
        timings.observe(ms(100.0));
        timings.observe(ms(200.0));

        let summary = timings.summary();
        assert_eq!(summary.samples, 100);
        assert!((summary.p50 - 10.0).abs() < 0.001, "p50 {}", summary.p50);
        assert!((summary.p95 - 10.0).abs() < 0.001, "p95 {}", summary.p95);
        assert!((summary.p99 - 100.0).abs() < 0.001, "p99 {}", summary.p99);
        assert!((summary.max - 200.0).abs() < 0.001, "max {}", summary.max);
    }

    /// An empty window reports zeros AND a sample count of zero, so a reader
    /// can tell "fast" from "nothing happened". Reporting 0 ms as a latency
    /// without that count is how a dead pipeline looks healthy.
    #[test]
    fn an_empty_window_says_it_is_empty() {
        let mut timings = Timings::new(8);
        let summary = timings.summary();
        assert_eq!(summary.samples, 0);
        assert!(summary.p50.abs() < f64::EPSILON, "p50 {}", summary.p50);
        assert!(timings.is_empty());
    }

    /// The cap is a safety net, and a window that hit it must SAY so rather
    /// than reporting the distribution of whatever arrived first — which is a
    /// different, quieter lie.
    #[test]
    fn a_full_window_counts_what_it_refused() {
        let mut timings = Timings::new(4);
        for _ in 0..10 {
            timings.observe(ms(1.0));
        }
        assert_eq!(timings.len(), 4);
        assert_eq!(timings.dropped(), 6);
        timings.clear();
        assert_eq!(timings.dropped(), 0, "a new window starts clean");
    }

    /// One sample is a legal window: every percentile is that sample.
    #[test]
    fn a_single_sample_is_every_percentile() {
        let mut timings = Timings::new(8);
        timings.observe(ms(7.5));
        let summary = timings.summary();
        assert_eq!(summary.samples, 1);
        for value in [summary.p50, summary.p95, summary.p99, summary.max] {
            assert!((value - 7.5).abs() < 0.001);
        }
    }
}
