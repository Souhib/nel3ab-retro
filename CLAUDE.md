# AGENTS.md

Guidance for AI agents and humans working in this repository.

## Project

Self-hosted retro cloud-gaming rooms: one emulator instance per room, up to four
browser players, server-side GPU emulation and encoding. Read
[`docs/adr/0001-architecture.md`](docs/adr/0001-architecture.md) first — it holds
the decisions and their reasons.

[`docs/etat-du-projet.md`](docs/etat-du-projet.md) is the dated entry point for
resuming work: delivered features, evidence, replaced approaches and remaining
questions. Check the working tree as well as commits; an installed change may
still be uncommitted. Do not infer deployment or remote CI status from either.

For Zelda performance, read the current hand-off at the top of
[`docs/plan-60fps-switch2-2026-11-08.md`](docs/plan-60fps-switch2-2026-11-08.md).
It separates the installed engine, qualified private candidates, rejected
experiments and the exact next action. Its filename retains the former target;
the current request is at least 40 constant game frames per second.

[`docs/carnet-de-bord.md`](docs/carnet-de-bord.md) is the same story told for a
human: how the project was built, what fought back, and what every acronym means.
Start there if you want the reasoning rather than the ruling.

[`docs/ecran-manettes.md`](docs/ecran-manettes.md) is a hand-off note for one
screen — the two live controller diagrams under `touches`. Read it before
touching `lib/padmap.ts`, `lib/wiring.ts` or `components/Wiring.tsx`: the invariant
it states (one frame, three readings) is not visible in any of them.

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

- **A new merge is not necessarily a new experiment.** On 2026-11-11, the merge
  of PR1095 was initially treated as a new lead although its exact head had
  already been tested on 2026-11-09 without repeatable gain. Search the reports
  and logbook by PR number and head hash before preparing a port. Retain the
  earlier result and name the changed baseline or implementation that justifies
  a bounded retry.
- **Red-first for every bug fix.** Verify by reintroducing the bug, not by reasoning.
- **A reintroduced bug must still let its regression test run.** On 2026-11-11,
  restoring an entire old identity module removed an export used by the new
  tests. Type checking stopped before the browser exercised the missing menu
  refresh. Retain the fixture's callable interface, reintroduce the missing
  application action, and require the named behavioural failure. A failed build
  is not that evidence.
- **A negative twin for every positive assertion.** "Accepts 1..=4" is worthless
  without "rejects 0 and 5".
- **Never assert behind a condition that can silently be false.** Assert the
  precondition instead of branching on it.
- **An extracted callback needs the same explicit dependencies and module context.**
  On 2026-11-11, a browser callback fixture omitted its `assert` dependency and
  stopped before checking activation. Its first repair runner used Node's
  `--eval`, which exposed that name and hid the reintroduced defect. Execute the
  fixture as a real module, require the expected failure, and keep missing-fixture
  errors separate from a rejected application action.
- **A screenshot name does not prove its scene.** Read the game's location.
  On 2026-11-08, `resumed-house` still showed « Kokiri Forest »: the save
  roundtrip proved a restored position, not the claimed zone transition.
  A fixed startup delay does not prove readiness either: on 2026-11-08 a
  20-second audio/video driver captured the title menu after sending input
  during loading. Observe the expected screen and exercise its black/loading
  and unrelated-scene negative twins before accepting a capture.
  A visible menu can still ignore input during its fade. On 2026-11-10,
  a matching Continue screen accepted by an image classifier ignored a requested
  180 ms press. Keep that transition as a negative fixture, require the observed
  contrast and consecutive stable recognitions, and observe the resulting screen
  before sending the next command. Matching text alone does not prove input readiness.
  The same timed inputs do not prove the same route. On 2026-11-10, one private
  cache trial entered a furnished room while its counterpart stayed outside the
  door. Both completed normally. Their images invalidated the comparison, so the
  remaining phases were stopped and no cache performance gain was claimed.
