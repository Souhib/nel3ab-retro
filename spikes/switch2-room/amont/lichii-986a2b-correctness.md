# Port sur Lichii du 9 novembre

Base figée `986a2b684d752cd5227d0d8cdd63d52111d9c298`. Le fichier
`lichii-986a2b-correctness.patch` contient deux corrections et leurs tests.
La reconstruction à partir des fichiers amont est vérifiée octet par octet.
L'adresse épinglée de téléchargement SDL est omise du correctif.

Le curseur de l'unique anneau ne change plus lorsqu'un tour occupé est refusé.
La fonction originale Lichii reproduit la réutilisation d'une région occupée
au deuxième appel. La version portée refuse les deux appels et accepte après
achèvement GPU. Trois tests passent 1 027 820 assertions ; la mutation qui
réintroduit le défaut échoue dans deux tests. Le type de mémoire, sa capacité
et le chemin de repli restent ceux de Lichii.

La reprise d'un petit uniforme lit ses octets et les compare au snapshot
réellement envoyé avant de lier l'ancienne allocation. Une page déjà marquée
CPU-modifiée peut changer sans nouvelle notification. Le vrai fixture du cache
reproduit ce cas : les octets liés restent anciens avec l'amont, sont actuels
après correction et redeviennent anciens si la validation est retirée.
Les 18 tests ciblés passent 80 303 assertions.

Le contrôle réel amont en mode 1 avait trouvé 592 différences sur 334 475
vérifications dans une fenêtre complète de mouvement. Les 120 832
comparaisons de descripteurs concordaient. Ce résultat ne désigne pas un
clignotement précis ; le vérificateur reprenait le chemin de référence.
Le mode 0 n'exerce pas les candidats delta et son zéro vérification n'est
pas une validation. Le mode 1 les exerce tout en gardant les acquires
sur le chemin de référence, contrairement au mode 2 examiné séparément.

La construction combinée avec Clang 23, PGO officiel, ThinLTO et réglage Ryzen
passe 1 091 tests, quatre tests réseau sont ignorés. Les objets qui instancient
les corrections sont reconstruits. Le diagnostic corrigé exerce 338 432
reprises et 118 784 comparaisons de descripteurs sans différence. Il ne
fournit pas un oracle indépendant de chaque donnée GPU : les tests réels,
leurs mutations et la preuve du code exécuté restent nécessaires.
L'ancien `UBO_KEEP_VERIFY` est inchangé et force le chemin de référence ;
son compteur de différences hypothétiques n'est pas remis artificiellement
à zéro après correction.

Les sondes retirées, deux passages successifs donnent 20,42 images/s en
mode 1 et 19,93 en mode 0. Les déplacements et arrêts sont normaux. Ce
contrôle n'est pas une comparaison alternée. Le rendu complet, les zones,
le son et une sauvegarde reprise ne sont pas qualifiés. Le moteur installé
reste inchangé. Le [rapport](../upstream-refresh-2026-11-09.json) conserve
les révisions, les diagnostics et les mesures.
