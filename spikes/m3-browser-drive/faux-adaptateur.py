"""Un adaptateur Switch qui ne lance rien et attend qu'on lui ferme l'entrée.

Le worker démarre l'adaptateur, puis ferme son entrée standard et attend sa
sortie: c'est tout le contrat dont un pilote de fermeture a besoin. Aucun
conteneur, aucune image, aucune carte graphique, donc aucun risque pour une
salle vivante qui tournerait à côté.

Les cinq arguments du vrai adaptateur sont ignorés volontairement.
"""

import sys

sys.stdin.read()