- **Keep a guard and its dependent action in one checked transaction.** On
  2026-11-10, a failed Python budget assertion did not stop the next shell line
  from sending a private game input. A newline is not an execution dependency.
  Run the action inside the checked controller or explicitly require success.
  Derive a trial label from its actual directory and test every bootstrap through
  the real seed copy before starting a cohort. A copied literal `A1` stopped B1
  before emulator launch that day; reintroducing it must fail the ownership check.
- **Coverage is a signal, never confidence.** It measures "executed by a test",
  not "reached by the app".
- **Publish success only after the last required check.** On 2026-11-11, a CPU
  profiler probe wrote `passed=true` before its independent decoder failed.
  The process exit and missing final check invalidated that flag. Keep an
  incomplete result false, and require both the final receipt and process status.
- **Relocating a bank must account for data and historical evidence too.** On
  2026-11-11, a script-only copy omitted the loader's `policy.json`. The next
  copy retained that input but rewrote twenty historical evidence paths to
  nonexistent files in the new bank. Both were caught before measurement.
  Enumerate copy, rebind or retained-external dispositions from the frozen
  manifest. Exercise the actual dependency closure and freeze before admitting
  a room. File extensions do not define the inputs, and historical evidence
  must keep its original path and expected content hash.
- **A live measurement on a drifting machine ALTERNATES.** Two successive phases
  never prove anything there: whatever runs second inherits a warmer cache, a
  fuller shader store, a calmer scene. On 2026-09-16 that mistake was made twice
  in one evening, once in each direction, before four alternating phases of three
  minutes settled the question. Alternate, or say plainly that the result is a
  trend and not a comparison.
- **A silent control proves nothing for the treated arm.** On 2026-11-19, a
  retention-margin trial had 48 routes without a freeze, but its control had
  almost stopped freezing for four hours: the defect's frequency changes by
  period, from 5 % to 44 % of routes. Keep the arm known to show the defect
  in the same alternation and require it to show the defect before counting
  the treated arm. One control that night was not one: the engine lowered its
  own retention limit mid-run after a foreign GPU client appeared. Verify a
  setting over the whole run, not only its startup line. The route counter
  also looked only at the second where the first freezes fell, and counted
  an unread last route as clean. Count from a per-frame trace, and report an
  uncovered route separately.
- **Do not measure a machine while loading it.** The same evening, a comparison
  ran with the profiler still recording and a `perf report` started in the middle
  of it; the freezes of that window were partly mine.
  Include automatic observers in that check. On 2026-11-10 the black box
  profiled a private shader warm-up and triggered its interference guard.
  Controlled runs pause that observer only after verifying no live game,
  restore its initial state in every exit path, and start from a clean seed
  after an interrupted compile. Never reuse its partial cache as a completed
  preparation or stop an unidentified external profiler.
  CI is not the only competing load. On 2026-11-10, Jellyfin used Vulkan and
  VAAPI on the same render node during all four CPU-affinity phases. The
  compiler/emulator process guard missed it, so the comparison was withdrawn.
  Check actual GPU descriptor ownership before and during trials, including
  private browser descendants. A reused PID is not an ownership proof. A name
  can change during the same process, so identity uses PID and start time only. Keep
  driver fdinfo statistics outside timed trials until their cost is qualified;
  the periodic guard uses descriptor metadata and sysfs device identity only.
  A polling guard still cannot exclude work created and closed between scans.
- **A worker gap does not prove an empty CI queue.** On 2026-11-09, a new
  worker entered the first Zelda comparison after the previous one exited.
  Check active and waiting work that can run here for every repository registered
  by local runners, then check local processes again. A remote-only workflow may
  be excluded only after its actual job placement and remaining job routing are
  proved; on the same day a hosted Souverain job exposed an overbroad queue guard.
  Pin that proof to its workflow revision and attempt; unknown routing still blocks.
  Keep monitoring
  during the phase: a new workflow can still arrive after an empty-queue check.
  Stop and exclude an affected phase, and prove actual process cleanup.
