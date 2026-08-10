// Copyright 2026 nel3ab-retro
// SPDX-License-Identifier: GPL-2.0-or-later

// Zero-copy frame export for nel3ab-retro.
//
// Dolphin's frame dumper reaches the finished XFB as a GPU texture and then
// immediately copies it into a staging texture and maps it — a GPU->CPU
// readback measured at 0.57 of a core, about three times the cost of the
// emulation itself on the same scene. This exports the frame as a dma-buf
// instead, so the worker can import it, convert it to NV12 with a shader and
// hand it to VAAPI without the CPU ever touching a pixel.
//
// Everything here is inert unless NEL3AB_FRAME_SOCKET names a socket that
// accepts a connection. That is deliberate: it keeps the patch out of Dolphin's
// config system entirely, so the fork stays small and rebases cheaply.

#pragma once

// Included rather than forward-declared. `MathUtil::Rectangle` is a class
// template, and a forward declaration has to match its `struct`/`class` key and
// its parameter list exactly — a needless way to break a build that has not been
// run yet.
#include "Common/MathUtil.h"

class AbstractTexture;

namespace Vulkan::FrameExport
{
// Called once when the Vulkan backend comes up. Installs the per-frame hook if
// and only if the socket is there; otherwise logs why and leaves Dolphin
// completely unchanged.
void Initialize();

// Called once when the backend goes down. Safe without a matching Initialize.
void Shutdown();
}  // namespace Vulkan::FrameExport
