//! The Dolphin process, from spawn to reap.
//!
//! # Why `-p headless` is passed explicitly and never left to default
//!
//! Without it, `GetPlatform` falls through `x11 → fbdev → headless` by *name
//! matching only*: it returns the first candidate without checking whether it
//! initialises, and `main` then fails on `!s_platform->Init()`. On a server with
//! no display, `PlatformX11::Init` calls `XOpenDisplay(nullptr)`, fails, and
//! Dolphin exits with "No platform found, or failed to initialize." There is no
//! retry and no fallback. The message reads like a broken build and is not.
//!
//! # The user directory is per session, and that is the point
//!
//! `--user` puts config, pipes and dumps in a directory we own. It keeps runs
//! from colliding with `~/.dolphin-emu`, keeps two sessions from sharing a
//! `GCPadNew.ini`, and leaves the exact configuration that produced a run
//! sitting on disk to be read afterwards — which a command line buried in a
//! process list does not.
//!
//! # Known limitation: an orphan is possible
//!
//! If the worker is `SIGKILL`ed, Dolphin survives it. The usual fix is
//! `prctl(PR_SET_PDEATHSIG)` in a `pre_exec` hook, and `pre_exec` is `unsafe`,
//! which this workspace forbids outside the FFI module that M2 will justify
//! properly. So the guarantee here is narrower and stated rather than implied:
//! [`Session::shutdown`] and the `Drop` fallback cover every exit the worker can
//! observe. M3 runs Dolphin in its own container, where the runtime reaps it,
//! and that is the real answer.

use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use nel3ab_protocol::InputFrame;
use nix::sys::signal::{self, Signal};
use nix::unistd::Pid;

use crate::config::{self, CONFIG_DIR};
use crate::error::EmulatorError;
use crate::pipe::{Delivery, PadWriter, PendingPipes, Pipes};
use crate::slots::SlotSet;

/// How often shutdown checks whether Dolphin has exited.
const REAP_POLL_INTERVAL: Duration = Duration::from_millis(25);

/// Dolphin's video backends, by the name its config actually stores.
///
/// The strings are `CONFIG_NAME` from each backend's `VideoBackend.h` — note
/// that Software's is two words. An unrecognised name is not an error in
/// Dolphin; it warns and silently substitutes the default, so a typo here would
/// surface as "the wrong backend was used", months later, in a benchmark.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum VideoBackend {
    /// Hardware rendering through Vulkan.
    ///
    /// The default, and headless-friendly: Dolphin sets
    /// `enable_surface = wsi.type != WindowSystemType::Headless`, so it needs
    /// neither a surface nor a swapchain — no `VK_EXT_headless_surface`, and it
    /// works on any conformant driver.
    #[default]
    Vulkan,
    /// Hardware rendering through OpenGL.
    OpenGl,
    /// CPU reference rasteriser. Exact and very slow.
    Software,
    /// No rasterisation at all. Boots a game without drawing it.
    Null,
}

impl VideoBackend {
    /// The string Dolphin stores and matches on.
    #[must_use]
    pub const fn config_name(self) -> &'static str {
        match self {
            Self::Vulkan => "Vulkan",
            Self::OpenGl => "OGL",
            Self::Software => "Software Renderer",
            Self::Null => "Null",
        }
    }
}

/// Dolphin's config systems, by the name `-C` matches on.
///
/// `GetSystemFromName` returns an empty optional for anything else, and the
/// caller **drops the override without a word**. So the set is closed here and
/// a bad name becomes an error before the process starts.
const KNOWN_SYSTEMS: [&str; 12] = [
    // Note the two that do not match their file or enum: `Dolphin` is
    // `System::Main` (it names Dolphin.ini), and `Graphics` is `System::GFX`.
    "Dolphin",
    "GCPad",
    "Wiimote",
    "GCKeyboard",
    "Graphics",
    "Logger",
    "SYSCONF",
    "DualShockUDPClient",
    "FreeLook",
    "Session",
    "GameSettingsOnly",
    "Achievements",
];

