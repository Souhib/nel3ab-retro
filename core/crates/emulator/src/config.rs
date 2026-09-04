//! Generates the Dolphin config files a session runs against.
//!
//! # Why generate instead of committing a fixture
//!
//! `GCPadNew.ini` and the FIFO names encode the same fact twice: `[GCPad2]` is
//! player 2 *because* it points at a file called `p2`. A committed fixture lets
//! those two drift, and the failure mode is not a crash — it is player 2's
//! controller quietly driving nobody. Deriving both from one [`SlotSet`] means
//! the drift cannot happen, and the golden tests below pin the bytes so an
//! accidental edit is still caught.
//!
//! Every key here is either something we depend on being non-default, or a
//! default we depend on so specifically that Dolphin changing it would be a bug
//! we want to find in a diff rather than in a game.

use std::fmt::Write as _;

use nel3ab_protocol::{MAX_PLAYERS, PlayerSlot};

use crate::slots::SlotSet;

/// Name of the directory Dolphin scans for input pipes, inside the user folder.
///
/// `File::GetUserPath(D_PIPES_IDX)`. Dolphin scans it **once**, at
/// input-backend init — a FIFO that appears afterwards is invisible for the
/// whole session.
pub const PIPES_DIR: &str = "Pipes";

/// Name of the config directory inside the Dolphin user folder.
pub const CONFIG_DIR: &str = "Config";

/// The named pipe Dolphin's sound output is written to.
///
/// It sits in the user directory because that is what the container mounts, and
/// because `HOME` inside the container IS the user directory — which is what
/// makes the ALSA configuration below reachable without touching the image.
pub const AUDIO_PIPE: &str = "audio.fifo";

/// `.asoundrc`, which turns "the default sound device" into "a pipe we read".
///
/// There is no sound card in the container and no sound server either, so the
/// usual backends have nothing to open. ALSA's `file` plugin writes the samples
/// straight through to a path, which is all we need.
///
/// The `null` slave provides no clock. Nothing paces this stream but the reader:
/// when the pipe is full Dolphin's audio thread blocks, exactly as it would on a
/// sound card whose buffer is full. So the reader must consume 48000 frames a
/// second and no faster — measured on the first attempt at 45 TIMES real time,
/// which is what an unpaced ALSA device does when the mixer keeps padding.
#[must_use]
pub fn asoundrc(pipe: &std::path::Path) -> String {
    format!(
        "pcm.!default {{\n    \
         type file\n    \
         slave.pcm \"null\"\n    \
         file \"{}\"\n    \
         format raw\n\
         }}\n",
        pipe.display()
    )
}

/// What the sound is, once it leaves Dolphin: signed 16-bit, little endian,
/// two channels, 48 kHz. Read out of the header ALSA itself writes when asked
/// for a WAV rather than assumed.
pub const AUDIO_RATE: u32 = 48_000;
/// Channels in the stream Dolphin writes.
pub const AUDIO_CHANNELS: u32 = 2;
/// Bytes per sample frame: two channels of `i16`.
pub const AUDIO_FRAME_BYTES: usize = 4;
/// The same figure where a `u32` is what converts without a lint: `f64::from`
/// is exact for a `u32` and merely plausible for a `usize`.
pub const AUDIO_FRAME_BYTES_U32: u32 = 4;

/// `SIDEVICE_GC_CONTROLLER` in Dolphin's `SIDevices` enum.
///
/// The enum is positional and unnamed in the ini, so the number IS the
/// contract. Verified against `Source/Core/Core/HW/SI/SI_Device.h` @ 216ffb45.
const SIDEVICE_GC_CONTROLLER: u8 = 6;

/// `SIDEVICE_NONE` — an empty controller port.
const SIDEVICE_NONE: u8 = 0;

/// The backend Dolphin plays through.
///
/// ALSA, on a machine with no sound card, because [`asoundrc`] has already
/// redefined what "the default device" means: a pipe. There is no sound server
/// in the container and none is wanted — the file plugin writes the samples and
/// the worker reads them.
///
/// It used to be "No Audio Output", when nobody was listening. Nobody was
/// listening because there was nothing to listen to.
const AUDIO_BACKEND: &str = "ALSA";

/// The FIFO file name for a player, e.g. `p1`.
///
/// This name is the entire identity mechanism: Dolphin uses the file name as the
/// device's virtual name, so player 2 is player 2 because the file is called
/// `p2`. Nothing enumerates, so nothing can reorder (ADR D3).
#[must_use]
pub fn pipe_file_name(slot: PlayerSlot) -> String {
    format!("p{}", slot.get())
}

/// The Dolphin device string for a player's pipe, e.g. `Pipe/0/p1`.
///
/// Shaped `<source>/<id>/<name>`. The id is `0` for every pipe: Dolphin numbers
/// duplicates within a source *by name*, and our names are already distinct.
#[must_use]
pub fn pipe_device(slot: PlayerSlot) -> String {
    format!("Pipe/0/{}", pipe_file_name(slot))
}

/// The FIFO file name for a player's CONTROL pipe, e.g. `c1`.
///
/// # Pourquoi un second tuyau
///
/// Le tuyau de Dolphin n'expose que douze boutons — exactement les douze de
/// notre trame. Faire passer un ordre par celui du jeu coûterait donc un bouton
/// de jeu, sur une manette qui n'en a pas de trop.
///
/// Celui-ci ne porte aucune manette: il ne sert qu'aux expressions qui décident
/// ce qui est branché. Un jeu n'en voit jamais rien.
#[must_use]
pub fn control_pipe_file_name(slot: PlayerSlot) -> String {
    format!("c{}", slot.get())
}

/// The Dolphin device string for a player's control pipe, e.g. `Pipe/0/c1`.
#[must_use]
pub fn control_pipe_device(slot: PlayerSlot) -> String {
    format!("Pipe/0/{}", control_pipe_file_name(slot))
}