- **Compare effective settings as well as raw configuration.** On 2026-11-09,
  saving Game0 normalized its derived `default` flag to true while NoSharpening1
  kept false. Preserve the raw difference and trace both loading and saving:
  metadata normalization alone does not establish a second changed parameter.
- **The last log timestamp is not the current time.** On 2026-11-08 it lagged
  seven seconds and admitted a preparation window into a gameplay measurement.
  Bound the observed phase with its recorded wall time and the process or
  container start, then retain only complete presentation windows inside it.
  A message saying "last 10 seconds" is not evidence of that duration either.
  On 2026-11-10, runtime pipeline totals were emitted only when another build
  completed; one summary covered about 60.21 seconds. Derive its bounds from
  the actual counter initialization/reset and emissions. Do not assign an
  aggregate wait to a single observed freeze without an event identifying it.
  A profiler timestamp may use a different clock too. On 2026-11-11, direct
  comparison of default perf timestamps with Python's monotonic ACKs selected
  no samples from a valid CPU probe. Pin `CLOCK_MONOTONIC` and verify both
  `use_clockid` and `clockid` in the actual recorded attributes. Then filter by
  the actual ACK bounds: five of 159 samples in the corrected CPU probe still
  preceded its enable acknowledgement. A decoder/count agreement does not
  establish the clock domain or the observed interval.
- **The input driver needs its own evidence.** On 2026-11-10, the browser
  movement driver exited 143 while the emulator kept running; its final report
  and buffered directions were lost. Record commands and phase bounds as they
  happen, release inputs on handled signals, and reject an incomplete phase.
  A healthy emulator or a midpoint image does not prove the driver finished.
  Later that evening, an interference guard closed the browser while its detached
  input controller continued. Signal the identified controller, wait and reap it,
  then close its page. Verify actual key-up delivery separately from CPU doubles.
  Audit only recorded own process identities and pad tokens: four pads from a
  real user room are not leaked test resources.
- **CPU doubles do not prove platform-header compatibility.** On 2026-11-09,
  the WSI producer fixture passed while the real Vulkan translation unit failed:
  X11's `Success` macro replaced a helper enum. Keep the full platform build,
  reproduce such collisions in a header test, and preserve the platform macro
  rather than hiding it with a global undefinition.
  The final link also belongs to that proof. On 2026-11-11, all changed native
  translation units compiled, then ThinLTO aborted because its cache inherited
  the read-only parent mount. Derive writable cache mounts from the actual
  compiler and linker commands. Reintroduce the missing mount with unique real
  inputs so a warm cached object cannot hide the failure.
- **Prove that the tested executable contains the changed code.** On 2026-11-08,
  copying prepared sources with preserved timestamps made Ninja reuse older
  GPU objects. The new helper's unit test passed while the emulator still ran
  its original wait. Give changed inputs fresh timestamps, inspect the rebuilt
  translation units, and require a runtime activation marker or equivalent
  code evidence. A changed executable hash alone can come from version metadata.
  All runtime helpers take their expected executable identity from the same
  frozen package manifest. On 2026-11-10, a new candidate loaded correctly but
  an affinity helper still carried the previous ELF hash and stopped the trial
  before measurement. Exercise every helper against the selected executable,
  including rejection of the old hash before its dependent action. A successful
  seed-copy bootstrap does not cover these later runtime guards.
  The same per-trial selection supplies configuration identity. Later that day,
  the runtime reader still opened the common A file while B had its own package.
  The identity guard stopped B before measurement. Exercise each actual reader
  through every real bootstrap's files, including the opposite-arm file; a
  validator given already-selected JSON cannot prove its caller selects it.
  The first reader fixture covered candidate selection but omitted the initial
  policy read, and the next B stopped for that second shared-file lookup. Cover
  policy, candidate and package together. Remove common native configuration
  fallbacks when arms differ so even A exposes a stale shared reader.
  On 2026-11-11, a fresh inventory still accepted all 757 old paths while a
  newer user profile and the installed shader cache lay outside its selected
  roots. Derive protected roots from the current installed title, including
  sibling profiles and caches, and exercise file creation as well as changed
  bytes. Rehash before and after a trial, never during its timed phase.
  The five seed-copy bootstraps still missed later spawned dependencies that
  day: an affinity negative called a missing script and F1 started B1's watchdog.
  Exercise the actual helper argv and dependencies for every trial, including
  failure teardown. Require a real watchdog readiness receipt before starting
  the worker; successful seed copying and syntax checks do not establish it.
  The loader-call fixture still began after its top-level namespace check:
  moving v2 to v3 left a basename regex behind and stopped the real entry.
  Derive a cohort's identity from its actual module path. Exercise both the
  ordinary entry and any validation mode through that same early guard,
  before admitting a room, rather than testing only a later block of calls.
  Relocating a candidate that contains absolute paths changes its digest too.
  The next copy still carried a constructor's old literal digest. Bind candidate
  path, digest, trial and revision in the selected package, and exercise the
  actual constructor on those current bytes before creating any private room.
  Unchanged source after path substitution does not prove its literals remain valid.
  The next runtime reader retained that old digest after the constructor passed.
  Re-exercise every complete reader against all current per-trial files after
  relocation, with explicit external-system doubles and stale-digest mutants.
  Compile an extracted or mutated Python body under its actual archived source
  path and record its hash; using the current file's name can print unrelated
  current lines in the mutant traceback and misidentify the failure.
