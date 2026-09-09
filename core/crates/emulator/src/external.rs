//! Lifecycle of an adapter which flushes its emulator when stdin closes.
use std::{
    io,
    path::Path,
    process::{Child, Command, ExitStatus, Stdio},
};

/// A child whose stop protocol is EOF, including on early return.
pub struct External(Child);
impl External {
    /// Start the configured adapter without a shell or interpolated arguments.
    pub fn start(
        script: &Path,
        rom: &Path,
        title: &str,
        slot: &str,
        runtime: &Path,
    ) -> io::Result<Self> {
        Command::new("python3")
            .arg(script)
            .arg(rom)
            .arg(title)
            .arg(slot)
            .arg(runtime)
            .stdin(Stdio::piped())
            .spawn()
            .map(Self)
    }
    /// Inspect without consuming the child's process handle.
    pub fn status(&mut self) -> io::Result<Option<ExitStatus>> {
        self.0.try_wait()
    }
    /// Wait for the adapter to close its capture and flush its game saves.
    pub fn shutdown(&mut self) -> io::Result<ExitStatus> {
        drop(self.0.stdin.take());
        self.0.wait()
    }
}
impl Drop for External {
    fn drop(&mut self) {
        if let Err(error) = self.shutdown() {
            tracing::error!(%error, "external emulator shutdown failed");
        }
    }
}