/// Ce qui est branché au bout d'une Wiimote, et qui peut changer EN COURS DE JEU.
///
/// # Pourquoi ce n'est pas une variante de `PadKind`
///
/// `PadKind` dit quel APPAREIL Dolphin présente, ce qui se décide au démarrage:
/// une manette GameCube et une Wiimote ne se remplacent pas à chaud. Une
/// extension, si. C'est le comportement du vrai matériel — on débranche un
/// Nunchuk et on branche une guitare sans éteindre la console — et Dolphin le
/// fait déjà: `Wiimote::Update()` appelle `HandleExtensionSwap` à 200 Hz.
///
/// Prouvé le 2026-09-02 contre Mario Strikers Charged, jeu tournant depuis
/// vingt-cinq secondes: voir `spikes/m5-manette-a-chaud`.
///
/// # Un NIVEAU, pas un front
///
/// L'ordre est un bouton TENU sur le tuyau de contrôle, pas une impulsion. Le
/// worker maintient ce qu'il veut et le réaffirme après tout redémarrage: l'état
/// vit chez lui, et Dolphin n'a rien à se rappeler. Une impulsion demanderait aux
/// deux de rester d'accord, ce que rien ne pourrait rétablir après une reprise.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Extension {
    /// Le Nunchuk, ce que la plupart des jeux Wii attendent.
    #[default]
    Nunchuk,
    /// La guitare, pour les jeux qui n'acceptent qu'elle.
    Guitare,
}

impl Extension {
    /// Le numéro d'attachement chez Dolphin.
    ///
    /// L'ordre vient de `WiimoteEmu::Wiimote::Wiimote`, qui les ajoute dans cet
    /// ordre: 0 rien, 1 Nunchuk, 2 Classic, 3 guitare. Le NOMBRE est le contrat,
    /// parce que l'expression rend un entier et non un nom.
    ///
    /// 2 manque exprès: la manette Classic n'a pas encore ses correspondances,
    /// et l'offrir sans elles donnerait une manette dont aucun bouton ne répond.
    #[must_use]
    pub const fn attachment(self) -> u8 {
        match self {
            Self::Nunchuk => 1,
            Self::Guitare => 3,
        }
    }

    /// Les boutons du tuyau de contrôle à TENIR pour l'obtenir.
    ///
    /// Deux bits, un par bouton, lus par l'expression écrite dans le fichier.
    /// `A` vaut un, `B` vaut deux, et l'attachement est `1 + A + 2 * B`. `A`
    /// reste libre pour la Classic, ce qui rendra son ajout purement additif.
    #[must_use]
    pub const fn held(self) -> &'static [&'static str] {
        match self {
            Self::Nunchuk => &[],
            Self::Guitare => &["B"],
        }
    }

    /// Ce qui voyage sur le fil et ce qu'on écrit sur le disque.
    #[must_use]
    pub const fn code(self) -> u8 {
        match self {
            Self::Nunchuk => 0,
            Self::Guitare => 1,
        }
    }

    /// Ce que la page envoie. Tout code inconnu retombe sur le Nunchuk, qui est
    /// ce que la plupart des jeux attendent.
    #[must_use]
    pub const fn from_code(code: u8) -> Self {
        match code {
            1 => Self::Guitare,
            _ => Self::Nunchuk,
        }
    }

    /// Comment on l'appelle dans un journal.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Nunchuk => "nunchuk",
            Self::Guitare => "guitare",
        }
    }
}

/// Quelle manette une place présente au jeu.
///
/// # Pourquoi c'est un CHOIX et pas les deux
///
/// Une manette GameCube et une Wiimote peuvent lire le même tuyau, et c'est ce
/// qui a rendu la Wiimote possible sans changer un octet du protocole. Mais un
/// jeu qui voit les deux compte deux manettes pour une personne: à deux joueurs,
/// le premier occupe deux places et le second n'entre jamais. Mesuré sur Mario
/// Kart Wii le 31 août 2026, le lendemain du jour où la Wiimote a été ajoutée.
///
/// Les deux branchées à la fois n'ont donc pas de sens, et le type le dit: il
/// n'y a pas de variante « les deux ».
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PadKind {
    /// La manette GameCube. Ce que fait un jeu GameCube, quoi qu'on demande.
    #[default]
    GameCube,
    /// La Wiimote et son Nunchuk, pour les jeux Wii qui n'acceptent que ça.
    Wiimote,
    /// La Wiimote dans une guitare, pour les jeux qui n'acceptent qu'elle.
    ///
    /// Une troisième valeur et non un drapeau à côté de `Wiimote`: les trois
    /// s'excluent, et un jeu qui verrait deux manettes en compterait deux.
    /// Guitar Hero III ne répond à RIEN d'autre — vérifié le 31 août 2026, avec
    /// une Wiimote et son Nunchuk: seul le bouton A de la Wiimote elle-même
    /// faisait quelque chose, ni la croix ni les autres boutons.
    Guitar,
}

impl PadKind {
    /// Ce que la page envoie sur le fil.
    #[must_use]
    pub const fn from_code(code: u8) -> Self {
        match code {
            1 => Self::Wiimote,
            2 => Self::Guitar,
            _ => Self::GameCube,
        }
    }

    /// Le code qui voyage, et ce qu'on écrit sur le disque.
    #[must_use]
    pub const fn code(self) -> u8 {
        match self {
            Self::GameCube => 0,
            Self::Wiimote => 1,
            Self::Guitar => 2,
        }
    }

    /// Comment on l'appelle dans un journal.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::GameCube => "gamecube",
            Self::Wiimote => "wiimote",
            Self::Guitar => "guitare",
        }
    }
}