- **Speculative compilation must preserve the instruction page cache too.** On
  2026-11-10, extracted real callback bodies returned an old instruction after
  a page-fill interleaving and a consumed JIT invalidation in a CPU double.
  Purging translated blocks did not refresh their source page. Exercise that
  interleaving and completed invalidations, then check actual callers and locks.
  A deterministic double does not prove occurrence in a game or a complete
  correction of mapping, full-cache and backing-memory lifetime cases.
- **Count which GPU programs were actually timed.** On 2026-11-08, rotating an
  index over a changing program list left a frequent program untimed after 128
  captures, despite only 77 programs being observed. Report observed and timed
  identifiers separately, and target persistent gaps before ranking costs.
- **A zero-valued environment flag may still be active.** On 2026-11-09,
  Lichii tested `getenv("EDEN_NX2_NO_MESH") != nullptr`, so `=0` still skipped
  mesh draws. Omit presence-based flags to disable them. Verify the actual
  process environment and exercise both presence and absence before accepting
  a negative control. Scalar settings such as split mode keep their zero value.
- **Zero disagreements require exercised comparisons.** On 2026-11-09,
  Lichii mode 0 reported no uniform disagreements because its delta paths
  require GPUBack. Require positive verified counts in the observed phase.
  Also check whether a verifier replaces the candidate with the reference:
  `UBO_KEEP_VERIFY` does, so it cannot certify execution of a corrected keep.
  On 2026-11-09, `GPU_PROFILE` also disabled Maxwell3D's fast dispatch, bypassing
  the state-write branch under test. Require actual candidate activation with
  compatible diagnostics; a slow-path profile is not its unprofiled cost budget.
- **A diagnostic summary may omit another class of disagreement.** On 2026-11-09,
  Lichii's front verifier reported zero ordinary-register differences while
  warning about sixteen shadow-register differences. Shadow warnings then
  reached their process-wide limit. Check every class and retain uncapped
  cumulative totals; silence after the warning limit cannot prove recovery.
  The same verifier resynchronized against shadow state before pending writes,
  making a later macro produce zero instead of `0x1234` in a real-queue fixture.
  When a verifier changes state, exercise both its comparison and the later
  use of that state, with pending work and an intentionally wrong value.
