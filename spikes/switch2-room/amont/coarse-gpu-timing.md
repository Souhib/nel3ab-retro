# Horodatages GPU par soumission existante

Prototype du 8 novembre 2026 sur Eglantine
`216d3e294367abd4742d7ebd736ef25a8db6f365`. Le fichier
`coarse-gpu-timing.patch` repart de l'amont intact. Les prototypes d'attente,
de lecture MME et de résumé mémoire précédents ne sont pas présents.
La sonde est désactivée par défaut et reste hors du moteur installé.

## Ce qui est mesuré

La sonde entoure les tampons de transferts et d'exécution principale dans les
soumissions que le moteur produit déjà. Elle ne crée pas une soumission par
mesure et n'ajoute pas de mise au repos du GPU par image. Les résultats sont
lus seulement après la fin de l'enregistrement et du tick de soumission
concerné, avec disponibilité vérifiée pour chaque compteur. Le pool n'est
réinitialisé qu'après la fin de sa capture précédente.

Les programmes de calcul invités sont comptés avec leur empreinte et leur
identifiant natif. Un seul programme est chronométré dans chaque capture ;
la sélection tourne sur ceux observés dans la capture précédente. Sa durée
est comprise dans celle du tampon d'exécution, jamais à ajouter à celle-ci.
Les programmes internes de l'émulateur ne sont pas identifiés par cette liste.

Les bornes du pipeline donnent des intervalles approximatifs qui peuvent se
recouvrir. L'enveloppe entre première et dernière commande peut contenir des
trous de préparation CPU, des attentes et des images encore en vol. L'union
des intervalles n'est pas un compteur exclusif d'occupation du matériel.
La [documentation Vulkan](https://docs.vulkan.org/samples/latest/samples/api/timestamp_queries/README.html)
explique ces limites. Vérifier le coût de la sonde par alternance avant de
l'utiliser pour choisir une modification du moteur.

## Utilisation privée

- `EDEN_NX2_COARSE_GPU=1` active la sonde.
- `EDEN_NX2_COARSE_PERIOD=60` échantillonne une image sur soixante par défaut.
- `EDEN_NX2_COARSE_MANUAL=1` attend le fichier `$HOME/coarse-gpu/arm` avant de
  commencer. Cela évite de dépenser la limite de captures dans le menu.
- `EDEN_NX2_COARSE_NATIVE=<identifiant hexadécimal>` cible un programme précis.
  S'il n'est pas observé, aucun autre programme n'est présenté comme sa mesure.

Chaque lancement produit au plus 128 captures, chacune limitée à 1 024
intervalles. Dépasser un budget invalide la capture, sans supprimer les
commandes du jeu. `capture-N.csv.meta` doit porter `complete=1` et `overflow=0`.
Le fichier `.programs` conserve les comptes des programmes observés ; le CSV
conserve seulement les horodatages et les identifiants. Aucun code de programme,
contenu de texture ou donnée de sauvegarde n'est exporté par la sonde.

Le pilote de laboratoire archive ces fichiers dans le dossier du lancement
après la sortie effective du conteneur. Les indices repartent de zéro à chaque
processus ; relire directement un dossier partagé après redémarrage attribuerait
les nouvelles mesures à l'ancien passage. Sélectionner les captures entièrement
comprises dans la phase observée avec leurs bornes de temps réelles.

## Validation

Construire `eden-cli` et `tests`, puis vérifier les objets réellement reconstruits.
Le marqueur `Coarse GPU timing ready` et des captures disponibles prouvent
l'activation. Les tests `[coarse_gpu]` couvrent les captures ouvertes, le budget
épuisé, les fins invalides ou répétées, la rotation des programmes, les résultats
indisponibles et les paramètres de compteur invalides. Les mutations doivent
faire échouer ces tests, sans modifier le binaire de référence.

Comparer le même exécutable, sonde coupée puis activée, sur quatre phases
alternées, sans compilateur, test ou profileur concurrent. Les réglages,
la sauvegarde, les caches initiaux et les commandes de caméra sont identiques.
Un relevé plus fréquent pour couvrir les programmes reste un diagnostic séparé :
il ne reçoit pas automatiquement la validation de coût du réglage une sur soixante.
Le plan dans `docs/plan-60fps-switch2-2026-11-08.md` et le rapport de cette reprise
conservent les résultats et les limites.


La rotation seule ne prouve pas la couverture : une liste qui change peut
laisser un programme fréquent sans mesure. Comparer les ensembles observés
et chronométrés, puis cibler les manques. Une capture où le programme demandé
est absent ne vaut pas une mesure de zéro milliseconde. Le contrôle sur la
sauvegarde au sol a exercé ce refus réel, avant de revenir à la vue du balcon.
La comparaison de quatre phases à une capture sur soixante observe 22,36
contre 21,75 images/s, soit −2,74 %. La sonde n'est donc pas présentée comme
transparente, même si son nombre de requêtes est réduit.