/// Renders `WiimoteNew.ini`: une Wiimote émulée par place, sur le même tuyau.
///
/// # Pourquoi ce fichier existe
///
/// Beaucoup de jeux Wii n'acceptent pas la manette GameCube. Sans Wiimote, ils
/// démarrent, affichent leur écran de titre, et ne répondent à rien. Dolphin
/// émule déjà une Wiimote — c'est même son réglage par défaut — mais son fichier
/// de correspondances était VIDE, donc aucun bouton n'était relié à quoi que ce
/// soit. Le jeu voyait une Wiimote sur laquelle personne n'appuie jamais.
///
/// # Le même tuyau que la manette
///
/// `Pipe/0/pN`, celui de la place N. Dolphin sépare l'APPAREIL de ce qu'on en
/// fait: un même tuyau peut nourrir une manette GameCube et une Wiimote à la
/// fois, et c'est le jeu qui décide laquelle il écoute. Un jeu Wii qui accepte
/// les deux, comme Mario Kart Wii, laisse donc le choix à l'écran.
///
/// # Le mouvement, remplacé par le stick
///
/// Une Wiimote se penche, se secoue et se pointe. Dolphin expose ces trois
/// choses comme des commandes ordinaires — `Tilt`, `Swing`, `Shake`, `IR` — qui
/// se branchent sur n'importe quel bouton ou axe. Le stick principal penche donc
/// la Wiimote, et le stick C déplace son pointeur.
///
/// Le stick principal sert DEUX fois: il penche la Wiimote et il pousse le stick
/// du Nunchuk. Ce n'est pas un oubli. Un jeu qui se joue Wiimote seule lit
/// l'inclinaison et n'a pas de Nunchuk; un jeu qui se joue avec un Nunchuk lit
/// son stick et ignore l'inclinaison. Les deux familles tiennent donc sur le même
/// stick, et aucune n'est servie à moitié.
///
/// # Ce qui reste sans correspondance, et pourquoi
///
/// Le bouton Home et la secousse. Une Wiimote plus un Nunchuk comptent treize
/// boutons; notre tuyau en porte douze. Home ouvre le menu de la console, dont
/// cette salle n'a pas besoin — elle a le sien. La secousse remplace souvent un
/// bouton que les jeux offrent aussi autrement. Les laisser vides est un choix
/// dit, pas un oubli: les mettre sur une combinaison rendrait deux vrais boutons
/// imprévisibles.
#[must_use]
pub fn wiimote_ini(slots: SlotSet, pads: PadKind) -> String {
    // Rien du tout quand la salle joue à la manette GameCube. Une Wiimote qui
    // existe sans qu'on s'en serve n'est pas neutre: le jeu la COMPTE.
    if pads == PadKind::GameCube {
        return String::new();
    }
    let mut out = String::new();
    for slot in slots.iter() {
        let _ = write!(out, "{}", wiimote_section(slot));
    }
    out
}

/// Une section `[WiimoteN]`.
///
/// Elle ne prend PLUS la manette de la salle, et c'est le compilateur qui l'a
/// dit: depuis que l'extension est une expression, le fichier ne la décide plus.
/// Ce qui est branché à un instant donné vit sur le tuyau de contrôle, chez le
/// worker, et non dans un fichier écrit une fois au démarrage.
fn wiimote_section(slot: PlayerSlot) -> String {
    let mut out = String::new();
    let w = &mut out;
    let _ = writeln!(w, "[Wiimote{}]", slot.get());
    let _ = writeln!(w, "Device = {}", pipe_device(slot));
    // 1 est `WiimoteSource::Emulated`. C'est déjà le défaut de la place 1 et
    // seulement d'elle; l'écrire pour toutes dit la règle au lieu de compter sur
    // un défaut qui ne vaut que pour une.
    let _ = writeln!(w, "Source = 1");

    for (key, token) in [
        ("Buttons/A", "A"),
        ("Buttons/B", "B"),
        // Les noms de la Wiimote sont `1` et `2`, ceux du tuyau restent `X` et
        // `Y`: le tuyau parle GameCube quoi qu'on branche derrière.
        ("Buttons/1", "X"),
        ("Buttons/2", "Y"),
        ("Buttons/+", "START"),
        ("D-Pad/Up", "D_UP"),
        ("D-Pad/Down", "D_DOWN"),
        ("D-Pad/Left", "D_LEFT"),
        ("D-Pad/Right", "D_RIGHT"),
        ("Nunchuk/Buttons/C", "L"),
        ("Nunchuk/Buttons/Z", "R"),
    ] {
        let _ = writeln!(w, "{key} = `Button {token}`");
    }

    // Le pointeur sur le stick C, l'inclinaison et le Nunchuk sur le principal.
    //
    // Les deux moitiés VERTICALES ne portent pas le même nom selon le groupe:
    // un pointeur et un stick montent et descendent, une inclinaison va en avant
    // et en arrière. Ce sont les noms de Dolphin (`Cursor.cpp` contre
    // `Tilt.cpp`), et une clé qu'il ne connaît pas est ignorée SANS un mot: la
    // Wiimote ne penche alors jamais, et rien ne dit pourquoi.
    for (group, axis, up, down) in [
        ("IR", "C", "Up", "Down"),
        ("Tilt", "MAIN", "Forward", "Backward"),
        ("Nunchuk/Stick", "MAIN", "Up", "Down"),
    ] {
        let _ = writeln!(w, "{group}/{up} = `Axis {axis} Y +`");
        let _ = writeln!(w, "{group}/{down} = `Axis {axis} Y -`");
        let _ = writeln!(w, "{group}/Left = `Axis {axis} X -`");
        let _ = writeln!(w, "{group}/Right = `Axis {axis} X +`");
        // Zéro, pour la même raison que sur la manette: le navigateur a déjà
        // appliqué la zone morte de la personne, et une seconde ici la
        // doublerait sans que personne ne l'ait demandé.
        let _ = writeln!(w, "{group}/Dead Zone = 0.0");
    }
    // `Tilt` compte en degrés et non en fraction de course: sans angle, une
    // inclinaison à fond ne penche presque pas. Quatre-vingt-cinq degrés est ce
    // que Dolphin propose lui-même pour une manette.
    let _ = writeln!(w, "Tilt/Angle = 85.0");

    // L'extension, et c'est elle qui décide si le jeu répond.
    //
    // « Un jeu qui n'en veut pas l'ignore » a été écrit ici, et c'est FAUX.
    // Guitar Hero III voit une Wiimote avec un Nunchuk, attend une guitare, et
    // n'obéit alors qu'au bouton A de la Wiimote elle-même: ni la croix, ni les
    // autres boutons. Une extension n'est pas un supplément qu'on branche au cas
    // où, c'est une déclaration de ce qu'on tient.
    // Les correspondances des DEUX extensions, toujours, quelle que soit celle
    // qui est branchée à cet instant.
    //
    // C'est la conséquence directe de l'échange à chaud: si l'extension peut
    // changer sans relancer, le fichier ne peut plus décrire une seule des deux.
    // Écrire celles de la guitare seulement quand la salle démarre en guitare
    // rendrait l'échange possible et inutile — on obtiendrait une guitare dont
    // aucune frette ne répond.
    let _ = write!(w, "{}", guitar_binds());
    {
        // La secousse, sur le bouton qui portait « moins ».
        //
        // # Pourquoi elle coûte un bouton
        //
        // Notre trame en porte douze et une Wiimote avec son Nunchuk en demande
        // treize. Le bouton Home avait déjà été sacrifié pour arriver à douze; la
        // secousse demande un quatorzième. « Moins » est le moins cher des douze:
        // il ne sert que dans les menus, là où A et la croix suffisent.
        //
        // Le besoin est concret: Mario Strikers Charged met les coups d'épaule sur
        // une secousse de Wiimote, et ils sont différents des tacles. Sans ça une
        // moitié du jeu est injouable.
        //
        // # Les TROIS axes sur le même bouton
        //
        // On ne sait pas lequel un jeu donné échantillonne, et Dolphin ne le dira
        // pas. Les trois ensemble suppriment la question, et c'est aussi ce que
        // fait une vraie main: personne ne secoue une manette sur un seul axe.
        for axis in ["X", "Y", "Z"] {
            let _ = writeln!(w, "Shake/{axis} = `Button Z`");
        }
        // Zéro, comme les autres groupes, et ici ce n'est pas cosmétique: le défaut
        // de Dolphin est CINQUANTE pour cent (`Force.cpp`, `AddDeadzoneSetting`).
        // Un bouton tout ou rien passerait quand même, mais laisser une zone morte
        // de moitié sur une entrée qui ne vaut que zéro ou un est une invitation à
        // se demander plus tard pourquoi la secousse est capricieuse.
        let _ = writeln!(w, "Shake/Dead Zone = 0.0");
    }

    // L'extension, décidée par une EXPRESSION plutôt que par un nom.
    //
    // Dolphin relit une expression à chaque sondage tant que la valeur n'est pas
    // une constante (`NumericSetting::GetValue`), et `Attachments::LoadConfig`
    // le dit lui-même: « First assume attachment string is a valid expression. »
    // Un nom fige l'extension au démarrage; un calcul la rend vivante.
    //
    // `1 + A + 2 * B` sur le tuyau de contrôle: rien tenu donne 1, le Nunchuk;
    // B tenu donne 3, la guitare. 2 est la Classic, laissée pour quand elle aura
    // ses correspondances.
    let _ = writeln!(
        w,
        "Extension = 1 + `{device}:Button A` + 2 * `{device}:Button B`",
        device = control_pipe_device(slot)
    );
    out
}

