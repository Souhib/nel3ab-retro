//! Un clip enregistré, rejoué image par image, pour le banc de liaison.
//!
//! Le banc (`just banc-liaison`) comparait des mesures prises sur l'écran de
//! démonstration d'un jeu, dont le débit allait de 0,8 à 25 Mbit/s selon la
//! minute: deux fenêtres sur trois ne mesuraient rien (carnet, 23 septembre
//! 2026). Ce module donne au worker une source d'images qui ne change pas d'un
//! passage à l'autre: `ffmpeg` décode un clip en boucle, à son rythme, et rend
//! des images NV12 brutes que le worker copie dans ses surfaces et encode avec
//! le MÊME encodeur qu'une salle.
//!
//! Rejouer le flux déjà encodé aurait été plus simple et faux sur le point qui
//! compte: après une chaîne cassée, une salle force une image-clé en moins d'une
//! demi-seconde, alors qu'un fichier encodé n'en a qu'aux endroits où il en a.
//!
//! Sans code `unsafe`: seul `crate::av::Encoder::upload` touche la surface.

use std::ffi::OsString;
use std::io::Read;
use std::path::Path;
use std::process::{Child, ChildStdout, Command, Stdio};

use crate::EncoderError;

/// Combien d'octets fait une image NV12 de cette taille: la luminance entière,
/// puis la chrominance au quart, entrelacée.
#[must_use]
pub fn nv12_len(width: u32, height: u32) -> usize {
    // Exact: la taille est paire des deux côtés, donc largeur × hauteur × 3 est pair.
    usize::try_from((u64::from(width) * u64::from(height) * 3).div_euclid(2)).unwrap_or(usize::MAX)
}

/// Découpe un flux d'octets en images NV12 entières.
///
/// Séparé du processus pour pouvoir l'éprouver sans `ffmpeg`: l'exécutant de CI
/// n'en a pas, et c'est ici que se trouve ce qui peut mal tourner, une image
/// coupée en deux lectures ou un flux qui s'arrête au milieu d'une image.
#[derive(Debug)]
pub struct Pictures<R> {
    reader: R,
    size: usize,
}

impl<R: Read> Pictures<R> {
    /// # Errors
    /// [`EncoderError::UnsupportedSize`] pour une taille vide ou impaire: NV12
    /// range la chrominance par blocs de deux sur deux.
    pub fn new(reader: R, width: u32, height: u32) -> Result<Self, EncoderError> {
        if width == 0 || height == 0 || !width.is_multiple_of(2) || !height.is_multiple_of(2) {
            return Err(EncoderError::UnsupportedSize { width, height });
        }
        Ok(Self {
            reader,
            size: nv12_len(width, height),
        })
    }

    /// Des morceaux de `size` octets, pour le son: la même découpe, sans image.
    ///
    /// # Errors
    /// [`EncoderError::ReplayTruncated`] pour une taille nulle, qui ne découperait
    /// jamais rien.
    pub fn of_bytes(reader: R, size: usize) -> Result<Self, EncoderError> {
        if size == 0 {
            return Err(EncoderError::ReplayTruncated {
                got: 0,
                expected: 0,
            });
        }
        Ok(Self { reader, size })
    }

    /// Remplit `picture` avec l'image suivante.
    ///
    /// Rend `false` quand le flux s'arrête proprement ENTRE deux images.
    ///
    /// # Errors
    /// [`EncoderError::ReplayTruncated`] quand il s'arrête au milieu d'une
    /// image, [`EncoderError::Replay`] si la lecture échoue.
    pub fn next_into(&mut self, picture: &mut Vec<u8>) -> Result<bool, EncoderError> {
        picture.resize(self.size, 0);
        let mut filled = 0;
        while filled < self.size {
            let Some(rest) = picture.get_mut(filled..) else {
                break;
            };
            match self.reader.read(rest) {
                Ok(0) if filled == 0 => return Ok(false),
                Ok(0) => {
                    return Err(EncoderError::ReplayTruncated {
                        got: filled,
                        expected: self.size,
                    });
                }
                Ok(read) => filled += read,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(source) => {
                    return Err(EncoderError::Replay {
                        what: "reading a decoded picture",
                        source,
                    });
                }
            }
        }
        Ok(true)
    }
}

