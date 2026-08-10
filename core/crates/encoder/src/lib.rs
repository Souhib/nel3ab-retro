//! Turns emulator frames into an encoded video stream.
//!
//! Follows the **Sunshine topology**, not the capture-then-import one: allocate
//! the VAAPI surface FIRST, export it as a dma-buf, and let a shader write NV12
//! straight into it. The surface is then legal for the video engine BY
//! CONSTRUCTION — which sidesteps AMD's DCC-modifier rejection on everything
//! before RDNA4 (our RX 6650 XT is RDNA2), and drops a VPP pass.
//!
//! Milestone: M2.

#![forbid(unsafe_code)]