/// Les correspondances de la guitare, sur le même tuyau que tout le reste.
///
/// # Les noms viennent de Dolphin, pas d'une supposition
///
/// `Guitar.cpp` au commit qu'on épingle: les groupes sont `Frets`, `Strum`,
/// `Buttons`, `Stick`, `Whammy` et `Slider Bar`, et les frettes s'appellent
/// `Green`, `Red`, `Yellow`, `Blue`, `Orange`. Une clé que Dolphin ne connaît
/// pas est ignorée SANS un mot, exactement comme `Tilt/Up` l'avait été: la
/// touche ne fait alors rien et rien ne dit pourquoi.
///
/// # Ce qu'une touche de clavier devient
///
/// Cinq frettes sur les cinq boutons de la manette, le grattage sur la croix
/// haut et bas. C'est la disposition des jeux de guitare sur clavier, et c'est
/// la seule qui tienne: notre trame porte douze boutons et une guitare en
/// demande cinq plus deux plus deux.
///
/// La barre de vibrato va sur le stick C. C'est un `Triggers`, donc il compte
/// de zéro à un et pas de moins un à un: seule la moitié positive de l'axe sert,
/// et l'autre ne serait jamais lue.
fn guitar_binds() -> String {
    let mut out = String::new();
    let w = &mut out;
    for (key, token) in [
        ("Guitar/Frets/Green", "A"),
        ("Guitar/Frets/Red", "B"),
        ("Guitar/Frets/Yellow", "X"),
        ("Guitar/Frets/Blue", "Y"),
        ("Guitar/Frets/Orange", "Z"),
        ("Guitar/Strum/Up", "D_UP"),
        ("Guitar/Strum/Down", "D_DOWN"),
        ("Guitar/Buttons/-", "L"),
        ("Guitar/Buttons/+", "START"),
    ] {
        let _ = writeln!(w, "{key} = `Button {token}`");
    }
    let _ = writeln!(w, "Guitar/Stick/Up = `Axis MAIN Y +`");
    let _ = writeln!(w, "Guitar/Stick/Down = `Axis MAIN Y -`");
    let _ = writeln!(w, "Guitar/Stick/Left = `Axis MAIN X -`");
    let _ = writeln!(w, "Guitar/Stick/Right = `Axis MAIN X +`");
    let _ = writeln!(w, "Guitar/Stick/Dead Zone = 0.0");
    let _ = writeln!(w, "Guitar/Whammy/Bar = `Axis C X +`");
    out
}

/// Renders `GCPadNew.ini` for the given ports.
///
/// # The two spellings of Start
///
/// The ini key is `Buttons/Start` (Dolphin's `START_BUTTON = "Start"`) while the
/// pipe token is `START` (`s_button_tokens`). They are genuinely different
/// strings in two different files, and using either spelling in both places
/// produces a button that never presses and never complains.
#[must_use]
pub fn gcpad_ini(slots: SlotSet) -> String {
    let mut out = String::new();
    for slot in slots.iter() {
        // `fmt::Write for String` is infallible; see `wire::append`.
        let _ = write!(out, "{}", gcpad_section(slot));
    }
    out
}