/// One `-C <System>.<Section>.<Key>=<Value>` command-line override.
///
/// A struct rather than a string because Dolphin parses that argument with three
/// `getline` calls on `.` and `=` and discards anything it cannot make sense of,
/// silently. Validating the parts up front turns every one of those silent
/// discards into an error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigOverride {
    system: String,
    section: String,
    key: String,
    value: String,
}

impl ConfigOverride {
    /// Builds an override, rejecting anything Dolphin would drop or truncate.
    ///
    /// # Errors
    /// [`EmulatorError::InvalidOverride`] for an unknown system, an empty part,
    /// or a separator character inside a part.
    pub fn new(system: &str, section: &str, key: &str, value: &str) -> Result<Self, EmulatorError> {
        if !KNOWN_SYSTEMS.contains(&system) {
            return Err(EmulatorError::InvalidOverride {
                field: "system",
                value: system.to_owned(),
                reason: "not one of Dolphin's config systems; it would be dropped in silence",
            });
        }
        for (field, part) in [("section", section), ("key", key)] {
            if part.is_empty() {
                return Err(EmulatorError::InvalidOverride {
                    field,
                    value: part.to_owned(),
                    reason: "empty",
                });
            }
            if part.contains('.') || part.contains('=') {
                return Err(EmulatorError::InvalidOverride {
                    field,
                    value: part.to_owned(),
                    reason: "contains a separator, which shifts every later field",
                });
            }
        }
        if value.contains('=') {
            return Err(EmulatorError::InvalidOverride {
                field: "value",
                value: value.to_owned(),
                reason: "Dolphin reads the value up to the first '=' and truncates the rest",
            });
        }
        Ok(Self {
            system: system.to_owned(),
            section: section.to_owned(),
            key: key.to_owned(),
            value: value.to_owned(),
        })
    }

    /// The argument as Dolphin expects it after `-C`.
    #[must_use]
    pub fn to_argument(&self) -> String {
        format!(
            "{}.{}.{}={}",
            self.system, self.section, self.key, self.value
        )
    }
}

/// Everything needed to start one emulator instance.
#[derive(Debug, Clone)]
pub struct DolphinConfig {
    /// Path to `dolphin-emu-nogui`.
    pub binary: PathBuf,
    /// The game image to boot.
    pub game: PathBuf,
    /// Directory Dolphin will use for config, pipes and dumps.
    pub user_dir: PathBuf,
    /// Which controller ports this session serves.
    pub slots: SlotSet,
    /// Quelle manette ces places présentent au jeu.
    ///
    /// Une seule des deux, jamais les deux: voir [`crate::config::PadKind`].
    pub pads: crate::config::PadKind,
    /// Renderer to use.
    pub video_backend: VideoBackend,
    /// Extra `-C` overrides, applied above the generated files.
    pub overrides: Vec<ConfigOverride>,
    /// Where the patched build should offer its rendered frames, if anywhere.
    ///
    /// `None` leaves the export entirely inert — the patch checks for the
    /// variable and does nothing without it, which is why an unpatched Dolphin
    /// and a patched one behave identically here.
    ///
    /// The path must be reachable by the emulator process. When it runs in a
    /// container, that means inside a directory both sides see at the same path
    /// — `user_dir` is already one.
    pub frame_socket: Option<PathBuf>,
    /// Où Dolphin doit écrire la vibration, quand on veut la recevoir.
    ///
    /// Un second tube, à côté de celui du son, et le troisième patch du projet
    /// est ce qui le remplit: l'interface d'entrée par tube est à sens unique,
    /// donc sans lui la vibration reste dans l'émulateur.
    pub rumble_pipe: Option<PathBuf>,
    /// How long to wait for Dolphin to open the input pipes.
    pub startup_timeout: Duration,
    /// How long `SIGTERM` gets before `SIGKILL`.
    pub shutdown_grace: Duration,
}

