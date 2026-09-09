//! Les dernières secondes de la partie, gardées pour qu'on puisse les revoir.
//!
//! # Ce qui est gardé, et pourquoi si peu
//!
//! Un anneau des unités d'accès telles que l'encodeur les a produites. La vidéo
//! n'est pas réencodée: le fichier rendu contient exactement les octets qui sont
//! partis vers les navigateurs, donc un clip montre ce que les joueurs ont vu
//! plutôt qu'une deuxième version de la même partie.
//!
//! # Pourquoi il faut garder plus que trente secondes
//!
//! Un décodeur ne peut pas commencer au milieu: il lui faut une image-clé. Le
//! GOP de cet encodeur fait dix secondes, donc un anneau de trente secondes
//! contiendrait entre deux et trois clés, et couper à la plus ancienne rendrait
//! un clip de vingt secondes une fois sur trois.
//!
//! On garde donc quarante secondes et on coupe à la clé la plus RÉCENTE qui
//! laisse au moins trente secondes derrière elle. Le clip fait alors toujours
//! au moins trente secondes, et au plus quarante.

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Ce qu'un clip couvre au minimum.
pub const COVERS: Duration = Duration::from_secs(30);

/// Ce que l'anneau garde, image-clé comprise.
///
/// Trente secondes de contenu plus un GOP, parce que la coupe doit tomber sur
/// une clé. Au-delà, on garderait des secondes qu'aucun clip n'utilisera.
const KEEPS: Duration = Duration::from_secs(40);

/// Ce que l'anneau s'autorise à retenir, en octets.
///
/// Deux cent vingt-quatre mébioctets. Le chiffre vient d'une mesure et pas d'une
/// habitude: sur 29 374 tranches de vraie partie, le débit tient 8,4 Mb/s à la
/// médiane, 24,8 au p95 et 43,2 au maximum. Quarante secondes au pire mesuré
/// font donc 216 Mo, et cette borne les couvre.
///
/// Elle existe quand même, parce qu'un jeu plus agité que tout ce qu'on a vu ne
/// doit pas pouvoir manger la mémoire de la machine: au-delà, l'anneau oublie
/// ses plus vieilles images et le clip est simplement plus court.
const HOLDS: usize = 224 * 1024 * 1024;

/// Le temps minimum entre deux clips.
///
/// Trente secondes, et ce n'est pas un frein arbitraire: un clip couvre au moins
/// trente secondes, donc deux clips pris à moins de trente secondes d'écart se
/// recouvrent et le second n'apporte rien de neuf. La limite dit la même chose
/// que la fonctionnalité.
///
/// Elle vit ICI, du côté serveur, et pas seulement dans la page. C'est la leçon
/// du bouton « ça saccade », qui se réarmait au bout de trois secondes pendant
/// que le salon en refusait vingt: ce qui compte est ce que le serveur accepte,
/// et un bouton qui promet autre chose ment.
pub const APART: Duration = Duration::from_secs(30);

/// Une image encodée, telle qu'elle est partie sur le fil.
#[derive(Debug, Clone)]
struct Kept {
    /// L'instant de capture, sur l'horloge du worker.
    at: Duration,
    /// Vrai quand un décodeur peut commencer ici.
    key: bool,
    bytes: Arc<[u8]>,
}

// Contrat du son transmis par le worker : 48 kHz, stéréo, i16 little endian.
const SAMPLE_RATE: usize = 48_000;
const SAMPLE_BYTES: usize = 4;
// 40 s × 48 000 × 4 = 7,68 Mo, calcul du 2026-09-06. La borne en octets
// s'applique aussi si des horodatages répétés empêchent la borne en temps.
const SOUND_HOLDS: usize = 40 * SAMPLE_RATE * SAMPLE_BYTES;

#[derive(Debug, Clone)]
struct Sound {
    at: Duration,
    pcm: Arc<[u8]>,
}

#[expect(
    clippy::integer_division,
    reason = "position entière dans le PCM, erreur inférieure à un échantillon (21 µs à 48 kHz)"
)]
fn sample_at(at: Duration) -> usize {
    usize::try_from(at.as_nanos() * SAMPLE_RATE as u128 / 1_000_000_000).unwrap_or(usize::MAX)
}

