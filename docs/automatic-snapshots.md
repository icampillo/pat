# Historique automatique — 9 octobre 2026

## Architecture et décisions

Le code initial utilisait une contrainte nullable `(portfolioId, dailyKey)` seulement pour les captures quotidiennes. Les boutons, la commande CLI, les imports Bourse et changements de wallets produisaient aussi des captures sans clé. Le lecteur mélangeait ces points ; les catégories ajoutaient la valeur courante en mémoire.

Désormais :

- Le seul producteur de production est `createPortfolioSnapshots → runSnapshot → capture`, appelé par le cron existant. Pas de nouvelle infrastructure ni dépendance.
- Le job choisit le portefeuille principal (ancienneté puis UUID), comme `owned()`. L’application reste mono-portefeuille visible ; les portefeuilles supplémentaires ne sont **pas additionnés**.
- Jour comptable fixe : **Europe/Paris**. `capturedAt` reste un instant PostgreSQL `timestamptz` ; `referenceDay` est sa date Paris ISO. Les préférences utilisateur ou le navigateur ne changent pas la journée historique.
- Une contrainte SQL unique sur `(referenceOwnerId, referenceDay)` garantit une seule référence par utilisateur/jour, même lors d’écritures concurrentes sur plusieurs portefeuilles. Une vérification SQL lie aussi la date au timestamp.
- Lecture et insertion sous RepeatableRead ; jusqu’à trois tentatives en cas de conflit ou erreur transitoire de connexion. Aucune mise à jour des valeurs d’une capture existante.
- Une valorisation inconnue reste `null`, avec `incomplete: true` dans le log. Les détails figent les dernières observations connues et leur fraîcheur ; le job ne garantit pas un nouveau cours fournisseur.
- Les jours sans observation restent absents. Les graphiques insèrent seulement un séparateur null pour interrompre la ligne, jamais une valeur fictive. Les catégories n’ajoutent plus le point courant à l’historique.
- Le seeder synthétique reste disponible uniquement sur un portefeuille `isDemo`.

## Fichiers principaux

| Périmètre                            | Fichiers                                                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contraintes / migration              | `prisma/schema.prisma`, `prisma/migrations/20261009120000_automatic_snapshots/migration.sql`                                                                                          |
| Jour et lacunes                      | `src/domain/snapshot-day.ts`                                                                                                                                                          |
| Job, lecture et capture              | `src/server/jobs/portfolio-snapshot.ts`, `src/server/portfolio-query.ts`, `src/server/portfolio-store.ts`                                                                             |
| Suppression des captures utilisateur | `src/server/portfolio.ts`, `src/server/wallets.ts`, `src/server/securities-import.ts`, `src/app/api/v1/[...path]/route.ts`, suppression de `scripts/snapshot.ts` et du script package |
| Interface                            | headers dashboard/workspace, history-view, charts, category-page, asset-category-card                                                                                                 |
| Données / exports                    | `src/shared/types.ts`, `src/domain/categories.ts`, `src/server/exports.ts`                                                                                                            |
| Validation                           | tests unitaires du job et des dates ; tests PostgreSQL de concurrence/migration ; adaptation des tests d’import, wallets, catégories, immobilier et E2E                               |

## Migration sans perte

Exécuter d’abord [l’audit SQL en lecture seule](../scripts/audit-snapshots.sql) sur la base cible, puis examiner ses résultats et disposer d’une sauvegarde habituelle.

La migration :

1. Ajoute deux colonnes de référence, sans supprimer aucune ligne.
2. Retient par utilisateur/jour une capture avec au moins une valeur connue en priorité, puis DAILY en priorité, puis la plus récente ; l’UUID départage les égalités. Les captures INVALIDATED sont exclues.
3. Préserve **tous** les anciens montants, JSON, types, timestamps et `dailyKey`. Les captures non retenues restent archivées dans la même table, accessibles par GET individuel authentifié et export CSV/JSON.
4. Ajoute l’unicité utilisateur/jour, la cohérence des deux champs et la cohérence de date. Le CHECK imposant une référence aux nouveaux DAILY est NOT VALID pour tolérer les anciens DAILY non retenus ; il contrôle néanmoins les nouvelles écritures.

Ce choix constitue la correction non destructive des doublons pour les graphiques. Il ne fusionne pas des valeurs différentes et ne transforme pas les captures manuelles anciennes en prétendues captures automatiques. L’export CSV indique `reference_day` et `daily_reference`.

Déployer la migration **avant** le code : `pnpm db:deploy`, avec la connexion de migration Neon habituelle (`DIRECT_URL`, TLS). Éviter les écritures de l’ancienne version pendant cette bascule. Ne pas utiliser `db push` : la migration SQL réalise la sélection des références et les CHECK.

