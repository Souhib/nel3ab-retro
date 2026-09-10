# Ryubing amont `475615f`

Ryubing `475615f` (26 août 2026), 328 commits après la version épinglée
`e2143d4`. Le son et les manettes y passent par SDL3, et la construction exige
le SDK .NET 10. `./build.sh <dossier>` le construit avec les correctifs de la
salle.

| Correctif | Rôle | Ce qui le prouve |
|---|---|---|
| `ryubing-headless-stop.patch` | arrêter sans fenêtre, sans planter | Sans lui, l'amont plante à l'arrêt sur Looney Tunes : code 134, un fil du jeu touche l'adresse zéro pendant la destruction. Avec lui, code 0 sur Looney Tunes et Mario Tennis. |
| `ryubing-audio-queue.patch` | file son : le retard du moteur de rendu retiré, la file du jeu intacte, une période par session | `./test-audio.sh`, sept essais sur le vrai rappel SDL3 (voir plus bas). |
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

`./test-audio.sh` exerce le vrai rappel SDL3 sur le périphérique factice de
SDL. Les sept essais passent sur l'amont corrigé. Sur l'amont d'origine, les
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
  n'a aucun silence inséré.
- Même vitesse que la version épinglée : cadence, délai de l'appui à l'image,
  charge processeur (carnet de bord, 10 septembre).
- La salle l'utilise depuis le 10 septembre 2026 au soir, dans
  `~/.local/share/nel3ab/switch/ryubing-1.3.3-475615f` (empreinte `91b2be67…`).
  Vérifié par `../latence/sonde.py` sur ce dossier même : son intact, 60 images
  par seconde, arrêt en code 0.

## Ce qui ne l'est pas

- Aucune partie longue sur l'amont, et Looney Tunes n'a pas été réécouté avec
  la période par session.
- Le fichier de configuration de chaque emplacement passe de la version 70 à 73
  au premier lancement. La version épinglée refuse ensuite ce fichier. Pour
  revenir en arrière : remettre `~/.config/nel3ab/switch.json.e2143d4-2026-09-10`
  et, dans chaque emplacement, `data/Config.json.v70-2026-09-10`.
- Le premier lancement de chaque jeu refait le cache des traductions du
  processeur : quatre minutes pour Mario Tennis.