/// Un clip prêt à emballer.
#[derive(Debug)]
pub struct Cut {
    /// Les unités d'accès, telles qu'elles sont parties sur le fil.
    pub annex_b: Vec<Arc<[u8]>>,
    /// Première image, sur l'horloge de capture commune au son et à la vidéo.
    from: Duration,
    sound: Vec<Sound>,
    /// Ce que le clip couvre.
    pub covers: Duration,
    /// Combien d'images il contient.
    pub frames: usize,
}

impl Cut {
    /// Le son coupé sur la première image, avec la durée des images exportées.
    /// La mémoire est allouée ici, après avoir rendu le verrou de l'anneau.
    #[must_use]
    #[expect(
        clippy::integer_division,
        reason = "nombre entier de trames stéréo ; la dernière fraction vaut moins de 21 µs"
    )]
    pub fn pcm(&self) -> Option<Vec<u8>> {
        let length = self.frames.saturating_mul(SAMPLE_RATE) / self.fps() as usize;
        let from = sample_at(self.from);
        let end = from.saturating_add(length);
        let mut out = vec![0; length * SAMPLE_BYTES];
        let mut cursor = None;
        let mut heard = false;
        for sound in &self.sound {
            let count = sound.pcm.len() / SAMPLE_BYTES;
            let stamped = sample_at(sound.at);
            // Les réveils du fil bougent de quelques échantillons. Garder les
            // morceaux contigus évite de découper la forme d'onde à chaque
            // réveil. Un écart supérieur à un morceau est une vraie coupure :
            // on repart de l'horodatage, le trou reste silencieux.
            let start = cursor
                .filter(|next: &usize| next.abs_diff(stamped) <= count)
                .unwrap_or(stamped);
            let stop = start.saturating_add(count);
            cursor = Some(stop);
            let left = start.max(from);
            let right = stop.min(end);
            if left < right {
                out[(left - from) * SAMPLE_BYTES..(right - from) * SAMPLE_BYTES].copy_from_slice(
                    &sound.pcm[(left - start) * SAMPLE_BYTES..(right - start) * SAMPLE_BYTES],
                );
                heard = true;
            }
        }
        heard.then_some(out)
    }

    /// La cadence à annoncer au multiplexeur.
    ///
    /// Lue sur le clip plutôt que supposée: un jeu PAL tourne à cinquante images
    /// par seconde et un jeu NTSC à soixante, et emballer l'un à la cadence de
    /// l'autre rend un fichier au ralenti ou en accéléré sans qu'aucune erreur
    /// le signale. Le worker le sait aussi, mais le lui demander serait un
    /// deuxième endroit où la vérité peut diverger.
    ///
    /// Arrondi à l'entier: les conteneurs MP4 acceptent une fraction, ffmpeg
    /// accepte un entier, et l'écart entre 59,94 et 60 fait moins d'une image
    /// sur un clip de trente secondes.
    #[must_use]
    pub fn fps(&self) -> u32 {
        let seconds = self.covers.as_secs_f64();
        if seconds <= 0.0 {
            return 60;
        }
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            clippy::cast_precision_loss,
            reason = "une cadence tient dans un u32 et l'arrondi est le but"
        )]
        let rate = (self.frames as f64 / seconds).round() as u32;
        rate.clamp(1, 240)
    }
}

/// Ce qu'un clip refusé demande d'attendre.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TooSoon {
    /// Combien de temps il reste à patienter.
    pub wait: Duration,
}

/// L'anneau des dernières secondes.
#[derive(Debug, Default)]
pub struct Clips {
    kept: VecDeque<Kept>,
    bytes: usize,
    taken: Option<Instant>,
    sound: VecDeque<Sound>,
    sound_bytes: usize,
}

impl Clips {
    /// Un anneau vide.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Range une image encodée, et oublie ce qui sort des bornes.
    pub fn keep(&mut self, at: Duration, key: bool, annex_b: &[u8]) {
        self.bytes += annex_b.len();
        self.kept.push_back(Kept {
            at,
            key,
            bytes: Arc::from(annex_b),
        });
        while let Some(oldest) = self.kept.front() {
            let too_old = at.saturating_sub(oldest.at) > KEEPS;
            if !too_old && self.bytes <= HOLDS {
                break;
            }
            self.bytes -= oldest.bytes.len();
            self.kept.pop_front();
        }
    }

