# One entry point for humans and for CI. CI runs these exact recipes, so a green
# local run and a green pipeline cannot diverge.
#
# That promise was broken once: CI set `RUSTFLAGS: -D warnings` in the workflow
# while the justfile passed it only to clippy, so `just check` went green locally
# on code that failed the pipeline on a dead-code warning. Setting it here is what
# makes the promise true — the strictness belongs to the recipe, not to one
# caller of it.
export RUSTFLAGS := "-D warnings"

default: check

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
# `--all-features` so the gated code is linted too — the libva FFI and the
# hardware integration tests. Clippy analyses without linking, so this needs
# neither libva nor a GPU, and code nobody lints is code nobody checks.
lint:
    cd core && cargo clippy --workspace --all-targets --all-features -- -D warnings

test:
    cd core && cargo test --workspace --all-targets

# Advisories + licences. Blocking, unlike an informational audit.
audit:
    cd core && cargo deny check

# Undefined behaviour in the FFI module (M2 onward).
miri:
    cd core && cargo +nightly miri test -p nel3ab-protocol

doc:
    cd core && cargo doc --workspace --no-deps --document-private-items
