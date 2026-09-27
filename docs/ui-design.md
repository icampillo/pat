# Interface Patrimoine — passe du 28 septembre 2026

## Audit et périmètre

La cartographie ASTra de la reprise précédente a identifié les composants UI ; sa recherche incluait des fichiers générés, exclus de la revue source. Sources relues : dashboard, shell, cartes de catégories, graphiques et feuille globale. Les composants réutilisables existants sont conservés, sans nouvelle dépendance.

Constats : montant principal trop proche des titres secondaires, styles de contraste superposés, couleurs graphiques en dur, contrôles irréguliers. Au début de cette reprise, les classes wealth/category et les variables du graphique n'avaient pas encore de définition CSS.

## Direction et système

- Surfaces claires légèrement nuancées, accent violet discret, bordures fines ; pas de glassmorphism.
- Tokens sémantiques en tête de `src/app/globals.css` : fonds, surfaces, texte, accent, positif/négatif, warning, focus. Le dark mode n'est pas activé ; les tokens constituent sa base, mais des styles historiques restent à migrer avant son introduction.
- Espacement : 4/8/12/16/24/32 px. Rayons principaux : 8/12/16 px. Contrôles : 42 px. Contenu : maximum 1520 px.
- Police système sans téléchargement ; titres hiérarchisés, patrimoine total 32–54 px (30–44 px mobile), chiffres financiers tabulaires.
- Breakpoints existants conservés : navigation mobile à 768 px, graphiques empilés à 1024 px, cartes sur une colonne à 600 px.

## Changements

- Dashboard : patrimoine total focal, date de situation, indisponibilités explicites, périodes 1/3/6 mois en complément des périodes existantes.
- Cartes cliquables : icônes Lucide, valeur/performance existantes, poids de répartition, hover de 2 px.
- Graphiques : couleurs sémantiques, grille discrète, tooltip harmonisé, identifiants de dégradé uniques, état sans historique explicite. Aucun point ni rendement inventé, ruptures de données conservées.
- Navigation : page active accessible, hover discret, sidebar défilante, retrait du chevron d'un sélecteur non interactif.
- Contrôles, tableaux et dialogues : surfaces cohérentes, focus visible, interactions légères ; la préférence de réduction des animations est respectée.

Aucun fichier métier, schéma, donnée ou dépendance modifié. Le rendement Dietz et les performances des catégories restent ceux des calculs existants.

## Vérifications exécutées

Avec Node et les dépendances déjà présents, sans installation :

```sh
node node_modules/typescript/bin/tsc --noEmit
./node_modules/.bin/eslint .
node node_modules/vitest/vitest.mjs run tests/unit
node node_modules/prettier/bin/prettier.cjs --check src/app/globals.css src/components/asset-category-card.tsx src/components/charts.tsx src/components/pages/dashboard.tsx src/components/workspace/shell.tsx
git diff --check
```

Typecheck OK ; 78 tests dans 11 fichiers OK ; lint sans erreur (avertissement existant : variable `overall` inutilisée dans `portfolio-breakdown.tsx`) ; formatage et diff OK.

Équivalents WSL : `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`.

Pas de Playwright ni de build lourd, conformément à la demande. Le rendu navigateur n'a pas été validé : vérifier à 375/768/1440 px, navigation clavier/menu mobile, EUR/USD, périodes, montants longs et états sans données sur le serveur de développement habituel.
