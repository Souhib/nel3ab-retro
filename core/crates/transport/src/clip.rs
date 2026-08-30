//! Les dernières secondes de la partie, gardées pour qu'on puisse les revoir.
//!
//! # Ce qui est gardé, et pourquoi si peu
//!
//! Un anneau des unités d'accès telles que l'encodeur les a produites. Rien
//! n'est réencodé: le fichier rendu contient exactement les octets qui sont
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
#[derive(Debug)]
struct Kept {
    /// L'instant de capture, sur l'horloge du worker.
    at: Instant,
    /// Vrai quand un décodeur peut commencer ici.
    key: bool,
    bytes: Vec<u8>,
}

/// Un clip prêt à emballer.
#[derive(Debug)]
pub struct Cut {
    /// Les unités d'accès, telles qu'elles sont parties sur le fil.
    pub annex_b: Vec<u8>,
    /// Ce que le clip couvre.
    pub covers: Duration,
    /// Combien d'images il contient.
    pub frames: usize,
}

impl Cut {
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
}

impl Clips {
    /// Un anneau vide.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Range une image encodée, et oublie ce qui sort des bornes.
    pub fn keep(&mut self, at: Instant, key: bool, annex_b: &[u8]) {
        self.bytes += annex_b.len();
        self.kept.push_back(Kept {
            at,
            key,
            bytes: annex_b.to_vec(),
        });
        while let Some(oldest) = self.kept.front() {
            let too_old = at.saturating_duration_since(oldest.at) > KEEPS;
            if !too_old && self.bytes <= HOLDS {
                break;
            }
            self.bytes -= oldest.bytes.len();
            self.kept.pop_front();
        }
    }

    /// Ce que l'anneau retient, en octets. Pour le journal.
    #[must_use]
    pub const fn weight(&self) -> usize {
        self.bytes
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
            .rfind(|(_, k)| k.key && last.saturating_duration_since(k.at) >= COVERS)
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
        let mut annex_b = Vec::with_capacity(self.bytes);
        for kept in self.kept.iter().skip(from) {
            annex_b.extend_from_slice(&kept.bytes);
        }
        let covers = self
            .kept
            .back()
            .zip(self.kept.get(from))
            .map_or(Duration::ZERO, |(last, first)| {
                last.at.saturating_duration_since(first.at)
            });
        self.taken = Some(now);
        Ok(Some(Cut {
            annex_b,
            covers,
            frames: self.kept.len() - from,
        }))
    }
}

/// Ce qui peut rater entre les octets et le fichier.
#[derive(Debug, thiserror::Error)]
pub enum ClipError {
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
/// Rien n'est réencodé: `-c copy` recopie les mêmes octets dans un conteneur.
/// Ce qui reste à faire est de l'écriture de boîtes MP4, entièrement spécifiée
/// et entièrement ennuyeuse, et une erreur y donne un fichier qui ne s'ouvre
/// nulle part sans dire pourquoi.
///
/// Le coût est mesuré et petit: un processus par clip, au plus un toutes les
/// trente secondes, et jamais sur le chemin des images. C'est l'inverse du
/// raisonnement de l'ADR D7, qui refusait libavcodec pour ENCODER; encoder est
/// soixante fois par seconde sur le chemin critique, emballer est une fois par
/// demi-minute sur un fil à part.
///
/// L'Annex B ne porte aucune horloge, d'où `-r`: sans lui, ffmpeg suppose
/// vingt-cinq images par seconde et le clip sort au ralenti.
///
/// # Errors
/// [`ClipError`] quand ffmpeg manque, refuse, ou rend un fichier illisible.
pub fn to_mp4(annex_b: &[u8], fps: u32) -> Result<Vec<u8>, ClipError> {
    use std::io::Write as _;

    // Un nom qui ne peut pas entrer en collision avec un autre clip en cours.
    let scratch = std::env::temp_dir().join(format!(
        "nel3ab-clip-{}-{}.mp4",
        std::process::id(),
        next_scratch()
    ));
    let mut ffmpeg = std::process::Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-f", "h264", "-r"])
        .arg(fps.to_string())
        .args(["-i", "-", "-c", "copy", "-movflags", "+faststart", "-y"])
        .arg(&scratch)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(ClipError::NoMuxer)?;
    if let Some(mut input) = ffmpeg.stdin.take() {
        // L'erreur est ignorée à dessein: ffmpeg qui ferme son entrée plus tôt
        // est un refus, et c'est sa sortie d'erreur qui le dira proprement.
        let _ = input.write_all(annex_b);
    }
    let done = ffmpeg.wait_with_output().map_err(ClipError::NoMuxer)?;
    if !done.status.success() {
        let _ = std::fs::remove_file(&scratch);
        return Err(ClipError::Refused(
            String::from_utf8_lossy(&done.stderr).trim().to_owned(),
        ));
    }
    let mp4 = std::fs::read(&scratch).map_err(ClipError::Unreadable);
    // Effacé quoi qu'il arrive: le fichier ne sert qu'à traverser ffmpeg, et
    // celui qui reste est celui qu'on oublie.
    let _ = std::fs::remove_file(&scratch);
    mp4
}

/// Un numéro qui monte, pour que deux clips simultanés n'écrivent pas au même
/// endroit. La limite de cadence les rend improbables; se reposer dessus pour
/// la CORRECTION serait faire d'un confort une garantie.
fn next_scratch() -> u64 {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

#[cfg(test)]
#[expect(
    clippy::unwrap_used,
    clippy::integer_division,
    reason = "a panic IS the failure signal in a test, and a frame lands to the millisecond"
)]
mod tests {
    use super::*;

