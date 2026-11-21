# Publications constantes de Lichii, 9 novembre 2026

## Base et portée

Ce port privé ajoute le [diff exact de la proposition #874](https://github.com/zortos293/Lichii/pull/874),
tête `6a5434e7a98fbb8a04aff96b401a710e7da47a2c`, à Lichii
`986a2b684d752cd5227d0d8cdd63d52111d9c298` avec les corrections
de `lichii-986a2b-correctness.patch`. Il préserve le miroir de #979.
Il ne corrige pas le raccourci d'acquire du mode 2. Le contrôle utilise
le mode 1, les clôtures par défaut et la précision GPU basse.

`lichii-payload-release-874.patch` contient le changement de production
amont et une fixture de régression ajoutée au CMake des tests. Il s'applique
après le patch de fiabilité. Le pin de téléchargement SDL reste privé,
identique à celui du témoin compilé.

Le correctif distingue les constantes publiées par un rapport des compteurs
dont le résultat dépend du GPU. Il autorise les premières selon le mode de
clôture et de précision, tout en conservant le nettoyage unique des requêtes.
Retirer seulement le drapeau de clôture ne reproduit pas ce changement.

## Preuve du comportement

Le test exécute les vrais `QueryCacheBase`, `FenceManager`, gestionnaires de
mémoire et mappages invités. Le backend de clôture est un double dont
l'achèvement doit être demandé explicitement. Le rasterizer nul ne gère
pas les clôtures : son callback immédiat masquerait précisément le défaut.
Les valeurs du producteur de requêtes sont synthétiques. Aucun GPU, shader,
jeu ou contenu de mémoire de jeu ne figure dans la fixture.

Avant le port, le test compile et échoue après cinq préconditions réussies :
la mémoire mappée contient encore 100 au lieu de 5. Le diff exact passe neuf
tests et 571 assertions. Ils couvrent les modes de clôture et de précision,
un vrai type compteur avec producteur présent, le repli d'un type absent,
les rapports sans clôture, les sorties invalidée et non synchronisée,
le nettoyage, les miroirs et les horodatages.

Cinq mutants compilent et échouent ensuite sur l'assertion attendue : attente
forcée rétablie, garde de compteur retirée, libération perdue, double
libération et miroir supprimé. La fixture ne prouve pas toutes les courses
du backend Vulkan asynchrone ni les usages après recyclage d'un identifiant.

## Binaire expérimental

La construction reprend Clang 23, le même profil PGO officiel, ThinLTO,
les réglages Ryzen et les chemins internes du témoin corrigé. Les unités
de compilation du cache de requêtes, du cache d'uniformes et de l'anneau
sont reconstruites après rafraîchissement des dates des entrées.
La suite complète passe 1 100 tests et 71 893 627 assertions. Quatre tests
réseau restent explicitement ignorés dans le conteneur sans réseau.

Le SHA-256 du CLI expérimental est
`be340855afa1f183b9105c1921e40592489a177c9067e2a20cc297ccd83f5ab1`.
Celui du témoin avant #874 reste
`41d8fbfcc24db6da89f2fd018b8d03faaf5a75cf456a03eedf246aeff7b88f3a`.

`lichii-payload-release-activation.patch` est séparé. Il ajoute un journal
unique après une publication admissible réellement exécutée, seulement si
`EDEN_NX2_PAYLOAD_SYNC_TRACE=1` au premier appel. Absence, zéro et autres
valeurs le désactivent. Il n'affiche aucune adresse ni donnée du jeu.
Ce marqueur est compilé dans le candidat, puis désactivé pour les FPS.
L'identité de l'exécutable ne remplace pas la preuve d'activation en jeu.

Le marqueur est observé une fois dans le callback exécuté. La scène Kokiri,
la caméra et la marche sont vérifiées, avec arrêt normal. Les quatre phases
sans diagnostics donnent, corrigé/témoin alternés,
21,32/20,21/20,62/19,93 images/s. Le total pondéré par les durées des fenêtres
complètes donne 21,08 contre 20,07, soit +5,05 % observés. Les couvertures
diffèrent : 85,38 contre 119,586 secondes. Aucune image retenue ne dépasse
100 ms. Les mêmes fichiers privés de cache et de progression sont restaurés
avant chaque phase, mais le système et les personnages restent variables.

Ce résultat ne démontre pas 30 images/s, une partie longue, une transition
de zone, le son ou une reprise de sauvegarde. `NO_MESH=1` reste présent dans
les deux conditions, comme auparavant ; la fidélité complète du monde n'est
pas qualifiée. Rapport : `../payload-release-2026-11-09.json`.
Ce binaire n'est pas installé dans la salle. Le nouveau commit amont
`0b83798bf`, publié pendant ce travail, modifie aussi la durée de vie des
rapports et devra être composé dans une autre base avant tout essai de
cette combinaison.