/// Lit « largeur,hauteur » tel que `ffprobe -of csv=p=0` l'écrit.
///
/// # Errors
/// [`EncoderError::ReplayProbe`] pour toute autre forme.
pub fn parse_size(text: &str) -> Result<(u32, u32), EncoderError> {
    let bad = || EncoderError::ReplayProbe {
        output: text.trim().to_owned(),
    };
    let line = text.lines().next().ok_or_else(bad)?;
    let (width, height) = line.trim().split_once(',').ok_or_else(bad)?;
    Ok((
        width.trim().parse().map_err(|_| bad())?,
        height.trim().parse().map_err(|_| bad())?,
    ))
}

/// Ce que `ffmpeg` reçoit pour décoder `clip` en boucle, sans le son.
///
/// `-re` lit le clip à SON rythme: une image rendue plus vite que le jeu ne
/// l'a produite mesurerait une liaison plus chargée qu'elle ne l'est. Le clip
/// garde la cadence du jeu enregistré, cinquante images par seconde pour un jeu
/// PAL, et pas forcément les soixante d'une salle.
#[must_use]
pub fn ffmpeg_arguments(clip: &Path) -> Vec<OsString> {
    let mut arguments: Vec<OsString> =
        ["-v", "error", "-nostdin", "-stream_loop", "-1", "-re", "-i"]
            .iter()
            .map(OsString::from)
            .collect();
    arguments.push(clip.as_os_str().to_owned());
    arguments.extend(
        ["-an", "-vf", "format=nv12", "-f", "rawvideo", "pipe:1"]
            .iter()
            .map(OsString::from),
    );
    arguments
}

/// Ce que `ffmpeg` reçoit pour décoder le SON de `clip` en boucle.
///
/// Stéréo, 48 kHz, entiers signés sur seize bits: le format que Dolphin donne
/// à une salle et que la page attend. `-re` aussi, pour que le son sorte au
/// rythme où il a été enregistré.
#[must_use]
pub fn ffmpeg_sound_arguments(clip: &Path) -> Vec<OsString> {
    let mut arguments: Vec<OsString> =
        ["-v", "error", "-nostdin", "-stream_loop", "-1", "-re", "-i"]
            .iter()
            .map(OsString::from)
            .collect();
    arguments.push(clip.as_os_str().to_owned());
    arguments.extend(
        ["-vn", "-ac", "2", "-ar", "48000", "-f", "s16le", "pipe:1"]
            .iter()
            .map(OsString::from),
    );
    arguments
}

/// Le son d'un clip en cours de lecture par `ffmpeg`, en morceaux de taille fixe.
#[derive(Debug)]
pub struct ClipSound {
    child: Child,
    chunks: Pictures<ChildStdout>,
}

impl ClipSound {
    /// # Errors
    /// [`EncoderError::Replay`] si `ffmpeg` ne se lance pas.
    pub fn open(clip: &Path, chunk_bytes: usize) -> Result<Self, EncoderError> {
        let mut child = Command::new("ffmpeg")
            .args(ffmpeg_sound_arguments(clip))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|source| EncoderError::Replay {
                what: "running ffmpeg for the sound",
                source,
            })?;
        let Some(stdout) = child.stdout.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err(EncoderError::Replay {
                what: "taking ffmpeg's sound output",
                source: std::io::Error::other("no stdout"),
            });
        };
        match Pictures::of_bytes(stdout, chunk_bytes) {
            Ok(chunks) => Ok(Self { child, chunks }),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                Err(error)
            }
        }
    }

    /// Le morceau suivant; `false` quand `ffmpeg` s'est arrêté.
    ///
    /// # Errors
    /// Voir [`Pictures::next_into`].
    pub fn next_into(&mut self, chunk: &mut Vec<u8>) -> Result<bool, EncoderError> {
        self.chunks.next_into(chunk)
    }
}