    /// Range le PCM même si aucun navigateur n'a activé son haut-parleur.
    pub fn keep_sound(&mut self, at: Duration, pcm: &[u8]) {
        if pcm.is_empty() || !pcm.len().is_multiple_of(SAMPLE_BYTES) || pcm.len() > SOUND_HOLDS {
            return;
        }
        self.sound_bytes += pcm.len();
        self.sound.push_back(Sound {
            at,
            pcm: Arc::from(pcm),
        });
        while let Some(first) = self.sound.front() {
            if at.saturating_sub(first.at) <= KEEPS && self.sound_bytes <= SOUND_HOLDS {
                break;
            }
            self.sound_bytes -= first.pcm.len();
            self.sound.pop_front();
        }
    }

    /// Ce que l'anneau retient, en octets. Pour le journal.
    #[must_use]
    pub const fn weight(&self) -> usize {
        self.bytes + self.sound_bytes
    }

    /// Depuis quand l'anneau a de quoi couper, ou rien s'il n'a pas encore
    /// d'image-clé assez vieille.
    ///
    /// La clé la plus RÉCENTE qui laisse au moins [`COVERS`] derrière elle. La
    /// plus ancienne donnerait un clip plus long, mais aussi plus lourd et plus
    /// vieux que ce qu'on vient de vivre; c'est « les trente dernières
    /// secondes » qu'on veut, pas « tout ce qu'on a ».
    fn cut(&self) -> Option<usize> {
        let last = self.kept.back()?.at;
        self.kept
            .iter()
            .enumerate()
            .rfind(|(_, k)| k.key && last.saturating_sub(k.at) >= COVERS)
            .map(|(index, _)| index)
    }

    /// Vrai quand un clip est prêt à être pris.
    #[must_use]
    pub fn ready(&self) -> bool {
        self.cut().is_some()
    }

    /// Les octets du clip, et ce qu'il couvre.
    ///
    /// # Errors
    /// [`TooSoon`] quand le précédent est trop récent. Rendre l'attente plutôt
    /// qu'un simple refus est ce qui permet au bouton de dire la vérité.
    pub fn take(&mut self, now: Instant) -> Result<Option<Cut>, TooSoon> {
        if let Some(last) = self.taken {
            let since = now.saturating_duration_since(last);
            if since < APART {
                return Err(TooSoon {
                    wait: APART.saturating_sub(since),
                });
            }
        }
        let Some(from) = self.cut() else {
            // Pas encore de quoi couper: la salle vient de démarrer. Ce n'est ni
            // un refus ni une erreur, et le dire par `None` évite d'inventer un
            // troisième cas.
            return Ok(None);
        };
        // Les données restent partagées : ni copie vidéo ni assemblage PCM
        // sous le verrou que prennent les fils d'image et de son.
        let annex_b = self
            .kept
            .iter()
            .skip(from)
            .map(|kept| Arc::clone(&kept.bytes))
            .collect();
        let covers = self
            .kept
            .back()
            .zip(self.kept.get(from))
            .map_or(Duration::ZERO, |(last, first)| {
                last.at.saturating_sub(first.at)
            });
        self.taken = Some(now);
        Ok(Some(Cut {
            annex_b,
            from: self.kept[from].at,
            sound: self.sound.iter().cloned().collect(),
            covers,
            frames: self.kept.len() - from,
        }))
    }
}

