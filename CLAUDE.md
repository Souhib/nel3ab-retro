# AGENTS.md

Guidance for AI agents and humans working in this repository.

## Project

Self-hosted retro cloud-gaming rooms: one emulator instance per room, up to four
browser players, server-side GPU emulation and encoding. Read
[`docs/adr/0001-architecture.md`](docs/adr/0001-architecture.md) first — it holds
the decisions and their reasons.

[`docs/carnet-de-bord.md`](docs/carnet-de-bord.md) is the same story told for a
human: how the project was built, what fought back, and what every acronym means.
Start there if you want the reasoning rather than the ruling.

## The rules that matter

### 1. No rule without its reason — and the reason is measured

Every `#[allow(...)]`, every threshold in `clippy.toml`, every ignored advisory
carries a comment stating **what it costs and why it is safe**. A bare `allow` is
a defect. When a number is involved, record the measurement and the date.

### 2. `unsafe` is forbidden, except behind a proof

The ban is mechanical, and lives at each crate root: `protocol`, `emulator`,
`transport` and `worker` all carry `#![forbid(unsafe_code)]`. The workspace lint
is `deny` rather than `forbid` for one reason only — `forbid` cannot be lifted at
all, not even for the exception below.

**The exception is the GPU FFI, and only it.** Three modules of the `encoder`
crate carry it, which is `#![deny(unsafe_code)]` at the crate root and `#[allow]`
on those modules alone — never crate-wide:

| Module | Why it is unavoidable |
|---|---|
| `encoder::va` | libva: allocating and exporting the encode surface |
| `encoder::av` | the libavcodec shim (ADR D7) |
| `encoder::vulkan` | `ash`: importing the dma-buf and dispatching the shader (ADR D8) |

Adding a fourth is a decision, not a convenience: it needs an ADR entry saying
what was weighed. D8 is the worked example — it argues Vulkan *from* why D7
decided the opposite for ffmpeg.

Each block needs a `// SAFETY:` comment establishing the invariant, and a test
pinning it when the safety is not obvious.

Where the invariant is a **memory layout**, assert it at compile time rather than
in a test: `encoder::va::sys` pins every size and offset against measurements
taken from the real headers (`spikes/m2-vaapi-export/va_layout.c`), so a
mis-declared struct fails the build instead of returning plausible garbage.

Where the layout is one **we** define across a language boundary, ask the other
side rather than assuming: `encoder::av`'s shim exports `n3_layout()`, and a test
compares *every field* — not just the size, since two compensating padding errors
would leave the size right and every value wrong. That test needs no GPU, because
a mismatch is a defect of the binding rather than of the machine.

Note what `just miri` can actually do: Miri cannot execute foreign functions, so
it will never validate a libva or Vulkan call. Run it on the pointer and slice
arithmetic *around* the calls, where a mistake would be ours.

### 3. Make invalid states unrepresentable

Prefer the type system over a runtime check, and a runtime check over a comment.
`PlayerSlot` cannot hold `0`; a caller therefore cannot pass a bad slot, and no
test needs to prove it. This is the strongest form of "the rule lives in the
machine".

### 4. A test must be able to fail for the right reason

- **Red-first for every bug fix.** Verify by reintroducing the bug, not by reasoning.
- **A negative twin for every positive assertion.** "Accepts 1..=4" is worthless
  without "rejects 0 and 5".
- **Never assert behind a condition that can silently be false.** Assert the
  precondition instead of branching on it.
- **Coverage is a signal, never confidence.** It measures "executed by a test",
  not "reached by the app".
- A test that cannot fail is worse than no test: it advertises coverage that does
  not exist.

### 5. Orchestration only in the binary

`crates/worker` wires crates together. Any behaviour belongs in a library crate
so it is testable without a process, a GPU or a network. (This is the transposition
of "no logic in routes".)

### 6. The worker must not panic

A panic kills a live game session. `unwrap`, `expect` and `panic!` are denied
outside tests. Errors are typed with `thiserror`; `anyhow` is allowed only in the
binary, at the boundary.

### 7. A task is not done until CI is green — and CI cannot see the GPU

Run **`just`** (which is `check` + `gpu-test`) locally, then watch the run. A
failing early step means the later gates were **skipped, not passed**.

Two halves, and neither covers the other:

- **`just check`** is exactly what CI runs, so a red one here is a red pipeline
  later. Never put it in the same command as `git push`: the push has to be a
  decision taken *after* reading the result. That rule exists because the output
  was ignored three times, the third after an earlier spurious red had taught
  the eye to skip it.
- **`just gpu-test`** is everything CI structurally cannot prove. The runner has
  no GPU, so the dma-buf import, the compute pass and the encode are invisible
  to it — a green pipeline says nothing about the half of this project that
  matters most.

Hence the split between the `vaapi` feature (compiles the FFI, needs only
headers) and `gpu-tests` (needs a real device). They were one flag until the
worker depended on `vaapi` for real: Cargo unifies features across a workspace,
so `cargo test --workspace` started running GPU tests on a runner that has none.

The way to close the gap properly is a self-hosted runner on lgf. Worth doing
when more than one person commits.

### 8. The page is a committed artefact, and it can go stale

`crates/worker/src/page/index.html` is built from `front/` and compiled into the
binary. Change anything under `front/src` and you must run `just front-build`
and commit the result, or the worker ships yesterday's page.

`just check` catches it through a stamp over the build inputs plus the hash of
the page that build produced (`front/stamp.mjs`, ADR D13). Do not replace that
with a rebuild-and-diff: the minifier renames locals differently between runs of
identical sources, so it goes red for no reason, and a check that is red for no
reason is a check people learn to skip.

The other half of the rule: **React must never end up on the frame path.** The
media loop lives in `front/src/media/` as plain modules that own the canvas and
paint on `requestAnimationFrame`. React reads a snapshot twice a second. A
component that wants to read the picture is a component to rewrite as a module.

### 9. The logbook is part of the work, not a write-up afterwards

[`docs/carnet-de-bord.md`](docs/carnet-de-bord.md) is written **for a human who
is not in the terminal**. It explains, in French, how the project was built:
what was tried, what fought back, which options were weighed, what was chosen and
why — defining every acronym and piece of jargon on the way.

Update it in the **same change** that earns the entry. It is not a summary
generated at the end; a decision explained a week later has already lost the
reasoning that made it. Add an entry whenever any of these happens:

- a decision is taken, changed or reversed — mirror the ADR entry, but say it in
  plain words and explain the terms it uses;
- **an option is killed by an experiment** — record what the experiment was and
  how long it took. These are the entries that save the most time later;
- a trap costs real time — the symptom, the cause, and the general lesson, so the
  lesson outlives the trap;
- a number is measured that changes what we do — with its date and its caveats;
- a test is found to pass while broken — those entries are the most valuable in
  the document, and this project has produced several.

Two things it must keep doing:

- **Explain the vocabulary.** Any acronym introduced in the narrative gets a line
  in the glossary at the end. A reader who does not know what DCC, dma-buf or ABI
  means must still be able to follow.
- **Stay honest about what is not proven.** Where a measurement is a floor, a
  best case, or taken on unrealistic input, say so next to the number rather than
  letting the table imply more than it showed.

## Commands

| | |
|---|---|
| **`just`** | **the gate before a commit: `check` + `gpu-test`** |
| `just check` | Rust + Python + page: fmt, lints, tests, page stamp — exactly what CI runs |
| `just gpu-test` | the tests only this machine can run (no GPU on CI) |
| `just front-build` | rebuilds the page into the worker's source tree, and stamps it |
| `just browser-watch` | what the page renders over a minute, without restarting anything |
| `just end-to-end` | the whole chain against a real Dolphin and ROM |
| `just fix` | auto-format, auto-fix lints |
| `just audit` | advisories + licences (blocking) |
| `just miri` | undefined-behaviour check on FFI |

## Conventions

- **Prose**: plain words, active voice, one idea per sentence. No em dashes, no
  decorative emoji in headings, no metaphor where a concrete word exists
  ("ratchet", "harness", "surface" as nouns). This applies to comments, the
  logbook and commit messages. It does not license writing less: rule 1 still
  wants the reason, stated plainly.
- **Commits**: Conventional Commits with an emoji, subject states the intent
  (`fix(input): 🎮 reject unknown button bits instead of masking them`).
  **Never** add AI attribution or `Co-Authored-By`.
- **Never commit unless explicitly asked.**
- Keep this file current: when a rule is corrected, strengthen it here so the
  mistake cannot recur.