impl DolphinConfig {
    /// A single-player session with the defaults this project runs on.
    #[must_use]
    pub fn new(binary: PathBuf, game: PathBuf, user_dir: PathBuf, slots: SlotSet) -> Self {
        Self {
            binary,
            game,
            user_dir,
            slots,
            // La manette GameCube par défaut: c'est ce que fait un jeu
            // GameCube, et c'est ce que la salle faisait avant qu'une Wiimote
            // existe. Un défaut ne doit rien changer à ce qui marchait.
            pads: crate::config::PadKind::GameCube,
            video_backend: VideoBackend::default(),
            overrides: Vec::new(),
            frame_socket: None,
            rumble_pipe: None,
            // Dolphin reads a multi-gigabyte image, builds its shader cache and
            // brings up Vulkan before the input backend exists. Thirty seconds
            // is slack, not a measurement — the attach loop returns as soon as
            // the pipes open, so a generous bound costs nothing on a fast start
            // and avoids a spurious failure on a cold cache.
            startup_timeout: Duration::from_secs(30),
            shutdown_grace: Duration::from_secs(5),
        }
    }
}

/// A running emulator instance and its input pipes.
#[derive(Debug)]
pub struct Session {
    child: Child,
    /// Shared so a second thread can write pad state the instant it arrives
    /// rather than once per frame — see [`PadWriter`].
    pipes: Arc<Mutex<Pipes>>,
    user_dir: PathBuf,
    shutdown_grace: Duration,
    /// Set once the process has been reaped, so `Drop` knows there is nothing
    /// left to do and cannot signal a pid the OS may have recycled.
    exit_status: Option<ExitStatus>,
}

impl Session {
    /// Writes the config, creates the pipes, starts Dolphin, and waits until it
    /// is reading input.
    ///
    /// The order is forced by Dolphin and is not adjustable: it scans its pipe
    /// directory once during input-backend init, so every FIFO must exist before
    /// the process starts.
    ///
    /// # Errors
    /// Anything in [`EmulatorError`]. On failure the process is terminated
    /// rather than left behind.
    pub fn start(config: &DolphinConfig) -> Result<Self, EmulatorError> {
        write_config_files(config)?;
        let pending = PendingPipes::create(&config.user_dir, config.slots)?;

        let mut command = Command::new(&config.binary);
        command
            .arg("--platform")
            .arg("headless")
            .arg("--user")
            .arg(&config.user_dir)
            .arg("--video_backend")
            .arg(config.video_backend.config_name())
            .arg("--exec")
            .arg(&config.game)
            // Inherited, not piped. A piped stream nobody reads fills its 64 KiB
            // buffer and then blocks Dolphin inside `write` — the emulator would
            // freeze mid-game because of a logging choice. Draining it properly
            // needs a reader thread, which belongs with the rest of the
            // observability work, not here.
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .stdin(Stdio::null());
        if let Some(pipe) = &config.rumble_pipe {
            command.env("NEL3AB_RUMBLE_PIPE", pipe);
        }
        if let Some(socket) = &config.frame_socket {
            // Set on the child rather than on us: `std::env::set_var` is unsafe
            // in edition 2024 and forbidden here, and a process-wide mutation
            // would leak into every other test in the binary anyway.
            command.env("NEL3AB_FRAME_SOCKET", socket);
        }
        for over in &config.overrides {
            command.arg("--config").arg(over.to_argument());
        }

        let mut child = command.spawn().map_err(|source| EmulatorError::Spawn {
            binary: config.binary.clone(),
            source,
        })?;
        let pid = child.id();
        tracing::info!(pid, slots = config.slots.len(), "Dolphin started");

        let attached = pending.attach_all(config.startup_timeout, || match child.try_wait() {
            Ok(Some(status)) => Err(EmulatorError::ExitedDuringStartup { status }),
            Ok(None) => Ok(()),
            Err(source) => Err(EmulatorError::ProcessControl { pid, source }),
        });

        let pipes = match attached {
            Ok(pipes) => pipes,
            Err(error) => {
                // Never leave a half-started emulator holding the GPU. The
                // startup failure is what the caller needs to see, so a failure
                // to clean up is logged rather than returned in its place.
                if let Err(cleanup) = terminate_child(&mut child, config.shutdown_grace) {
                    tracing::error!(%cleanup, "could not stop Dolphin after a failed start");
                }
                return Err(error);
            }
        };

        Ok(Self {
            child,
            pipes: Arc::new(Mutex::new(pipes)),
            user_dir: config.user_dir.clone(),
            shutdown_grace: config.shutdown_grace,
            exit_status: None,
        })
    }