/// Ce qui peut rater entre les octets et le fichier.
#[derive(Debug, thiserror::Error)]
pub enum ClipError {
    /// La vidéo a survécu dans l'anneau, mais pas le son de cette période.
    /// Un refus explicite vaut mieux qu'un fichier silencieux annoncé réussi.
    #[error(
        "le son de cette période n'est plus disponible ; laisse jouer trente secondes puis reprends un clip"
    )]
    MissingSound,
    /// `ffmpeg` n'est pas sur la machine, ou n'a pas pu démarrer.
    #[error("ffmpeg n'a pas démarré: {0}")]
    NoMuxer(#[source] std::io::Error),
    /// Il a démarré et refusé le travail. Sa sortie d'erreur est gardée, parce
    /// qu'elle dit toujours pourquoi et qu'un code de sortie ne dit rien.
    #[error("ffmpeg a refusé: {0}")]
    Refused(String),
    /// Le fichier produit n'a pas pu être relu.
    #[error("le fichier du clip n'a pas pu être lu: {0}")]
    Unreadable(#[source] std::io::Error),
}

/// Emballe des unités d'accès Annex B dans un MP4 lisible partout.
///
/// # Pourquoi `ffmpeg` et pas un multiplexeur à nous
///
/// La vidéo n'est pas réencodée : `-c:v copy` conserve ses octets. Le son brut
/// devient une piste AAC au moment du téléchargement, sur ce fil séparé.
/// Ce qui reste à faire est de l'écriture de boîtes MP4, entièrement spécifiée
/// et entièrement ennuyeuse, et une erreur y donne un fichier qui ne s'ouvre
/// nulle part sans dire pourquoi.
///
/// Le coût est mesuré et petit: un processus par clip, au plus un toutes les
/// trente secondes, et jamais sur le chemin des images. D7 utilise la
/// bibliothèque libavcodec pour l'image en direct ; ce processus séparé ne
/// travaille que sur le fichier demandé.
///
/// L'Annex B ne porte aucune horloge, d'où `-r`: sans lui, ffmpeg suppose
/// vingt-cinq images par seconde et le clip sort au ralenti.
///
/// # Errors
/// [`ClipError`] quand ffmpeg manque, refuse, ou rend un fichier illisible.
pub fn to_mp4(cut: &Cut) -> Result<Vec<u8>, ClipError> {
    use std::io::Write as _;

    // Répertoire privé et nettoyage automatique, même sur un refus de ffmpeg.
    let scratch = tempfile::Builder::new()
        .prefix("nel3ab-clip-")
        .tempdir()
        .map_err(ClipError::Unreadable)?;
    let out = scratch.path().join("clip.mp4");
    let pcm = cut.pcm().ok_or(ClipError::MissingSound)?;
    let audio = scratch.path().join("audio.s16le");
    std::fs::write(&audio, pcm).map_err(ClipError::Unreadable)?;
    let mut ffmpeg = std::process::Command::new("ffmpeg")
        .args(mux_args(cut.fps(), Some(&audio), &out))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(ClipError::NoMuxer)?;
    if let Some(mut input) = ffmpeg.stdin.take() {
        for bytes in &cut.annex_b {
            // Un refus précoce ferme le tube ; stderr donne sa raison.
            if input.write_all(bytes).is_err() {
                break;
            }
        }
    }
    let done = ffmpeg.wait_with_output().map_err(ClipError::NoMuxer)?;
    if !done.status.success() {
        return Err(ClipError::Refused(
            String::from_utf8_lossy(&done.stderr).trim().to_owned(),
        ));
    }
    std::fs::read(out).map_err(ClipError::Unreadable)
}

/// La vidéo reste inchangée. Seul le PCM est encodé en AAC pour le MP4.
/// 192 kbit/s stéréo : 720 ko pour trente secondes, contre 5,76 Mo en PCM.
/// Choix du 2026-09-06, vérifié par décodage du fichier ; aucun encodeur audio
/// ne tourne dans la boucle de jeu. Les options suivent la documentation ffmpeg.
fn mux_args(
    fps: u32,
    audio: Option<&std::path::Path>,
    out: &std::path::Path,
) -> Vec<std::ffi::OsString> {
    use std::ffi::OsString;
    let mut args: Vec<OsString> = ["-hide_banner", "-loglevel", "error", "-f", "h264", "-r"]
        .iter()
        .map(OsString::from)
        .collect();
    args.push(fps.to_string().into());
    args.extend(["-i", "pipe:0"].iter().map(OsString::from));
    if let Some(audio) = audio {
        args.extend(
            ["-f", "s16le", "-ar", "48000", "-ac", "2", "-i"]
                .iter()
                .map(OsString::from),
        );
        args.push(audio.as_os_str().to_owned());
        args.extend(
            [
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-threads:a",
                "1",
            ]
            .iter()
            .map(OsString::from),
        );
    }
    args.extend(
        ["-c:v", "copy", "-movflags", "+faststart", "-y"]
            .iter()
            .map(OsString::from),
    );
    args.push(out.as_os_str().to_owned());
    args
}

#[cfg(test)]
#[expect(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::integer_division,
    reason = "a panic IS the failure signal in a test, and a frame lands to the millisecond"
)]
mod tests {
    use super::*;

