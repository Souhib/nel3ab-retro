//! Carries video to the browser and input frames back.
//!
//! # The transport is NOT decided yet
//!
//! This file used to say "media over WebRTC" as though it were settled. It was
//! written before anyone investigated, and `docs/m3-working-plan.md` is where
//! the choice is actually being made — WebRTC, or our own bytes decoded by
//! `WebCodecs` over a plain transport. Experiment 1 has since shown a browser
//! takes the bytes `encoder::av` emits **unchanged**, which is exactly the sort
//! of thing that turns a default into a decision.
//!
//! What is not in doubt is the shape of the two channels, whichever carries
//! them: video wants ordering, inputs do **not**. A retransmitted input is
//! already stale — the next frame is 16.7 ms away — so reliability there would
//! buy latency and nothing else. That argument survives either option; it is
//! only the mechanism (a DataChannel, or WebTransport datagrams) that is open.
//!
//! Milestone: M3.

#![forbid(unsafe_code)]

pub mod browser;
pub mod clip;
pub mod control;

pub use browser::{BrowserServer, Packet, TransportError};
pub use control::OwnerSeat;