    /// Delivers one client frame to the pipe for its slot.
    ///
    /// # Errors
    /// See [`Pipes::send`].
    pub fn send(&mut self, frame: &InputFrame) -> Result<Delivery, EmulatorError> {
        self.pipes
            .lock()
            .map_err(|_| EmulatorError::PipesPoisoned)?
            .send(frame)
    }

    /// A handle another thread can use to write pad state.
    ///
    /// The point is latency: writing on the frame loop's schedule costs a whole
    /// frame period, measured, because the write lands at the same phase every
    /// time and that phase is just after the emulator polls. Writing on arrival
    /// makes the wait uniform instead of worst-case.
    #[must_use]
    pub fn pad_writer(&self) -> PadWriter {
        PadWriter::from(Arc::clone(&self.pipes))
    }

    /// Forces a full state transmission on the next send for every player.
    ///
    /// # Errors
    /// [`EmulatorError::PipesPoisoned`].
    pub fn resync(&mut self) -> Result<(), EmulatorError> {
        self.pipes
            .lock()
            .map_err(|_| EmulatorError::PipesPoisoned)?
            .resync();
        Ok(())
    }

    /// The process id, for logs and for anyone correlating with `ps`.
    #[must_use]
    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    /// The exit status if Dolphin has stopped, `None` while it runs.
    ///
    /// # Errors
    /// [`EmulatorError::ProcessControl`] if the process cannot be queried.
    pub fn try_status(&mut self) -> Result<Option<ExitStatus>, EmulatorError> {
        if let Some(status) = self.exit_status {
            return Ok(Some(status));
        }
        let pid = self.child.id();
        let status = self
            .child
            .try_wait()
            .map_err(|source| EmulatorError::ProcessControl { pid, source })?;
        if let Some(status) = status {
            self.exit_status = Some(status);
        }
        Ok(status)
    }

    /// Stops Dolphin and removes the pipes it was reading.
    ///
    /// Takes `self` by value so nothing can be sent to a stopped session. The
    /// `Drop` that runs at the end of this call sees the process already reaped
    /// and does nothing, so the two paths cannot both act.
    ///
    /// # Errors
    /// [`EmulatorError::ProcessControl`] if the process could not be signalled
    /// or reaped.
    pub fn shutdown(mut self) -> Result<ExitStatus, EmulatorError> {
        let status = self.terminate(self.shutdown_grace)?;
        self.remove_pipes();
        Ok(status)
    }

    fn terminate(&mut self, grace: Duration) -> Result<ExitStatus, EmulatorError> {
        if let Some(status) = self.exit_status {
            return Ok(status);
        }
        let status = terminate_child(&mut self.child, grace)?;
        self.exit_status = Some(status);
        Ok(status)
    }

    /// Removes the FIFOs this session created.
    ///
    /// Only the pipe directory, never the whole user directory: it also holds
    /// the config and any dumps, which are exactly what someone wants to read
    /// after a run went wrong.
    fn remove_pipes(&self) {
        let dir = self.user_dir.join(crate::config::PIPES_DIR);
        if let Err(error) = std::fs::remove_dir_all(&dir)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!(path = %dir.display(), %error, "could not remove the pipe directory");
        }
    }
}

