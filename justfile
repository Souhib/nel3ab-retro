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

# Everything a commit must satisfy. Mirrors `poe check`.
check: fmt-check lint test

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

# Is every button of a GameCube pad wired, and to the right bit? Needs the worker
# RUNNING. Feeds a synthetic standard gamepad, because a mapping is wrong in a
# way that only shows on the button nobody thought to press.
browser-pad:
    cd spikes/m3-browser-drive && node padmap.mjs http://localhost:8100/

# Does sound come out, at the rate it was recorded at, and does the page play it?
# Needs the worker RUNNING. The first check reads the stream the way the page
# does and looks at the samples; the second drives the page's own playback with
# autoplay forced on, which is the only thing it fakes.
browser-sound:
    cd spikes/m3-browser-drive && node sound.mjs http://localhost:8100/ 20
    cd spikes/m3-browser-drive && node playback.mjs http://localhost:8100/ 12

# Does one press answer exactly one question of the pad lesson? Needs the worker
# RUNNING. Feeds a synthetic pad frame by frame, because what this gets wrong is
# a SEQUENCE — a press that also answers the question after it.
browser-lesson:
    cd spikes/m3-browser-drive && node lesson.mjs http://localhost:8100/

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

# Undefined behaviour in the FFI module (M2 onward).
miri:
    cd core && cargo +nightly miri test -p nel3ab-protocol

doc:
    cd core && cargo doc --workspace --no-deps --document-private-items