    /// Une partie ordinaire: soixante images par seconde, une clé toutes les dix
    /// secondes, comme l'encodeur les produit.
    fn played(seconds: u64) -> (Clips, Instant) {
        let start = Duration::ZERO;
        let mut clips = Clips::new();
        for frame in 0..seconds * 60 {
            let at = start + Duration::from_millis(frame * 1000 / 60);
            clips.keep(at, frame % 600 == 0, &[0_u8; 8 * 1024]);
        }
        (clips, Instant::now())
    }

    #[test]
    fn a_clip_covers_at_least_the_thirty_seconds_it_promises() {
        let (mut clips, now) = played(60);

        let cut = clips.take(now).unwrap().unwrap();
        let (bytes, covers) = (cut.annex_b, cut.covers);

        assert!(covers >= COVERS, "le clip ne couvre que {covers:?}");
        assert!(!bytes.is_empty());
    }

    /// Le jumeau: pas beaucoup plus que ce qu'il promet non plus.
    #[test]
    fn and_never_much_more_than_it_promises() {
        let (mut clips, now) = played(60);

        let covers = clips.take(now).unwrap().unwrap().covers;

        assert!(covers < COVERS + Duration::from_secs(11), "{covers:?}");
    }

    /// Et quand PLUSIEURS clés qualifient, on prend la plus récente.
    ///
    /// Ce cas n'est pas théorique: l'encodeur force une image-clé chaque fois
    /// que quelqu'un rejoint ou en redemande une, donc une salle animée en a
    /// bien plus qu'une toutes les dix secondes. Avec le GOP seul, une seule clé
    /// tombe dans la fenêtre où la coupe est permise, et le choix ne se voit
    /// pas: le banc de mutations l'a montré en remplaçant « la plus récente »
    /// par « la plus ancienne » sans qu'un test tombe.
    #[test]
    fn when_several_keys_would_do_the_clip_starts_at_the_newest() {
        let start = Duration::ZERO;
        let mut clips = Clips::new();
        // Une clé par seconde, comme une salle où des gens arrivent.
        for frame in 0..60 * 60_u32 {
            let at = start + Duration::from_millis(u64::from(frame) * 1000 / 60);
            clips.keep(at, frame % 60 == 0, &frame.to_le_bytes());
        }

        let covers = clips.take(Instant::now()).unwrap().unwrap().covers;

        // La plus ancienne rendrait quarante secondes. Ce qu'on veut est les
        // trente dernières, pas tout ce qu'on a.
        assert!(
            covers < COVERS + Duration::from_secs(2),
            "le clip couvre {covers:?}, donc il ne part pas de la clé la plus récente"
        );
    }

    #[test]
    fn a_clip_starts_on_a_key_frame_and_nowhere_else() {
        // Sans ça, le décodeur reçoit des images qui référencent une image
        // qu'il n'a jamais eue, et le fichier ne s'ouvre pas du tout.
        let start = Duration::ZERO;
        let mut clips = Clips::new();
        // Chaque image porte son propre numéro, pour qu'on puisse dire laquelle
        // ouvre le clip plutôt que d'espérer.
        for frame in 0..60 * 60_u32 {
            let at = start + Duration::from_millis(u64::from(frame) * 1000 / 60);
            clips.keep(at, frame % 600 == 0, &frame.to_le_bytes());
        }

        let bytes = clips
            .take(Instant::now())
            .unwrap()
            .unwrap()
            .annex_b
            .concat();

        let first = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
        assert_eq!(
            first % 600,
            0,
            "le clip part de l'image {first}, qui n'est pas une clé"
        );
    }

    #[test]
    fn a_room_that_just_started_has_nothing_to_clip_yet() {
        // Ni un refus ni une erreur: il n'y a simplement pas encore trente
        // secondes derrière une clé.
        let (mut clips, now) = played(5);

        assert!(clips.take(now).unwrap().is_none());
        assert!(!clips.ready());
    }

    #[test]
    fn a_second_clip_too_soon_is_refused_and_says_how_long_to_wait() {
        let (mut clips, now) = played(60);
        clips.take(now).unwrap().unwrap();

        let refused = clips.take(now + Duration::from_secs(10)).unwrap_err();

        assert_eq!(refused.wait, APART.saturating_sub(Duration::from_secs(10)));
    }

