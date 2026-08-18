//! Endormir l'émulateur quand plus personne ne regarde.
//!
//! # Pourquoi ça ne se fait pas avec un signal
//!
//! Le processus que le worker lance est `docker run`, pas Dolphin. Un `SIGSTOP`
//! s'arrêterait au client docker et laisserait le jeu tourner derrière. On passe
//! donc par `docker pause`, qui gèle le conteneur par le cgroup freezer, et qui
//! demande un nom: c'est le wrapper qui le donne.
//!
//! # Ce que ça rapporte, mesuré
//!
//! Le 18 août 2026, salle vide, trois paires alternées de dix secondes: le
//! pipeline complet coûtait 5,87 W au-dessus d'une machine sans worker. Couper
//! la conversion et l'encodage n'en a rendu que 0,31. **Les cinq watts et demi
//! qui restent sont l'émulateur**, qui fait avancer le jeu pour personne.
//!
//! Et l'électricité n'est pas le meilleur argument. Une course continue, un
//! chronomètre de menu défile, une partie laissée en plan dérive pendant des
//! heures. Geler le jeu la retrouve exactement où elle était.
//!
//! # Le danger, et ce qui le désamorce
//!
//! Un conteneur en pause ne reçoit aucun signal. Si le worker mourait pendant
//! une pause, le jeu resterait gelé pour toujours et le worker suivant en
//! lancerait un second à côté: exactement l'émulateur orphelin qui a volé les
//! entrées pendant douze heures en août.
//!
//! Deux choses l'empêchent, et aucune des deux ne dépend de ce module tournant
//! correctement:
//!
//! - le wrapper efface le conteneur du même nom AVANT d'en lancer un neuf, donc
//!   un gelé oublié ne survit pas au démarrage suivant;
//! - le worker réveille toujours avant d'arrêter, quoi qu'il arrive.

use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Combien de temps une salle doit rester vide avant qu'on gèle le jeu.
///
/// Une minute. Assez pour qu'un rechargement de page, une reconnexion ou un
/// aller-retour aux toilettes ne gèlent rien, et assez court pour qu'une soirée
/// finie ne laisse pas la machine tourner jusqu'au lendemain.
pub const GRACE: Duration = Duration::from_mins(1);

/// Ce qu'il faut faire à l'émulateur, s'il faut faire quelque chose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Move {
    /// Geler: la salle est vide depuis assez longtemps.
    Sleep,
    /// Dégeler: quelqu'un regarde.
    Wake,
}

/// Décide quand geler et quand réveiller.
///
/// Sans horloge à lui: l'instant est passé à chaque tour, ce qui rend la règle
/// vérifiable sans attendre une minute par test.
#[derive(Debug, Default)]
pub struct Nap {
    /// Depuis quand la salle est vide. `None` quand quelqu'un regarde.
    empty_since: Option<Instant>,
    asleep: bool,
}

impl Nap {
    /// Un émulateur éveillé, dans une salle dont on ne sait encore rien.
    #[must_use]
    pub const fn new() -> Self {
        Self {
            empty_since: None,
            asleep: false,
        }
    }

    /// Vrai quand le jeu est gelé en ce moment.
    #[must_use]
    pub const fn asleep(&self) -> bool {
        self.asleep
    }

    /// Un tour d'observation. Rend un geste seulement quand l'état CHANGE.
    ///
    /// Seulement au changement, parce que `docker pause` sur un conteneur déjà
    /// gelé est une erreur, et parce qu'appeler docker deux fois par seconde
    /// pour ne rien changer serait une dépense pour éviter une dépense.
    pub fn saw(&mut self, watchers: usize, now: Instant, grace: Duration) -> Option<Move> {
        if watchers > 0 {
            self.empty_since = None;
            return self.asleep.then(|| {
                self.asleep = false;
                Move::Wake
            });
        }
        let since = *self.empty_since.get_or_insert(now);
        if self.asleep || now.duration_since(since) < grace {
            return None;
        }
        self.asleep = true;
        Some(Move::Sleep)
    }
}

