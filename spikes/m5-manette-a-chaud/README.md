# Changer d'extension sans relancer le jeu

**Statut: prouvé, contre un vrai jeu Wii, sans patcher Dolphin.**

## La question

Changer de manette relance la partie aujourd'hui. Le choix voyage sur le chemin
du changement de jeu (`remember_choice`): le worker l'écrit, s'arrête, systemd le
relance. Un joueur qui veut juste troquer son Nunchuk perd la partie de tout le
monde.

## Ce qui est prouvé

Un ordre venu de l'extérieur change l'extension d'une Wiimote émulée **pendant
que le jeu tourne**, sans redémarrage. Nunchuk vers Classic, Classic vers
guitare, guitare vers Nunchuk. Le jeu tourne depuis 25 secondes au moment du
premier ordre, ce qui répond à l'objection « ça n'a marché que parce que rien ne
tournait encore ».

## Ce qui n'est PAS prouvé, et ne l'est pas par accident

**Que le jeu accepte l'échange à ce moment-là.** Dolphin échange; le jeu décide
quoi en faire. Guitar Hero attend qu'on branche une guitare et devrait suivre;
un jeu qui ne lit son type de manette qu'à son écran de choix ignorera un
changement en plein niveau. Ça se teste par jeu, et ce n'est pas ce que ce
script mesure.

La distinction compte parce qu'un « ça marche » qui mélange les deux ferait
promettre à l'interface quelque chose que le jeu ne tient pas.

## Pourquoi ça marche sans patch

Deux faits lus dans la source du Dolphin épinglé (216ffb45):

1. **`Wiimote::Update()` tourne à 200 Hz et appelle `HandleExtensionSwap` à
   chaque passage.** Le commentaire de Dolphin le dit lui-même: « If a new
   extension is requested in the GUI the change will happen here. » Le mécanisme
   existe déjà, il n'attend qu'un ordre. C'est le comportement du vrai matériel:
   on débranche un Nunchuk et on branche une guitare sans éteindre la console.

2. **Le choix d'extension accepte une expression d'entrée**, réévaluée à chaque
   sondage. `NumericSetting::GetValue` relit son entrée tant que la valeur n'est
   pas une constante, et `Attachments::LoadConfig` est explicite: « First assume
   attachment string is a valid expression. »

On écrit donc `Extension` comme une expression qui lit un **second tuyau**, dédié
au contrôle:

```ini
[Wiimote1]
Extension = 1 + `Pipe/0/ctl:Button A` + 2 * `Pipe/0/ctl:Button B`
```

Un second tuyau plutôt qu'un jeton du premier parce que le tuyau de Dolphin
n'expose que **douze boutons** — exactement les douze de notre trame. En voler un
coûterait un bouton de jeu.

L'index de `Pipe/0/<nom>` ne dépend pas de l'ordre d'énumération: Dolphin numérote
les homonymes, et chaque tuyau a un nom différent. C'était une crainte, elle est
levée.

## L'observable

`HandleExtensionSwap` journalise `Switching to Extension N`. Un nombre dans un
journal: pas d'écran à regarder, pas d'humain, et ça **nomme** l'extension
obtenue plutôt que de la déduire. Le journal montre aussi l'échange en deux
temps — détacher, puis attacher au passage suivant — qui est le comportement de
Dolphin et non un défaut.

## Le piège qui a coûté une partie

`docker/dolphin-in-docker.sh` fait `docker rm -f nel3ab-dolphin` avant de
démarrer, pour la bonne raison qu'un émulateur orphelin vole les entrées. La
première version de cette manip n'a pas nommé son conteneur: elle a donc **tué le
Dolphin de la salle en cours**, qui a redémarré et tué le nôtre en repartant.
Code de sortie 137, et une partie relancée sous les doigts de quelqu'un.

Le script refuse maintenant de partir sous le nom de la salle. La leçon est plus
large: un script d'essai qui emprunte l'outillage de la production en hérite les
effets de bord, y compris ceux qui sont voulus.

## Ce que ça ne couvre pas

**Une vraie manette GameCube sur un jeu Wii.** Ce n'est pas une extension, c'est
un appareil. Dolphin sait le brancher à chaud — `SerialInterfaceManager::Update
Devices()` compare la configuration à ce qui est branché à chaque image, avec une
seconde de battement — mais il lit une valeur de `Config`, pas une expression. Et
débrancher la Wiimote n'existe que derrière un raccourci de l'interface Qt, alors
qu'on tourne en `--platform headless`.

Il ne nous manque donc pas une fonction, **il nous manque un canal**: le tuyau ne
transporte que des boutons et des axes. `PlatformHeadless::MainLoop()` se réveille
toutes les 100 ms et ne fait rien d'autre que dépiler des tâches; c'est là
qu'irait un quatrième patch, et il ouvrirait du même coup les sauvegardes d'état
(`--save_state` existe déjà au lancement, il ne manque que de quoi en écrire une).

Ce serait une décision, pas une commodité: elle mérite son entrée d'ADR avant
d'être écrite.

## Rejouer

```
just manette-a-chaud
```

Il faut un jeu Wii et l'image Dolphin. `NEL3AB_SPIKE_ROM` change le jeu,
`NEL3AB_SPIKE_SETTLE` le temps de jeu avant le premier ordre.
