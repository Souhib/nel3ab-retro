#!/usr/bin/env bash
# Real SDL3 backend callbacks with a dummy device; no room, ROM, keys or saved data.
# RYUBING_SOURCE selects another upstream tree, such as an unpatched checkout
# for the red check. DOTNET defaults to the .NET 10 SDK that upstream requires.
set -euo pipefail
cd "$(dirname "$0")"
lab=${SWITCH_LAB:-/tmp/nel3ab-switch-lab}
# Par défaut, l'arbre que build.sh prépare : l'amont et les correctifs du dépôt.
source=${RYUBING_SOURCE:-$lab/ryubing-amont-475615f0431b4995b03c930c5089d20f6f3570e0}
SDL_AUDIO_DRIVER=dummy SDL_VIDEO_DRIVER=dummy NUGET_PACKAGES="$lab/nuget" \
  "${DOTNET:-$lab/dotnet10/dotnet}" run --project audio-tests/AudioTests.csproj -c Release \
  -p:Nel3abRyubingSource="$source"
