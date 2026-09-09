"""Commandes reformulées depuis les manuels, consultés le 6 septembre 2026.

Les clés nomment les commandes du tuyau Dolphin, pas les boutons du matériel
physique. Le configurateur relie déjà ces deux lectures. Une fiche absente ne
prétend pas connaître les appareils acceptés par un jeu ajouté à la bibliothèque.
"""

BASE = "https://csassets.nintendo.com/noaext/image/private/t_KA_PDF/"
GUIDES = {
    "mario tennis aces": {
        "players": 4,
        "multiplayer": "1 à 4 joueurs sur le même écran en jeu libre. Aventure en solo.",
        "devices": ["Manette Pro"],
        "checked": "2026-09-09",
        "allowed": [4],
        "source": "https://www.nintendo.com/fr-fr/Assistance/Nintendo-Switch/Mises-a-jour-des-logiciels/Historique-des-mises-a-jour-de-Mario-Tennis-Aces-1505194.html",
        "note": (
            "Commandes standard. Le jeu peut réattribuer R et ZR dans ses options. "
            "Le mode mouvement n'est pas raccordé."
        ),
        "actions": {
            "4": {
                "A": "Frappe liftée · avec X : frappe puissante",
                "B": "Frappe coupée · avec X : frappe puissante",
                "Y": "Frappe à plat · avec X : frappe puissante",
                "X": "Lob / amorti, selon le stick gauche",
                "R": "Instinct, selon les options du jeu",
                "ZR": "Instinct, selon les options du jeu",
                "lx+": "Déplacer / viser à droite",
                "lx-": "Déplacer / viser à gauche",
                "ly+": "Déplacer / viser vers le haut",
                "ly-": "Déplacer / viser vers le bas",
                "PLUS": "Menu / pause",
            }
        },
    },
    "mario kart wii": {
        "players": 4,
        "multiplayer": "Course VS et bataille à 2 à 4 sur le même écran. Grand Prix en solo.",
        "devices": [
            "Wiimote + Nunchuk",
            "Manette GameCube",
            "Wiimote seule / volant",
            "Manette classique",
        ],
        "checked": "2026-09-07",
        "allowed": [1, 0],
        "source": BASE + "Wii_Mario_Kart",
        "note": (
            "Commandes de course. Les figures à la Wiimote utilisent une secousse ; le "
            "cabrage demande un mouvement d'inclinaison."
        ),
        "actions": {
            "0": {
                "A": "Accélérer",
                "B": "Freiner / reculer / déraper",
                "R": "Sauter / déraper",
                "L": "Utiliser un objet",
                "X": "Regarder derrière",
                "Z": "Regarder derrière",
                "x": "Diriger",
                "START": "Pause",
                "D_UP": "Figure / roue arrière",
                "D_DOWN": "Fin de roue arrière",
            },
            "1": {
                "A": "Accélérer",
                "B": "Freiner / reculer / déraper",
                "R": "Utiliser un objet (Z du Nunchuk)",
                "L": "Regarder derrière (C du Nunchuk)",
                "x": "Diriger / incliner",
                "Z": "Secouer pour une figure",
                "START": "Pause",
            },
        },
    },
    "mario strikers charged": {
        "players": 4,
        "multiplayer": "Jusqu'à quatre joueurs, répartis entre les deux équipes.",
        "devices": ["Wiimote + Nunchuk"],
        "checked": "2026-09-07",
        "allowed": [1],
        "source": BASE + "Wii_Mario_Strikers_Charged",
        "note": (
            "Wiimote avec Nunchuk. Le pointeur sert aux arrêts de MegaStrike. La secousse "
            "du Nunchuk, distincte de celle de la Wiimote, n'est pas encore transmise par "
            "cette configuration."
        ),
        "actions": {
            "1": {
                "A": "Passer / changer de joueur en défense",
                "B": "Tirer / charger / dégager",
                "L": "Objet / pouvoir (C du Nunchuk)",
                "R": "Lober avec A ou B (Z du Nunchuk)",
                "x": "Déplacer le joueur",
                "cx": "Viser les arrêts de MegaStrike",
                "Z": "Charge physique (secousse Wiimote)",
                "D_UP": "Feinte / tacle glissé",
                "D_DOWN": "Feinte / tacle glissé",
                "D_LEFT": "Feinte / tacle glissé",
                "D_RIGHT": "Feinte / tacle glissé",
                "X": "Pause (bouton 1)",
            }
        },
    },
    "mario party 8": {
        "players": 4,
        "multiplayer": "Plateaux et mini-jeux à 1 à 4 ; certains modes se jouent à deux.",
        "devices": ["Wiimote seule"],
        "checked": "2026-09-07",
        "allowed": [3],
        "source": BASE + "Wii_Mario_Party_8",
        "note": (
            "Wiimote seule. Les boutons, gestes et orientation changent selon le mini-jeu "
            ": lis l'écran de règles avant chacun. Les gestes émulés ne couvrent pas "
            "nécessairement tous les mini-jeux."
        ),
        "actions": {},
    },
    "mario party 9": {
        "players": 4,
        "multiplayer": "Plateaux et mini-jeux à 1 à 4 ; certains modes ont leur propre limite.",
        "devices": ["Wiimote seule"],
        "checked": "2026-09-07",
        "allowed": [3],
        "source": BASE + "Wii_Mario_Party_9",
        "note": (
            "Wiimote seule. Les boutons, gestes et orientation changent selon le mini-jeu "
            ": lis l'écran de règles avant chacun. Les gestes émulés ne couvrent pas "
            "nécessairement tous les mini-jeux."
        ),
        "actions": {},
    },
    "guitar hero iii - legends of rock": {
        "allowed": [2],
        "source": "",
        "note": (
            "Guitare émulée. Correspondances Dolphin vérifiées dans le projet ; fiche de "
            "commandes du jeu non vérifiée dans un manuel éditeur."
        ),
        "actions": {},
    },
}