    /// Le jumeau. Une limite qui refuserait toujours satisferait le test
    /// au-dessus en rendant la fonctionnalité inutilisable.
    #[test]
    fn a_second_clip_after_the_wait_is_granted() {
        let (mut clips, now) = played(60);
        clips.take(now).unwrap().unwrap();

        assert!(clips.take(now + APART).unwrap().is_some());
    }

    #[test]
    fn the_ring_forgets_what_falls_out_of_its_window() {
        // Sinon une soirée de quatre heures garderait quatre heures de vidéo.
        let (clips, _) = played(300);

        assert!(
            clips.weight() < 45 * 60 * 8 * 1024,
            "l'anneau retient {} octets après cinq minutes",
            clips.weight()
        );
    }

    #[test]
    fn the_ring_also_forgets_when_the_pictures_get_too_heavy() {
        // Le jumeau de la borne en temps. Un jeu plus agité que tout ce qu'on a
        // mesuré ne doit pas pouvoir manger la mémoire de la machine: l'anneau
        // rend un clip plus court plutôt que de grandir.
        let start = Duration::ZERO;
        let mut clips = Clips::new();
        for frame in 0..40 * 60_u64 {
            let at = start + Duration::from_millis(frame * 1000 / 60);
            // Cent kibioctets par image, soit six fois le pire mesuré.
            clips.keep(at, frame % 600 == 0, &vec![0_u8; 100 * 1024]);
        }

        assert!(clips.weight() <= HOLDS, "{} octets", clips.weight());
    }

    #[test]
    fn a_muxer_that_is_not_there_is_named_rather_than_guessed() {
        // Le cas d'une machine sans ffmpeg. On veut une erreur qui dit quoi
        // installer, pas un fichier vide qui ne s'ouvre nulle part.
        let missing = to_mp4(&Cut {
            annex_b: vec![Arc::from([0, 0, 0, 1, 0x65])],
            from: Duration::ZERO,
            sound: vec![chunk(Duration::ZERO, 480, 1)],
            covers: Duration::from_secs(1),
            frames: 60,
        });

        // Sur cette machine ffmpeg EST là, donc l'appel échoue plus loin: sur
        // des octets qui ne sont pas une vidéo. Les deux chemins sont des
        // erreurs nommées, et c'est ce qu'on vérifie.
        assert!(matches!(
            missing,
            Err(ClipError::NoMuxer(_) | ClipError::Refused(_))
        ));
    }

    #[test]
    fn the_muxer_is_asked_for_the_frame_rate_it_cannot_guess() {
        // L'Annex B ne porte aucune horloge. Sans `-r`, ffmpeg suppose
        // vingt-cinq images par seconde et un clip de trente-cinq secondes en
        // annonce quatre-vingt-quatre, au ralenti, sans un mot.
        let args = mux_args(50, None, std::path::Path::new("/tmp/x.mp4"));
        let said: Vec<String> = args
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();

        let rate = said
            .iter()
            .position(|a| a == "-r")
            .expect("la cadence est demandée");
        assert_eq!(said[rate + 1], "50");
    }

    #[test]
    fn the_muxer_is_told_to_copy_rather_than_re_encode() {
        // Le jumeau, et il porte la promesse de la fonctionnalité: le clip
        // contient les octets qui sont partis vers les navigateurs. Un
        // réencodage donnerait un fichier qui montre la même partie sans être
        // la même vidéo, et coûterait la carte graphique pendant qu'on joue.
        let said: Vec<String> = mux_args(60, None, std::path::Path::new("/tmp/x.mp4"))
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();

        let codec = said
            .iter()
            .position(|a| a == "-c:v")
            .expect("le codec est nommé");
        assert_eq!(said[codec + 1], "copy");
        assert_eq!(said.last().map(String::as_str), Some("/tmp/x.mp4"));
    }