fn gcpad_section(slot: PlayerSlot) -> String {
    let mut out = String::new();
    let w = &mut out;
    let _ = writeln!(w, "[GCPad{}]", slot.get());
    let _ = writeln!(w, "Device = {}", pipe_device(slot));

    for (key, token) in [
        ("Buttons/A", "A"),
        ("Buttons/B", "B"),
        ("Buttons/X", "X"),
        ("Buttons/Y", "Y"),
        ("Buttons/Z", "Z"),
        ("Buttons/Start", "START"),
        ("D-Pad/Up", "D_UP"),
        ("D-Pad/Down", "D_DOWN"),
        ("D-Pad/Left", "D_LEFT"),
        ("D-Pad/Right", "D_RIGHT"),
        ("Triggers/L", "L"),
        ("Triggers/R", "R"),
    ] {
        // Backticks quote a control name literally. Without them the expression
        // parser reads `Button D_UP` as two terms and binds nothing.
        let _ = writeln!(w, "{key} = `Button {token}`");
    }

    // Dolphin models each stick as two opposed half-axes, so a single pipe axis
    // feeds two keys. `Up` takes the `+` half and `Down` the `-` half, which is
    // what makes our "positive y is up" convention true rather than aspirational.
    for (group, axis) in [("Main Stick", "MAIN"), ("C-Stick", "C")] {
        let _ = writeln!(w, "{group}/Up = `Axis {axis} Y +`");
        let _ = writeln!(w, "{group}/Down = `Axis {axis} Y -`");
        let _ = writeln!(w, "{group}/Left = `Axis {axis} X -`");
        let _ = writeln!(w, "{group}/Right = `Axis {axis} X +`");
        // Zero is already Dolphin's default, and it is stated anyway because we
        // depend on it: the browser has already applied the player's dead zone
        // (ADR D3), and a second one here would silently compound the first.
        let _ = writeln!(w, "{group}/Dead Zone = 0.0");
    }

    let _ = writeln!(w, "Triggers/L-Analog = `Axis L +`");
    let _ = writeln!(w, "Triggers/R-Analog = `Axis R +`");

    // Default is off, which ties the emulated pad's connection state to the real
    // device. We want the opposite: the room decides who is player 2 (ADR D4),
    // and a pad that vanishes mid-match because of a device-enumeration hiccup
    // is far worse than one that stays plugged in. Pipe absence is detected by
    // us instead, at attach time, where it can be reported properly.
    let _ = writeln!(w, "Options/Always Connected = True");
    let _ = writeln!(w);
    out
}