impl Drop for Session {
    /// Last resort for the paths that never reach [`Session::shutdown`] — an
    /// error return, a panic unwinding through a caller, an early `return`.
    ///
    /// Everything is best-effort and logged: a `Drop` that can fail loudly turns
    /// one problem into two, and a worker must not panic.
    fn drop(&mut self) {
        if self.exit_status.is_some() {
            return;
        }
        tracing::warn!(
            pid = self.child.id(),
            "session dropped without shutdown; terminating Dolphin"
        );
        if let Err(error) = self.terminate(Duration::from_secs(2)) {
            tracing::error!(%error, "could not stop Dolphin during drop");
        }
        self.remove_pipes();
    }
}

/// `SIGTERM`, then `SIGKILL` once `grace` has passed.
///
/// `SIGTERM` first because Dolphin installs a handler for it that calls
/// `RequestShutdown()`, which stops emulation in order and flushes the memory
/// card. `SIGKILL` does none of that and can corrupt a save, so it is the
/// fallback rather than the method.
///
/// A free function because it is also needed on the startup-failure path, where
/// there is a `Child` but not yet a [`Session`] to hang it off.
fn terminate_child(child: &mut Child, grace: Duration) -> Result<ExitStatus, EmulatorError> {
    let raw = child.id();
    let control = |source| EmulatorError::ProcessControl { pid: raw, source };

    if let Some(status) = child.try_wait().map_err(control)? {
        return Ok(status);
    }

    let pid = Pid::from_raw(
        i32::try_from(raw).map_err(|_| EmulatorError::ProcessControl {
            pid: raw,
            source: std::io::Error::other("pid does not fit in a pid_t"),
        })?,
    );

    if let Err(errno) = signal::kill(pid, Signal::SIGTERM) {
        tracing::warn!(pid = raw, %errno, "SIGTERM failed; escalating");
    }

    let deadline = Instant::now() + grace;
    while Instant::now() < deadline {
        if let Some(status) = child.try_wait().map_err(control)? {
            tracing::info!(pid = raw, "Dolphin stopped on SIGTERM");
            return Ok(status);
        }
        std::thread::sleep(REAP_POLL_INTERVAL);
    }

    tracing::warn!(
        pid = raw,
        ?grace,
        "Dolphin ignored SIGTERM; sending SIGKILL"
    );
    child.kill().map_err(control)?;
    child.wait().map_err(control)
}

