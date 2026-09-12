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

/// Depuis combien de temps sans le moindre geste une salle se ferme.
///
/// Trente minutes, décidé par Souhib le 12 septembre 2026. La sieste, elle, ne
/// gèle que Dolphin et ne rend rien pour la Switch, qui ne fait jamais la
/// sieste et tourne à plein tant que personne ne ferme.
pub const CLOSE_AFTER: Duration = Duration::from_mins(30);

/// Combien de temps avant la fermeture on prévient la salle.
///
/// Cinq minutes: assez pour revenir des toilettes, assez court pour ne pas
/// laisser tourner une salle qu'on a quittée. Un seul geste annule tout.
pub const WARN_BEFORE: Duration = Duration::from_mins(5);

/// Les deux délais de la règle, ensemble.
///
/// Ensemble parce qu'ils n'ont de sens que l'un par rapport à l'autre: prévenir
/// après avoir fermé ne veut rien dire. Les passer séparément donnait une
/// signature que personne ne relit, et deux occasions de les inverser.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// Après combien de temps sans geste la salle se ferme.
    pub after: Duration,
    /// Combien de temps avant la fermeture on prévient.
    pub warn: Duration,
    /// Après combien de temps SANS PERSONNE la salle ferme son jeu.
    ///
    /// Bien plus court que l'inactivité, parce que ce n'est pas la même chose:
    /// là, plus personne n'est là pour revenir. Trois minutes quand même, et pas
    /// zéro: recharger une page laisse la salle vide une seconde ou deux, et
    /// fermer sur-le-champ tuerait la partie de quelqu'un qui vient d'appuyer
    /// sur F5.
    pub empty: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            after: CLOSE_AFTER,
            warn: WARN_BEFORE,
            empty: EMPTY_AFTER,
        }
    }
}

/// Depuis combien de temps SANS PERSONNE une salle ferme son jeu.
///
/// Trois minutes. Le même délai que celui qui donne la main à quelqu'un d'autre
/// quand le propriétaire s'absente, et pour la même raison: c'est le temps au
/// bout duquel une absence cesse d'être un aller-retour.
pub const EMPTY_AFTER: Duration = Duration::from_mins(3);

/// Ce qu'une salle sans geste mérite, s'il faut faire quelque chose.
///
/// Un type à part de [`Move`], et pas une variante de plus: `Move` se traduit
/// en verbe docker (`pause`, `unpause`), et fermer une salle n'est pas un verbe
/// docker. Les mélanger obligerait `tell_docker` à inventer une commande.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// Prévenir: la fermeture approche.
    Warn,
    /// Fermer le jeu et rendre la salle à son catalogue.
    Close,
}

/// La règle d'inactivité.
///
/// Présence et activité ne sont pas la même chose, et c'est tout le sujet: un
/// onglet oublié compte comme un spectateur, donc une règle bâtie sur [`Busy`]
/// ne fermerait jamais rien. L'instant qu'on lui passe est celui du dernier
/// geste réel, celui que le transport estampille sur une trame NON NEUTRE.
///
/// Sans horloge à elle, comme [`Nap`]: chaque instant est passé, donc la règle
/// se vérifie sans attendre une demi-heure.
#[derive(Debug, Default)]
pub struct Idle {
    /// Le dernier instant de vie observé, pour repérer qu'un geste a eu lieu.
    seen: Option<Instant>,
    /// Depuis quand la salle est vide, si elle l'est.
    ///
    /// Mesuré ici plutôt que déduit du dernier geste: quelqu'un qui regarde
    /// sans toucher à rien n'a pas fait de geste depuis longtemps, et il est
    /// pourtant là.
    empty_since: Option<Instant>,
    /// Dans combien de MINUTES la salle ferme, si c'est assez proche pour le
    /// dire. Zéro veut dire « rien à annoncer ».
    ///
    /// Tenu à jour à chaque tour, et pas seulement au moment d'avertir: une
    /// page qui arrive en plein compte à rebours doit le voir elle aussi, et
    /// un geste doit l'effacer chez tout le monde.
    closing_in: u8,
    warned: bool,
    closed: bool,
}

