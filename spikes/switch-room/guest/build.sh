#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# SDK digest observed on 2026-09-07. The application contains only our test code.
docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges \
  --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work \
  devkitpro/devkita64@sha256:1fc388c3a0d34bd2045a6dadcb1020e069d5f876a187fd705de14b4440c00282 \
  bash -c 'export PATH=/opt/devkitpro/devkitA64/bin:/opt/devkitpro/tools/bin:$PATH; aarch64-none-elf-gcc -O2 -g -Wall -Wextra -Werror -march=armv8-a -mtune=cortex-a57 -mtp=soft -fPIE -ffunction-sections -D__SWITCH__ -I/opt/devkitpro/libnx/include -L/opt/devkitpro/libnx/lib -specs=/opt/devkitpro/libnx/switch.specs source/main.c -lnx -lm -o nel3ab-probe.elf && nacptool --create "nel3ab probe" "nel3ab" "0.1.0" nel3ab-probe.nacp && elf2nro nel3ab-probe.elf nel3ab-probe.nro --nacp=nel3ab-probe.nacp'
