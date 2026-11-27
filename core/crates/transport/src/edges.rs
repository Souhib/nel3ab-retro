//! Un appui court ne se perd plus entre la page et la manette virtuelle.
//!
//! Une manette est un niveau (carnet, § 6.13): chaque place garde son dernier
//! état, et le fil d'entrée ne transmet que celui-là. C'est juste pour un stick,
//! pas pour un bouton. Après un trou de liaison, la page livre ses trames en
//! rafale. Un appui et son relâchement peuvent alors tomber entre deux lectures
//! de l'emplacement: seul le relâchement sort, et le jeu ne voit jamais
//! l'appui. Même s'ils sortent tous les deux, le jeu ne lit sa manette qu'une
//! fois par image, et un appui qui dure une demi-milliseconde sur la manette
//! virtuelle a toutes les chances de tomber entre deux lectures (audit ENT-2,
//! 2026-11-27).
//!
//! La règle ici: un bouton dont l'état vient de changer sur la manette
//! virtuelle garde ce nouvel état [`HOLD`] au moins. Un appui perdu entre deux
//! lectures est rendu, et tenu ce temps-là. Même chose pour un relâchement pris
//! entre deux appuis. Rien n'est mis en file: une place n'a qu'un état voulu et
//! un état dit, et un trou de liaison ne devient jamais un retard qui
//! s'accumule. Les sticks restent au « dernier gagne ».
//!
//! Le prix: un appui plus court que [`HOLD`] est allongé jusqu'à [`HOLD`], et
//! un nouvel appui moins de [`HOLD`] après un relâchement attend la fin de ce
//! délai. Un appui tenu plus longtemps n'est ni allongé ni retardé.

use std::time::{Duration, Instant};

use nel3ab_protocol::switch::{SwitchButtons, SwitchFrame};

/// Combien de temps un bouton garde l'état qu'on vient de dire à la manette.
///
/// Une image à 60 Hz, 16,7 ms, et une marge: le jeu lit sa manette une fois
/// par image, à un instant que nous ne connaissons pas. Choisi, pas mesuré
/// (audit ENT-2): la mesure demande le programme de test qui dessine chaque
/// bouton à chaque image, avec l'émulateur.
pub const HOLD: Duration = Duration::from_millis(20);

/// Les seize boutons du format Switch, chacun son bit.
const BUTTONS: u32 = 16;

/// Ce que la manette virtuelle d'une place a reçu, et ce que la page veut.
#[derive(Debug, Default, Clone)]
pub struct Edges {
    /// Le dernier état dit à la manette, absent avant le premier.
    told: Option<SwitchFrame>,
    /// Le dernier état envoyé par la page, que `told` rattrape.
    wanted: Option<SwitchFrame>,
    /// Quand chaque bouton a changé pour la dernière fois sur la manette.
    changed: [Option<Instant>; BUTTONS as usize],
    /// Les fronts qu'un « dernier gagne » aurait perdus, depuis le dernier relevé.
    rescued: u64,
    /// Les états dits en retard à dessein, depuis le dernier relevé.
    deferred: u64,
}

/// Les fronts tenus d'une place depuis le dernier relevé.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Kept {
    /// Les appuis ou relâchements arrivés et repartis entre deux lectures,
    /// qu'un « dernier gagne » aurait perdus.
    pub rescued: u64,
    /// Les états dits plus tard que la page ne les a envoyés, pour tenir un
    /// bouton [`HOLD`].
    pub deferred: u64,
}

impl Edges {
    /// Le dernier état de la place, avec les boutons appuyés et relâchés dans
    /// les états que personne n'a lus. Rend ce qu'il faut dire à la manette.
    ///
    /// `went_down` porte chaque bouton tenu dans au moins un de ces états,
    /// `went_up` chaque bouton relâché dans au moins un.
    pub fn offer(
        &mut self,
        latest: SwitchFrame,
        went_down: u32,
        went_up: u32,
        now: Instant,
    ) -> SwitchFrame {
        let told = self.told.map_or(0, buttons);
        let want = buttons(latest);
        // Appuyé puis relâché sans avoir été lu: l'appui est dit maintenant.
        let lost_press = went_down & !want & !told & SwitchButtons::KNOWN;
        // Relâché puis appuyé de nouveau sans avoir été lu: le relâchement aussi.
        let lost_release = went_up & want & told & SwitchButtons::KNOWN;
        for bit in bits(lost_press | lost_release) {
            self.changed[bit] = Some(now);
        }
        self.rescued += u64::from((lost_press | lost_release).count_ones());
        self.wanted = Some(latest);
        self.settle((told | lost_press) & !lost_release, latest, now)
    }