- **No lost samples does not prove complete call stacks.** On 2026-11-09,
  a CPU profile lost no samples but lacked a usable DWARF chain for 75.26%
  of sampled cycles, including 89.83% on GPUBack. Report leaf-symbol and
  call-chain coverage separately. Do not infer a caller from a resolved leaf
  or rename unknown library instructions as a known function.
  On 2026-11-10, `addr2line` on stripped libc assigned internal addresses to
  the nearest exported `__nss_database_lookup`; those labels were withdrawn.
  Require matching debug information or a proven function range before naming
  an unresolved instruction. Keep the actual mapped libraries and guest JIT
  map before container cleanup. An optional perf header warning also requires
  an independent data-record audit before accepting the decoded samples.
  Capture scheduler switches with their counters: a later disabled switch does
  not erase observed earlier counter increments or prove no scheduling delay.
  A short user stack is not an unwound call chain. On 2026-11-11, eight captured
  bytes identified copy return sites only after proving the exact library's
  stack invariant, matching sampled user IP and registers, and checking the
  actual CALL instructions. Keep valid ABI entry and an intact return slot as
  explicit preconditions; a tail call can preserve an earlier caller's return.
  Read actual perf attributes and event IDs: the stack option added a tracking
  event and moved the identifier ahead of IP. Its real game capture also emitted
  298,960 MMAP2 records, absent from the CPU fixture. A whole-phase remap guard
  may merge their exact address union by PID, but must preserve holes and compare
  the result with an independent endpoint calculation before dropping repetitions.
  Keep that profiling cost separate from an uninstrumented performance claim.
  Validate full-size metadata costs too. On 2026-11-11 a context fixture kept five
  maps, while the real snapshots contained over 26,000; rebuilding their identity
  index for every map made offline analysis quadratic. Require one identity
  evaluation per input map and compare selection with an independent sorted join.
  A sampled size is not a byte counter: the same 64 KiB copy can be sampled more
  than once. Name it as the current segment request, not total copied bytes.
- **Bound an observer failure by its whole invocation, not just its final error.**
  On 2026-11-11, an inventory failed on a vanished private browser after its
  timed phase. The observer began 1.406 seconds after the recorded phase end;
  the generic error did not establish a foreign GPU client during measurement.
  Keep the failed global gate and raw files unchanged. A separate adjudication
  must bind the actual inputs and process identities, reject overlapping or
  missing bounds and recycled PIDs, and state its narrower scope. An explicit
  browser-close receipt may come after a launcher's automatic signal handler
  has already closed it; that receipt alone does not bound the actual close.
- **A warm-up must not make the timed write optional.** On 2026-11-11, removing
  every timed memcpy still passed a real GPU post-readback because the warm-up
  already held the expected pattern. Change the checked source blocks after
  prevalidation and before timing; reintroduce the skipped-copy mutant and require
  its rejection after the timed loop for every accepted memory policy. Keep the
  mutant's byte counters and rates excluded even when the old validator says pass.
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

Run **`just`** (which is `check` + `gpu-test` + `clip-audio-test` +
`switch-saves-test` + `switch-capture-test`) locally, then watch the run. A
failing early step means the later gates were **skipped, not passed**.

The local gate also runs `switch-saves-test` and `switch-capture-test`. The adapter
and capture now serve the main room; their filesystem and packet tests must not
remain optional prototype checks. `switch-controls-test` additionally verifies
four disposable kernel controllers and browser inputs when that path changes.

The local gate also runs `clip-audio-test`, which requires ffmpeg and ffprobe.
The CI runner has neither. On 2026-09-06 the existing clip driver was found to
accept a video-only MP4: checking that an image opens does not prove sound.
The fixture must decode known stereo audio and verify its start and its signal.

Two halves, and neither covers the other:

- **`just check`** is the shared code-quality recipe used by the CI `quality`
  job. CI also scans secrets and runs separate documentation and supply-chain
  jobs; those are not included in `check`. Run `just docs` for prose and
  `just audit` for the Rust advisory and licence checks. A local pass is not a
  remote CI result. Never put `check` in the same command as `git push`: the push
  has to be a decision taken *after* reading the result. That rule exists because the output
  was ignored three times, the third after an earlier spurious red had taught
  the eye to skip it.
- **`just gpu-test`** covers the GPU paths CI structurally cannot prove. The runner has
  no GPU, so the dma-buf import, the compute pass and the encode are invisible
  to it — a green pipeline says nothing about the half of this project that
  matters most.

