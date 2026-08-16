# Ce qui gouverne les lints ici

**Un seul fichier: `.oxlintrc.json`.** C'est le seul nom qu'oxlint cherche.

Il y en a eu deux pendant une journée: un `oxlint.json` portant les catégories,
qui n'a jamais été lu par personne. Une configuration qu'on croit active et qui
ne l'est pas est pire que pas de configuration: elle fait croire qu'un filet
existe. Trouvé en vérifiant `oxlint --help`, qui annonce
`-c=<./.oxlintrc.json>`, pas en lisant le code.

Deux règles portent une raison:

- **`react/react-in-jsx-scope` est éteinte.** La transformation JSX moderne
  n'exige plus `React` dans la portée, et le greffon React de Vite l'utilise. La
  laisser allumée rendrait rouge chaque composant du dossier, pour une contrainte
  que le compilateur n'a plus.
- **`src/client` est ignoré.** C'est le client engendré depuis le document
  OpenAPI. Son style appartient au générateur, et le soumettre à nos règles
  reviendrait à corriger à la main un fichier qu'une commande réécrit.

Le formatage suit la même ligne: `.oxfmtignore` laisse `src/client` tranquille,
sinon régénérer donnerait toujours un écart et la vérification de fraîcheur
(`just contract-check`) serait rouge en permanence.
