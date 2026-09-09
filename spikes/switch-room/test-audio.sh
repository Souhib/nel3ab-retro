#!/usr/bin/env bash
# Real backend callbacks with a dummy device; no room, ROM, keys or saved data.
set -euo pipefail
cd "$(dirname "$0")"
lab=${SWITCH_LAB:-/tmp/nel3ab-switch-lab}
SDL_AUDIODRIVER=dummy SDL_VIDEODRIVER=dummy NUGET_PACKAGES="$lab/nuget" \
  "${DOTNET:-dotnet}" run --project audio-tests/AudioTests.csproj -c Release \
  -p:Nel3abRyubingSource="$lab/ryubing-src"