impl Drop for ClipSound {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Un clip en cours de lecture par `ffmpeg`.
///
/// Le processus est tué et attendu quand la valeur disparaît: un décodeur
/// orphelin continuerait à lire un disque pour personne.
#[derive(Debug)]
pub struct Clip {
    child: Child,
    pictures: Pictures<ChildStdout>,
    width: u32,
    height: u32,
}

impl Clip {
    /// Mesure le clip avec `ffprobe`, puis lance son décodage.
    ///
    /// # Errors
    /// [`EncoderError::Replay`] si `ffprobe` ou `ffmpeg` ne se lancent pas,
    /// [`EncoderError::ReplayProbe`] si la taille ne se lit pas.
    pub fn open(clip: &Path) -> Result<Self, EncoderError> {
        let probed = Command::new("ffprobe")
            .args(["-v", "error", "-select_streams", "v:0"])
            .args(["-show_entries", "stream=width,height", "-of", "csv=p=0"])
            .arg(clip)
            .output()
            .map_err(|source| EncoderError::Replay {
                what: "running ffprobe",
                source,
            })?;
        let (width, height) = parse_size(&String::from_utf8_lossy(&probed.stdout))?;
        let mut child = Command::new("ffmpeg")
            .args(ffmpeg_arguments(clip))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|source| EncoderError::Replay {
                what: "running ffmpeg",
                source,
            })?;
        let Some(stdout) = child.stdout.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err(EncoderError::Replay {
                what: "taking ffmpeg's output",
                source: std::io::Error::other("no stdout"),
            });
        };
        match Pictures::new(stdout, width, height) {
            Ok(pictures) => Ok(Self {
                child,
                pictures,
                width,
                height,
            }),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                Err(error)
            }
        }
    }

    /// La taille des images, lue par `ffprobe`.
    #[must_use]
    pub const fn size(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    /// L'image suivante. Bloque jusqu'à ce que `ffmpeg`, qui suit le rythme du
    /// clip, l'ait rendue: c'est ce qui cadence le banc.
    ///
    /// # Errors
    /// Voir [`Pictures::next_into`]. Un clip lu en boucle ne finit pas: `false`
    /// veut dire que `ffmpeg` s'est arrêté.
    pub fn next_into(&mut self, picture: &mut Vec<u8>) -> Result<bool, EncoderError> {
        self.pictures.next_into(picture)
    }
}

impl Drop for Clip {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;

    /// Un lecteur qui rend ses octets par petits morceaux, comme un tube.
    struct Dribble {
        bytes: Vec<u8>,
        at: usize,
        step: usize,
    }

