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

/// How much sound the pipe is allowed to hold, and therefore how far behind the
/// emulator this reader runs.
///
/// **This is the latency nothing could see.** A Linux pipe holds 64 KiB by
/// default, which at 48 kHz stereo is 341 ms of audio. Dolphin fills it in the
/// first moments — the `null` slave accepts everything instantly, so nothing
/// paces the writer — and then blocks in `pipe_write` for the rest of the
/// session. Confirmed on the running machine: its writer thread sat in
/// `pipe_write` on every sample taken. Since the pipe stays full, every sample
/// read out of it is as old as the pipe is deep.
///
/// No metric could show it, and that is the lesson worth keeping: a chunk is
/// stamped when WE read it, so the whole delay happens upstream of our own
/// clock. The measurement said 47 ms while the real figure was ten times that.
///
/// Draining the backlog is NOT the fix, and it was tried: taking everything
/// available removes the back pressure that makes the stream real time, and the
/// sound skips. Shrinking the buffer keeps the mechanism and moves the number.
///
/// **The capacity IS the latency**, and that is not a figure of speech here.
/// Sampled 120 times on the running machine, the writer was blocked in
/// `pipe_write` on 113 of them: the pipe sits full 94 % of the time, so every
/// byte of capacity is a byte of standing delay. Reading more often does not
/// change it — the writer refills to full the instant room appears.
///
/// So it is as small as it can be made without breaking, and where that is was
/// found by breaking it. **One page, 4 KiB (21 ms), starves:** 2891 chunks of
/// invented silence in two minutes, and the sound went discontinuous again —
/// the jump at a chunk boundary was five times the jump inside one, on 159
/// boundaries out of 399.
///
/// What that measures is not our reader, which takes its ten milliseconds on
/// time. It is something on Dolphin's side of the pipe, and the honest position
/// is that the mechanism is not pinned down. Its ALSA backend asks for at most
/// 8192 frames in up to 32 periods (`AlsaSoundStream.h` @ 216ffb45), which would
/// be 256-frame writes — small enough to fit four times over in one page. So the
/// obvious explanation is wrong, and what is left is a guess about its audio
/// thread stalling on a tight pipe long enough for its mixer to fall behind.
///
/// Constraining the periods from our side was tried, by giving the `file`
/// plugin's slave an explicit `period_size` and `buffer_size`: ALSA refused the
/// whole device and the room went silent, 4005 invented chunks and not one
/// audible. Reverted.
///
/// Two pages is therefore an empirical floor, not a derived one, and it is
/// labelled as such rather than dressed up.
const PIPE_BYTES: i32 = 8 * 1024;

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
    /// Est-ce qu'un AUTRE émulateur écrit déjà dans ce tuyau ?
    ///
    /// # Pourquoi cette question existe
    ///
    /// Le 2026-08-17, une salle a servi un son haché pendant une soirée. La
    /// cause n'était ni l'encodeur ni le réseau: un Dolphin oublié d'une mesure
    /// de la veille tournait encore, monté sur le MÊME répertoire de session,
    /// donc les deux écrivaient leur PCM dans ce fichier. Le worker lisait un
    /// mélange de deux parties. Rien n'a échoué, rien n'a été journalisé, et
    /// `sound_starved` est resté à zéro pendant douze heures.
    ///
    /// Deux processus sur un même tuyau ne devraient pas être une situation
    /// possible. Faute de pouvoir l'empêcher, on la rend BRUYANTE.
    ///
    /// # Pourquoi on écoute plutôt qu'on cherche
    ///
    /// Chercher le coupable demanderait de fouiller `/proc`, ou de savoir que
    /// l'émulateur tourne dans Docker — ce que ce crate ignore volontairement.
    /// Écouter le tuyau répond à la seule question qui compte, et y répond
    /// directement: est-ce que quelque chose arrive alors que nous n'avons
    /// encore rien démarré ?
    ///
    /// En deux temps, et c'est le second qui fait la différence. On vide
    /// d'abord ce qui traîne: des octets restés d'un écrivain déjà mort sont
    /// périmés, pas une intrusion, et refuser à cause d'eux condamnerait une
    /// salle pour un fantôme. On écoute ensuite: ce qui arrive APRÈS a forcément
    /// un vivant derrière.
    ///
    /// À appeler avant de démarrer son propre émulateur, sinon la réponse est
    /// oui et c'est nous.
    pub fn intruder(&mut self, listen_for: Duration) -> bool {
        let mut sink = [0_u8; 4096];
        while matches!(self.file.read(&mut sink), Ok(read) if read > 0) {}
        std::thread::sleep(listen_for);
        matches!(self.file.read(&mut sink), Ok(read) if read > 0)
    }

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
        // Shrunk before anybody writes to it, which is the only moment it can
        // be: the kernel refuses to shrink a pipe below what it already holds.
        // Best-effort — a kernel that says no leaves the reader to do the whole
        // job, which it does.
        if let Err(errno) = nix::fcntl::fcntl(&file, nix::fcntl::FcntlArg::F_SETPIPE_SZ(PIPE_BYTES))
        {
            tracing::warn!(%errno, "the sound pipe kept its default size");
        }
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

    /// How long ago the sound in a chunk was actually produced.
    ///
    /// The pipe sits full — sampled 60 times on the running machine, the writer
    /// was blocked in `pipe_write` on 57 — so a chunk read now holds sound the
    /// emulator handed over one pipe-depth ago. That delay is real, it is
    /// upstream of every clock this project owns, and **a chunk stamped with the
    /// instant we read it claims to be fresher than it is.**
    ///
    /// Which was not merely untidy. The page offers to delay the picture to meet
    /// the sound, and it computes how much from that stamp: it was compensating
    /// by seven milliseconds where the true figure was fifty. The control looked
    /// broken because it was being told the wrong number, not because it did not
    /// work.
    ///
    /// So the tap says how far back its sound comes from, and the stamp is
    /// corrected by it. This makes nothing faster. It makes the figure true, and
    /// a true figure is what the compensation needs to be worth ticking.
    #[must_use]
    pub const fn standing_delay(&self) -> Duration {
        // Bytes per second, then the depth in microseconds. The pipe capacity is
        // what we asked for; the kernel may have rounded it up, but never down.
        #[expect(
            clippy::integer_division,
            reason = "microseconds from a byte count: the remainder is under a \
                      microsecond of audio and no decision turns on it"
        )]
        Duration::from_micros(
            PIPE_BYTES as u64 * 1_000_000 / (AUDIO_RATE as u64 * AUDIO_FRAME_BYTES as u64),
        )
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

        // Exactly enough for one chunk, and NOT more. This looks like a reader
        // that could be draining and is not, and it was changed to drain once.
        // It must not be again: taking everything available removes the back
        // pressure that makes the stream real time in the first place, because
        // the `null` slave never applies any. Measured with the drain in place —
        // the emulator wrote 80 seconds of audio for every 10 seconds of wall
        // clock, and what came out skipped: the jump at a chunk boundary was
        // nine times the jump inside one, on 47% of boundaries. Audible as
        // clicking. The pipe filling and Dolphin waiting IS the clock.
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
    use crate::config::AUDIO_FRAME_BYTES_U32;

    /// Un écrivain vivant est vu.
    ///
    /// C'est la panne du 2026-08-17: un émulateur oublié qui écrivait dans le
    /// tuyau d'une autre salle, sans que rien n'échoue nulle part.
    #[test]
    fn another_writer_on_the_same_pipe_is_seen() {
        let dir = tempfile::tempdir().unwrap();
        let mut tap = SoundTap::open(dir.path()).unwrap();
        let path = tap.path().to_path_buf();

        // Un intrus: il ouvre en écriture et pousse sans s'arrêter, comme le
        // ferait un émulateur qui tourne.
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let told = std::sync::Arc::clone(&stop);
        let intruder = std::thread::spawn(move || {
            let Ok(mut pipe) = std::fs::OpenOptions::new().write(true).open(&path) else {
                return;
            };
            while !told.load(std::sync::atomic::Ordering::Relaxed) {
                if std::io::Write::write_all(&mut pipe, &[0_u8; 512]).is_err() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        });

        assert!(tap.intruder(Duration::from_millis(200)));

        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = intruder.join();
    }

    /// Le jumeau qui compte le plus: un tuyau tranquille ne doit RIEN dire.
    ///
    /// Sans lui, un garde qui répondrait toujours oui passerait le test du
    /// dessus et empêcherait toute salle de démarrer. C'est un garde de
    /// démarrage: se tromper dans ce sens-là est pire que la panne qu'il évite.
    #[test]
    fn a_quiet_pipe_is_not_an_intrusion() {
        let dir = tempfile::tempdir().unwrap();
        let mut tap = SoundTap::open(dir.path()).unwrap();

        assert!(!tap.intruder(Duration::from_millis(200)));
    }

    /// Et l'autre jumeau: des octets d'un écrivain DÉJÀ MORT sont périmés.
    ///
    /// Ils restent dans le tampon du tuyau tant que personne ne les lit, donc un
    /// garde qui se contenterait de regarder « y a-t-il quelque chose » refuserait
    /// de démarrer à cause d'un fantôme. C'est le premier temps du garde, celui
    /// qui vide, qui répond à ça.
    #[test]
    fn bytes_left_by_a_dead_writer_are_not_an_intrusion() {
        let dir = tempfile::tempdir().unwrap();
        let mut tap = SoundTap::open(dir.path()).unwrap();

        {
            let mut pipe = std::fs::OpenOptions::new()
                .write(true)
                .open(tap.path())
                .unwrap();
            std::io::Write::write_all(&mut pipe, &[7_u8; 2048]).unwrap();
        } // l'écrivain ferme ici, et ses octets restent dans le tuyau

        assert!(!tap.intruder(Duration::from_millis(200)));
    }

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

    /// The pipe holds a bounded amount, and therefore so does the latency.
    ///
    /// It is the whole fix: nothing else here changed, because the reader taking
    /// exactly one chunk per tick is what makes the stream real time. Red-first:
    /// drop the `F_SETPIPE_SZ` call and this reports 65536 — 341 ms of standing
    /// delay that no other measurement in this project can see.
    #[test]
    fn the_pipe_cannot_hold_more_sound_than_we_are_willing_to_be_late_by() {
        let dir = tempfile::tempdir().unwrap();
        let tap = SoundTap::open(dir.path()).unwrap();

        let held = nix::fcntl::fcntl(&tap.file, nix::fcntl::FcntlArg::F_GETPIPE_SZ).unwrap();

        assert_eq!(held, PIPE_BYTES, "the pipe kept a different size");
        // Stated in milliseconds, because that is the unit the mistake was made
        // in: 64 KiB reads as "a buffer", 341 ms reads as a third of a second of
        // sound arriving late.
        let milliseconds =
            f64::from(held) / (f64::from(AUDIO_RATE) * f64::from(AUDIO_FRAME_BYTES_U32) / 1000.0);
        assert!(
            milliseconds <= 50.0,
            "the pipe can hold {milliseconds:.0} ms of sound, which is latency \
             nobody can measure from the other end"
        );
        // And still more than the reader takes in one go, or it would starve on
        // its own cadence rather than on the emulator's.
        assert!(
            milliseconds >= 2.0 * CHUNK.as_secs_f64() * 1000.0,
            "too tight for two ticks"
        );
    }

    /// Sound that arrives on time is passed through untouched.
    ///
    /// The negative twin of the bound above: a pipe small enough would "fix" the
    /// latency by losing the audio, and this is what says it does not.
    #[test]
    fn sound_that_arrives_on_time_is_kept_whole() {
        use std::io::Write as _;
        let dir = tempfile::tempdir().unwrap();
        let mut tap = SoundTap::open(dir.path()).unwrap();
        let mut writer = std::fs::OpenOptions::new()
            .write(true)
            .open(dir.path().join(AUDIO_PIPE))
            .unwrap();
        writer.write_all(&[7_u8; CHUNK_BYTES]).unwrap();

        let mut chunk = [0_u8; CHUNK_BYTES];
        tap.next_chunk(&mut chunk);

        assert!(chunk.iter().all(|byte| *byte == 7), "the chunk was altered");
        assert_eq!(tap.starved(), 0);
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