    /// Une partie ordinaire: soixante images par seconde, une clé toutes les dix
    /// secondes, comme l'encodeur les produit.
    fn played(seconds: u64) -> (Clips, Instant) {
        let start = Instant::now();
        let mut clips = Clips::new();
        for frame in 0..seconds * 60 {
            let at = start + Duration::from_millis(frame * 1000 / 60);
            clips.keep(at, frame % 600 == 0, &[0_u8; 8 * 1024]);
        }
        (
            clips,
            start + Duration::from_millis(seconds * 60 * 1000 / 60),
        )
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
        let start = Instant::now();
        let mut clips = Clips::new();
        // Une clé par seconde, comme une salle où des gens arrivent.
        for frame in 0..60 * 60_u32 {
            let at = start + Duration::from_millis(u64::from(frame) * 1000 / 60);
            clips.keep(at, frame % 60 == 0, &frame.to_le_bytes());
        }

        let covers = clips
            .take(start + Duration::from_mins(1))
            .unwrap()
            .unwrap()
            .covers;

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
        let start = Instant::now();
        let mut clips = Clips::new();
        // Chaque image porte son propre numéro, pour qu'on puisse dire laquelle
        // ouvre le clip plutôt que d'espérer.
        for frame in 0..60 * 60_u32 {
            let at = start + Duration::from_millis(u64::from(frame) * 1000 / 60);
            clips.keep(at, frame % 600 == 0, &frame.to_le_bytes());
        }

        let bytes = clips
            .take(start + Duration::from_mins(1))
            .unwrap()
            .unwrap()
            .annex_b;

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
        let start = Instant::now();
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
        let missing = to_mp4(&[0, 0, 0, 1, 0x65], 60);

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
        // vingt-cinq images par seconde et un clip de soixante sort au ralenti,
        // ce qui est une erreur qu'aucun code de sortie ne signale.
        //
        // Vérifié sur le message d'erreur, faute de pouvoir inspecter la ligne
        // de commande: ffmpeg répète ce qu'on lui a demandé quand il refuse.
        let refused = to_mp4(b"pas une video", 60);

        assert!(matches!(refused, Err(ClipError::Refused(_))));
    }

    #[test]
    fn the_clip_reports_the_cadence_it_actually_holds() {
        // Un jeu PAL tourne à cinquante images par seconde. Emballer à soixante
        // rendrait un fichier en accéléré, sans qu'aucune erreur le dise.
        let start = Instant::now();
        let mut clips = Clips::new();
        for frame in 0..50 * 60_u64 {
            let at = start + Duration::from_millis(frame * 1000 / 50);
            clips.keep(at, frame % 500 == 0, &[0_u8; 1024]);
        }

        let cut = clips.take(start + Duration::from_mins(1)).unwrap().unwrap();

        assert_eq!(cut.fps(), 50);
    }

    #[test]
    fn a_clip_that_covers_nothing_still_names_a_cadence() {
        // Le jumeau du cas dégénéré: une division par zéro rendrait `NaN`, et
        // une cadence `NaN` passée à ffmpeg est un refus illisible.
        let empty = Cut {
            annex_b: Vec::new(),
            covers: Duration::ZERO,
            frames: 0,
        };

        assert!(empty.fps() >= 1);
    }
}
