# Nel3ab Retro

Des salles de jeu rétro auto-hébergées. Une personne ouvre un navigateur, rejoint
une salle, et joue à un jeu GameCube avec jusqu'à trois amis. Tout tourne sur
notre serveur : l'émulation, le rendu 3D, l'encodage vidéo. Le navigateur ne fait
que recevoir une vidéo et renvoyer les touches.

C'est du cloud gaming, mais chez soi.

## Par où commencer

**[Le carnet de bord](carnet-de-bord.md)** est le document principal, et il
s'adresse à un humain qui n'est pas dans un terminal. Il raconte en français
comment le projet a été construit : ce qui a été tenté, ce qui a résisté, quelles
options ont été écartées et pourquoi. Chaque acronyme y est défini, et un
glossaire de 90 entrées ferme le document.

Trois chapitres se lisent seuls si le reste est trop long :

- **[Ce qu'on construit](carnet-de-bord.md#1-ce-quon-construit)** — le projet en
  une page et un schéma.
- **[Les pièges qui ont coûté du temps](carnet-de-bord.md#7-les-pieges-qui-ont-coute-du-temps-et-ce-quils-ont-appris)**
  — les erreurs, ce qu'elles ont appris, et notamment la série de tests qui
  passaient tout en étant cassés.
- **[Où on en est](carnet-de-bord.md#9-ou-on-en-est)** — les mesures du jour, avec
  leurs conditions, et ce qui n'est pas fait.

## Les autres documents

| | Pour quoi | Langue |
|---|---|---|
| [Décisions (ADR)](adr/0001-architecture.md) | chaque décision en une ligne, avec sa raison | anglais |
| [Plans M1](m1-working-plan.md), [M2](m2-working-plan.md), [M3](m3-working-plan.md) | l'avancement et les mesures brutes | anglais |

Le carnet est en français parce qu'il est écrit pour être lu. Les plans de travail
sont en anglais parce qu'ils sont écrits pour être utilisés par la session
suivante, humaine ou non.

## État du projet

M1, M2 et M3 sont finis et mesurés : image, son, quatre manettes, dans un
navigateur, sur le réseau privé.

Ce qui n'existe pas encore, et qu'il vaut mieux savoir avant de partager un lien :
**rien n'authentifie personne**. Qui atteint le réseau privé peut regarder,
écouter et prendre une manette. C'est le premier travail de M4.