/// Writes `Config/GCPadNew.ini` and `Config/Dolphin.ini` into the user directory.
fn write_config_files(config: &DolphinConfig) -> Result<(), EmulatorError> {
    let dir = config.user_dir.join(CONFIG_DIR);
    std::fs::create_dir_all(&dir).map_err(|source| EmulatorError::WriteConfig {
        path: dir.clone(),
        source,
    })?;

    // `.asoundrc` goes at the top of the user directory, not in `Config`:
    // that directory IS `HOME` inside the container, and ALSA reads its
    // configuration from `$HOME/.asoundrc` with no help from anybody.
    let pipe = config.user_dir.join(config::AUDIO_PIPE);
    std::fs::write(config.user_dir.join(".asoundrc"), config::asoundrc(&pipe)).map_err(
        |source| EmulatorError::WriteConfig {
            path: config.user_dir.join(".asoundrc"),
            source,
        },
    )?;

    for (name, contents) in [
        ("GCPadNew.ini", config::gcpad_ini(config.slots)),
        // Écrit pour TOUS les jeux, pas seulement les jeux Wii. Une console
        // GameCube n'a pas de Wiimote et ce fichier ne lui coûte rien; brancher
        // l'écriture sur la console demanderait de la connaître ici, où on ne
        // sait que lancer un disque.
        (
            "WiimoteNew.ini",
            config::wiimote_ini(config.slots, config.pads),
        ),
        (
            "Dolphin.ini",
            config::dolphin_ini(config.slots, config.pads),
        ),
    ] {
        let path = dir.join(name);
        std::fs::write(&path, contents).map_err(|source| EmulatorError::WriteConfig {
            path: path.clone(),
            source,
        })?;
    }
    Ok(())
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;

    #[test]
    fn backend_names_are_the_strings_dolphin_stores() {
        // A wrong name is not rejected by Dolphin; it warns and uses the default.
        assert_eq!(VideoBackend::Vulkan.config_name(), "Vulkan");
        assert_eq!(VideoBackend::OpenGl.config_name(), "OGL");
        assert_eq!(VideoBackend::Software.config_name(), "Software Renderer");
        assert_eq!(VideoBackend::Null.config_name(), "Null");
        assert_eq!(VideoBackend::default(), VideoBackend::Vulkan);
    }

    #[test]
    fn an_override_renders_in_dolphins_grammar() {
        let over = ConfigOverride::new("Graphics", "Settings", "DumpFrames", "True").unwrap();
        assert_eq!(over.to_argument(), "Graphics.Settings.DumpFrames=True");
    }

    #[test]
    fn an_unknown_system_is_rejected_rather_than_silently_dropped() {
        // `GFX` is the enum's name and a very natural guess; the string Dolphin
        // matches is `Graphics`. It would be discarded without a word.
        let error = ConfigOverride::new("GFX", "Settings", "DumpFrames", "True").unwrap_err();
        assert!(
            matches!(
                error,
                EmulatorError::InvalidOverride {
                    field: "system",
                    ..
                }
            ),
            "got {error:?}"
        );
        // The same confusion in the other direction.
        assert!(ConfigOverride::new("Main", "Core", "CPUThread", "False").is_err());
    }

    #[test]
    fn the_systems_we_actually_use_are_accepted() {
        // Negative twin of the test above: rejecting the unknown is worthless if
        // it also rejects the two names this project depends on.
        assert!(ConfigOverride::new("Dolphin", "Core", "CPUThread", "False").is_ok());
        assert!(ConfigOverride::new("Graphics", "Settings", "DumpFrames", "True").is_ok());
    }

    #[test]
    fn separators_inside_a_part_are_rejected() {
        for (section, key, value) in [
            ("Core.Nested", "Key", "1"),
            ("Core", "Key=Other", "1"),
            ("Core", "Key", "a=b"),
            ("", "Key", "1"),
        ] {
            assert!(
                ConfigOverride::new("Dolphin", section, key, value).is_err(),
                "accepted {section}/{key}/{value}"
            );
        }
    }

    #[test]
    fn starting_against_a_missing_binary_fails_without_leaving_state() {
        let dir = tempfile::tempdir().unwrap();
        let config = DolphinConfig::new(
            PathBuf::from("/nonexistent/dolphin-emu-nogui"),
            PathBuf::from("/nonexistent/game.rvz"),
            dir.path().to_path_buf(),
            SlotSet::ALL,
        );
        let error = Session::start(&config).unwrap_err();
        assert!(
            matches!(error, EmulatorError::Spawn { .. }),
            "got {error:?}"
        );
    }

    #[test]
    fn the_config_files_land_where_dolphin_reads_them() {
        let dir = tempfile::tempdir().unwrap();
        let config = DolphinConfig::new(
            PathBuf::from("/nonexistent/dolphin-emu-nogui"),
            PathBuf::from("/nonexistent/game.rvz"),
            dir.path().to_path_buf(),
            SlotSet::ALL,
        );
        write_config_files(&config).unwrap();

        let pad = std::fs::read_to_string(dir.path().join("Config/GCPadNew.ini")).unwrap();
        assert!(pad.contains("Device = Pipe/0/p4"));
        let main = std::fs::read_to_string(dir.path().join("Config/Dolphin.ini")).unwrap();
        assert!(main.contains("SIDevice3 = 6"));
    }
}
