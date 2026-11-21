# Banques natives et invalidation des pages recouvertes

Expérience privée du 9 novembre 2026 sur Eglantine rc3
`78743f30c251f66bd77e6eea6c28d8632d642d6f`. Le
[rapport](../native-bank-2026-11-09.json) conserve les résultats et les exclusions.
Aucun moteur installé n'est remplacé.

Le fichier `native-bank-range-lab.patch` conserve tout le code de laboratoire
testé depuis cette révision : comparaison des banques, sonde de transferts,
anneau en mémoire système et correctif de curseur. Il remplace les correctifs
de ces essais précédents ; ne pas les empiler. La modification locale du
téléchargement SDL est omise. Une reconstruction à partir des fichiers amont
et de ce correctif est vérifiée octet par octet pour chaque fichier modifié.

La comparaison utilise `EDEN_NX2_BANK_COMPARE=1`, contre `0` pour son témoin.
`EDEN_NX2_BANK_COMPARE_STATS`, `EDEN_NX2_HOST_BUFFER_UPLOAD` et
`EDEN_NX2_UPLOAD_PAYLOAD_DIAGNOSTIC` restent à `0` pendant les mesures de FPS.
Toutes ces options sont désactivées en l'absence de variable. Le correctif
de curseur reste commun aux deux conditions. Les 248 tests passent avec la
comparaison à `0` puis `1`, quatre tests réseau sont ignorés sans réseau.

La construction emploie Clang 23, le profil PGO officiel, ThinLTO,
`-march=znver2 -mtune=znver2 -O3 -g1`. Le fichier qui instancie le code changé
est `renderer_vulkan/vk_buffer_cache_base.cpp`. Sa date de reconstruction
et le marqueur d'une réutilisation réelle complètent le SHA-256 du programme.
Le témoin emploie le même exécutable et le même pilote Mesa 25.2.8.

Le prototype compare toutes les pages couvertes avant la seule invalidation
artificielle qui force un nouvel envoi chaque image. Il conserve le suivi
normal des écritures. Une page déjà écrite par le GPU garde le chemin forcé.
Les écritures et remplacements de tampons n'oublient que les instantanés
recouvrant leurs destinations ; les débordements gardent le vidage complet.

Le relevé séparé évite 76,02 % des invalidations forcées examinées, sans
mesurer directement une réduction des octets transférés. Les quatre passages
alternés donnent 24,23 contre 22,48 images/s. La couverture inégale des
fenêtres et les à-coups initiaux limitent le +7,79 % observé. Une vérification
secondaire des fenêtres plus tardives donne +4,41 %. Les 30 images/s ne sont
pas atteintes. Les quatre déplacements et arrêts sont normaux.

Les clignotements, une nouvelle zone, le son et une sauvegarde reprise ne sont
pas qualifiés. Le stock source précède l'envoi : sa correspondance exacte avec
les octets envoyés sous écritures concurrentes du jeu reste à établir.
Ne pas déduire la correction des données d'une hausse des FPS.