impl Idle {
    /// Une salle dont on ne sait encore rien.
    #[must_use]
    pub const fn new() -> Self {
        Self {
            seen: None,
            empty_since: None,
            closing_in: 0,
            warned: false,
            closed: false,
        }
    }

    /// Dans combien de minutes la salle ferme, ou zéro s'il n'y a rien à dire.
    ///
    /// Lu à chaque tour par le binaire, qui le donne aux pages. Une valeur et
    /// pas un événement: une page qui arrive après l'avertissement doit voir le
    /// compte à rebours, et un événement ne se répète pas.
    #[must_use]
    pub const fn closing_in(&self) -> u8 {
        self.closing_in
    }

    /// Un tour d'observation. Rend un geste une seule fois par échéance.
    ///
    /// `alive` est le dernier moment où la salle a vécu: le dernier geste d'un
    /// joueur, ou l'ouverture de la salle tant que personne n'a joué. Un jeu
    /// demandé ou une fermeture déjà en route suspendent la règle: la boucle
    /// d'images a déjà du travail, et lui en ajouter ferait deux ordres pour
    /// une seule salle.
    pub fn saw(
        &mut self,
        busy: Busy,
        playing: bool,
        alive: Instant,
        now: Instant,
        limits: Limits,
    ) -> Option<Step> {
        if self.seen != Some(alive) {
            self.seen = Some(alive);
            self.warned = false;
            self.closed = false;
        }
        // Une salle sans jeu n'a rien à fermer, et le dire ici plutôt que chez
        // l'appelant garde la règle entière au même endroit. Le worker installé
        // est relancé par systemd dès qu'il s'arrête: fermer une salle vide ne
        // libérerait rien et rouvrirait la même salle deux secondes plus tard.
        if !playing || busy.wanted {
            self.closing_in = 0;
            return None;
        }
        // La salle désertée, AVANT l'inactivité: quand plus personne n'est là,
        // il n'y a personne à prévenir et rien à attendre. Une salle vide est
        // aussi une salle inactive, donc l'ordre décide laquelle des deux
        // ferme, et la plus courte doit gagner.
        if busy.quiet() {
            let depuis = *self.empty_since.get_or_insert(now);
            if now.saturating_duration_since(depuis) >= limits.empty {
                return (!std::mem::replace(&mut self.closed, true)).then_some(Step::Close);
            }
        } else {
            self.empty_since = None;
        }
        let idle = now.saturating_duration_since(alive);
        // Le compte à rebours que la salle affiche. Arrondi au MINUTE
        // SUPÉRIEURE: annoncer « dans 0 minute » pendant cinquante secondes
        // ferait mentir le compte dans le sens qui inquiète.
        let left = limits.after.saturating_sub(idle);
        self.closing_in = if idle >= limits.after.saturating_sub(limits.warn) {
            u8::try_from(left.as_secs().div_ceil(60)).unwrap_or(u8::MAX)
        } else {
            0
        };
        if idle >= limits.after {
            return (!std::mem::replace(&mut self.closed, true)).then_some(Step::Close);
        }
        if idle >= limits.after.saturating_sub(limits.warn) {
            return (!std::mem::replace(&mut self.warned, true)).then_some(Step::Warn);
        }
        None
    }
}

/// Ce qu'il faut faire à l'émulateur, s'il faut faire quelque chose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Move {
    /// Geler: la salle est vide depuis assez longtemps.
    Sleep,
    /// Dégeler: quelqu'un regarde.
    Wake,
}

