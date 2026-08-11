//! Turns emulator frames into an encoded video stream.
//!
//! Follows the **Sunshine topology**, not the capture-then-import one: allocate
//! the VAAPI surface FIRST, export it as a dma-buf, and let a shader write NV12
//! straight into it. The surface is then legal for the video engine BY
//! CONSTRUCTION — which sidesteps AMD's DCC-modifier rejection on everything
//! before RDNA4 (our RX 6650 XT is RDNA2), and drops a VPP pass.
//!
//! Milestone: M2.

// NOT `forbid`, and this is the one crate in the workspace where that is true.
// CLAUDE.md rule 2 names exactly one exception — the FFI module — so the lint is
// `deny` here and lifted on `va` alone, where every block carries a `SAFETY:`
// comment and the struct layouts are asserted against the C headers at compile
// time. Everything else in this crate, including the dma-buf socket, stays safe.
#![deny(unsafe_code)]

pub mod error;
pub mod frame_source;
pub mod h264;
pub mod protocol;

#[cfg(feature = "vaapi")]
#[allow(unsafe_code, reason = "the libva FFI is rule 2's FFI exception")]
pub mod va;

#[cfg(feature = "vaapi")]
#[allow(unsafe_code, reason = "the libavcodec shim is rule 2's FFI exception")]
pub mod av;

#[cfg(feature = "vaapi")]
#[allow(unsafe_code, reason = "the Vulkan FFI is rule 2's FFI exception (ADR D8)")]
pub mod vulkan;

pub use error::EncoderError;
pub use frame_source::{DmaBuf, FrameListener, FrameSource, LentFrame};
pub use h264::{ColourDescription, PpsParams, SpsParams, build_pps, build_sps};
pub use protocol::FrameDescriptor;
