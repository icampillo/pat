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
