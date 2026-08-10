# One entry point for humans and for CI. CI runs these exact recipes, so a green
# local run and a green pipeline cannot diverge.

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
lint:
    cd core && cargo clippy --workspace --all-targets -- -D warnings

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
