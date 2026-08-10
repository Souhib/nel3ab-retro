//! Carries video to the browser and input frames back.
//!
//! Two channels with opposite guarantees: media over WebRTC, and inputs over an
//! UNRELIABLE, UNORDERED DataChannel. A retransmitted input is already stale —
//! the next frame is 8 ms away — so reliability here would buy latency and
//! nothing else.
//!
//! Milestone: M3.

#![forbid(unsafe_code)]
