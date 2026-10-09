# Dashboard — refonte UI/UX

## Périmètre

Refonte limitée à `/dashboard` : header compact, quatre KPI, graphique principal, allocation,
cartes d’investissement et entrée vers l’analyse IA existante. Shell, autres pages,
WorkspaceProvider, API, workers et calculs métier inchangés. Pas de dépendance ajoutée.

- `src/components/dashboard/` : primitives React/Tailwind, header et périodes ; tokens
  sémantiques isolés dans `dashboard.module.css`, sans ajout à `globals.css`.
- `charts.tsx` : variante dashboard explicite ; présentation par défaut conservée.
- `asset-category-card.tsx` : nouvelle composition cliquable ; helpers partagés inchangés.
- `PortfolioAnalysisDialog` : classe du déclencheur optionnelle, comportement inchangé.

## Données

Patrimoine issu de `state.totals`, liquidités converties via les fonctions existantes,
positions/catégories via `buildCategoryDetails`. Coût global masqué lorsqu’incomplet,
avec wallet inclus ou immobilier (pas de confusion entre coût brut et valeur nette).
Performance Dietz et restrictions EUR/USD/immobilier/wallets conservées.
Aucune valeur de démonstration ni requête supplémentaire introduite dans l’application.

Les snapshots déterminent seuls la courbe : périodes existantes, lacunes non reliées,
état vide sous deux captures valorisées. Allocation positive et liquidités connues
conservées ; poids indisponibles lorsque le total est inconnu.

## Validation au commit demandé le 8 octobre 2026

Exécuté avec succès :

```sh
pnpm typecheck
pnpm lint
pnpm test:unit  # 200 tests, 27 fichiers
pnpm build
git diff --check
```

Dans ce conteneur, pnpm 11 tente une réinstallation implicite des modules. Les commandes
ont été exécutées avec `/workspace/.local/bin` ajouté au PATH et
`pnpm_config_verify_deps_before_run=false`, sans modifier la configuration du dépôt.
Build : `VERCEL=1`, workers désactivés et `DATABASE_URL` factice locale inaccessible.
Aucun accès à la base réelle ni modification de `.env`.

Commande navigateur exécutée :

```sh
pnpm exec playwright test --config=playwright.navigation.config.ts
```

**Bloquée avant les scénarios :** Chromium installé sous `/workspace/patrimoine-browsers`,
mais le conteneur ne fournit pas `libglib-2.0.so.0` et d’autres bibliothèques requises.
Les 17 scénarios ont échoué au lancement du navigateur, pas sur des assertions UI.
La tentative de préparation d’un index APT local a également échoué sur les restrictions
setgroups/seteuid. Aucune élévation ni modification des permissions entreprise.

**Validation visuelle réelle, captures et Axe du nouveau rendu restent à effectuer.**
Ne pas assimiler le build réussi à une réception visuelle.

Les tests ajoutés utilisent des fixtures synthétiques uniquement : 1440/1024/768/375 px,
EUR/USD, clavier/périodes/tooltip, absence de refetch, portefeuille vide, données
incomplètes, immobilier, wallet, montants longs, snapshot en cours/erreur/succès.
Les suites de navigation/IA préexistantes sont conservées ; deux sélecteurs E2E historiques
ont été adaptés aux cartes et à la nouvelle rangée de KPI.

Pour reprendre dans un environnement avec Chromium et ses dépendances : construire
l’application, puis relancer la commande navigateur ci-dessus. Elle démarre un serveur
local sur 127.0.0.1:3002 et intercepte les données via fixtures, sans base de test.

Aucun push ni déploiement effectué.

## Répartition interactive (8 octobre 2026)

La variante dashboard du graphique Recharts se remplit en une seconde à l’ouverture,
depuis le haut. `isAnimationActive="auto"` respecte `prefers-reduced-motion` ; les transitions
CSS sont également désactivées avec cette préférence. Aucune nouvelle dépendance.

Survol : section mise en relief, catégorie et poids au centre, montant dans une infobulle.
Clic sur une section ou la légende : sélection persistante, montant EUR/USD et poids
par rapport au patrimoine, lien vers la catégorie (portefeuille pour les liquidités).
Un second clic, la croix ou Échap dans le graphique annule la sélection. Sections
accessibles avec Tab, Entrée et Espace ; focus visible, légende tactile, annonce du détail.
Un total inconnu ne devient jamais un pourcentage des seules valeurs connues.

La sélection reste locale au dashboard, sans requête ni écriture supplémentaire.
Le graphique interne des pages catégories conserve son comportement antérieur.


## Correctifs treemap et historiques (9 octobre 2026)

