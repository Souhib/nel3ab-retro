# Le gestionnaire de moteurs des salles externes

Les salles Switch, Switch 2 et Xbox 360 lancent un émulateur dans Docker par un
script Python, celui que nomme `form.script` dans `consoles/consoles.json`
(`docker/<console>-room.py`). Les trois scripts recopiaient le même cycle de
vie. Ce dossier le rassemble, en deux parties:

- `socle/` : ce que chaque moteur partage. Le nom et le verrou de
  l'emplacement de sauvegarde (`emplacement.py`), le plan d'un moteur et ses
  manettes (`lancement.py`), le cycle de la salle (`salle.py` : manettes,
  moteur, capture, arrêt), et la table des consoles externes (`consoles.py`).
- `<moteur>/` : ce qui est propre à un émulateur. Sa fiche `moteur.json`, puis,
  console par console, son module `adaptateur.py`.

La migration se fait une console à la fois, dans l'ordre Xbox 360, Switch 2,
puis Switch. Tant qu'une console n'a pas basculé, son script d'origine reste
celui que le worker lance, et le socle garde des copies de son code
(`serve`, `pad_command`...) que `socle/test_differentiel.py` tient égales.

## Les règles, et ce qui les vérifie

| Règle | Pourquoi | Vérifiée par |
|---|---|---|
| Une salle ne lit jamais `consoles/consoles.json` ni rien sous `control/` | Un manifeste faux arrêterait toutes les salles externes, alors que l'ADR D22 veut qu'il arrête la porte | `socle/test_regles.py`, et `socle/test_consoles.py` qui compare la table au manifeste dans les deux sens |
| La bibliothèque standard seulement | Le worker lance `python3` par le PATH de son unité, pas le venv du salon | `socle/test_regles.py` (import sous `/usr/bin/python3 -I -S`) |
| Aucun import dans le corps d'une fonction | Un import paresseux lirait, au moment de l'arrêt, une version plus récente de l'arbre principal | ruff PLC0415 dans `just moteurs-test`, et `socle/test_regles.py` |
| Une migration ne change aucune commande Docker | C'est ce qui permet de basculer sans reconstruire le worker | `just salles-dore` (`docker/test_salles_dore.py`) |

## Les commandes

| | |
|---|---|
| `just moteurs-test` | les essais de ce dossier, ruff et le format, sans Docker ni carte |
| `just salles-dore` | les commandes Docker de chaque console comparées au doré |
| `just salles-dore-ecrire` | réécrit le doré, seulement quand rien d'autre n'est modifié |
