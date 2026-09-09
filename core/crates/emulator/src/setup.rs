//! Les appareils présentés au jeu, un choix par place.
//!
//! Une manette GameCube et une Wiimote ne sont jamais branchées ensemble sur
//! une même place. Des personnes différentes peuvent choisir des appareils
//! différents avant de démarrer un jeu Wii qui les accepte.

use crate::config::PadKind;
use nel3ab_protocol::PlayerSlot;

/// Un appareil par place, jamais deux appareils pour la même personne.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PadSetup([PadKind; 4]);

impl From<PadKind> for PadSetup {
    fn from(kind: PadKind) -> Self {
        Self([kind; 4])
    }
}

impl PadSetup {
    #[must_use]
    /// Construit les quatre choix déjà typés.
    pub const fn new(pads: [PadKind; 4]) -> Self {
        Self(pads)
    }

    #[must_use]
    /// Le choix de cette place valide.
    pub fn at(self, slot: PlayerSlot) -> PadKind {
        self.0[usize::from(slot.get() - 1)]
    }

    #[must_use]
    /// Les quatre codes du protocole.
    pub fn codes(self) -> [u8; 4] {
        self.0.map(PadKind::code)
    }

    /// Un fichier atomique associe le choix au jeu, jamais au lancement d'avant.
    /// # Errors
    /// Rend l'erreur d'écriture ou de renommage sans lancer un jeu mal configuré.
    pub fn save_for(self, directory: &std::path::Path, game: &str) -> std::io::Result<()> {
        let path = directory.join("chosen-setup");
        let temporary = directory.join("chosen-setup.tmp");
        std::fs::write(&temporary, format!("{}\n{game}", self.encode()))?;
        std::fs::rename(temporary, path)
    }

    #[must_use]
    /// Relit les choix seulement s’ils appartiennent au jeu demandé.
    pub fn load_for(directory: &std::path::Path, game: &str) -> Option<Self> {
        let text = std::fs::read_to_string(directory.join("chosen-setup")).ok()?;
        let (codes, stored_game) = text.split_once('\n')?;
        if game != stored_game {
            return None;
        }
        Self::parse(codes)
    }

    /// Remplace seulement l'extension d'une Wiimote déjà branchée.
    #[must_use]
    pub fn with_extension(mut self, slot: PlayerSlot, extension: crate::config::Extension) -> Self {
        if self.at(slot) != PadKind::GameCube {
            self.0[slot.index()] = match extension {
                crate::config::Extension::Nunchuk => PadKind::Wiimote,
                crate::config::Extension::Guitare => PadKind::Guitar,
                crate::config::Extension::None => PadKind::WiimoteOnly,
            };
        }
        self
    }

    /// Le fichier est petit et complet. Une valeur invalide n'en charge aucune.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        let codes: Vec<_> = text.split_whitespace().map(str::parse::<u8>).collect();
        let [Ok(a), Ok(b), Ok(c), Ok(d)] = codes.as_slice() else {
            return None;
        };
        let values = [*a, *b, *c, *d];
        values
            .iter()
            .all(|code| *code <= 3)
            .then(|| Self(values.map(PadKind::from_code)))
    }

    #[must_use]
    /// La représentation complète rangée sur disque.
    pub fn encode(self) -> String {
        self.codes().map(|v| v.to_string()).join(" ")
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    reason = "Les essais affirment que leurs places valides existent."
)]
mod tests {
    use super::*;
    use crate::SlotSet;
    use crate::config::{dolphin_ini, wiimote_ini};

    #[test]
    fn saved_choices_belong_to_the_named_game() {
        let directory = tempfile::tempdir().unwrap();
        let setup = PadSetup::parse("0 1 2 3").unwrap();
        assert_eq!(PadSetup::load_for(directory.path(), "kart.rvz"), None);
        setup.save_for(directory.path(), "kart.rvz").unwrap();
        assert_eq!(
            PadSetup::load_for(directory.path(), "kart.rvz"),
            Some(setup)
        );
        assert_eq!(PadSetup::load_for(directory.path(), "party.rvz"), None);
        assert!(
            setup
                .save_for(&directory.path().join("missing"), "kart.rvz")
                .is_err()
        );
        assert_eq!(
            PadSetup::load_for(directory.path(), "kart.rvz"),
            Some(setup)
        );
    }

    #[test]
    fn changing_an_extension_changes_only_a_wiimote_at_that_port() {
        let setup = PadSetup::parse("0 1 2 3").unwrap();
        let changed =
            setup.with_extension(PlayerSlot::new(2).unwrap(), crate::config::Extension::None);
        assert_eq!(changed.codes(), [0, 3, 2, 3]);
        assert_eq!(
            changed.with_extension(
                PlayerSlot::new(1).unwrap(),
                crate::config::Extension::Guitare
            ),
            changed
        );
        assert_eq!(
            changed.with_extension(
                PlayerSlot::new(2).unwrap(),
                crate::config::Extension::Nunchuk
            ),
            setup
        );
    }

    #[test]
    fn each_seat_presents_only_its_chosen_device() {
        let setup = PadSetup::parse("0 1 2 0").unwrap();
        let dolphin = dolphin_ini(SlotSet::ALL, setup);
        assert!(dolphin.contains("SIDevice0 = 6"));
        assert!(dolphin.contains("SIDevice1 = 0"));
        assert!(dolphin.contains("SIDevice2 = 0"));
        assert!(dolphin.contains("SIDevice3 = 6"));
        let wii = wiimote_ini(SlotSet::ALL, setup);
        assert!(wii.contains("[Wiimote2]\nDevice"));
        assert!(wii.contains("[Wiimote3]\nDevice"));
        assert!(wii.contains("[Wiimote1]\nSource = 0"));
        assert!(!wii.contains("[Wiimote1]\nDevice"));
        assert_eq!(setup.encode(), "0 1 2 0");
    }

    #[test]
    fn invalid_files_never_partially_change_a_setup() {
        for bad in [
            "",
            "0",
            "0 1 2",
            "0 1 2 0 1",
            "0 1 4 0",
            "0 -1 2 0",
            "0 x 2 0",
        ] {
            assert_eq!(PadSetup::parse(bad), None);
        }
        assert_eq!(PadSetup::parse("1 1 1 1"), Some(PadKind::Wiimote.into()));
    }
}
