# Nel3ab Retro

Des salles de jeu rétro auto-hébergées. Une personne ouvre un navigateur, rejoint
une salle, et joue à un jeu GameCube, Wii ou Switch avec jusqu'à trois amis. Tout tourne sur
notre serveur : l'émulation, le rendu 3D, l'encodage vidéo. Le navigateur ne fait
que recevoir une vidéo et renvoyer les touches.

C'est du cloud gaming, mais chez soi.

## Par où commencer

**[Le carnet de bord](carnet-de-bord.md)** est le document principal, et il
s'adresse à un humain qui n'est pas dans un terminal. Il raconte en français
comment le projet a été construit : ce qui a été tenté, ce qui a résisté, quelles
options ont été écartées et pourquoi. Chaque acronyme y est défini, et un
glossaire ferme le document.

Pour reprendre le développement, commencer par
**[l'état du projet au 9 septembre](etat-du-projet.md)**. Il relie les fonctions
livrées, les pistes écartées, les mesures et le travail restant. Il distingue
aussi ce qui est dans Git de ce qui vit encore dans l'arbre de travail.

Trois chapitres se lisent seuls si le reste est trop long :

- **[Ce qu'on construit](carnet-de-bord.md#1-ce-quon-construit)** — le projet en
  une page et un schéma.
- **[Les pièges qui ont coûté du temps](carnet-de-bord.md#8-les-pieges-qui-ont-coute-du-temps-et-ce-quils-ont-appris)**
  — les erreurs, ce qu'elles ont appris, et notamment la série de tests qui
  passaient tout en étant cassés.
- **[Septembre](carnet-de-bord.md#11-septembre-ce-que-le-mois-a-appris)** : les
  incidents, les correctifs et le passage du prototype Switch à la salle.

Le chapitre historique [Où on en est](carnet-de-bord.md#10-ou-on-en-est)
conserve les mesures de la première chaîne Dolphin, avec leurs conditions.
Ce n'est plus le tableau de bord du déploiement actuel.

## Les autres documents

| | Pour quoi | Langue |
|---|---|---|
| [État du projet](etat-du-projet.md) | reprise datée, preuves et questions ouvertes | français |
| [Décisions (ADR)](adr/0001-architecture.md) | décisions et amendements, avec leurs raisons | anglais |
| [Touches et manettes](ecran-manettes.md) | invariants du configurateur, clavier et profils | français |
| [Switch dans la salle](switch-room.md) | jeux inscrits, sauvegardes, exploitation et limites | français |
| [Étude Switch](etude-switch-2026-09-07.md) | moteurs comparés, essais et mesures successives | français |
| [Audit du 6 septembre](audit-2026-09-06.md) | relecture de l'audit initial et suivi des corrections | français |
| [Plans M1](m1-working-plan.md), [M2](m2-working-plan.md), [M3](m3-working-plan.md) | archives des premiers travaux et mesures brutes | anglais |

Le carnet est en français parce qu'il est écrit pour être lu. Les plans de travail
sont en anglais et conservent des expériences qui ne sont plus à refaire sans
motif. Leurs diagnostics et commandes ne décrivent pas tous l'état actuel.

## État du projet

Au 9 septembre, une salle commune accueille Dolphin pour GameCube/Wii et un
adaptateur Ryubing pour Switch. Les noms suivent les places vérifiées, le chef
est indiqué, les spectateurs sont listés et les joueurs préparent leurs manettes
avant un lancement Wii ou Switch. Les clips contiennent le son.

L'identité et l'accès viennent de Tailscale ; le domaine `nel3ab.app` reste
privé. Il n'existe pas encore d'orchestration de plusieurs salles ni de jeton
utilisateur signé pour ouvrir le worker à Internet. Les mouvements Switch,
le gel de Zen sous Windows et certaines mesures de réseau restent ouverts,
avec leurs limites dans l'état de reprise.
