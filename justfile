# One entry point for humans and for CI. CI runs these exact recipes, so a green
# local run and a green pipeline cannot diverge.
#
# That promise was broken once: CI set `RUSTFLAGS: -D warnings` in the workflow
# while the justfile passed it only to clippy, so `just check` went green locally
# on code that failed the pipeline on a dead-code warning. Setting it here is what
# makes the promise true — the strictness belongs to the recipe, not to one
# caller of it.
export RUSTFLAGS := "-D warnings"

default: local

# THE GATE BEFORE A COMMIT, on a machine that has the GPU.
#
# `check` is what CI can prove; `gpu-test` is what only this machine can. CI runs
# on a GitHub runner with no GPU, so everything M2 built — the dma-buf import,
# the compute pass, the encode — is invisible to it. A green pipeline therefore
# says nothing about the half of this project that matters most, and running
# those tests has to be somebody's habit rather than a hope.
#
# It is the DEFAULT recipe for that reason: `just` with no argument runs the
# whole gate, so forgetting takes an extra word rather than fewer.
#
# The way to make CI cover this is a self-hosted runner on lgf. Worth doing when
# more than one person commits; until then a rule that costs one command is
# cheaper than a runner to maintain.
local: check gpu-test

# The control plane's own gate, which is its owner's: ruff, ty, pytest, driven by
# poe exactly as LaTabdhir and Majlisna drive theirs.
control:
    cd control && uv run poe check

# The page's own gate: types, lints, unit tests. Same shape as the other two.
front:
    cd front && npm run typecheck && npm run lint && npm run format:check && npm test

# Is the TypeScript client still the one this API describes?
#
# Two links, and both are regenerated from their source rather than trusted:
# FastAPI writes `control/openapi.json` from its own routes, and Hey API writes
# `front/src/client` from that document (ADR D6). A field renamed in Python and
# not regenerated here would reach the browser as `undefined`, in the one place
# nothing checks types at run time.
#
# Diffing works for these, unlike for the page: a JSON dump and a code generator
# both give the same bytes for the same input. The page cannot be checked this
# way because its minifier does not (see `front-check`).
contract-check:
    cd control && uv run poe openapi
    cd front && npx openapi-ts
    git diff --exit-code --stat control/openapi.json front/src/client

# Builds the page into the worker's source tree, where `include_str!` reads it,
# and stamps it with a hash of what it was built from.
front-build:
    cd front && npm run build && node stamp.mjs

# Is the committed page the one these sources produce?
#
# The page is a build artefact that is committed, so `cargo build` never needs
# node. That trade has one failure mode: a change to `front/src` that nobody
# rebuilt, shipping a binary with yesterday's page in it.
#
# Compares the stamp rather than the HTML. Rebuilding and diffing the file was
# the first attempt and it fails on unchanged sources: the minifier renames a
# handful of locals differently between two runs of the same input. A check that
# is red for no reason is a check people learn to skip.
front-check:
    cd front && node stamp.mjs --check

# Everything a commit must satisfy. Mirrors `poe check`.
check: fmt-check lint test control front front-check contract-check

# Auto-fix pass for development. Mirrors `poe fix`.
fix:
    cd core && cargo fmt --all
    cd core && cargo clippy --workspace --all-targets --fix --allow-dirty

fmt-check:
    cd core && cargo fmt --all --check

# `-D warnings` makes every lint blocking: a warning IS a failure.
#
# `--all-features` so the gated code is linted too — the GPU FFI and the hardware
# integration tests. Code nobody lints is code nobody checks.
#
# This needs build-time tools (`libavcodec-dev libavutil-dev libva-dev
# glslang-tools`) but not a GPU: clippy analyses without linking, yet the build
# script compiles real C and a real shader, and cannot be talked out of wanting
# real headers and a real compiler. CI installs them for exactly this recipe.
# It went red once for want of that line.
lint:
    cd core && cargo clippy --workspace --all-targets --all-features -- -D warnings

test:
    cd core && cargo test --workspace --all-targets

# The tests that need the GPU on this machine. NOT part of `check`, because CI
# has no GPU and a test that cannot run must not report a pass.
#
# `vaapi` compiles the GPU FFI and needs only headers; `gpu-tests` runs what
# needs a real device. They were one flag until the worker started depending on
# `vaapi` for real: Cargo unifies features across a workspace, so `cargo test
# --workspace` began running GPU tests on the CI runner.
gpu-test:
    cd core && sg render -c 'cargo test -p nel3ab-encoder --features gpu-tests'

