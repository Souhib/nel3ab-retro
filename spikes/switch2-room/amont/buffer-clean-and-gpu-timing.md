# Résumé des pages mémoire et horodatages GPU

Prototype privé du 8 novembre 2026, basé sur Eglantine
`216d3e294367abd4742d7ebd736ef25a8db6f365`. Le correctif
[`buffer-clean-and-gpu-timing.patch`](buffer-clean-and-gpu-timing.patch)
ne se cumule pas avec les deux prototypes précédents. Il reste hors du
moteur installé. Les options expérimentales sont désactivées par défaut.

## Ce que contient le code

`EDEN_NX2_BUFFER_STATS=1` compte les appels de synchronisation, les appels
sans transfert, les pages modifiées et les octets effectivement copiés.
Les banques de constantes forcées sont comptées séparément. Un octet
transféré n'est pas nécessairement un octet différent. La sonde compare
une copie sur seize, au plus ses 4 096 premiers octets, avec un historique
borné à 16 Mio de données. Cet échantillon ne permet pas de classer toutes
les banques en données modifiées ou inchangées. Aucun contenu du jeu ni
adresse invitée n'est écrit dans les compteurs.

`EDEN_NX2_BUFFER_FAST_CLEAN=1` permet d'éviter un parcours de pages quand
un résumé prouve que la plage ne contient ni page modifiée par le CPU,
ni page dont la surveillance doit être réarmée. Un bit résume un mot de
64 pages, soit 256 Kio. Un gestionnaire de 4 Mio prend huit octets de plus.
Une plage douteuse conserve le parcours existant. Les écritures retardées,
leur validation et les changements de surveillance mettent le résumé à jour.
Le maintien de ce résumé coûte aussi du travail ; la comparaison utilise
un témoin amont intact, compilé avec les mêmes outils, pour compter ce coût.

`EDEN_NX2_GPU_TIMINGS=1` crée une sonde de commandes Vulkan. Créer
`$HOME/gpu-timing/request` demande la capture d'une image. Les résultats
`capture-N.csv` et leur fichier `.meta` ne sont exploitables que si
`complete=1` et `dropped=0`. Le stockage est borné à 16 384 intervalles.
Une saturation abandonne des mesures, jamais les commandes du jeu.
Les horodatages entourent les commandes de dessin, calcul et copie au moment
de leur enregistrement, dans les tampons de commandes existants.
La lecture attend leur disponibilité sans ajouter de soumission ou de mise
au repos du GPU par image. Les bornes haut et bas du pipeline donnent des
intervalles approximatifs qui peuvent se recouvrir. Leurs sommes par
catégorie ne sont pas des durées exclusives du matériel.
Voir la [documentation Vulkan](https://docs.vulkan.org/samples/latest/samples/api/timestamp_queries/README.html).

## Construire et vérifier

Appliquer le correctif à la révision indiquée, puis construire `eden-cli`
et `tests`. Vérifier que les fichiers modifiés sont réellement reconstruits.
Le message `Buffer lab diagnostic: stats=false fast_clean=true` prouve la
configuration, et `Buffer clean summary: first clean range skipped` prouve
le passage dans le nouveau chemin. L'empreinte du binaire seule ne suffit pas.

Le filtre Catch2 `[buffer_clean],[gpu_time]` exerce les pages propres et
modifiées, les limites de mots, les pages non surveillées, les écritures
retardées et les paramètres des horodatages. Dix mille changements déterministes
comparent aussi le résumé aux bits d'origine. Les mutations qui ignorent
les pages non surveillées, une mise à jour du résumé ou la disponibilité GPU
doivent échouer. Les tests de conversion ne remplacent pas un essai Vulkan
sur le vrai GPU.

Les performances se mesurent sans ces sondes : statistiques et horodatages
à zéro, aucune requête de capture. Alterner témoin/correctif/témoin/correctif,
mêmes options, sauvegarde, caches initiaux et caméra. Vérifier les images
avant et après. Les tests réseau ignorés dans un conteneur sans réseau restent
signalés comme ignorés. Le [plan](../../../docs/plan-60fps-switch2-2026-11-08.md)
conserve les résultats, les limites et la suite.