    /// Dit à la manette `next`, plus chaque bouton qui peut rejoindre l'état
    /// voulu: celui qui a tenu son état [`HOLD`], ou qui n'a jamais changé.
    fn settle(&mut self, mut next: u32, wanted: SwitchFrame, now: Instant) -> SwitchFrame {
        for bit in bits(next ^ buttons(wanted)) {
            let ready =
                self.changed[bit].is_none_or(|at| now.saturating_duration_since(at) >= HOLD);
            if ready {
                next ^= 1 << bit;
                self.changed[bit] = Some(now);
            }
        }
        let told = SwitchFrame {
            // Toujours valide: `next` ne prend que des bits de `told` et de
            // `wanted`. Le repli serait le « dernier gagne » d'avant.
            buttons: SwitchButtons::from_bits(next).unwrap_or(wanted.buttons),
            ..wanted
        };
        self.told = Some(told);
        told
    }

    /// Quand un état retenu devra être dit, s'il y en a un.
    #[must_use]
    pub fn due(&self) -> Option<Instant> {
        let (told, wanted) = (self.told?, self.wanted?);
        let differ = told.buttons.bits() ^ wanted.buttons.bits();
        bits(differ)
            .filter_map(|bit| self.changed[bit].map(|at| at + HOLD))
            .min()
    }

    /// L'état à dire maintenant, si un état retenu est arrivé à son heure.
    pub fn tick(&mut self, now: Instant) -> Option<SwitchFrame> {
        if self.due()? > now {
            return None;
        }
        let (told, wanted) = (self.told.map_or(0, buttons), self.wanted?);
        self.deferred += 1;
        Some(self.settle(told, wanted, now))
    }

    /// Les fronts tenus depuis le dernier appel, puis un relevé neuf.
    pub const fn take_kept(&mut self) -> Kept {
        let kept = Kept {
            rescued: self.rescued,
            deferred: self.deferred,
        };
        self.rescued = 0;
        self.deferred = 0;
        kept
    }
}

/// Les numéros des bits levés dans `mask`, parmi les seize boutons.
fn bits(mask: u32) -> impl Iterator<Item = usize> {
    (0..BUTTONS)
        .filter(move |bit| mask & (1 << bit) != 0)
        .filter_map(|bit| usize::try_from(bit).ok())
}

/// Les boutons d'une trame, pour les masques d'un emplacement.
#[must_use]
pub const fn buttons(frame: SwitchFrame) -> u32 {
    frame.buttons.bits() & SwitchButtons::KNOWN
}