# Does the page survive its decoder dying? Needs the worker RUNNING and streaming
# (`systemctl start nel3ab-worker`), because the failure only exists against a
# live stream: a decoder that is fed nothing cannot be caught refusing anything.
#
# Not part of `local`: it drives a real Chrome against a real session, so it is
# the recipe to run when the page changes rather than on every commit.
browser-recovery:
    cd spikes/m3-browser-drive && node wedge.mjs http://localhost:8100/ 6

# Le propriétaire de la salle: le premier arrivé, et la passation quand il part.
#
# Demande une salle VIDE, et s'abstient sinon: quelqu'un qui joue à côté n'est
# pas un défaut.
browser-owner:
    cd spikes/m3-browser-drive && node owner.mjs

# L'identité, de bout en bout, à travers le VRAI proxy.
#
# Contre l'adresse tailscale et pas localhost: c'est le proxy qui écrit
# l'identité, donc mesurer ailleurs mesurerait son absence. Ça veut dire que
# cet essai ne tourne QUE sur la machine qui sert la salle.
browser-identity:
    cd spikes/m3-browser-drive && node identity.mjs

# L'antisèche dit-elle vrai, et la réassignation tient-elle ?
#
# La manette est SIMULÉE, en remplaçant `navigator.getGamepads`: ce qui est
# vérifié est la traduction et la réassignation, pas le pilote USB. Brancher une
# vraie DualSense sur le serveur pour tester l'affichage d'un nom serait un
# montage que personne ne peut rejouer.
browser-bindings:
    cd spikes/m3-browser-drive && node bindings.mjs http://localhost:8100/

# Ce que la page rend, sur une minute, sans rien redémarrer.
#
# Le banc redémarre la session, donc il ne peut pas tourner pendant que
# quelqu'un joue. Celui-ci n'est qu'un spectateur de plus: il mesure le côté
# navigateur, qui est la moitié qu'un changement de page peut dégrader.
browser-watch seconds="60":
    cd spikes/m3-browser-drive && node watch.mjs http://localhost:8100/ {{seconds}}

# Does the page survive being switched away from? Needs the worker RUNNING.
# Opens a second tab to push the first one into the background, which is how a
# person does it, and asserts that nothing is decoded for a screen that is not
# asking. Watching the decoder's backlog instead would pass on a machine whose
# decoder is fast enough to keep up with work nobody wanted — this one is.
browser-background:
    cd spikes/m3-browser-drive && node backgrounded.mjs http://localhost:8100/ 30

# Does a controller survive its player switching away, and only that? Needs the
# worker RUNNING. Backgrounds a real tab for longer than the ping deadline, then
# closes one. The unit tests pin the server's side of this; only a real browser
# can answer whether Chrome pongs while a tab is throttled, and the whole design
# rests on it doing so.
browser-seats:
    cd spikes/m3-browser-drive && node seat-kept.mjs http://localhost:8100/ 25

# Can a person take the controller back from a page that is merely open? Needs
# the worker RUNNING and NOBODY else holding a port — the test says so rather
# than passing vacuously.
browser-claim:
    cd spikes/m3-browser-drive && node claim.mjs http://localhost:8100/

# Does sound come out, at the rate it was recorded at, and does the page play it?
# Needs the worker RUNNING. The first check reads the stream the way the page
# does and looks at the samples; the second drives the page's own playback with
# autoplay forced on, which is the only thing it fakes.
browser-sound:
    cd spikes/m3-browser-drive && node sound.mjs http://localhost:8100/ 20
    cd spikes/m3-browser-drive && node playback.mjs http://localhost:8100/ 12

# Where the audio latency goes, poste by poste, on the client's side of the wire.
# Needs the worker RUNNING. Give it 60 s or more: the page's lead decays one
# millisecond per clean second, so a short look reports where it STARTED rather
# than where it lives.
#
# The server's pipe is counted in these numbers, and was not always: the worker
# dates each chunk back by the pipe's depth. Without that the sound declared
# itself fresher than it was, and the offset the page reported was 7 ms where the
# truth was 54 — which is why the "line the picture up with the sound" control
# looked inert. It was compensating by the wrong number, not failing to work.
audio-budget seconds="60":
    cd spikes/m3-browser-drive && node audio-budget.mjs http://localhost:8100/ {{seconds}}

# The two ways of building the audio context, one after the other on the same
# stream. Prints what each costs; whether either buzzes is a question for ears.
browser-rates:
    cd spikes/m3-browser-drive && node rates.mjs http://localhost:8100/

# Does the lip-sync box move the picture when it is clicked, rather than twenty
# seconds later? Needs the worker RUNNING.
browser-lipsync:
    cd spikes/m3-browser-drive && node lipsync.mjs http://localhost:8100/

# Do the numbers stay beside the picture, without scrolling, at the widths people
# actually use? Needs the worker RUNNING.
browser-layout:
    cd spikes/m3-browser-drive && node layout.mjs

