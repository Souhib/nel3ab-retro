#!/usr/bin/env bash
# Construit Ryubing amont 475615f avec les correctifs de la salle, dans
# <dossier>/publish, et note l'empreinte de l'exécutable. Source, SDK et cache
# NuGet restent hors du dépôt, dans SWITCH_LAB. NEL3AB_LATENCY_PROBE_BUILD=1
# ajoute les marqueurs de latence : pour une sonde, jamais pour la salle.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
lab=${SWITCH_LAB:-/tmp/nel3ab-switch-lab}
out=${1:?usage: build.sh <dossier de sortie>}
commit=475615f0431b4995b03c930c5089d20f6f3570e0
source_dir="$lab/ryubing-amont-$commit"
# L'amont exige le SDK .NET 10 (global.json). dotnet-install.sh --channel 10.0
# l'installe dans un dossier privé, sans toucher au système.
dotnet_bin=${DOTNET:-$lab/dotnet10/dotnet}
if [ -e "$out/publish" ]; then
  echo "$out/publish existe déjà : jamais d'écrasement d'un moteur, choisir un autre dossier." >&2
  exit 1
fi
if [ ! -d "$source_dir/.git" ]; then
  git clone --filter=blob:none https://git.ryujinx.app/projects/Ryubing.git "$source_dir"
fi
# Ce dossier n'appartient qu'à ce script : il repart toujours de l'amont nu.
git -C "$source_dir" checkout -q --detach --force "$commit"
git -C "$source_dir" reset -q --hard "$commit"
git -C "$source_dir" clean -q -fd
patches=(ryubing-headless-stop.patch ryubing-audio-queue.patch)
if [ "${NEL3AB_LATENCY_PROBE_BUILD:-}" = 1 ]; then patches+=(ryubing-latency-probe.patch); fi
for patch in "${patches[@]}"; do git -C "$source_dir" apply "$here/$patch"; done
NUGET_PACKAGES="$lab/nuget" DOTNET_CLI_TELEMETRY_OPTOUT=1 "$dotnet_bin" publish \
  "$source_dir/src/Ryujinx/Ryujinx.csproj" -c Release -r linux-x64 --self-contained true \
  -p:PublishTrimmed=false -p:Version=1.3.3 -o "$out/publish"
# L'empreinte, parce que le numéro de version ne distingue pas les correctifs.
sha256sum "$out/publish/Ryujinx" > "$out/SHA256SUMS"