    #[test]
    fn the_clip_reports_the_cadence_it_actually_holds() {
        // Un jeu PAL tourne à cinquante images par seconde. Emballer à soixante
        // rendrait un fichier en accéléré, sans qu'aucune erreur le dise.
        let start = Duration::ZERO;
        let mut clips = Clips::new();
        for frame in 0..50 * 60_u64 {
            let at = start + Duration::from_millis(frame * 1000 / 50);
            clips.keep(at, frame % 500 == 0, &[0_u8; 1024]);
        }

        let cut = clips.take(Instant::now()).unwrap().unwrap();

        assert_eq!(cut.fps(), 50);
    }

    #[test]
    fn a_clip_that_covers_nothing_still_names_a_cadence() {
        // Le jumeau du cas dégénéré: une division par zéro rendrait `NaN`, et
        // une cadence `NaN` passée à ffmpeg est un refus illisible.
        let empty = Cut {
            annex_b: Vec::new(),
            from: Duration::ZERO,
            sound: Vec::new(),
            covers: Duration::ZERO,
            frames: 0,
        };

        assert!(empty.fps() >= 1);
    }
    fn audio_cut() -> Cut {
        Cut {
            annex_b: Vec::new(),
            from: Duration::from_secs(10),
            sound: Vec::new(),
            covers: Duration::from_secs(1),
            frames: 60,
        }
    }

    fn chunk(at: Duration, frames: usize, value: u8) -> Sound {
        Sound {
            at,
            pcm: Arc::from(vec![value; frames * SAMPLE_BYTES]),
        }
    }

    #[test]
    fn audio_is_cut_at_the_first_picture_not_the_oldest_sound() {
        let mut cut = audio_cut();
        let at = cut.from;
        cut.sound = vec![
            chunk(at.checked_sub(Duration::from_secs(1)).unwrap(), 480, 99),
            chunk(at.checked_sub(Duration::from_millis(5)).unwrap(), 480, 1),
            chunk(at + Duration::from_millis(5), 480, 2),
            chunk(at + Duration::from_millis(995), 480, 3),
            chunk(at + Duration::from_secs(2), 480, 99),
        ];
        let pcm = cut.pcm().unwrap();
        assert_eq!(pcm.len(), SAMPLE_RATE * SAMPLE_BYTES);
        assert!(pcm[..240 * SAMPLE_BYTES].iter().all(|b| *b == 1));
        assert!(
            pcm[240 * SAMPLE_BYTES..720 * SAMPLE_BYTES]
                .iter()
                .all(|b| *b == 2)
        );
        assert!(
            pcm[720 * SAMPLE_BYTES..47760 * SAMPLE_BYTES]
                .iter()
                .all(|b| *b == 0)
        );
        assert!(pcm[47760 * SAMPLE_BYTES..].iter().all(|b| *b == 3));
        assert!(!pcm.contains(&99));
    }

    #[test]
    fn scheduling_jitter_does_not_cut_the_waveform_between_chunks() {
        let mut cut = audio_cut();
        for tick in 0..100 {
            let jitter = if tick % 2 == 0 { 0 } else { 300 };
            cut.sound.push(chunk(
                cut.from + Duration::from_micros(tick * 10_000 + jitter),
                480,
                7,
            ));
        }
        assert!(cut.pcm().unwrap().iter().all(|byte| *byte == 7));
    }

    #[test]
    fn sound_outside_the_video_does_not_invent_an_audio_track() {
        let mut cut = audio_cut();
        assert!(cut.pcm().is_none());
        cut.sound.push(chunk(Duration::ZERO, 480, 7));
        assert!(cut.pcm().is_none());
        cut.sound.push(chunk(cut.from, 480, 0));
        assert!(
            cut.pcm().unwrap().iter().all(|byte| *byte == 0),
            "silence produit et son absent sont distincts"
        );
    }

    #[test]
    fn audio_storage_is_bounded_by_time_and_by_bytes() {
        let mut clips = Clips::new();
        clips.keep_sound(Duration::ZERO, &[1; 1920]);
        clips.keep_sound(KEEPS + Duration::from_secs(1), &[2; 1920]);
        assert_eq!(clips.sound.len(), 1);
        assert_eq!(clips.sound.front().unwrap().pcm[0], 2);
        for _ in 0..5000 {
            clips.keep_sound(KEEPS, &[3; 1920]);
        }
        assert!(clips.sound_bytes <= SOUND_HOLDS);
        assert!(clips.sound_bytes > SOUND_HOLDS - 1920);
        let before = clips.sound_bytes;
        clips.keep_sound(KEEPS, &[1, 2, 3]);
        clips.keep_sound(KEEPS, &[]);
        assert_eq!(clips.sound_bytes, before);
    }