# Does the library show the names a person reads, and none of the file clutter?
# Needs the worker RUNNING.
browser-library:
    cd spikes/m3-browser-drive && node library.mjs

# Taking a socket somebody is playing on: two clicks to do it, and the player it
# was taken from is told and left unplugged rather than quietly moved. Needs the
# worker RUNNING and ONE free port — not an empty room.
browser-steal:
    cd spikes/m3-browser-drive && node steal.mjs http://localhost:8100/

# Changing the game from the page. RESTARTS THE SESSION, which is the feature,
# so it must not be run while somebody is playing something they care about.
#
# What it pins is the SEQUENCE, not the outcome: one click must arm and boot
# nothing. A test that only checked "the game changed" would pass just as well on
# a page that switched on the first click, and what is being confirmed is the end
# of everybody else's game.
browser-games:
    cd spikes/m3-browser-drive && node games.mjs http://localhost:8100/

# One benchmark run of the shipped chain: release worker under systemd, the real
# Dolphin container, the real GPU, a real headless Chrome watching. RESTARTS THE
# SESSION, so it must not be run while somebody is playing.
#
# Takes about three minutes: 45 s of warm-up so shader compilation and the
# display schedule have settled, then 90 s measured. Writes the raw result to
# bench/results/ and prints the distributions.
bench label="baseline":
    node bench/run.mjs {{label}}

# The whole chain against a real Dolphin and a real ROM. Minutes, not seconds.
end-to-end:
    cd core && sg render -c 'cargo test -p nel3ab-encoder --features gpu-tests,dolphin-integration --test dolphin_frames_become_h264 -- --nocapture'

# Advisories + licences. Blocking, unlike an informational audit.
audit:
    cd core && cargo deny check

# Undefined behaviour in the pointer and slice arithmetic around the FFI.
#
# It pointed at `nel3ab-protocol` and was therefore theatre twice over: that
# crate carries `#![forbid(unsafe_code)]`, so there is no undefined behaviour of
# ours for Miri to find in it, and the recipe was RED anyway — proptest calls
# `getcwd`, which Miri's isolation refuses. A check that cannot fail and does
# not run is worse than no check.
#
# `nel3ab-encoder` is where all 94 `unsafe` blocks live. The two flags are not
# decoration:
#
#   -Zmiri-disable-isolation   proptest reads the filesystem to persist failing
#                              seeds; isolation blocks that and aborts the run.
#   --skip frame_source        Miri implements AF_INET and AF_INET6 only, so the
#                              tests that bind a Unix socket cannot run under it.
#
# What is left is exactly what CLAUDE.md rule 2 asks for: the H.264 bitstream
# writer and the wire parsers, where a mistake would be ours rather than the
# GPU's. Miri cannot execute libva or Vulkan and never will.
miri:
    cd core && MIRIFLAGS=-Zmiri-disable-isolation cargo +nightly miri test \
        -p nel3ab-encoder --lib -- --skip frame_source

# The API reference, generated from the Rust source.
doc:
    cd core && cargo doc --workspace --no-deps --document-private-items

# The prose site: the carnet, the ADR and the working plans, built by Zensical
# from the same files the repository already keeps.
#
# `--strict` is the point of this recipe, not a flourish. It fails the build on a
# link or an anchor that resolves to nothing, which is the one kind of rot a
# 2800-line document acquires silently: a section gets renamed, every link to it
# dies, and nothing says so until a reader clicks. It caught two on its first
# run.
#
# Needs the tool once: `uv tool install zensical`.
docs:
    zensical build --strict

# Rebuild, then publish on the tailnet. Two commands are one because publishing a
# site nobody rebuilt is the failure this recipe exists to prevent.
#
# Served straight from `site/` rather than copied to /srv: one directory, so the
# site cannot be current in the repository and stale where it is served. The cost
# is a sub-second window during a rebuild where a reader could fetch a half-built
# page — acceptable for a documentation site on a private network, and it would
# not be for anything a stranger reaches.
#
# TAILNET ONLY, deliberately. `tailscale serve` shares inside the tailnet;
# `tailscale funnel` would put it on the public internet. This document names
# internal hostnames and says plainly that the game server has no authentication,
# so it stays where the reader has already been invited.
#
# The port is 8444 because 8443 is the game. Both are proxied by the same
# tailscaled, so neither needs its own certificate.
docs-deploy: docs
    sudo tailscale serve --bg --https=8444 {{justfile_directory()}}/site
    @echo "https://lgf.tail3bd01c.ts.net:8444/"

# Rebuild on every change, with a local preview. For writing, not for publishing.
docs-watch:
    zensical serve
