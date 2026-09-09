//! Bounded silence and cooperative process shutdown, outside the image path.
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// Reclaims this wrapper's previous container before any FIFO or save is opened.
/// Native Dolphin binaries do not implement the cleanup subcommand.
/// # Errors
/// The wrapper refused cleanup, including a name bound to another session.
pub fn prepare(binary: &std::path::Path, directory: &std::path::Path) -> std::io::Result<()> {
    if binary
        .file_name()
        .is_none_or(|name| name != "dolphin-in-docker.sh")
    {
        return Ok(());
    }
    let status = std::process::Command::new(binary)
        .arg("--cleanup")
        .arg("--user")
        .arg(directory)
        .status()?;
    if !status.success() {
        return Err(std::io::Error::other(format!(
            "emulator cleanup refused: {status}"
        )));
    }
    Ok(())
}

/// Bounds Docker control calls even if its daemon stops answering.
///
/// The caller uses null output; no pipe needs draining while this waits. Five-second
/// Docker operations are infrastructure failures, not emulation stalls.
/// # Errors
/// Spawn/reap failure or the caller's deadline was exceeded.
pub fn bounded_status(
    command: &mut std::process::Command,
    limit: Duration,
) -> std::io::Result<std::process::ExitStatus> {
    let mut child = command.spawn()?;
    let deadline = Instant::now() + limit;
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status);
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "process control deadline exceeded",
            ));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// A signal only changes this flag; it never invokes Docker or takes a lock.
pub struct Shutdown {
    flag: Arc<AtomicBool>,
    registrations: Vec<signal_hook::SigId>,
}

impl Shutdown {
    /// Installs SIGTERM and SIGINT handlers for the lifetime of the worker.
    /// # Errors
    /// The operating system refused signal registration.
    pub fn listen() -> std::io::Result<Self> {
        let mut this = Self {
            flag: Arc::new(AtomicBool::new(false)),
            registrations: Vec::new(),
        };
        for signal in [signal_hook::consts::SIGTERM, signal_hook::consts::SIGINT] {
            this.registrations
                .push(signal_hook::flag::register(signal, Arc::clone(&this.flag))?);
        }
        Ok(this)
    }

    /// Shared with every loop that must finish before Dolphin is stopped.
    #[must_use]
    pub fn flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.flag)
    }
}

impl Drop for Shutdown {
    fn drop(&mut self) {
        for id in self.registrations.drain(..) {
            signal_hook::low_level::unregister(id);
        }
    }
}

/// Declared after Session, so even an early error joins writers before its drop.
pub struct Workers {
    stopping: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
}
impl Workers {
    /// Owns the shared stop flag without requesting a stop yet.
    #[must_use]
    pub const fn new(stopping: Arc<AtomicBool>) -> Self {
        Self {
            stopping,
            threads: Vec::new(),
        }
    }
    /// Joins this thread on every exit path after setting the stop flag.
    pub fn add(&mut self, thread: JoinHandle<()>) {
        self.threads.push(thread);
    }
}
impl Drop for Workers {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::Relaxed);
        for thread in self.threads.drain(..) {
            if thread.join().is_err() {
                tracing::error!("a worker thread panicked during shutdown");
            }
        }
    }
}

/// Warns after three awake seconds without a frame.
///
/// Policy bounds, not measured startup times: allow thirty before restarting.
/// Sleeping resets the interval. Unit tests advance a supplied clock rather than sleeping.
pub const QUIET_WARNING: Duration = Duration::from_secs(3);
/// Maximum awake silence before the supervisor starts a fresh emulator.
pub const QUIET_LIMIT: Duration = Duration::from_secs(30);

/// Action to take after observing the producer.
#[derive(Debug, PartialEq, Eq)]
pub enum Health {
    /// No action, or the warning has already been emitted.
    Healthy,
    /// Record the first unusually long awake silence.
    Warn,
    /// Exit through normal shutdown so the supervisor can recover.
    Restart,
}

/// A silence deadline reset by frames and intentional sleep.
pub struct Silence {
    heard: Instant,
    warned: bool,
}
impl Silence {
    /// Starts the grace period when the stream is ready to be read.
    #[must_use]
    pub const fn new(now: Instant) -> Self {
        Self {
            heard: now,
            warned: false,
        }
    }
    /// Observes a frame or a read timeout on the supplied monotonic clock.
    pub fn saw(&mut self, frame: bool, sleeping: bool, now: Instant) -> Health {
        if frame || sleeping {
            self.heard = now;
            self.warned = false;
            return Health::Healthy;
        }
        let quiet = now.saturating_duration_since(self.heard);
        if quiet >= QUIET_LIMIT {
            return Health::Restart;
        }
        if quiet >= QUIET_WARNING && !self.warned {
            self.warned = true;
            return Health::Warn;
        }
        Health::Healthy
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dropping_workers_stops_and_joins_real_owned_threads() {
        let stopping = Arc::new(AtomicBool::new(false));
        let finished = Arc::new(AtomicBool::new(false));
        let mut workers = Workers::new(Arc::clone(&stopping));
        let flag = Arc::clone(&stopping);
        let done = Arc::clone(&finished);
        workers.add(std::thread::spawn(move || {
            // A finite twin avoids hanging the suite if the stop signal breaks.
            let deadline = Instant::now() + Duration::from_secs(1);
            while !flag.load(Ordering::Relaxed) && Instant::now() < deadline {
                std::thread::yield_now();
            }
            done.store(flag.load(Ordering::Relaxed), Ordering::Relaxed);
        }));
        assert!(!stopping.load(Ordering::Relaxed));
        drop(workers);
        assert!(finished.load(Ordering::Relaxed));
    }

    #[test]
    fn a_control_process_can_finish_or_exceed_its_deadline() {
        assert!(
            bounded_status(
                &mut std::process::Command::new("true"),
                Duration::from_secs(1)
            )
            .is_ok_and(|status| status.success())
        );
        let error = bounded_status(
            std::process::Command::new("sleep").arg("10"),
            Duration::from_millis(20),
        );
        assert!(
            matches!(error, Err(ref cause) if cause.kind() == std::io::ErrorKind::TimedOut),
            "{error:?}"
        );
    }

    #[test]
    fn awake_silence_warns_once_then_requests_recovery() {
        let now = Instant::now();
        let mut silence = Silence::new(now);
        assert_eq!(silence.saw(false, false, now), Health::Healthy);
        assert_eq!(silence.saw(false, false, now + QUIET_WARNING), Health::Warn);
        assert_eq!(
            silence.saw(false, false, now + QUIET_WARNING),
            Health::Healthy
        );
        assert_eq!(
            silence.saw(false, false, now + QUIET_LIMIT),
            Health::Restart
        );
    }
    #[test]
    fn sleep_and_new_frames_reset_the_silence_deadline() {
        let now = Instant::now();
        let mut silence = Silence::new(now);
        let later = now + QUIET_LIMIT * 10;
        assert_eq!(silence.saw(false, true, later), Health::Healthy);
        assert_eq!(silence.saw(false, false, later), Health::Healthy);
        assert_eq!(
            silence.saw(true, false, later + QUIET_LIMIT),
            Health::Healthy
        );
        assert_eq!(
            silence.saw(false, false, later + QUIET_LIMIT),
            Health::Healthy
        );
    }
}
