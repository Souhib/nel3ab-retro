# Copie chiffrée des sauvegardes

Depuis le 21 novembre 2026, les sauvegardes des joueurs ont une copie hors de la
machine, sur le NAS de la maison. Avant cette date, elles n'existaient qu'en un
seul exemplaire, sur le disque de lgf.

## Ce qui tourne

| | |
|---|---|
| Script | `tools/abri.sh` |
| Chaque heure | `nel3ab-abri.timer` lance une copie |
| Chaque nuit à 4 h 30 | `nel3ab-abri-entretien.timer` copie, applique la rétention et relit un seizième des données envoyées |
| Dépôt | `/mnt/nas/nel3ab-abri/restic`, chiffré par restic |
| Mot de passe | `~/.config/nel3ab-abri/mot-de-passe`, lisible du seul compte `souhib` |
| Dernière issue | `~/.local/state/nel3ab-abri/etat.json` : début, fin, code de sortie |
| Test | `just abri-test`, contre un faux dossier personnel et un dépôt jetable |

**Le mot de passe doit exister ailleurs que sur lgf.** Sans lui, la copie du NAS
est illisible, y compris pour nous. Si le disque de lgf meurt, le fichier du mot
de passe meurt avec lui. Recopiez son contenu dans un gestionnaire de mots de
passe :

```sh
cat ~/.config/nel3ab-abri/mot-de-passe
```

## Ce qui est copié, et ce qui ne l'est pas

Copié :

- `~/.local/state/nel3ab` : sauvegardes personnelles Dolphin, dossiers des
  salles, emplacements Switch et Switch 2, pseudos et liaisons de manettes.
- `~/.config/nel3ab` : configuration des moteurs.
- `~/.local/share/nel3ab/switch/template` et `~/.local/share/nel3ab/switch2`.

Exclu :

- Les caches de shaders (`.cache`, `mesa_shader_cache`, `cache` et `mesa` des
  emplacements). Ils se reconstruisent en jouant.
- Les dossiers d'essai `test-switch2-*` et `nx2-lab`.
- Les binaires gardés dans `deployments`.
- Les enregistrements de profileur `perf.data`.
- Les ROM (76 Go dans `~/roms`) et les mises à jour Switch. Elles se récupèrent
  à leur source.

Les tubes nommés (`*.fifo`, `full.h264`) sont enregistrés comme des tubes, sans
être lus.

## Rétention

48 copies heure par heure, puis 31 jours, 13 semaines et 24 mois. Une partie
abîmée un samedi et remarquée le mardi garde sa version du vendredi.

## Restaurer

Toujours dans un dossier à part, jamais par-dessus les sauvegardes en place :

```sh
export RESTIC_REPOSITORY=/mnt/nas/nel3ab-abri/restic
export RESTIC_PASSWORD_FILE=~/.config/nel3ab-abri/mot-de-passe
restic snapshots                      # la liste des copies, avec leur heure
restic ls latest | grep personal-saves | head
restic restore <copie> --target /tmp/restauration \
    --include ~/.local/state/nel3ab/personal-saves/<jeu>
```

Comparer ensuite avec `diff -r`, arrêter la salle concernée, puis remettre le
dossier à sa place. Sur une autre machine, il suffit de restic, du NAS et du mot
de passe.

## Limites connues

- Le partage du NAS s'appelle « Public ». Personne ne peut lire la copie, mais
  n'importe quel appareil de la maison peut l'effacer.
- Une copie prise pendant qu'un jeu écrit sa sauvegarde peut contenir un fichier
  à moitié écrit. La copie de l'heure suivante en aura une version entière, et la
  rétention garde les deux.
- Le montage NFS est « hard » : si le NAS ne répond plus, la copie attend au lieu
  d'échouer. Elle est abandonnée au bout de deux heures (quatre pour
  l'entretien).
