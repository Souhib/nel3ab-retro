//! Dolphin's sound, taken out of a pipe.
//!
//! There is no sound card in the container and no sound server either, so the
//! usual backends have nothing to open. ALSA's `file` plugin writes the samples
//! straight to a path instead, and [`config::asoundrc`] points the default
//! device at the pipe this module reads.
//!
//! **The reader is the clock.** The `null` slave in that configuration paces
//! nothing: Dolphin's audio thread pulls from the mixer as fast as the device
//! accepts, and an unpaced device accepts everything. Measured on the first
//! attempt: 8.7 MB/s, forty-five times real time, most of it the mixer padding
//! its own underruns. What makes the stream real time is this reader taking
//! 48000 frames a second and no more, at which point the pipe fills and
//! Dolphin's audio thread waits — which is what it would do on a sound card.
use std::io::Read as _;
use std::os::unix::fs::OpenOptionsExt as _;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::config::{AUDIO_FRAME_BYTES, AUDIO_PIPE, AUDIO_RATE};
use crate::error::EmulatorError;

/// How much sound is carried at a time.
///
/// Ten milliseconds. A chunk is only sent once it is full, so its first sample
/// waits the whole chunk before leaving: the length of a chunk is a floor under
/// how late the sound can be. It was twenty, and the sound measured 68 ms behind
/// the picture; halving it takes ten of those directly.
///
/// Not shorter, because each chunk is a message: ten milliseconds is a hundred
/// messages a second, and five would be two hundred for another five.
pub const CHUNK: Duration = Duration::from_millis(10);

/// Frames in one chunk: a hundredth of a second.
///
/// Written as the division so that changing the rate cannot leave this behind.
/// The test below states the result in milliseconds, which is the unit the
/// mistake was made in.
#[expect(
    clippy::integer_division,
    reason = "48000/50 is exact, and a rate that is not a multiple of 50 would \
              fail the twenty-millisecond test rather than round quietly"
)]
pub const CHUNK_FRAMES: usize = (AUDIO_RATE / 100) as usize;

/// Bytes in one chunk.
pub const CHUNK_BYTES: usize = CHUNK_FRAMES * AUDIO_FRAME_BYTES;

/// The read end of Dolphin's sound.
#[derive(Debug)]
pub struct SoundTap {
    file: std::fs::File,
    path: PathBuf,
    /// When the next chunk is due. Kept as an absolute instant and advanced by
    /// exactly one chunk, so a late read does not push every later one back.
    due: Instant,
    /// What has arrived but does not yet fill a chunk.
    pending: Vec<u8>,
    /// Chunks that had to be filled with silence because nothing was there.
    starved: u64,
}

impl SoundTap {
    /// Creates the pipe and opens the read end.
    ///
    /// Non-blocking, and that matters: opening a pipe for reading blocks until
    /// somebody opens the other end, and the writer here is an emulator that
    /// has not been started yet. The pipe must exist FIRST, or Dolphin's own
    /// open would create a plain file and the sound would go to disk.
    ///
    /// # Errors
    /// [`EmulatorError::CreateFifo`] or [`EmulatorError::OpenFifo`].
    pub fn open(user_dir: &Path) -> Result<Self, EmulatorError> {
        let path = user_dir.join(AUDIO_PIPE);
        if let Ok(meta) = std::fs::symlink_metadata(&path)
            && !std::os::unix::fs::FileTypeExt::is_fifo(&meta.file_type())
        {
            let _ = std::fs::remove_file(&path);
        }
        if !path.exists() {
            nix::unistd::mkfifo(&path, nix::sys::stat::Mode::from_bits_truncate(0o600)).map_err(
                |errno| EmulatorError::CreateFifo {
                    path: path.clone(),
                    source: std::io::Error::from(errno),
                },
            )?;
        }
        let file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(nix::fcntl::OFlag::O_NONBLOCK.bits())
            .open(&path)
            .map_err(|source| EmulatorError::OpenFifo {
                path: path.clone(),
                source,
            })?;
        Ok(Self {
            file,
            path,
            due: Instant::now(),
            pending: Vec::with_capacity(CHUNK_BYTES * 2),
            starved: 0,
        })
    }

