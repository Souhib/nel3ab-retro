# Ryubing amont `475615f`

Ryubing `475615f` (26 août 2026), 328 commits après la version épinglée
`e2143d4`. Le son et les manettes y passent par SDL3, et la construction exige
le SDK .NET 10. `./build.sh <dossier>` le construit avec les correctifs de la
salle.

| Correctif | Rôle | Ce qui le prouve |
|---|---|---|
| `ryubing-headless-stop.patch` | arrêter sans fenêtre, sans planter | Sans lui, l'amont plante à l'arrêt sur Looney Tunes : code 134, un fil du jeu touche l'adresse zéro pendant la destruction. Avec lui, code 0 sur Looney Tunes et Mario Tennis. |
| `ryubing-audio-queue.patch` | file son : le retard du moteur de rendu retiré, la file du jeu intacte, une période par session, rien remis quand rien ne manque | `./test-audio.sh`, neuf essais sur le vrai rappel SDL3 (voir plus bas). |
| `ryubing-latency-probe.patch` | deux marqueurs de latence, pour les sondes seulement | `../latence/` |

Le correctif des sources de paquets de la version épinglée est inutile ici :
les paquets de mise à jour sont sur nuget.org. Chaque fichier a été produit par
`git diff` sur l'arbre amont modifié, jamais retouché à la main.

## La période par session

SDL2 ouvrait une sortie son par session, taillée sur ses tampons : un tampon de
960 échantillons partait d'un bloc, et le jeu avait 20 ms pour fournir le
suivant. SDL3 partage une seule sortie qui demande 5 ms à la fois. Sur le
programme de test (`../guest/`), qui n'a qu'un tampon en vol, l'amont laissait
alors un silence de 5 ms toutes les 60 à 80 ms : 277 en 20 s, et 282 sans aucun
de nos correctifs, contre 0 sur la version épinglée. Chaque session rend
maintenant sa propre période ; le surplus reste dans le flux SDL. Après : 0
silence et 0 cassure en 20 s.

SDL3 appelle ce rappel à chaque lecture, en indiquant ce qui manque, souvent
rien. Remettre une période à chaque appel vidait le jeu plus vite que le temps
réel, et le son s'accumulait dans SDL avec un retard croissant : Looney Tunes
est resté muet des minutes dans la salle, le soir même de l'installation. Le
rappel ne remet plus rien quand rien ne manque, et `sdl_ms` du compteur de sonde
(`NEL3AB_AUDIO_PROBE=1`) dit ce qui attend dans SDL.

`./test-audio.sh` exerce le vrai rappel SDL3 sur le périphérique factice de
SDL. L'essai DevicePull laisse SDL lui-même tirer le son, 5 ms à la fois : il
remettait 4096 échantillons pour 1920 lus avant la correction. L'essai
ProbeLockOrder tient l'ordre des verrous du compteur de sonde : il interrogeait
SDL en tenant le verrou de file, et le son du programme de test s'est figé ainsi.
Les neuf essais passent sur l'amont corrigé. Sur l'amont d'origine, les
deux essais du retard du moteur de rendu échouent. Avec la garde de la file du
jeu retirée, l'essai de la file du jeu échoue. L'essai de la période échouait
avant la correction (3840 octets attendus, 960 reçus).

## Ce qui est prouvé, le 10 septembre 2026

- La construction, avec l'empreinte notée dans `SHA256SUMS` à côté du moteur.
- Looney Tunes et Mario Tennis démarrent ; Mario Tennis charge la sauvegarde
  « débloquée » (copie), mode Aventure au niveau 99.
- Les quatre manettes sont reconnues avec les mêmes identifiants qu'en SDL2, et
  la vibration du programme de test arrive au navigateur.
- Le son du programme de test est intact ; la musique du titre de Mario Tennis
  n'a aucun silence inséré. Ce contrôle ne voit pas le retard : c'est DevicePull
  et `sdl_ms` qui le tiennent.
- Même vitesse que la version épinglée : cadence, délai de l'appui à l'image,
  charge processeur (carnet de bord, 10 septembre).
- La salle l'utilise depuis le 10 septembre 2026 au soir, dans
  `~/.local/share/nel3ab/switch/ryubing-1.3.3-475615f-c` (empreinte `4fff0608…`).
  La première installation du même soir (`ryubing-1.3.3-475615f`, `91b2be67…`)
  avait le son en retard décrit plus haut ; elle reste sur le disque, inutilisée.
  La version `c` a été vérifiée en sonde : Looney Tunes fait entendre sa
  cinématique au même moment que l'ancien moteur, avec 19 ms en attente dans
  SDL ; la sinusoïde du programme de test est intacte, 15 ms dans SDL ; les deux
  s'arrêtent en code 0.

## Ce qui ne l'est pas

- Aucune partie longue sur l'amont, et Looney Tunes n'a pas été réécouté avec
  la période par session.
- Le fichier de configuration de chaque emplacement passe de la version 70 à 73
  au premier lancement. La version épinglée refuse ensuite ce fichier. Pour
  revenir en arrière : remettre `~/.config/nel3ab/switch.json.e2143d4-2026-09-10`
  et, dans chaque emplacement, `data/Config.json.v70-2026-09-10`.
- Le premier lancement de chaque jeu refait le cache des traductions du
  processeur : quatre minutes pour Mario Tennis.
