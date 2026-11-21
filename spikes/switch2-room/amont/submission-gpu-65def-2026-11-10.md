# Sonde de soumissions sur les sources du moteur installé

Le correctif accompagne `submission-gpu-65def-2026-11-10.json`. Il vise une
copie exacte des sources ayant produit `65defb74`, avec leurs changements
locaux déjà présents, et non la révision Git nue `0b83798b`. Le contrôle
`git apply --check` passe sur cette copie. Le moteur installé reste intact.

La construction privée produit `be3c43fb`. Les dix entrées modifiées ont
des dates fraîches. Les objets du planificateur, du rasteriseur et de la
nouvelle sonde sont réellement reconstruits. La suite native recense
1 255 cas, dont quatre ignorés sans réseau. Les tests avec doubles CPU
compilent aussi le vrai fichier de la sonde et refusent quatre mutations.
Cela ne valide pas le pilote Vulkan ni le coût de l'instrumentation.

## Portée

La sonde entoure les tampons de transferts et d'exécution des soumissions
existantes. Elle n'ajoute aucune soumission, aucune attente explicite du GPU
pendant les images et aucun chronométrage par dessin. Elle ne classe pas
les programmes invités. Elle attend la fermeture de l'enregistrement et
le tick GPU terminé avant lecture ou réutilisation du pool de compteurs.
Les résultats indisponibles invalident la capture. À l'arrêt, le worker
rejoint et le dernier tick soumis terminé précèdent la destruction du pool.

Les horodatages imposent néanmoins des dépendances d'exécution. Leurs
intervalles peuvent se recouvrir, et leur enveloppe peut contenir des trous.
Une somme n'est donc pas un temps exclusif du GPU. Voir les
[limites données par Khronos](https://docs.vulkan.org/samples/latest/samples/api/timestamp_queries/README.html).
L'ancienne mesure du 8 novembre concernait Eglantine, sans maillages et sans
le même mode de séparation CPU. Elle ne qualifie pas cette construction.

## Activation privée à vérifier

- `EDEN_NX2_SUBMISSION_GPU=1` active la sonde. Son absence la désactive.
- `EDEN_NX2_SUBMISSION_GPU_PERIOD=60` choisit une image sur soixante.
- `EDEN_NX2_SUBMISSION_GPU_MANUAL=1` attend `$HOME/submission-gpu/arm`.

Le stockage est limité à 1 024 intervalles par capture et 128 captures par
lancement. Le dépassement invalide les mesures sans supprimer les commandes
du jeu. Chaque CSV doit avoir un fichier `.meta` de version 2, complet et
sans dépassement. Les bornes monotones de début et de résultats disponibles
doivent tenir entièrement dans la phase réellement observée.

Le lecteur privé limite pour l'instant son interprétation aux compteurs de
64 bits sans rebouclage. Il rejette les autres cas et vérifie que la durée
GPU tient dans l'enveloppe hôte conservatrice. L'union des intervalles et
leur enveloppe sont rapportées séparément de leurs sommes.

Le premier contrôle de lancement est refusé par un client GPU extérieur,
avant tout worker ou jeu. Aucun marqueur d'activation ni résultat GPU réel
n'est encore accepté. Il reste à vérifier le monde joué, les 141 réglages,
les paquets reçus, les fichiers complets et l'arrêt normal. Une alternance
avec le même binaire, sonde coupée puis active, doit ensuite qualifier son
coût avant toute décision de performance. Aucun gain de FPS n'est revendiqué.
