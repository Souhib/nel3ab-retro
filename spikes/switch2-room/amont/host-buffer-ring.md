# Anneau d'envoi en mémoire système et curseur occupé

Prototype local du 9 novembre 2026, sur Eglantine rc3 `78743f30c`.
Le paquet installé reste inchangé. Le correctif complet est
`host-buffer-ring.patch`, avec ses trois tests CPU.

Le chemin `EDEN_NX2_HOST_BUFFER_UPLOAD=1` ajoute un anneau indépendant en mémoire
système aux envois des tampons du cache. Les accès directs aux uniformes gardent
l'anneau initial. La valeur `0`, une valeur inconnue ou l'absence de la variable
conservent ce chemin initial. La mémoire réellement allouée est journalisée
au démarrage du contrôle activé. Les grandes demandes et les régions occupées
utilisent le stock de tampons existant.

Le calcul des réservations est commun aux deux anneaux. Un tour refusé ne doit
modifier aucun curseur : sinon une nouvelle demande peut accepter la région
encore occupée. Le défaut original est reproduit avant correction et par
réintroduction dans le fichier utilisé par le moteur. Un test suit aussi les
octets réservés dans deux anneaux avec des travaux encore en cours ; un autre
refuse les dimensions invalides. Les 242 tests passent avec la variable à `0`
et à `1`, quatre tests réseau sont ignorés sans réseau.

Le premier contrôle activé donne 22,41 images/s dans Kokiri, avec marche au
sol et arrêt normal. Il ne prouve pas un gain causal et n'atteint pas 30.
Les quatre passages alternés donnent 22,14 images/s avec ce chemin et 23,29
avec le chemin habituel. La variante en mémoire système est écartée. Le rapport
`../host-ring-2026-11-09.json` distingue le correctif de réservation et l'essai
de cadence. Leur présence ensemble ne prouve pas que le premier améliorait
les FPS. Le son, une sauvegarde reprise et un changement de zone restent à
qualifier avant toute installation.

`host-buffer-upload-pool.patch` conserve le prototype précédent, sans anneau
d'envoi indépendant. Il donne 22,47 images/s dans un contrôle isolé. Les deux
correctifs partent de rc3 et ne doivent pas être empilés.