## Cron Vercel et reprise

Configuration conservée : `0 6 * * *`, GET `/api/cron/snapshot`, Node.js, dynamique, `maxDuration = 300`. Cela correspond à 07 h Paris en hiver et 08 h en été ; l’offre Hobby peut déclencher pendant l’heure programmée.

Le job a un budget d’ordonnancement de 180 secondes et des transactions de 30 secondes. Les propriétaires déjà traités sont filtrés avant pagination, pour qu’une relance progresse vers les suivants. Les compteurs sont ceux de l’invocation, pas un audit exhaustif des propriétaires ignorés.

Logs structurés : `started/completed/partial`, `captured` (identifiant et jour, indicateur d’incomplétude), `retry` (code Prisma, tentative), `failed` (portefeuille, jour, code sûr). Aucune exception brute ni donnée financière n’est loggée. HTTP 503 si échec ou temps insuffisant.

Selon [la documentation Vercel](https://vercel.com/docs/cron-jobs/manage-cron-jobs), **pas de retry automatique du cron échoué**. Les retries SQL bornés couvrent les incidents transitoires, pas une panne durable de Neon, un crash ou un timeout complet. L’opérateur peut relancer le job via Vercel le même jour ; les captures existantes sont ignorées. En environnement administré Node/Docker, `pnpm workers snapshot` exécute le même job. Aucune commande ne permet plus de créer une capture MANUAL. Une reprise le lendemain ne fabrique pas le jour manqué.

### Vérification réelle à effectuer sur la production

Aucun accès aux paramètres ni journaux du projet Vercel/Neon n’est disponible dans cette session. La configuration du dépôt et le build ne prouvent pas qu’un cron réel s’exécute.

Après migration et déploiement :

1. Vérifier le déploiement **Production**, Node 24 / Fluid Compute, le cron activé et la variable Production `CRON_SECRET` (sans la copier dans un ticket).
2. Constater une invocation planifiée avec `completed` / HTTP 200 et les jours Paris attendus. Une requête sans autorisation doit renvoyer 401.
3. Relancer le job deux fois le même jour : comparer les IDs, valeurs et nombres de références, qui doivent rester inchangés.
4. Confirmer l’absence de doublons de référence et vérifier les éventuels anciens doublons avec l’audit.
5. Vérifier l’alerte/journal en cas de 503, puis la reprise le même jour. Surveiller toute absence de passage ; aucune nouvelle infrastructure d’alerte n’est ajoutée ici.

Aucun déploiement, push, migration ni audit des données **de production** n’a été exécuté.

## Vérifications exécutées

- **219 tests unitaires, 28 fichiers : réussis.** Dates Paris, changements d’heure, relances, échecs isolés, budget du job et lacunes graphiques inclus.
- **72 tests d’intégration PostgreSQL, 9 fichiers : réussis.** Concurrence même portefeuille et même propriétaire entre portefeuilles ; immutabilité après relance/cotation ; suppression du POST ; cron authentifié exécuté deux fois ; préservation intégrale des données lors de la migration ; imports, catégories, immobilier et wallets.
- **Prisma validate, migrate deploy (deux fois), migrate diff --exit-code : réussis**, sur PostgreSQL éphémère isolé. Les contraintes personnalisées sont aussi exercées par le test SQL de migration.
- **TypeScript, ESLint et git diff --check : réussis**, sans avertissement ESLint.
- **Build Next.js 16.3.5 / Prisma 7.10, Node 24, VERCEL=1 : réussi**, y compris la route dynamique /api/cron/snapshot. URL de base factice inaccessible ; aucune migration au build.
- Tests E2E adaptés au déclenchement du cron de test et à l’absence du bouton, **non exécutés**. Aucune validation navigateur ou invocation Vercel réelle revendiquée.

Commandes du projet : `pnpm test:unit`, `pnpm test:integration`, `pnpm typecheck`, `pnpm lint`, `pnpm build`. Dans le sandbox, les CLI Node locales ont été utilisées directement pour unité/lint/TypeScript/build, car pnpm demandait une réinstallation du node_modules existant. Les dépendances du projet n’ont pas été modifiées.

La validation PostgreSQL a installé les dépendances depuis le lockfile et exécuté les commandes Prisma et `pnpm test:integration` dans un build Docker rootless dédié : `/projects/patrimoine-snapshot-validation/Dockerfile` et `validate.sh`. Le build vérifié est `agents-project/patrimoine-snapshot-validation:local`. Les premiers appels d’outil ont expiré pendant le build ; l’appel final a confirmé l’image et la couche de tests réussie en cache. Aucun conteneur applicatif persistant ni port supplémentaire n’a été lancé.