# Les pages éditeur vérifient le multijoueur, pas une commande propre à chaque
# mini-jeu. Ne pas étendre ces fiches à une édition modifiée par sous-chaîne.
GC_GUIDES = {
    f"mario party {number}": {
        "players": 8 if number == 7 else 4,
        "multiplayer": (
            "Le jeu original accepte huit personnes en partageant quatre manettes. "
            "Cette salle attribue une manette à chacun de ses quatre joueurs."
            if number == 7
            else "Plateaux et mini-jeux jusqu'à quatre joueurs."
        ),
        "allowed": [0],
        "devices": ["Manette GameCube"],
        "source": (
            "https://www.nintendo.com/en-gb/Games/Nintendo-GameCube/"
            f"Mario-Party-{number}-{page}.html"
        ),
        "checked": "2026-09-07",
        "note": (
            "Les commandes changent à chaque mini-jeu : consulte son écran de règles."
            + (" Le microphone GameCube n'est pas transmis par la salle." if number >= 6 else "")
        ),
        "actions": {},
    }
    for number, page in [(4, 268280), (5, 268291), (6, 268302), (7, 268313)]
}

GC_GUIDES.update(
    {
        name: {
            "players": 4,
            "multiplayer": mode,
            "allowed": [0],
            "devices": ["Manette GameCube"],
            "source": "https://www.nintendo.com/en-gb/Games/Nintendo-GameCube/" + page,
            "checked": "2026-09-07",
            "note": (
                "Capacité multijoueur vérifiée chez Nintendo. "
                "Commandes détaillées à vérifier dans le jeu."
            ),
            "actions": {},
        }
        for name, page, mode in [
            (
                "mario power tennis",
                "Mario-Power-Tennis-268324.html",
                "Jusqu'à quatre joueurs, notamment en double.",
            ),
            (
                "super mario strikers",
                "Mario-Smash-Football-268335.html",
                "Jusqu'à quatre joueurs répartis entre les deux équipes.",
            ),
        ]
    }
)


SWITCH_GUIDES = {
    "mario tennis aces": GUIDES.pop("mario tennis aces"),
    "looney tunes: wacky world of sports": {
        "players": 4,
        "multiplayer": "1 à 4 joueurs sur le même écran : basket, football, golf et tennis.",
        "devices": ["Manette Pro"],
        "allowed": [4],
        "checked": "2026-09-09",
        "source": "https://www.nintendo.com/en-gb/Games/Nintendo-Switch-games/Looney-Tunes-Wacky-World-of-Sports-2648344.html",
        "note": (
            "Appuyer sur L et R ensemble à l'écran titre. Choisir le mode Classique : "
            "les mouvements ne sont pas transmis. Les commandes changent selon le sport ; "
            "consulter les règles affichées dans le jeu."
        ),
        "actions": {},
    },
}


def guide_for(name: str, console: str) -> dict | None:
    if console == "switch":
        return SWITCH_GUIDES.get(name.casefold())
    if console == "gc":
        return GC_GUIDES.get(name.casefold())
    if console == "wii":
        return GUIDES.get(name.casefold())
    return None
