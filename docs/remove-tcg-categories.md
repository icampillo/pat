# Retrait des catégories TCG — 12 octobre 2026

Les catégories Pokémon et One Piece ont été retirées du provisionnement, du formulaire et du fournisseur de prix. Les seeds et fixtures ne créent plus de cartes. Les anciennes routes affichent « Page introuvable » après migration.

## Base existante

Avant de démarrer la nouvelle version, appliquer les migrations dans l’environnement cible :

```sh
pnpm db:deploy
pnpm build
```

`20261012160000_remove_tcg_categories` est atomique et réexécutable sans changement supplémentaire. Elle réutilise (ou crée) OTHER dans chaque portefeuille concerné, reclasse les actifs, incrémente leurs versions et celle du portefeuille, puis supprime les deux catégories. Aucun actif, prix, transaction, image ou snapshot n’est supprimé. Les autres portefeuilles restent inchangés.

Les anciens champs de métadonnées restent acceptés pour permettre l’édition des fiches reclassées sans perte. Les snapshots sont immuables : leur lecteur regroupe les anciennes valorisations TCG sous OTHER sans modifier les valeurs enregistrées. Les sauvegardes et exports historiques ne sont pas purgés.

## Vérifications exécutées

- 278 tests unitaires réussis, dont le regroupement EUR/USD des snapshots historiques et les prix inconnus.
- Deux tests d’intégration réussis sur PostgreSQL embarqué PGlite éphémère : migration avec plusieurs portefeuilles, OTHER absent/existant, conservation des données, versions et réexécution ; création d’un nouveau compte avec exactement cinq catégories.
- TypeScript, ESLint (zéro erreur, un avertissement préexistant dans `wallet-display.ts`), Prettier ciblé et `git diff --check` réussis.
- Build Next.js production webpack réussi avec URL de base factice et aucun appel fournisseur.
- Un scénario Chromium réussi : cinq choix, absence de champs TCG et de liens, anciennes routes introuvables.

Commandes reproductibles, avec une `DATABASE_URL_TEST` PostgreSQL dédiée dont le nom se termine par `_test` :

```sh
pnpm test:unit
pnpm exec vitest run tests/integration/remove-tcg-migration.test.ts tests/integration/categories.test.ts --maxWorkers=1
pnpm typecheck
pnpm lint
pnpm build
pnpm exec playwright test --config=playwright.navigation.config.ts removed-categories.spec.ts
```

Dans ce sandbox, pnpm n’est pas dans le PATH : les CLI installées ont été lancées avec Node via les scripts locaux de validation. Journaux : `/workspace/remove-tcg-{unit,integration,lint,build,browser}.log`. La configuration MCP signale trois outils omis par politique ; les vérifications ci-dessus ont été exécutées par le terminal sandbox, pas via MCP.

Aucune base réelle, variable d’environnement du projet, sauvegarde ou publication n’a été modifiée. Migration de production et déploiement non exécutés. Les modifications concurrentes du début de `prisma/seed.ts` (réutilisation du compte de démonstration) ont été préservées ; seule la suppression des deux exemples TCG et le compteur de six actifs relèvent de cette demande.