    /// Where the pipe is, for anybody reporting on it.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// How many chunks had to be invented because the emulator had produced
    /// nothing. Silence is the right thing to send — a gap in the stream would
    /// leave the page's clock guessing — but a rising count means the emulator
    /// is not keeping up and should be visible rather than inaudible.
    #[must_use]
    pub const fn starved(&self) -> u64 {
        self.starved
    }

    /// Waits until the next chunk is due, then returns exactly one chunk.
    ///
    /// Always returns a full chunk: what the pipe could not supply is silence.
    pub fn next_chunk(&mut self, out: &mut [u8; CHUNK_BYTES]) {
        self.due += CHUNK;
        // A tap that has fallen far behind — the thread was descheduled, the
        // machine slept — does not try to catch up by reading a burst. It skips
        // to now, because sound that late is sound nobody wants.
        let now = Instant::now();
        if self.due < now {
            self.due = now;
        } else {
            std::thread::sleep(self.due - now);
        }

        let mut scratch = [0_u8; CHUNK_BYTES];
        while self.pending.len() < CHUNK_BYTES {
            match self.file.read(&mut scratch) {
                Ok(0) => break,
                Ok(read) => self.pending.extend_from_slice(&scratch[..read]),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(_) => break,
            }
        }

        if self.pending.len() >= CHUNK_BYTES {
            out.copy_from_slice(&self.pending[..CHUNK_BYTES]);
            self.pending.drain(..CHUNK_BYTES);
        } else {
            out.fill(0);
            self.starved += 1;
        }
    }
}

#[cfg(test)]
#[expect(
    clippy::unwrap_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;

    /// The chunk is exactly the length it claims, and the arithmetic that says
    /// so is worth pinning: the first reader written against this pipe took
    /// 1920 frames every 20 ms, which is 40 ms of sound read twice as often as
    /// it exists. It reported the stream as running at double speed and sent me
    /// looking for a fault in ALSA.
    #[test]
    fn a_chunk_lasts_exactly_as_long_as_it_says() {
        #[expect(
            clippy::cast_precision_loss,
            reason = "960 frames: exact in an f64 by a factor of five thousand billion"
        )]
        let seconds = CHUNK_FRAMES as f64 / f64::from(AUDIO_RATE);
        assert!(
            (seconds - CHUNK.as_secs_f64()).abs() < 1e-9,
            "{CHUNK_FRAMES} frames at {AUDIO_RATE} Hz is {seconds} s, not {CHUNK:?}"
        );
        assert_eq!(CHUNK_BYTES, 1920, "two channels of i16, 480 frames");
    }

    /// Nothing on the pipe is silence, not a short chunk: a page that receives
    /// less than it expects has to guess what the gap was worth.
    #[test]
    fn an_empty_pipe_yields_silence_and_says_so() {
        let dir = tempfile::tempdir().unwrap();
        let mut tap = SoundTap::open(dir.path()).unwrap();
        let mut chunk = [0xAA_u8; CHUNK_BYTES];

        tap.next_chunk(&mut chunk);

        assert!(chunk.iter().all(|byte| *byte == 0), "not silence");
        assert_eq!(tap.starved(), 1);
    }

    /// What the emulator wrote is what the page gets, byte for byte.
    #[test]
    fn what_is_written_comes_back_whole() {
        use std::io::Write as _;
        let dir = tempfile::tempdir().unwrap();
        let mut tap = SoundTap::open(dir.path()).unwrap();

        let written: Vec<u8> = (0..CHUNK_BYTES)
            .map(|index| u8::try_from(index % 251).unwrap_or(0))
            .collect();
        let mut writer = std::fs::OpenOptions::new()
            .write(true)
            .open(tap.path())
            .unwrap();
        writer.write_all(&written).unwrap();

        let mut chunk = [0_u8; CHUNK_BYTES];
        tap.next_chunk(&mut chunk);
        assert_eq!(chunk.as_slice(), written.as_slice());
        assert_eq!(tap.starved(), 0, "there was nothing to invent");
    }
}