Tests must never inherit the live worker control address or persistent state.
Worker fixtures also override `NEL3AB_PERSONAL_SAVE_ROOT`: since 2026-11-10,
personal Dolphin saves can live outside the numbered room. Test new-game and
resume with two authenticated identities whose cleaned names collide, and the
same nickname. A pending new-game request must name its game and account,
must not reset either on mismatch, and must be consumed before a process restart
can repeat it. Keep and test the previous progression's history.
Save-menu changes additionally run `just save-options-test`: four console
menus read real import receipts and lose the unlocked option when payloads are
removed, without booting a game. A directory name or an ordinary played save is
not proof of a complete import.
Integration fixtures override `NEL3AB_WORKER_CONTROL` before constructing settings
and use temporary storage. Tests that exercise TCP bind an ephemeral loopback
port. On 2026-09-06, a mock HTTP worker was found alongside the real default
control port: mocking `/roms` alone does not isolate owner announcements.
An isolated lobby must also replace the numbered-room registry before its
background watcher starts. `Salons` derives 8110/8111 for room one and overrides
the supplied worker addresses. On 2026-11-07 this made a private browser driver
query the installed room while its media test passed. Assert the lobby's actual
game, named seat and spectator as well as the worker's catalogue. Disable
installed service lifecycle commands in that fixture.
HTTP tests must include long cookies and fragmented headers. Read through the
header terminator before routing or closing a response; a single socket read
does not prove the request is complete. On 2026-10-16, reading only 2048 bytes
left cookies unread and reset the connection before the room page arrived.
Short requests from a clean browser had hidden the blank page seen by a user.
Browser network tests must prove the input socket has actually disconnected.
An offline toggle or a throttle setting alone is not that proof. A close handshake
without its reply must be exercised: it exposed a stale local seat on 2026-09-06.
An isolated real room also gives its proxy separate configuration and data
directories, with automatic config persistence disabled. A separate listening
port does not prevent Caddy from overwriting the user's restart configuration.

Media-load comparisons must preserve actual server subscription counts and
validate each role. On 2026-11-10, the spectator deliberately opened no input
socket and did not request sound before an in-room gesture. Check the exposed
test API: its audio object is narrower than internal `SoundStats`. Preserve
encoded pictures during decoder-free phases and decode them outside the phase.
Use the last picture's timestamp, not a later header-only packet's timestamp.
On 2026-11-11, a reconnected page held its local seat while the lobby still
announced that seat without its player name. Wait for the actual server's
chosen game, named seat and spectator state within a bounded deadline; a local
socket and seat alone do not prove that announcement has arrived. Validate a
manual visual-review receipt through the actual consumer guard before
publishing it: a missing room path stopped another launch that day.

Register a new emulator's actual kernel process name with the black box as well
as its console with the room. On 2026-11-07, `eden-cli` was absent from the
observer: Zelda was marked idle, its metrics lost, and GPU allocator reads
allowed during play. Exercise the real process scanner through the service
with fake system files, including an unrelated process as the negative twin.
Also cover engine-specific capture branches. A mocked engine list cannot
prove that the installed emulator will ever reach those branches.

An image that runs the emulator may still fail its room adapter. On
2026-11-10, the qualified native image lacked `evdev` in the Python environment
selected by the real pad command. The browser waited 120 seconds without any
emulator starting. Before using a new image in a room, exercise that exact
helper command with production permissions and disposable controllers; prove
their kernel state and disappearance after stop. A host import or a different
Python interpreter does not cover this path.
Frozen launch artefacts also record executable permissions, not just content
hashes. On 2026-11-10, a private `run-cli.sh` retained mode 0664 and failed with
errno 13 before the native client. Exercise direct subprocess launch under the
real container UID and mounts; a syntax check or reading the script cannot
prove the kernel will execute it.