/// Ce qui empêche une salle de dormir.
///
/// Un type plutôt qu'un nombre, et la raison est un vrai défaut. La sieste ne
/// regardait que les spectateurs du GRAND format. Trois personnes pouvaient
/// donc être dans la salle sans qu'elle s'en aperçoive: celle qui a choisi le
/// format réduit parce que sa liaison est mauvaise, celle qui a mis son
/// téléphone en manette seule, et celle qui tient une manette sans regarder.
///
/// Ce que ça donnait, vécu le 30 août 2026: le conteneur gelé, un écran noir, et
/// surtout **un jeu demandé qui n'arrivait jamais**. La boucle d'images est
/// bloquée sur un émulateur en pause, et c'est elle qui lit la demande de jeu:
/// la demande était donc notée puis oubliée, sans un mot, jusqu'à ce que
/// quelqu'un d'autre ouvre le grand format par hasard.
///
/// Nommer chaque raison plutôt que les additionner à l'appel force à décider
/// pour chacune, et rend le défaut d'origine impossible à réintroduire par
/// oubli: ajouter un champ casse la compilation de tout ce qui construit un
/// `Busy`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Busy {
    /// Combien regardent, les deux formats confondus.
    pub watching: usize,
    /// Combien tiennent une manette. Geler le jeu sous les doigts de quelqu'un
    /// qui joue est le pire cas, et c'était possible.
    pub holding: usize,
    /// Vrai quand un jeu a été demandé et pas encore servi.
    ///
    /// Une salle vide qui reçoit une demande doit se réveiller pour l'exécuter.
    /// Sans ça, la personne qui a cliqué attend un jeu qui ne viendra qu'au
    /// prochain spectateur.
    pub wanted: bool,
}

