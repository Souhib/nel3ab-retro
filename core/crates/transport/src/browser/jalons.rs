//! Les jalons d'un démarrage, publiés dans `/roms` (ADR D43).
//!
//! Le salon les lit pour dire où en est un lancement: le worker a démarré, son
//! émulateur ou son adaptateur est lancé, la première image est partie. Trois
//! faits que seul le worker connaît, et qu'il ne publiait pas.
//!
//! Ajoutés au moment de SERVIR `/roms`, pas dans la bibliothèque elle-même:
//! les chaînes de référence de `nel3ab_emulator::library` ne bougent pas, et
//! le chemin d'une image ne paie qu'une lecture atomique par paquet.
//!
//! L'heure est l'heure MURALE, en millisecondes depuis 1970: le salon la
//! compare à l'heure murale de son propre lancement, sur la même machine.
//! L'horloge monotone de ce processus ne se comparerait à rien hors de lui.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Ce que ce worker a franchi depuis son démarrage.
#[derive(Debug)]
pub struct Jalons {
    /// Quand ce worker a démarré son jeu ou son menu. `0` si l'horloge murale
    /// est antérieure à 1970, et rien n'est alors publié.
    depuis_ms: u64,
    /// L'émulateur ou l'adaptateur a démarré.
    moteur: AtomicBool,
    /// Le premier paquet d'image offert aux spectateurs, `0` tant qu'aucun.
    image_ms: AtomicU64,
}

impl Jalons {
    /// Les jalons d'un worker qui démarre maintenant.
    #[must_use]
    pub fn maintenant() -> Self {
        Self::depuis(heure_ms())
    }

    /// Les jalons d'un worker démarré à cette heure murale.
    #[must_use]
    pub const fn depuis(depuis_ms: u64) -> Self {
        Self {
            depuis_ms,
            moteur: AtomicBool::new(false),
            image_ms: AtomicU64::new(0),
        }
    }

    /// L'émulateur ou l'adaptateur vient de démarrer.
    pub fn moteur_lance(&self) {
        self.moteur.store(true, Ordering::Relaxed);
    }

    /// Un paquet d'image vient d'être offert. Seul le PREMIER est retenu.
    ///
    /// Sur le chemin de chaque image: une lecture atomique, et l'heure n'est
    /// lue qu'une fois. L'échange garde le premier écrivain si deux flux
    /// arrivaient ensemble.
    pub fn image_offerte(&self) {
        if self.image_ms.load(Ordering::Relaxed) == 0 {
            let _premiere = self.image_ms.compare_exchange(
                0,
                heure_ms().max(1),
                Ordering::Relaxed,
                Ordering::Relaxed,
            );
        }
    }

    /// Le catalogue tel que `/roms` le sert, avec les jalons franchis.
    ///
    /// Rien quand le catalogue n'est pas un objet JSON (le banc des clips sert
    /// `[]`): il est alors servi tel quel. Un jalon non franchi est ABSENT,
    /// jamais `false` ni `0`: le salon lit l'absence d'un champ que ce worker
    /// publie comme « pas encore », et celle d'un worker plus ancien comme
    /// « on ne sait pas ».
    #[must_use]
    pub fn dans(&self, catalogue: &str) -> Option<String> {
        let Ok(serde_json::Value::Object(mut objet)) = serde_json::from_str(catalogue) else {
            return None;
        };
        if self.depuis_ms > 0 {
            objet.insert("depuis_ms".into(), self.depuis_ms.into());
        }
        if self.moteur.load(Ordering::Relaxed) {
            objet.insert("moteur".into(), "lance".into());
        }
        let image = self.image_ms.load(Ordering::Relaxed);
        if image > 0 {
            objet.insert("image_ms".into(), image.into());
        }
        Some(serde_json::Value::Object(objet).to_string())
    }
}

/// L'heure murale en millisecondes depuis 1970, ou `0` avant 1970.
fn heure_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |ecart| {
            u64::try_from(ecart.as_millis()).unwrap_or(u64::MAX)
        })
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;

    #[test]
    fn un_worker_neuf_ne_publie_que_son_demarrage() {
        let jalons = Jalons::depuis(1_000);
        let vu: serde_json::Value =
            serde_json::from_str(&jalons.dans(r#"{"current":null,"roms":[]}"#).unwrap()).unwrap();

        assert_eq!(vu["depuis_ms"], 1_000);
        assert!(vu.get("moteur").is_none(), "pas encore lancé: absent");
        assert!(vu.get("image_ms").is_none(), "pas encore d'image: absent");
        assert!(vu["current"].is_null());
    }

    #[test]
    fn la_premiere_image_est_retenue_et_la_suivante_ne_la_change_pas() {
        let jalons = Jalons::depuis(1_000);
        jalons.moteur_lance();
        jalons.image_offerte();
        let premiere: serde_json::Value =
            serde_json::from_str(&jalons.dans("{}").unwrap()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));

        jalons.image_offerte();
        let seconde: serde_json::Value = serde_json::from_str(&jalons.dans("{}").unwrap()).unwrap();

        assert_eq!(premiere["moteur"], "lance");
        assert!(premiere["image_ms"].as_u64().unwrap() >= 1);
        assert_eq!(seconde["image_ms"], premiere["image_ms"]);
    }

    #[test]
    fn un_catalogue_qui_n_est_pas_un_objet_est_servi_tel_quel() {
        assert_eq!(Jalons::depuis(1_000).dans("[]"), None);
        assert_eq!(Jalons::depuis(1_000).dans("pas du json"), None);
    }

    #[test]
    fn une_heure_d_avant_1970_ne_se_publie_pas() {
        let vu: serde_json::Value =
            serde_json::from_str(&Jalons::depuis(0).dans("{}").unwrap()).unwrap();
        assert!(vu.get("depuis_ms").is_none());
    }
}