A stopped `docker exec` client does not prove its container process has exited.
On 2026-09-08, capture restarts left four producers mixing video and sound in the
Switch prototype and invalidated the measurements. Capture services must stop
and wait for the process inside Docker, refuse a second producer, and verify
that no recorder or audio reader survives their stop before a new measurement.
Recovery tests must suspend both video and sound producers, not only kill an
encoder. On 2026-09-08, the audio watchdog reached its deadline but a blocking
read still prevented shutdown. Pipe reads must let the stop request through,
and tests must prove this while the writer remains alive and silent.


Switch controller changes also run `just switch-controls-test`. It creates four
isolated virtual devices and reads their kernel state after real browser input.
Kernel state is not what the game receives. On 2026-09-11 the test expected the
same wrong code as the helper, and the page's X reached every game as Y. A
button change is also checked in a game that shows which button it read.
Checking a serialized message alone does not prove its axis scale survives the
bridge: on 2026-09-08 an extra multiplication saturated already 16-bit sticks.
Its individual setup must block game input and accept the first new key after
closing at rest. Test this through the native dialog: its asynchronous close
event once cleared that key a second time after the unit-tested reader accepted it.
The same driver exercises real force-feedback events for all four players,
then refuses vibration delivery and verifies that buttons still work. Use the
production helper launch arguments and ingress, including their permissions.
On 2026-09-09 the test helper had DAC_OVERRIDE, unlike the installed helper;
it hid a permission failure that destroyed all four pads on the first vibration.

Hence the split between the `vaapi` feature (compiles the FFI, needs only
headers) and `gpu-tests` (needs a real device). They were one flag until the
worker depended on `vaapi` for real: Cargo unifies features across a workspace,
so `cargo test --workspace` started running GPU tests on a runner that has none.

The way to close the gap properly is a self-hosted runner on lgf. Worth doing
when more than one person commits.

### 8. The page is a committed artefact, and it can go stale

`core/crates/worker/src/page/index.html` is built from `front/` and compiled into the
binary. Change anything under `front/src` and you must run `just front-build`
and commit the result, or the worker ships yesterday's page.

`just check` catches it through a stamp over the build inputs plus the hash of
the page that build produced (`front/stamp.mjs`, ADR D13). Do not replace that
with a rebuild-and-diff: the minifier renames locals differently between runs of
identical sources, so it goes red for no reason, and a check that is red for no
reason is a check people learn to skip.

Browser drivers against a temporary worker compare its served HTML hash with
this artefact before exercising the page. Building the front end and running
`cargo test` does not rebuild the executable in `target/debug`. On 2026-09-07,
a direct driver invocation tested the previous controller screen until a new
assertion exposed it. Use the `just` recipe that builds the worker first.

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

When a later experiment replaces a conclusion, retain the dated account and add
a pointer to the replacement. Update the current entry pages and hand-off notes
in the same change. On 2026-09-09, the logbook described an installed Switch
integration while the study still presented it as future work. History and a
current setup guide must not give contradictory instructions to the next reader.
Building `just docs` refreshes the `site/` directory served by Caddy; editing
Markdown alone does not update the site.

## Commands

| | |
|---|---|
| **`just`** | **the gate before a commit: `check` + `gpu-test` + `clip-audio-test` + `switch-saves-test` + `switch-capture-test`** |
| `just check` | Rust + Python + page: the shared code-quality recipe used by CI |
| `just docs` | strict documentation build; also refreshes the site served by Caddy |
| `just gpu-test` | the tests only this machine can run (no GPU on CI) |
| `just front-build` | rebuilds the page into the worker's source tree, and stamps it |
| `just browser-watch` | what the page renders over a minute, without restarting anything |
| `just boite-noire` | reads the black box: machine and page cadence per ten seconds, then the day's captures |
| `just end-to-end` | the whole chain against a real Dolphin and ROM |
| `just fix` | auto-format, auto-fix lints |
| `just audit` | advisories + licences (blocking) |
| `just clip-audio-test` | exports a real MP4 and decodes its audio with ffmpeg, without a running room |
| `just miri` | CPU bitstream/parser tests under Miri; the GPU FFI feature is not enabled |

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