    impl Read for Dribble {
        fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
            let end = (self.at + self.step).min(self.bytes.len());
            let take = (end - self.at).min(out.len());
            out[..take].copy_from_slice(&self.bytes[self.at..self.at + take]);
            self.at += take;
            Ok(take)
        }
    }

    fn dribble(bytes: Vec<u8>, step: usize) -> Dribble {
        Dribble { bytes, at: 0, step }
    }

    #[test]
    fn an_nv12_picture_is_one_and_a_half_bytes_per_pixel() {
        assert_eq!(nv12_len(1280, 1056), 2_027_520);
        assert_eq!(nv12_len(2, 2), 6);
        assert_eq!(nv12_len(0, 1056), 0);
    }

    #[test]
    fn pictures_cut_across_many_small_reads_come_out_whole() {
        // Deux images de 4 x 2, soit 12 octets chacune, lues trois par trois.
        let bytes: Vec<u8> = (0..24).collect();
        let mut pictures = Pictures::new(dribble(bytes, 5), 4, 2).unwrap();
        let mut picture = Vec::new();

        assert!(pictures.next_into(&mut picture).unwrap());
        assert_eq!(picture, (0..12).collect::<Vec<u8>>());
        assert!(pictures.next_into(&mut picture).unwrap());
        assert_eq!(picture, (12..24).collect::<Vec<u8>>());
        // Le jumeau: la fin propre entre deux images n'est pas une erreur.
        assert!(!pictures.next_into(&mut picture).unwrap());
    }

    #[test]
    fn a_stream_that_stops_inside_a_picture_is_an_error_not_a_picture() {
        let mut pictures = Pictures::new(dribble((0..18).collect(), 4), 4, 2).unwrap();
        let mut picture = Vec::new();
        assert!(pictures.next_into(&mut picture).unwrap());

        let error = pictures.next_into(&mut picture).unwrap_err();
        assert!(
            matches!(
                error,
                EncoderError::ReplayTruncated {
                    got: 6,
                    expected: 12
                }
            ),
            "{error:?}"
        );
    }

    #[test]
    fn an_odd_or_empty_size_is_refused() {
        assert!(Pictures::new(dribble(Vec::new(), 1), 3, 2).is_err());
        assert!(Pictures::new(dribble(Vec::new(), 1), 4, 0).is_err());
        assert!(Pictures::new(dribble(Vec::new(), 1), 4, 2).is_ok());
    }

    #[test]
    fn the_probe_answer_is_read_and_anything_else_refused() {
        assert_eq!(parse_size("1280,1056\n").unwrap(), (1280, 1056));
        assert!(parse_size("").is_err());
        assert!(parse_size("1280x1056").is_err());
        assert!(parse_size("1280,").is_err());
    }

    #[test]
    fn sound_is_cut_in_chunks_of_the_asked_size_and_zero_is_refused() {
        let mut chunks = Pictures::of_bytes(dribble((0..8).collect(), 3), 4).unwrap();
        let mut chunk = Vec::new();
        assert!(chunks.next_into(&mut chunk).unwrap());
        assert_eq!(chunk, vec![0, 1, 2, 3]);
        assert!(chunks.next_into(&mut chunk).unwrap());
        assert!(!chunks.next_into(&mut chunk).unwrap());
        assert!(Pictures::of_bytes(dribble(Vec::new(), 1), 0).is_err());
    }

    #[test]
    fn the_sound_is_decoded_as_the_rooms_pcm_in_a_loop_at_its_own_pace() {
        let arguments = ffmpeg_sound_arguments(Path::new("/clips/a.mp4"));
        let text: Vec<&str> = arguments.iter().map(|a| a.to_str().unwrap()).collect();
        let pair = |flag: &str, value: &str| text.windows(2).any(|p| p == [flag, value]);
        assert!(pair("-stream_loop", "-1"));
        assert!(text.contains(&"-re"));
        assert!(text.contains(&"-vn"));
        assert!(pair("-ac", "2"));
        assert!(pair("-ar", "48000"));
        assert!(pair("-f", "s16le"));
    }

    #[test]
    fn the_clip_is_decoded_in_a_loop_at_its_own_pace_without_sound() {
        let arguments = ffmpeg_arguments(Path::new("/clips/a b.mp4"));
        let text: Vec<&str> = arguments.iter().map(|a| a.to_str().unwrap()).collect();
        let before = |flag: &str, value: &str| text.windows(2).any(|pair| pair == [flag, value]);
        assert!(before("-stream_loop", "-1"));
        assert!(
            before("-i", "/clips/a b.mp4"),
            "un seul argument, espace compris"
        );
        assert!(text.contains(&"-re"));
        assert!(text.contains(&"-an"));
        assert!(before("-f", "rawvideo"));
        assert_eq!(text.last(), Some(&"pipe:1"));
    }
}