    #[test]
    fn the_muxer_copies_video_but_encodes_and_selects_the_audio() {
        let args = mux_args(
            60,
            Some(std::path::Path::new("/tmp/sound.s16le")),
            std::path::Path::new("/tmp/x.mp4"),
        );
        let said: Vec<_> = args.iter().map(|a| a.to_string_lossy()).collect();
        for (option, value) in [
            ("-c:v", "copy"),
            ("-c:a", "aac"),
            ("-ar", "48000"),
            ("-ac", "2"),
        ] {
            let at = said.iter().position(|arg| *arg == option).unwrap();
            assert_eq!(said[at + 1], value);
        }
        assert!(said.windows(2).any(|pair| pair == ["-map", "1:a:0"]));
        let silent = mux_args(60, None, std::path::Path::new("/tmp/x.mp4"));
        assert!(!silent.iter().any(|arg| arg == "-c:a"));
    }

    fn generated_video() -> Arc<[u8]> {
        let generated = std::process::Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=16x16:r=60",
                "-t",
                "1",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-tune",
                "zerolatency",
                "-f",
                "h264",
                "pipe:1",
            ])
            .output()
            .unwrap();
        assert!(
            generated.status.success(),
            "{}",
            String::from_utf8_lossy(&generated.stderr)
        );
        Arc::from(generated.stdout)
    }

    #[test]
    #[ignore = "requires ffmpeg and ffprobe; run just clip-audio-test"]
    fn the_exported_mp4_contains_audible_stereo_and_preserves_its_start() {
        use std::process::Command;
        let mut cut = audio_cut();
        cut.annex_b = vec![generated_video()];
        let pcm: Vec<u8> = (0..36000)
            .flat_map(|sample| {
                let value: i16 = if sample % 100 < 50 { 8000 } else { -8000 };
                [value.to_le_bytes(), (-value).to_le_bytes()].concat()
            })
            .collect();
        cut.sound = vec![Sound {
            at: cut.from + Duration::from_millis(250),
            pcm: Arc::from(pcm),
        }];
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("clip.mp4");
        std::fs::write(&file, to_mp4(&cut).unwrap()).unwrap();
        let probe = Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=codec_name,sample_rate,channels",
                "-of",
                "csv=p=0",
            ])
            .arg(&file)
            .output()
            .unwrap();
        assert!(probe.status.success());
        assert_eq!(String::from_utf8_lossy(&probe.stdout).trim(), "aac,48000,2");
        let decoded = Command::new("ffmpeg")
            .args(["-v", "error", "-i"])
            .arg(&file)
            .args([
                "-map", "0:a:0", "-f", "s16le", "-ac", "2", "-ar", "48000", "pipe:1",
            ])
            .output()
            .unwrap();
        assert!(
            decoded.status.success(),
            "{}",
            String::from_utf8_lossy(&decoded.stderr)
        );
        let samples: Vec<_> = decoded
            .stdout
            .chunks_exact(4)
            .map(|s| {
                (
                    i16::from_le_bytes([s[0], s[1]]),
                    i16::from_le_bytes([s[2], s[3]]),
                )
            })
            .collect();
        assert!(
            (48000..=49024).contains(&samples.len()),
            "{} samples",
            samples.len()
        );
        assert!(
            samples[..9600]
                .iter()
                .all(|(left, right)| left.unsigned_abs() < 20 && right.unsigned_abs() < 20),
            "le son commence avant son image"
        );
        let loud = &samples[24000..36000];
        assert!(
            loud.iter()
                .map(|(left, _)| u64::from(left.unsigned_abs()))
                .sum::<u64>()
                > 12000 * 1000,
            "la piste existe mais reste muette"
        );
        assert!(
            loud.iter()
                .map(|(left, right)| i64::from(*left) * i64::from(*right))
                .sum::<i64>()
                < 0,
            "les deux canaux ont perdu leur signal distinct"
        );
        // Un son absent est une erreur ; un vrai silence reste une piste.
        cut.sound.clear();
        assert!(matches!(to_mp4(&cut), Err(ClipError::MissingSound)));
    }
}