/// Renders `Dolphin.ini` for the given ports.
#[must_use]
pub fn dolphin_ini(slots: SlotSet, pads: PadKind) -> String {
    let mut out = String::new();
    let w = &mut out;

    let _ = writeln!(w, "[Core]");
    // Only the ports the room actually serves get a controller. An unserved port
    // holding a phantom pad changes what the GAME does — a four-player title
    // opens four split-screen viewports for one player.
    for raw in 1..=MAX_PLAYERS {
        // Et rien du tout quand la salle joue à la Wiimote. Une manette
        // GameCube branchée à côté d'une Wiimote fait compter DEUX manettes pour
        // une personne: à deux joueurs, le premier occupe deux places et le
        // second n'entre jamais.
        let device = PlayerSlot::new(raw).map_or(SIDEVICE_NONE, |slot| {
            if slots.contains(slot) && pads == PadKind::GameCube {
                SIDEVICE_GC_CONTROLLER
            } else {
                SIDEVICE_NONE
            }
        });
        let _ = writeln!(w, "SIDevice{} = {device}", raw - 1);
    }

    let _ = writeln!(w);
    let _ = writeln!(w, "[DSP]");
    let _ = writeln!(w, "Backend = {AUDIO_BACKEND}");

    let _ = writeln!(w);
    let _ = writeln!(w, "[Analytics]");
    // Unasked, this prompts on first run. A prompt on a headless server is a
    // process that never becomes ready and no message saying why.
    let _ = writeln!(w, "Enabled = False");
    let _ = writeln!(w, "PermissionAsked = True");

    let _ = writeln!(w);
    let _ = writeln!(w, "[Interface]");
    // Same reason: a confirmation dialog is unanswerable with no display, and
    // it would turn our SIGTERM shutdown into a hang.
    let _ = writeln!(w, "ConfirmStop = False");

    out
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;

    fn slot(raw: u8) -> PlayerSlot {
        PlayerSlot::new(raw).unwrap()
    }

    #[test]
    fn a_single_player_pad_renders_exactly_this() {
        // Golden. Dolphin answers an unbindable expression by binding nothing and
        // saying nothing, so "the file was written" and "the controller works"
        // are unrelated facts until the bytes are pinned.
        assert_eq!(
            gcpad_ini(SlotSet::EMPTY.with(slot(1))),
            "\
[GCPad1]
Device = Pipe/0/p1
Buttons/A = `Button A`
Buttons/B = `Button B`
Buttons/X = `Button X`
Buttons/Y = `Button Y`
Buttons/Z = `Button Z`
Buttons/Start = `Button START`
D-Pad/Up = `Button D_UP`
D-Pad/Down = `Button D_DOWN`
D-Pad/Left = `Button D_LEFT`
D-Pad/Right = `Button D_RIGHT`
Triggers/L = `Button L`
Triggers/R = `Button R`
Main Stick/Up = `Axis MAIN Y +`
Main Stick/Down = `Axis MAIN Y -`
Main Stick/Left = `Axis MAIN X -`
Main Stick/Right = `Axis MAIN X +`
Main Stick/Dead Zone = 0.0
C-Stick/Up = `Axis C Y +`
C-Stick/Down = `Axis C Y -`
C-Stick/Left = `Axis C X -`
C-Stick/Right = `Axis C X +`
C-Stick/Dead Zone = 0.0
Triggers/L-Analog = `Axis L +`
Triggers/R-Analog = `Axis R +`
Options/Always Connected = True

"
        );
    }

    /// Une seule manette à la fois, et c'est l'invariant qui compte le plus.
    ///
    /// Le défaut du 31 août 2026: les deux étaient déclarées, sur le même tuyau.
    /// Mario Kart Wii comptait alors DEUX manettes pour une personne, le premier
    /// joueur occupait deux places, et le second n'entrait jamais.
    #[test]
    fn a_room_never_offers_both_pads_at_once() {
        let gc_wiimotes = wiimote_ini(SlotSet::ALL, PadKind::GameCube);
        let wii_pads = dolphin_ini(SlotSet::ALL, PadKind::Wiimote);

        assert_eq!(
            gc_wiimotes, "",
            "pas de Wiimote quand on joue à la GameCube"
        );
        for raw in 0..4 {
            assert!(
                wii_pads.contains(&format!("SIDevice{raw} = {SIDEVICE_NONE}")),
                "pas de manette GameCube quand on joue à la Wiimote: {wii_pads}"
            );
        }
    }

    /// Le jumeau: chacune existe bien quand c'est ELLE qu'on a choisie.
    ///
    /// Sans cette moitié, un fichier vide dans les deux cas passerait l'essai
    /// au-dessus et laisserait la salle sans aucune manette.
    #[test]
    fn each_pad_exists_when_it_is_the_one_chosen() {
        assert!(wiimote_ini(SlotSet::ALL, PadKind::Wiimote).contains("[Wiimote1]"));
        assert!(wiimote_ini(SlotSet::ALL, PadKind::Guitar).contains("[Wiimote1]"));
        assert!(dolphin_ini(SlotSet::ALL, PadKind::GameCube).contains("SIDevice0 = 6"));
    }

    /// Une seule extension est branchée à la fois, et ce n'est plus le fichier
    /// qui le décide.
    ///
    /// Guitar Hero III voit une Wiimote avec un Nunchuk, attend une guitare, et
    /// n'obéit alors qu'au bouton A de la Wiimote elle-même — constaté le
    /// 31 août 2026 en jouant. Deux extensions déclarées seraient la même
    /// famille de défaut que deux manettes pour une personne.
    ///
    /// L'invariant tient toujours, à un autre endroit: l'expression rend UN
    /// entier, donc Dolphin attache UNE extension. Ce qui a changé est que le
    /// fichier porte désormais les correspondances des deux, parce que l'une ou
    /// l'autre peut être branchée sans relancer le jeu.
    #[test]
    fn one_extension_at_a_time_even_though_both_are_bound() {
        let ini = wiimote_ini(SlotSet::EMPTY.with(slot(1)), PadKind::Wiimote);

        // Une seule ligne `Extension =`, et c'est un calcul et non un nom.
        assert_eq!(
            ini.lines()
                .filter(|l| l.starts_with("Extension = "))
                .count(),
            1,
            "{ini}"
        );
        assert!(
            ini.contains("Extension = 1 + `Pipe/0/c1:Button A`"),
            "{ini}"
        );
        // Un NOM figerait l'extension au démarrage, ce qui est exactement ce
        // qu'on vient de retirer.
        assert!(!ini.contains("Extension = Nunchuk"), "{ini}");
        assert!(!ini.contains("Extension = Guitar"), "{ini}");

        // Et les deux jeux de correspondances sont là. Sans ça l'échange serait
        // possible et inutile: on obtiendrait une guitare dont aucune frette ne
        // répond.
        assert!(ini.contains("Nunchuk/Buttons/C = `Button L`"), "{ini}");
        assert!(ini.contains("Guitar/Frets/Green = `Button A`"), "{ini}");
    }

    /// Le calcul écrit dans le fichier et le type Rust disent la même chose.
    ///
    /// L'expression est `1 + A + 2 * B`, et `held()` dit quels boutons tenir.
    /// Les deux vivent à deux endroits et rien ne les relie: ce jumeau-là les
    /// noue. Changer l'un sans l'autre donnerait une extension qui s'annonce et
    /// une autre qui arrive, sans un mot.
    #[test]
    fn the_expression_and_the_held_buttons_agree() {
        for wanted in [Extension::Nunchuk, Extension::Guitare] {
            let held = wanted.held();
            let computed = 1 + u8::from(held.contains(&"A")) + 2 * u8::from(held.contains(&"B"));
            assert_eq!(
                computed,
                wanted.attachment(),
                "{} tenu sur {held:?} donne {computed}, pas {}",
                wanted.name(),
                wanted.attachment()
            );
        }
        // Le jumeau négatif: deux extensions ne peuvent pas demander le même
        // attachement, sinon en choisir une donnerait l'autre.
        assert_ne!(
            Extension::Nunchuk.attachment(),
            Extension::Guitare.attachment()
        );
    }

    /// Le tuyau de contrôle d'une place est LE SIEN.
    ///
    /// Sans ça, l'extension du joueur 1 changerait celle de tout le monde — la
    /// panne exacte qu'on cherche à supprimer, réintroduite un cran plus bas.
    #[test]
    fn each_seat_reads_its_own_control_pipe() {
        let ini = wiimote_ini(SlotSet::ALL, PadKind::Wiimote);

        for raw in 1..=4 {
            assert!(
                ini.contains(&format!("Extension = 1 + `Pipe/0/c{raw}:Button A`")),
                "place {raw}:\n{ini}"
            );
        }
        // Et il n'est jamais confondu avec le tuyau du JEU: un ordre passé par
        // celui-là coûterait un bouton de jeu.
        assert!(!ini.contains("Extension = 1 + `Pipe/0/p"), "{ini}");
    }

    /// La secousse existe, sur les trois axes, et « moins » a bien laissé sa place.
    ///
    /// Mario Strikers Charged met les coups d'épaule sur une secousse de
    /// Wiimote. Sans elle, une moitié du jeu est injouable.
    #[test]
    fn a_wiimote_can_be_shaken() {
        let ini = wiimote_ini(SlotSet::EMPTY.with(slot(1)), PadKind::Wiimote);

        for axis in ["X", "Y", "Z"] {
            assert!(
                ini.contains(&format!("Shake/{axis} = `Button Z`")),
                "{axis}:\n{ini}"
            );
        }
        // Le bouton est DÉPENSÉ, pas partagé: le laisser sur les deux ferait
        // secouer la Wiimote chaque fois que quelqu'un ouvre un menu.
        //
        // Sur la LIGNE et non en sous-chaîne. Depuis que les correspondances de
        // la guitare sont toujours écrites, `Guitar/Buttons/-` contient
        // `Buttons/-`: l'essai échouait sur un défaut qui n'existait pas, ce qui
        // est la même perte de temps qu'un essai qui passe à tort.
        assert!(
            !ini.lines().any(|line| line.starts_with("Buttons/-")),
            "{ini}"
        );
    }

    /// Le jumeau: rien de tout ça n'existe sans Wiimote.
    ///
    /// Il ne dit plus « une guitare ne se secoue pas ». La secousse est un
    /// groupe de la Wiimote elle-même et non de son extension, donc elle reste
    /// écrite quelle que soit l'extension branchée — c'est le corps qu'on secoue.
    ///
    /// Conséquence assumée: `Button Z` porte à la fois la secousse et la frette
    /// orange, donc avec une guitare branchée, une frette secoue aussi la
    /// Wiimote. Douze boutons pour trois manettes se paient quelque part, et
    /// aucun jeu de guitare connu ne lit la secousse de la Wiimote.
    #[test]
    fn nothing_is_written_without_a_wiimote() {
        assert_eq!(wiimote_ini(SlotSet::ALL, PadKind::GameCube), "");
    }

    /// La zone morte de la secousse est à zéro, et ce n'est pas cosmétique.
    ///
    /// Le défaut de Dolphin est cinquante pour cent (`Force.cpp`). Un bouton
    /// tout ou rien passe quand même, mais l'écrire ferme la question avant
    /// qu'elle ne se pose un soir où la secousse a l'air capricieuse.
    #[test]
    fn the_shake_has_no_dead_zone_of_its_own() {
        let ini = wiimote_ini(SlotSet::EMPTY.with(slot(1)), PadKind::Wiimote);

        assert!(ini.contains("Shake/Dead Zone = 0.0"), "{ini}");
    }

    /// Les noms de groupes de la guitare, tels que Dolphin les connaît.
    ///
    /// `Guitar.cpp` au commit épinglé. L'essai existe pour la raison exacte qui
    /// avait coûté une demi-journée sur `Tilt/Up`: une clé que Dolphin ne
    /// connaît pas est ignorée sans un mot, donc une faute de frappe donne une
    /// touche qui ne fait rien et rien qui le dise.
    #[test]
    fn the_guitar_uses_the_names_dolphin_knows() {
        let ini = wiimote_ini(SlotSet::EMPTY.with(slot(1)), PadKind::Guitar);

        for key in [
            "Guitar/Frets/Green",
            "Guitar/Frets/Red",
            "Guitar/Frets/Yellow",
            "Guitar/Frets/Blue",
            "Guitar/Frets/Orange",
            "Guitar/Strum/Up",
            "Guitar/Strum/Down",
            "Guitar/Whammy/Bar",
        ] {
            assert!(ini.contains(key), "{key} manque:\n{ini}");
        }
        // Les frettes ne sont PAS des `Buttons`, et le grattage n'est pas une
        // croix. Écrire les noms de la Wiimote sous une guitare donnerait un
        // fichier que Dolphin lit sans rien y trouver.
        assert!(!ini.contains("Guitar/Buttons/Green"), "{ini}");
        assert!(!ini.contains("Guitar/D-Pad/Up"), "{ini}");
    }

    /// Les cinq frettes tombent sur cinq boutons DIFFÉRENTS.
    ///
    /// Le jumeau qui compte: deux frettes sur la même touche rendraient deux
    /// notes injouables, et c'est le genre de faute qu'une liste écrite à la
    /// main fait très bien.
    #[test]
    fn no_two_frets_share_a_button() {
        let ini = wiimote_ini(SlotSet::EMPTY.with(slot(1)), PadKind::Guitar);

        let mut held: Vec<&str> = ini
            .lines()
            .filter_map(|line| line.strip_prefix("Guitar/Frets/"))
            .filter_map(|line| line.split(" = ").nth(1))
            .collect();
        assert_eq!(held.len(), 5, "cinq frettes attendues: {ini}");
        held.sort_unstable();
        held.dedup();
        assert_eq!(held.len(), 5, "deux frettes sur le même bouton: {ini}");
    }

    /// L'invariant de ce fichier: `[WiimoteN]` doit écouter le tuyau de la
    /// place N, celui-là même que la manette GameCube de cette place.
    ///
    /// Se tromper ne donne pas d'erreur: ça donne une Wiimote sur laquelle
    /// personne n'appuie jamais, dans un jeu qui n'accepte qu'elle.
    #[test]
    fn each_wiimote_listens_to_its_own_players_pipe() {
        let ini = wiimote_ini(SlotSet::ALL, PadKind::Wiimote);

        for raw in 1..=4 {
            assert!(
                ini.contains(&format!("[Wiimote{raw}]\nDevice = Pipe/0/p{raw}\n")),
                "la Wiimote {raw} doit écouter le tuyau de la place {raw}"
            );
        }
    }

    #[test]
    fn only_the_players_who_are_there_get_a_wiimote() {
        // Le jumeau: un fichier qui déclarerait toujours les quatre passerait
        // l'essai au-dessus et brancherait des Wiimotes sur des tuyaux qui
        // n'existent pas.
        let ini = wiimote_ini(SlotSet::EMPTY.with(slot(1)).with(slot(3)), PadKind::Wiimote);

        assert!(ini.contains("[Wiimote1]") && ini.contains("[Wiimote3]"));
        assert!(!ini.contains("[Wiimote2]") && !ini.contains("[Wiimote4]"));
        assert_eq!(wiimote_ini(SlotSet::EMPTY, PadKind::Wiimote), "");
    }

    /// Le mouvement passe par les sticks, et les deux ne font pas la même chose.
    #[test]
    fn the_two_sticks_do_not_drive_the_same_thing() {
        let ini = wiimote_ini(SlotSet::EMPTY.with(slot(1)), PadKind::Wiimote);

        // Le pointeur sur le stick C: c'est lui qui remplace la visée.
        assert!(ini.contains("IR/Right = `Axis C X +`"));
        // L'inclinaison et le Nunchuk sur le principal, tous les deux: un jeu
        // Wiimote seule lit l'un, un jeu à Nunchuk lit l'autre.
        assert!(ini.contains("Tilt/Right = `Axis MAIN X +`"));
        assert!(ini.contains("Nunchuk/Stick/Right = `Axis MAIN X +`"));
        // Et l'angle, sans lequel une inclinaison à fond ne penche presque pas.
        assert!(ini.contains("Tilt/Angle = 85.0"));
        // Les noms VERTICAUX de l'inclinaison sont ceux de Dolphin: une
        // inclinaison va en avant et en arrière, pas en haut et en bas. Le
        // premier jet écrivait `Tilt/Up`, que Dolphin ignore sans un mot.
        assert!(ini.contains("Tilt/Forward = `Axis MAIN Y +`"));
        assert!(ini.contains("Tilt/Backward = `Axis MAIN Y -`"));
        assert!(!ini.contains("Tilt/Up"), "Dolphin ne connaît pas cette clé");
    }

    #[test]
    fn a_wiimote_is_emulated_and_carries_its_nunchuk() {
        let ini = wiimote_ini(SlotSet::EMPTY.with(slot(1)), PadKind::Wiimote);

        // Sans cette ligne, Dolphin n'émule rien du tout pour les places 2 à 4:
        // seule la première est émulée par défaut.
        assert!(ini.contains("Source = 1"));
        assert!(ini.contains("Nunchuk/Buttons/C = `Button L`"));
        // Le Nunchuk est ce qu'on obtient quand rien n'est tenu sur le tuyau de
        // contrôle: c'est le `1` en tête du calcul.
        assert_eq!(Extension::default(), Extension::Nunchuk);
        assert_eq!(Extension::Nunchuk.held(), &[] as &[&str]);
    }

    #[test]
    fn the_ini_section_and_the_fifo_name_agree_for_every_port() {
        // The one invariant this module exists to hold: `[GCPadN]` must point at
        // the file the pipe layer will create for slot N.
        let ini = gcpad_ini(SlotSet::ALL);
        for raw in 1..=MAX_PLAYERS {
            let s = slot(raw);
            assert!(ini.contains(&format!("[GCPad{raw}]\nDevice = Pipe/0/p{raw}\n")));
            assert_eq!(pipe_file_name(s), format!("p{raw}"));
            assert_eq!(pipe_device(s), format!("Pipe/0/p{raw}"));
        }
    }

    #[test]
    fn only_the_configured_ports_appear() {
        let ini = gcpad_ini(SlotSet::EMPTY.with(slot(1)).with(slot(3)));
        assert!(ini.contains("[GCPad1]") && ini.contains("[GCPad3]"));
        // Negative twin: rendering the requested ports is worthless if it also
        // renders the others.
        assert!(!ini.contains("[GCPad2]") && !ini.contains("[GCPad4]"));
    }

    #[test]
    fn an_empty_session_renders_no_pads() {
        assert_eq!(gcpad_ini(SlotSet::EMPTY), "");
    }

    #[test]
    fn the_two_spellings_of_start_are_both_present_and_not_swapped() {
        let ini = gcpad_ini(SlotSet::EMPTY.with(slot(1)));
        assert!(ini.contains("Buttons/Start = `Button START`"));
        // Negative twin for the exact confusion this guards against.
        assert!(!ini.contains("Buttons/START"));
        assert!(!ini.contains("`Button Start`"));
    }

    #[test]
    fn si_devices_track_the_served_ports() {
        let ini = dolphin_ini(
            SlotSet::EMPTY.with(slot(1)).with(slot(4)),
            PadKind::GameCube,
        );
        assert!(ini.contains("SIDevice0 = 6"), "{ini}");
        assert!(ini.contains("SIDevice1 = 0"), "{ini}");
        assert!(ini.contains("SIDevice2 = 0"), "{ini}");
        assert!(ini.contains("SIDevice3 = 6"), "{ini}");
    }

    #[test]
    fn every_port_is_declared_even_when_unserved() {
        // An omitted SIDevice key falls back to Dolphin's default, which is a
        // connected standard controller on port 1 — a phantom player.
        let ini = dolphin_ini(SlotSet::EMPTY, PadKind::GameCube);
        for port in 0..MAX_PLAYERS {
            assert!(ini.contains(&format!("SIDevice{port} = 0")), "{ini}");
        }
    }

    #[test]
    fn the_headless_hazards_are_all_disabled() {
        let ini = dolphin_ini(SlotSet::ALL, PadKind::GameCube);
        for key in [
            "Enabled = False",
            "PermissionAsked = True",
            "ConfirmStop = False",
        ] {
            assert!(ini.contains(key), "missing {key} in:\n{ini}");
        }
    }

    /// Sound is played through ALSA on a machine that has no sound card, and
    /// that is safe for exactly one reason: the configuration beside it has
    /// already redefined the default device as a pipe. The two belong together,
    /// so they are asserted together — asking for ALSA without the redirection
    /// is a headless Dolphin hunting for hardware that is not there.
    #[test]
    fn the_sound_goes_to_a_pipe_rather_than_a_sound_card() {
        let ini = dolphin_ini(SlotSet::ALL, PadKind::GameCube);
        assert!(ini.contains("Backend = ALSA"), "not ALSA in:\n{ini}");

        let rc = asoundrc(std::path::Path::new("/somewhere/audio.fifo"));
        assert!(
            rc.contains("pcm.!default"),
            "the default device is untouched"
        );
        assert!(rc.contains("type file"), "not the file plugin");
        assert!(
            rc.contains("/somewhere/audio.fifo"),
            "the pipe is not named in:\n{rc}"
        );
    }
}