- La treemap utilisait des rectangles calculés sur 100 × 100 puis les rapportait à
  300 × 320 ; la référence DOM du `ResizeObserver` n'était pas attachée. Le calcul
  utilise maintenant les dimensions mesurées de la carte, y compris après redimensionnement
  et ouverture du détail. Surfaces proportionnelles, clavier et tactile conservés.
- Les détails de catégories ouvrent 30 jours, le dashboard ouvrait systématiquement 7 jours.
  Un historique de seed ancien peut donc être visible dans les détails mais masqué sur le
  dashboard. Reproduction navigateur avec les mêmes observations, situation avancée de
  14 jours ; aucun accès à la base personnelle pour établir cette reproduction.
- À l'ouverture, 7 jours restent prioritaires si au moins une série contient deux valeurs
  enregistrées. Sinon, le graphique principal choisit la première période disponible
  (30 j / 3 M / 1 A / Tout), les catégories partagent 30 j si disponible. Le sélecteur et
  une indication affichent explicitement la période retenue. Le choix manuel prime ensuite.
- Aucun décalage de dates, reconstruction depuis les positions actuelles ou traitement
  spécial des données de démonstration. Valeurs inconnues et jours manquants conservés.
  Les indicateurs de variation 7 j sont indépendants et restent indisponibles sans référence
  temporelle exacte. Si aucune période ne contient assez de relevés, l'état vide demeure.
- Changements frontend et helpers dashboard uniquement ; seed, API, migrations,
  snapshots, calculs de performance, données et autres pages inchangés.

Validation reproductible : `pnpm test:unit`, `pnpm lint`, `pnpm build`,
`pnpm exec playwright test --config=playwright.navigation.config.ts dashboard.spec.ts`.
Tests navigateur sur fixtures interceptées uniquement, base factice locale inaccessible,
workers désactivés. Le test de non-régression mesure aussi la surface réellement occupée
par les rectangles : un simple test de visibilité ne détectait pas la miniature.

Résultats exécutés : 247 tests unitaires, lint global et build Next production réussis
(TypeScript inclus). Chromium : 11 scénarios réussis sur le premier passage ; le dernier
scénario, dont l'assertion de visibilité ne tenait pas compte des tracés SVG horizontaux,
a réussi après correction du test et relance ciblée (12 scénarios validés au total).
Captures 1440/1024/768/375 px examinées en desktop/mobile, sans débordement et sans
violation Axe sur les quatre formats. Cas seed vieillie : courbes, sélection manuelle,
EUR/USD et détail de catégorie validés. Captures conservées hors Git dans
`/workspace/patrimoine-dashboard-fix-captures/`.

Limites : les dates des relevés de la seed de l'utilisateur n'ont pas été consultées ;
le cas historique hors période a été reproduit avec une fixture déterministe.
Trois outils MCP sont omis par la politique de cette session ; les vérifications ci-dessus
ont été exécutées via le terminal sandbox et Chromium local, sans ces outils.
Aucun commit, push, déploiement, modification de base ou de fichier d'environnement.


## Répartition sans panneau au survol (9 octobre 2026)

Le survol et le simple focus ne sélectionnent plus une catégorie et n'ouvrent plus
l'encadré sous la treemap. Le clic, le tap, Entrée et Espace ouvrent toujours les détails ;
Échap et la croix les ferment. Survoler une autre catégorie ne modifie pas une sélection
explicite. Aucun changement de géométrie ni de données.

Le signalement « courbes visibles uniquement sur 1 an / Tout » n'est pas reproduit avec
401 relevés quotidiens synthétiques jusqu'à la veille/heure du calcul : les tracés existent
sur toutes les périodes principales et sur 7 j / 30 j pour les catégories, en EUR et USD.
Ce contrôle valide le rendu frontend, pas les données ni la seed exécutée par l'utilisateur.
Date du dernier relevé et nature de l'état vide demandées ; filtres et seed inchangés,
aucun accès à la base réelle. La cause propre au signalement reste à confirmer.

Validation exécutée : 28 tests ciblés (dashboard, categories, snapshot-job), 13 scénarios
Chromium dashboard, ESLint global, formatage ciblé et build Next production (TypeScript
inclus). Commandes reproductibles :

```sh
pnpm exec vitest run tests/unit/dashboard.test.ts tests/unit/categories.test.ts tests/unit/snapshot-job.test.ts
pnpm lint
pnpm build
pnpm exec playwright test --config=playwright.navigation.config.ts dashboard.spec.ts
```

Même environnement local isolé que ci-dessus, sans base réelle et sans workers.
Logs `/workspace/patrimoine-hover-{build,lint,browser}.log` et
`/workspace/patrimoine-chart-targeted-unit.log`. Aucun commit, push ni déploiement.