#[cfg(test)]
#[expect(
    clippy::unwrap_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;
    use nel3ab_protocol::{PlayerSlot, Stick};

    const A: u32 = 1;
    const B: u32 = 1 << 1;

    fn frame(bits: u32) -> SwitchFrame {
        SwitchFrame {
            buttons: SwitchButtons::from_bits(bits).unwrap(),
            ..SwitchFrame::neutral(PlayerSlot::new(1).unwrap())
        }
    }

    fn ms(start: Instant, ms: u64) -> Instant {
        start + Duration::from_millis(ms)
    }

    /// Un appui et son relâchement arrivés ensemble, entre deux lectures: la
    /// manette reçoit l'appui tout de suite, puis le relâchement [`HOLD`] après.
    #[test]
    fn a_press_released_before_it_was_read_still_reaches_the_pad() {
        let start = Instant::now();
        let mut seat = Edges::default();
        assert_eq!(seat.offer(frame(0), 0, A | B, start), frame(0));
        // A pressed then released: the slot holds the release, and says A went down.
        let told = seat.offer(frame(0), A, A, ms(start, 100));
        assert_eq!(
            told.buttons.bits() & A,
            A,
            "only the release came out: the press was lost"
        );
        assert_eq!(seat.due(), Some(ms(start, 120)), "the release waits HOLD");
        assert_eq!(seat.tick(ms(start, 119)), None, "released before HOLD");
        assert_eq!(seat.tick(ms(start, 120)), Some(frame(0)));
        assert_eq!(seat.due(), None, "one deferred edge, then nothing");
        assert_eq!(
            seat.take_kept(),
            Kept {
                rescued: 1,
                deferred: 1
            }
        );
    }

    /// Le même pour un relâchement pris entre deux appuis: la manette voit le
    /// bouton relâché [`HOLD`], puis appuyé de nouveau.
    #[test]
    fn a_release_between_two_presses_still_reaches_the_pad() {
        let start = Instant::now();
        let mut seat = Edges::default();
        assert_eq!(seat.offer(frame(A), A, 0, start), frame(A));
        let told = seat.offer(frame(A), A, A, ms(start, 100));
        assert_eq!(
            told.buttons.bits() & A,
            0,
            "the release between two presses was lost"
        );
        assert_eq!(seat.tick(ms(start, 110)), None);
        assert_eq!(seat.tick(ms(start, 120)), Some(frame(A)));
    }

    /// Le jumeau: un appui tenu 100 ms sort à l'heure et se relâche à l'heure,
    /// sans rien retenir.
    #[test]
    fn a_press_held_longer_than_hold_is_neither_delayed_nor_lengthened() {
        let start = Instant::now();
        let mut seat = Edges::default();
        assert_eq!(seat.offer(frame(0), 0, A, start), frame(0));
        assert_eq!(seat.offer(frame(A), A, 0, ms(start, 10)), frame(A));
        assert_eq!(seat.offer(frame(A), A, 0, ms(start, 50)), frame(A));
        assert_eq!(seat.offer(frame(0), 0, A, ms(start, 110)), frame(0));
        assert_eq!(seat.due(), None);
        assert_eq!(seat.take_kept(), Kept::default());
    }

    /// Un appui lu, puis relâché 5 ms plus tard: le relâchement attend que
    /// l'appui ait duré [`HOLD`], et les sticks suivent sans attendre.
    #[test]
    fn a_press_read_then_released_too_soon_is_held_for_hold() {
        let start = Instant::now();
        let mut seat = Edges::default();
        assert_eq!(seat.offer(frame(A), A, 0, start), frame(A));
        let moved = SwitchFrame {
            left: Stick::new(8192, 0),
            ..frame(0)
        };
        let told = seat.offer(moved, 0, A, ms(start, 5));
        assert_eq!(
            told.buttons.bits(),
            A,
            "a press released after 5 ms was cut short on the pad"
        );
        assert_eq!(told.left, moved.left, "the stick waited for a button");
        assert_eq!(seat.tick(ms(start, 19)), None);
        assert_eq!(seat.tick(ms(start, 20)), Some(moved));
        assert_eq!(
            seat.take_kept(),
            Kept {
                rescued: 0,
                deferred: 1
            }
        );
    }

    /// Un seul état retenu par place, jamais une file: deux appuis courts dans
    /// le même délai en font un seul, et l'autre bouton n'attend pas.
    #[test]
    fn a_seat_keeps_one_deferred_state_never_a_queue() {
        let start = Instant::now();
        let mut seat = Edges::default();
        assert_eq!(seat.offer(frame(0), 0, A | B, start), frame(0));
        assert_eq!(seat.offer(frame(0), A, A, ms(start, 100)).buttons.bits(), A);
        // A second tap of A, and a press of B, before the release came out.
        let told = seat.offer(frame(B), A | B, A, ms(start, 105));
        assert_eq!(told.buttons.bits(), A | B, "B waited behind A");
        assert_eq!(seat.due(), Some(ms(start, 120)));
        assert_eq!(seat.tick(ms(start, 120)), Some(frame(B)));
        assert_eq!(seat.due(), None);
    }
}