/// Gèle le conteneur, ou le dégèle.
///
/// # Errors
/// Rend la sortie de docker quand la commande échoue, pour que l'appelant puisse
/// la tracer. Un échec n'est jamais fatal: une salle qui refuse de servir parce
/// qu'elle n'a pas su s'endormir serait une salle cassée par une économie.
pub fn tell_docker(container: &str, what: Move) -> Result<(), String> {
    let verb = match what {
        Move::Sleep => "pause",
        Move::Wake => "unpause",
    };
    let status = Command::new("docker")
        .arg(verb)
        .arg(container)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| format!("docker {verb} n'a pas pu être lancé: {error}"))?;
    if status.success() {
        return Ok(());
    }
    Err(format!("docker {verb} {container} a rendu {status}"))
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;

    fn at(base: Instant, seconds: u64) -> Instant {
        base + Duration::from_secs(seconds)
    }

    /// Une salle qui se vide ne gèle pas tout de suite.
    ///
    /// C'est la moitié qui compte le plus: une page qui se recharge laisse la
    /// salle vide une seconde ou deux, et geler le jeu à chaque rechargement
    /// serait pire que ne jamais le geler.
    #[test]
    fn an_empty_room_is_given_time_before_the_game_freezes() {
        let start = Instant::now();
        let mut nap = Nap::new();

        assert_eq!(nap.saw(0, start, GRACE), None);
        assert_eq!(nap.saw(0, at(start, 30), GRACE), None);
        assert_eq!(nap.saw(0, at(start, 59), GRACE), None);
        assert_eq!(nap.saw(0, at(start, 60), GRACE), Some(Move::Sleep));
    }

    /// Et le compteur repart de zéro dès que quelqu'un revient.
    #[test]
    fn somebody_coming_back_resets_the_wait() {
        let start = Instant::now();
        let mut nap = Nap::new();

        assert_eq!(nap.saw(0, at(start, 50), GRACE), None);
        assert_eq!(nap.saw(1, at(start, 51), GRACE), None);
        // Le compte repart de la première observation de vide, pas de l'instant
        // où la salle s'est vraiment vidée: personne ne l'a regardée entre les
        // deux. L'écart vaut au plus un tour de boucle, soit une seconde.
        assert_eq!(nap.saw(0, at(start, 100), GRACE), None);
        assert_eq!(
            nap.saw(0, at(start, 111), GRACE),
            None,
            "le compte a repris au départ au lieu de la dernière fois qu'on a vu du monde"
        );
        assert_eq!(nap.saw(0, at(start, 160), GRACE), Some(Move::Sleep));
    }

    /// Le réveil est immédiat, sans délai de grâce.
    ///
    /// L'inverse du gel, et volontairement asymétrique: attendre pour geler
    /// coûte quelques watts, attendre pour réveiller coûte une image figée sous
    /// les yeux de quelqu'un qui vient d'arriver.
    #[test]
    fn the_first_person_back_wakes_the_game_at_once() {
        let start = Instant::now();
        let mut nap = Nap::new();
        nap.saw(0, start, GRACE);
        assert_eq!(nap.saw(0, at(start, 60), GRACE), Some(Move::Sleep));

        assert_eq!(nap.saw(1, at(start, 61), GRACE), Some(Move::Wake));
        assert!(!nap.asleep());
    }

    /// On ne parle à docker qu'aux changements d'état.
    ///
    /// Sans ça, un tour de boucle par seconde lancerait `docker pause` deux
    /// mille fois par heure sur un conteneur déjà gelé, et chaque appel serait
    /// une erreur. Une dépense pour éviter une dépense.
    #[test]
    fn nothing_is_said_twice() {
        let start = Instant::now();
        let mut nap = Nap::new();
        nap.saw(0, start, GRACE);
        assert_eq!(nap.saw(0, at(start, 60), GRACE), Some(Move::Sleep));

        assert_eq!(nap.saw(0, at(start, 61), GRACE), None);
        assert_eq!(nap.saw(0, at(start, 600), GRACE), None);

        assert_eq!(nap.saw(2, at(start, 601), GRACE), Some(Move::Wake));
        assert_eq!(nap.saw(2, at(start, 602), GRACE), None);
    }

    /// Une salle qui n'a jamais été vide ne gèle rien.
    #[test]
    fn a_busy_room_never_sleeps() {
        let start = Instant::now();
        let mut nap = Nap::new();

        for second in 0..300 {
            assert_eq!(nap.saw(1, at(start, second), GRACE), None);
        }
        assert!(!nap.asleep());
    }
}
