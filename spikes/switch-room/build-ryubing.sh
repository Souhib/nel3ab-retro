#!/usr/bin/env bash
# Build the headless-shutdown and audio-queue fixes against the tested version.
# Keep downloads, package cache and emulator output outside the repository.
set -euo pipefail
cd "$(dirname "$0")"
probe=$PWD
lab=${SWITCH_LAB:-/tmp/nel3ab-switch-lab}
source_dir="$lab/ryubing-src"
if [ "$(docker inspect -f '{{.State.Running}}' nel3ab-switch-ryubing-lab 2>/dev/null || true)" = true ]; then
  echo 'Stop the prototype before rebuilding its executable.' >&2
  exit 1
fi
commit=e2143d43bcb6762340d8a01f20e7b5fdf104f02f
if [ ! -d "$source_dir/.git" ]; then
  git clone --filter=blob:none https://git.ryujinx.app/projects/Ryubing.git "$source_dir"
  git -C "$source_dir" checkout --detach "$commit"
fi
if [ "$(git -C "$source_dir" rev-parse HEAD)" != "$commit" ]; then
  echo 'The existing source checkout is a different version; choose another SWITCH_LAB.' >&2
  exit 1
fi
for patch in ryubing-headless-stop.patch ryubing-package-source.patch ryubing-audio-queue.patch; do
  if git -C "$source_dir" apply --reverse --check "$probe/$patch" 2>/dev/null; then
    continue
  fi
  git -C "$source_dir" apply --check "$probe/$patch"
  git -C "$source_dir" apply "$probe/$patch"
done
python3 extract-update-libraries.py "$lab/ryubing/publish/Ryujinx" "$lab/release-libraries"
# DOTNET may point to a private SDK. .NET 9 is pinned by upstream global.json.
dotnet_bin=${DOTNET:-dotnet}
NUGET_PACKAGES="$lab/nuget" DOTNET_CLI_TELEMETRY_OPTOUT=1 "$dotnet_bin" publish \
  "$source_dir/src/Ryujinx/Ryujinx.csproj" -c Release -r linux-x64 \
  --self-contained true -p:PublishTrimmed=false -p:Version=1.3.3 \
  -p:Nel3abReleaseLibraries="$lab/release-libraries" -o "$lab/ryubing-patched/publish"
# An untrimmed private build avoids adding a linker change to the shutdown test.
# Record the actual binary: its version string alone cannot distinguish patches.
sha256sum "$lab/ryubing-patched/publish/Ryujinx" > "$lab/ryubing-patched/SHA256SUMS"