impl Busy {
    /// Vrai quand plus personne n'a besoin que la salle tourne.
    #[must_use]
    pub const fn quiet(&self) -> bool {
        self.watching == 0 && self.holding == 0 && !self.wanted
    }
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
    pub fn saw(&mut self, busy: Busy, now: Instant, grace: Duration) -> Option<Move> {
        if !busy.quiet() {
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

/// L'attente qui revient vraiment à l'émulateur.
///
/// Le worker mesure le temps passé à attendre son image prochaine. Quand la
/// salle dort, ce temps contient la sieste, et une sieste n'est pas un hoquet:
/// `just sessions` annonçait « l'émulateur a fait attendre 6 310 436 ms » pour
/// une salle en pause depuis une heure quarante-cinq. Sept tranches sur les
/// soixante-trois signalées en trois jours de journal étaient dans ce cas.
///
/// Retranché ici plutôt que corrigé chez le lecteur, parce qu'une mesure fausse
/// qu'on rattrape à la lecture reste fausse dans le journal.
///
/// Ne descend jamais sous zéro. Les deux durées viennent d'horloges lues à des
/// instants différents, donc la sieste peut dépasser l'attente de quelques
/// microsecondes, et une soustraction qui déborderait rendrait une attente
/// gigantesque là où il n'y en avait aucune.
#[must_use]
pub const fn awake_wait(elapsed: Duration, napped: Duration) -> Duration {
    elapsed.saturating_sub(napped)
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
    let status = crate::lifecycle::bounded_status(
        Command::new("docker")
            .arg(verb)
            .arg(container)
            .stdout(Stdio::null())
            .stderr(Stdio::null()),
        Duration::from_secs(5),
    )
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
    /// Une salle où `n` personnes regardent, et rien d'autre.
    fn watching(n: usize) -> Busy {
        Busy {
            watching: n,
            ..Busy::default()
        }
    }

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

        assert_eq!(nap.saw(Busy::default(), start, GRACE), None);
        assert_eq!(nap.saw(Busy::default(), at(start, 30), GRACE), None);
        assert_eq!(nap.saw(Busy::default(), at(start, 59), GRACE), None);
        assert_eq!(
            nap.saw(Busy::default(), at(start, 60), GRACE),
            Some(Move::Sleep)
        );
    }

    /// Et le compteur repart de zéro dès que quelqu'un revient.
    #[test]
    fn somebody_coming_back_resets_the_wait() {
        let start = Instant::now();
        let mut nap = Nap::new();

        assert_eq!(nap.saw(Busy::default(), at(start, 50), GRACE), None);
        assert_eq!(nap.saw(watching(1), at(start, 51), GRACE), None);
        // Le compte repart de la première observation de vide, pas de l'instant
        // où la salle s'est vraiment vidée: personne ne l'a regardée entre les
        // deux. L'écart vaut au plus un tour de boucle, soit une seconde.
        assert_eq!(nap.saw(Busy::default(), at(start, 100), GRACE), None);
        assert_eq!(
            nap.saw(Busy::default(), at(start, 111), GRACE),
            None,
            "le compte a repris au départ au lieu de la dernière fois qu'on a vu du monde"
        );
        assert_eq!(
            nap.saw(Busy::default(), at(start, 160), GRACE),
            Some(Move::Sleep)
        );
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
        nap.saw(Busy::default(), start, GRACE);
        assert_eq!(
            nap.saw(Busy::default(), at(start, 60), GRACE),
            Some(Move::Sleep)
        );

        assert_eq!(nap.saw(watching(1), at(start, 61), GRACE), Some(Move::Wake));
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
        nap.saw(Busy::default(), start, GRACE);
        assert_eq!(
            nap.saw(Busy::default(), at(start, 60), GRACE),
            Some(Move::Sleep)
        );

        assert_eq!(nap.saw(Busy::default(), at(start, 61), GRACE), None);
        assert_eq!(nap.saw(Busy::default(), at(start, 600), GRACE), None);

        assert_eq!(
            nap.saw(watching(2), at(start, 601), GRACE),
            Some(Move::Wake)
        );
        assert_eq!(nap.saw(watching(2), at(start, 602), GRACE), None);
    }

    /// Une salle qui n'a jamais été vide ne gèle rien.
    #[test]
    fn a_busy_room_never_sleeps() {
        let start = Instant::now();
        let mut nap = Nap::new();

        for second in 0..300 {
            assert_eq!(nap.saw(watching(1), at(start, second), GRACE), None);
        }
        assert!(!nap.asleep());
    }

    #[test]
    fn a_wait_that_contained_a_nap_only_counts_what_was_awake() {
        // Une tranche entière de dix minutes, dont presque tout en pause.
        let waited = Duration::from_mins(10);
        let slept = Duration::from_secs(599);

        assert_eq!(awake_wait(waited, slept), Duration::from_secs(1));
    }

    /// Le jumeau, et il n'est pas décoratif: sans lui, une soustraction qui
    /// déborde rendrait une attente de cinq cent quatre-vingt-quatre mille ans,
    /// ce qui est exactement le genre de chiffre que ce module existe pour ne
    /// plus produire.
    #[test]
    fn a_nap_longer_than_the_wait_leaves_nothing_rather_than_everything() {
        let waited = Duration::from_millis(10);
        let slept = Duration::from_millis(11);

        assert_eq!(awake_wait(waited, slept), Duration::ZERO);
    }

    /// Et le cas ordinaire: sans sieste, l'attente est rendue telle quelle.
    /// Sinon une fonction qui rendrait toujours zéro passerait les deux
    /// au-dessus.
    #[test]
    fn a_wait_without_a_nap_is_left_alone() {
        let waited = Duration::from_millis(17);

        assert_eq!(awake_wait(waited, Duration::ZERO), waited);
    }

    #[test]
    fn somebody_on_the_reduced_format_keeps_the_room_awake() {
        // Le défaut du 30 août 2026, et il coûtait cher. La sieste ne comptait
        // que les spectateurs du GRAND format, donc quelqu'un qui a choisi le
        // format réduit parce que sa liaison est mauvaise voyait la salle geler
        // sous lui: écran noir, et surtout un jeu demandé qui n'arrivait jamais.
        let mut nap = Nap::new();
        let start = Instant::now();
        assert_eq!(nap.saw(watching(1), start, GRACE), None);

        let reduced = Busy {
            watching: 1,
            ..Busy::default()
        };
        assert_eq!(nap.saw(reduced, at(start, 120), GRACE), None);
    }

    #[test]
    fn somebody_holding_a_pad_keeps_the_room_awake() {
        // Le pire cas du même défaut: un téléphone en manette seule n'ouvre
        // AUCUNE socket vidéo, donc la salle gelait sous les doigts de quelqu'un
        // qui était en train de jouer.
        let mut nap = Nap::new();
        let start = Instant::now();
        let playing = Busy {
            holding: 1,
            ..Busy::default()
        };

        assert_eq!(nap.saw(playing, start, GRACE), None);
        assert_eq!(nap.saw(playing, at(start, 120), GRACE), None);
    }

    #[test]
    fn a_game_asked_for_wakes_a_sleeping_room() {
        // La boucle d'images lit la demande de jeu, et elle est bloquée quand
        // l'émulateur est gelé. Sans ce réveil, la demande attend le prochain
        // spectateur: elle est notée puis oubliée, sans un mot.
        let mut nap = Nap::new();
        let start = Instant::now();
        assert_eq!(nap.saw(Busy::default(), start, GRACE), None);
        assert_eq!(
            nap.saw(Busy::default(), at(start, 61), GRACE),
            Some(Move::Sleep)
        );

        let asked = Busy {
            wanted: true,
            ..Busy::default()
        };

        assert_eq!(nap.saw(asked, at(start, 62), GRACE), Some(Move::Wake));
    }

    /// Le jumeau de tout ce qui précède: une salle où personne ne fait RIEN doit
    /// toujours s'endormir. Sans lui, une règle qui rendrait « occupée » en
    /// permanence satisferait les trois tests au-dessus et supprimerait la
    /// sieste.
    #[test]
    fn a_room_where_nobody_does_anything_still_sleeps() {
        let mut nap = Nap::new();
        let start = Instant::now();
        nap.saw(Busy::default(), start, GRACE);

        assert_eq!(
            nap.saw(Busy::default(), at(start, 61), GRACE),
            Some(Move::Sleep)
        );
    }

    /// Une salle qu'on ne touche plus finit par se fermer.
    #[test]
    fn une_salle_sans_geste_depuis_trente_minutes_demande_la_fermeture() {
        let start = Instant::now();
        let mut idle = Idle::new();
        let vu = |idle: &mut Idle, s: u64| {
            idle.saw(watching(1), true, start, at(start, s), Limits::default())
        };

        assert_eq!(vu(&mut idle, 60), None);
        assert_eq!(vu(&mut idle, 25 * 60 - 1), None);
        assert_eq!(vu(&mut idle, 25 * 60), Some(Step::Warn));
        assert_eq!(vu(&mut idle, 26 * 60), None, "l'avertissement se répète");
        assert_eq!(vu(&mut idle, 30 * 60), Some(Step::Close));
        assert_eq!(vu(&mut idle, 31 * 60), None, "la fermeture se répète");
    }

    /// Le premier jumeau négatif: un geste récent ne déclenche rien du tout.
    #[test]
    fn une_manette_touchee_il_y_a_vingt_quatre_minutes_ne_dit_rien() {
        let start = Instant::now();
        let mut idle = Idle::new();

        assert_eq!(
            idle.saw(
                watching(1),
                true,
                at(start, 60),
                at(start, 60 + 24 * 60),
                Limits::default(),
            ),
            None
        );
    }

    /// Le second: à vingt-neuf minutes l'avertissement est dû, la fermeture non.
    /// Prévenir n'est pas fermer, et c'est tout l'intérêt des cinq minutes.
    #[test]
    fn une_manette_touchee_il_y_a_vingt_neuf_minutes_previent_sans_fermer() {
        let start = Instant::now();
        let mut idle = Idle::new();
        let geste = at(start, 60);

        assert_eq!(
            idle.saw(
                watching(1),
                true,
                geste,
                at(start, 60 + 29 * 60),
                Limits::default(),
            ),
            Some(Step::Warn)
        );
        assert_eq!(
            idle.saw(
                watching(1),
                true,
                geste,
                at(start, 60 + 29 * 60 + 59),
                Limits::default(),
            ),
            None,
            "la salle s'est fermée une seconde avant l'heure"
        );
    }

    /// Un geste pendant le compte à rebours annule tout, avertissement compris.
    #[test]
    fn un_geste_annule_la_fermeture_qui_approche() {
        let start = Instant::now();
        let mut idle = Idle::new();

        assert_eq!(
            idle.saw(
                watching(1),
                true,
                start,
                at(start, 25 * 60),
                Limits::default(),
            ),
            Some(Step::Warn)
        );
        let geste = at(start, 26 * 60);
        assert_eq!(
            idle.saw(
                watching(1),
                true,
                geste,
                at(start, 27 * 60),
                Limits::default(),
            ),
            None,
            "un geste n'a pas remis le compte à zéro"
        );
        assert_eq!(
            idle.saw(
                watching(1),
                true,
                geste,
                at(start, 31 * 60),
                Limits::default(),
            ),
            None,
            "la salle s'est fermée alors qu'on venait d'y jouer"
        );
        assert_eq!(
            idle.saw(
                watching(1),
                true,
                geste,
                at(start, 26 * 60 + 30 * 60),
                Limits::default(),
            ),
            Some(Step::Close)
        );
    }

    /// Une salle qui attend un jeu ne se ferme pas sous les doigts de celui qui
    /// vient de cliquer: la boucle d'images a déjà cet ordre à servir.
    #[test]
    fn une_salle_qui_attend_un_jeu_ne_se_ferme_pas() {
        let start = Instant::now();
        let mut idle = Idle::new();
        let demande = Busy {
            wanted: true,
            ..Busy::default()
        };

        assert_eq!(
            idle.saw(demande, true, start, at(start, 31 * 60), Limits::default(),),
            None
        );
    }

    /// Une salle ouverte SANS jeu n'a rien à fermer.
    ///
    /// Le worker installé est relancé par systemd dès qu'il s'arrête. Fermer une
    /// salle vide ne libérerait donc rien et provoquerait un redémarrage toutes
    /// les demi-heures, éternellement. Ce qui coûte, c'est l'émulateur.
    #[test]
    fn une_salle_sans_jeu_en_cours_ne_se_ferme_jamais() {
        let start = Instant::now();
        let mut idle = Idle::new();

        assert_eq!(
            idle.saw(
                watching(1),
                false,
                start,
                at(start, 60 * 60),
                Limits::default(),
            ),
            None,
            "une salle sans jeu s'est fermée pour rien"
        );
    }

    /// Une salle que tout le monde a quittée ferme son jeu, et vite.
    #[test]
    fn une_salle_que_tout_le_monde_a_quittee_ferme_son_jeu() {
        let start = Instant::now();
        let mut idle = Idle::new();
        let personne = Busy::default();

        // Le compte part du premier REGARD, pas de l'ouverture: avant d'avoir
        // observé la salle, on ne sait pas qu'elle est vide. Le fil la regarde
        // cinq fois par seconde, donc la différence est invisible en vrai.
        assert_eq!(
            idle.saw(personne, true, start, start, Limits::default()),
            None
        );
        assert_eq!(
            idle.saw(personne, true, start, at(start, 60), Limits::default()),
            None,
            "une minute de salle vide n'est pas un départ"
        );
        assert_eq!(
            idle.saw(personne, true, start, at(start, 3 * 60), Limits::default()),
            Some(Step::Close)
        );
    }

    /// Le jumeau: quelqu'un qui revient annule tout, et le compte repart à zéro.
    #[test]
    fn un_spectateur_qui_revient_annule_la_fermeture() {
        let start = Instant::now();
        let mut idle = Idle::new();
        let personne = Busy::default();

        assert_eq!(
            idle.saw(personne, true, start, start, Limits::default()),
            None
        );
        assert_eq!(
            idle.saw(
                watching(1),
                true,
                start,
                at(start, 2 * 60),
                Limits::default()
            ),
            None,
            "quelqu'un est là"
        );
        // La salle se revide à deux minutes trente: la fermeture est donc due à
        // cinq minutes trente, et pas à trois minutes.
        assert_eq!(
            idle.saw(
                personne,
                true,
                start,
                at(start, 2 * 60 + 30),
                Limits::default()
            ),
            None
        );
        assert_eq!(
            idle.saw(personne, true, start, at(start, 5 * 60), Limits::default()),
            None,
            "le compte n'est pas reparti de zéro quand la salle s'est revidée"
        );
        assert_eq!(
            idle.saw(
                personne,
                true,
                start,
                at(start, 5 * 60 + 30),
                Limits::default()
            ),
            Some(Step::Close)
        );
    }

    /// Le second jumeau: une manette tenue sans regarder est quelqu'un.
    ///
    /// C'est le défaut que la sieste avait eu avant nous: elle ne comptait que
    /// les spectateurs du grand format, et gelait le jeu sous les doigts de
    /// celui qui jouait au format réduit ou en manette seule.
    #[test]
    fn une_manette_tenue_sans_regarder_garde_la_salle() {
        let start = Instant::now();
        let mut idle = Idle::new();
        let manette = Busy {
            holding: 1,
            ..Busy::default()
        };

        assert_eq!(
            idle.saw(manette, true, start, at(start, 10 * 60), Limits::default()),
            None,
            "la salle s'est fermée sous les doigts de quelqu'un"
        );
    }

    /// La salle annonce le compte à rebours, et seulement quand il compte.
    #[test]
    fn la_salle_dit_dans_combien_de_minutes_elle_ferme() {
        let start = Instant::now();
        let mut idle = Idle::new();
        let present = watching(1);

        idle.saw(present, true, start, at(start, 10 * 60), Limits::default());
        assert_eq!(idle.closing_in(), 0, "vingt minutes avant, rien à annoncer");

        idle.saw(present, true, start, at(start, 25 * 60), Limits::default());
        assert_eq!(idle.closing_in(), 5);

        idle.saw(
            present,
            true,
            start,
            at(start, 29 * 60 + 30),
            Limits::default(),
        );
        assert_eq!(
            idle.closing_in(),
            1,
            "trente secondes restantes s'annoncent comme une minute"
        );
    }

    /// Le jumeau: un geste efface le compte à rebours chez tout le monde.
    #[test]
    fn un_geste_efface_le_compte_a_rebours() {
        let start = Instant::now();
        let mut idle = Idle::new();
        let present = watching(1);

        idle.saw(present, true, start, at(start, 26 * 60), Limits::default());
        assert_eq!(idle.closing_in(), 4);

        let geste = at(start, 26 * 60);
        idle.saw(present, true, geste, at(start, 27 * 60), Limits::default());
        assert_eq!(
            idle.closing_in(),
            0,
            "la salle annonce encore une fermeture annulée"
        );
    }

    /// Le second jumeau: une salle sans jeu n'annonce rien du tout.
    #[test]
    fn une_salle_sans_jeu_n_annonce_aucune_fermeture() {
        let start = Instant::now();
        let mut idle = Idle::new();

        idle.saw(
            watching(1),
            false,
            start,
            at(start, 29 * 60),
            Limits::default(),
        );

        assert_eq!(idle.closing_in(), 0);
    }
}
