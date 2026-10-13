# Audit et optimisation des lectures Neon — 13 octobre 2026

> **Suite terminée localement :** [phase 2 — snapshots, API par page et historiques](neon-performance-phase2.md). Les sections ci-dessous conservent le bilan de la première intervention ; la limite de 600 snapshots et les lectures JSON ont depuis été remplacées.

## Périmètre et résultat

Optimisation locale, sans commit, push, déploiement, modification du schéma ni accès à Neon production. Aucun calcul financier ni fonctionnement fournisseur Zerion modifié. Les données historiques restent intactes ; la refonte des snapshots est réservée à une deuxième intervention.

Les 4,3 Go mensuels, les 561 snapshots (~2,1 Mo de JSON) et les 6 observations (~79 Ko) sont des chiffres fournis par l’utilisateur, pas des mesures de cette intervention.

## 1. Causes confirmées par le code

| Déclencheur | Avant | Après |
| --- | --- | --- |
| Ouverture du workspace | Lecture complète, puis POST marché ; nouvelle lecture complète systématique à son achèvement, même sans changement ou après erreur | Lecture complète ; POST marché unique ; lecture `live` seulement si des taux/prix ont été écrits |
| Navigation, focus, visibilité | Cache navigateur de 60 s ; relecture complète si périmé | Cache conservé ; requêtes concurrentes mutualisées, y compris les demandes forcées |
| Mutation confirmée | `refresh(true)` complet, annulation de la lecture précédente | Invalidation sérialisée ; portée `live` pour wallets/configuration Zerion/cours, complète pour les autres mutations ; aperçu sans relecture |
| Wallet PENDING/SYNCING | Lecture complète forcée toutes les 5 s | GET statut uniquement ; relecture `live` lors d’une réussite, erreur terminale ou modification détectée |
| Actualisation périodique générale | 60 s sans wallet en cours, remplacée par le polling à 5 s pendant une synchronisation | Vérification générale à 60 s indépendante du timer de statut ; fraîcheur et visibilité contrôlées |
| Aperçu Bourse | `getState` complet, y compris captures inutilisées | Valorisation sans snapshots |

Une navigation avec un cache frais n’était **déjà pas** systématiquement une lecture SQL. Le layout n’appelle plus `getState` ; les chargements JS/RSC de routes ne sont pas des relectures du patrimoine.

La lecture coûteuse est `GET /api/v1/state` → `getState` → transaction RepeatableRead : actifs/prix, journal comptable, FX, catégories, plateformes, observations récentes des wallets et jusqu’à **600 JSON de snapshots**. Les snapshots sont ensuite projetés en agrégats : le JSON PostgreSQL transféré à Next peut donc être beaucoup plus volumineux que le HTTP envoyé au navigateur. `walletState` lit seulement la dernière observation valide par wallet, pas toute la table.

Le cache de 60 s était exclusivement en mémoire navigateur. `refresh(true)` le contournait après les mutations, après le marché à l’ouverture et toutes les 5 s durant une synchronisation. Plusieurs déclencheurs forcés pouvaient interrompre/redémarrer une lecture dont le travail SQL avait déjà commencé. Chaque onglet possède son propre cache.

Les routes de prix et exports peuvent aussi lire des historiques, mais ne sont pas appelées toutes les 5 s. Les crons Vercel sont quotidiens (marché 02:00, wallets 04:00, snapshots 06:00 UTC). L’authentification reste sollicitée par chaque requête privée.

### Hypothèses à confirmer en production

L’amplification par onglets multiples, une synchronisation longtemps bloquée, les ouvertures fréquentes, la durée des requêtes SQL et la répartition réelle des 4,3 Go restent à mesurer. Aucun de ces facteurs n’est présenté comme la cause exclusive de la facturation. La taille HTTP ne mesure **pas** le transfert public facturé par Neon.

## 2. Flux livré

- `GET /api/v1/wallets/status` : session obligatoire, portefeuille déterminé par son propriétaire, wallets non supprimés seulement. Trois lectures métier scalaires (portefeuille, configuration, connexions), en plus de l’authentification. Aucun snapshot, actif, transaction, observation JSON, adresse ou solde dans ce statut.
- `GET /api/v1/state?scope=live` : même transaction cohérente et mêmes calculs qu’avant, mais **aucune requête de snapshots**. Le navigateur conserve l’historique reçu précédemment. Cette portée recalcule encore les valeurs de tout le portefeuille ; elle n’est pas une projection crypto seule.
- Un timer de statut séquentiel : 5 s la première minute, 15 s jusqu’à cinq minutes, puis 30 s ; erreurs avec délai progressif borné à 60 s. Arrêt quand aucun wallet actif ne synchronise ; suspension dans les onglets masqués, reprise au retour. Aucun nouveau worker.
- PENDING → SYNCING met à jour le statut seulement. La terminaison, un nouveau `lastSuccessAt`, une activation ou un changement de liste déclenchent une lecture `live` mutualisée. Si elle échoue, la transition n’est pas acquittée et sera retentée ; les anciennes valeurs restent visibles.
- La demande manuelle marque explicitement PENDING pour déclencher ce suivi, même si le traitement n’a pas encore démarré. Cooldown, baux et idempotence existants restent en place.
- Les invalidations concurrentes sont regroupées. Une réponse antérieure à une écriture n’est jamais publiée ; une lecture supplémentaire est lancée seulement si nécessaire. Déconnexion/démontage annulent et invalident les réponses tardives ; un 401 vide l’état privé.
- Les lectures silencieuses conservent contenu, filtres et historique. Ni dépendance ajoutée, ni cache partagé entre utilisateurs, ni stockage persistant navigateur. Les réponses restent `private, no-store`.

## 3. Instrumentation développement

```sh
PATRIMOINE_PERF=1 pnpm dev
```

Active uniquement lorsque `NODE_ENV=development` **et** `PATRIMOINE_PERF=1`. Aucun log de cette instrumentation en production, même si le drapeau est défini.

- HTTP : compteur, durée, taille du corps JSON non compressé. Routes autorisées state/full, state/live, wallets/status, market/refresh ; autres chemins regroupés sous `other`.
- Lectures : compteurs/durées `portfolio.full` et `portfolio.live`.
- Prisma : durée de chaque requête, famille de table, opération et empreinte SHA-256 tronquée pour repérer répétitions et requêtes lentes. Aucun SQL brut ni paramètre.
- Aucun payload, identifiant propriétaire, adresse wallet, URL complète, token ou chaîne de connexion journalisé. Compteurs par processus, réinitialisés au redémarrage ; instrumentation désactivée par défaut.

Comparer les traces d’un même parcours et trier les durées SQL pour identifier les empreintes coûteuses. La taille HTTP et les durées locales ne remplacent ni les métriques de transfert Neon ni un profilage SQL en production.

## 4. Mesures avant/après disponibles

Scénario Chromium identique à 1440 px et 375 px : ouverture, marché inchangé, wallet PENDING → SYNCING à 5 s → OK à 10 s, nouvelle valeur affichée automatiquement, observation jusqu’à 30 s. API simulées ; build d’origine comparé au build modifié.

| Mesure par scénario | Avant | Après |
| --- | ---: | ---: |
| Lectures complètes HTTP | 4 | 1 |
| Lectures `live` HTTP | 0 | 1 |
| Lectures statut HTTP | 0 | 2 |
| Total requêtes de lecture HTTP | 4 | 4 |
| Corps JSON cumulés | 7 193 octets | 3 947 octets |

**75 % de lectures complètes en moins**, et **45,1 % de JSON HTTP en moins** sur ce petit jeu synthétique. Le nombre total de requêtes HTTP reste identique dans ce scénario ; leur portée change. Après : 1 794 octets pour la lecture complète, 1 796 pour la lecture live et 357 pour les deux statuts. L’historique de cette fixture est vide : l’ajout de la date de succès explique pourquoi la réponse live est ici légèrement plus grande que la réponse initiale.

Côté SQL, les tests vérifient que statut et live ne lisent aucun snapshot ; le statut ne lit pas non plus actifs/journal. Sans changement de statut, le code passait théoriquement de 12 lectures complètes/minute à environ une revalidation complète/minute plus des statuts légers, puis moins de statuts si la synchronisation dure. Avec 2,1 Mo de JSON de snapshots, les 12 lectures représentent un ordre de grandeur de 25,2 Mo/minute de contenu relu, **pas une mesure réseau ou de facturation**.

Artefacts : `/workspace/neon-measure-baseline.log`, `/workspace/neon-finish-browser.json` (pièces jointes `http-fixture-metrics.json`), `/workspace/neon-finish-browser.log`. Aucune mesure comparative SQL chronométrée sur Neon.

## 5. Fichiers modifiés

- UI/store : `src/components/workspace/context.tsx`, `data-store.ts`, nouveau `wallet-polling.ts`.
- API/serveur : `src/app/api/v1/[...path]/route.ts`, `src/server/portfolio-query.ts`, `wallet-state.ts`, `wallets.ts`, `securities-import.ts`, `db.ts`, nouveau `performance.ts`.
- Contrat partagé : `src/shared/wallets.ts`.
- Tests unitaires : `workspace-api.test.ts`, `workspace-data-store.test.ts`, nouveaux `wallet-polling.test.ts`, `portfolio-read-scope.test.ts`, `performance.test.ts`.
- Tests navigateur : `workspace.spec.ts`, `market-opening.spec.ts`, `loading.spec.ts`, nouveau `wallet-polling.spec.ts`.
- Intégration : nouveau `tests/integration/wallet-read.test.ts`.
- Documentation : ce rapport, `navigation-performance.md`, `market-opening-refresh.md`, `implementation.md`.
- `next-env.d.ts` : chemins générés par le build Next, sans changement métier.

Les fichiers utilisateur préexistants `.astra/`, `docker/bourse-validation/`, `docker/zerion-validation/Dockerfile` et `patrimoine-local.dump` sont préservés. Aucun dump ni `.env` copié dans les projets de validation.

## 6. Vérifications exécutées

Bilan cumulé, sans présenter les relances ciblées comme de nouveaux scénarios :

- **300 tests unitaires réussis** : déduplication, annulation avant départ, réponses obsolètes, mutations concurrentes, reprise réseau, fin/arrêt du polling, onglet masqué, 401, historique conservé, absence des lectures SQL lourdes et instrumentation sans données privées.
- **55 tests d’intégration PostgreSQL réussis** : `wallet-read`, `wallets`, `portfolio`. Isolation propriétaire, valorisation identique, snapshot inchangé, synchronisation Zerion, mutations atomiques, idempotence et crons existants. Base jetable du build rootless `/projects/patrimoine-neon-validation` ; génération Prisma, validation du schéma et 13 migrations existantes appliquées uniquement à cette base. PostgreSQL arrêté à la fin ; aucun service persistant lancé.
- **36/38 scénarios navigateur validés cumulativement** : passage initial 35 réussis/3 échecs ; test manuel corrigé et les 3 scénarios wallet réussis à la relance. Sélecteurs adaptés aux actions dans le panneau dépliable et aux notifications actuelles ; aucune assertion de géométrie assouplie.
- **2 échecs visuels préexistants confirmés sur le build d’origine** : hauteur loader/dashboard, 1,625 px à 1440 px et 26,1875 px à 375 px pour une tolérance de 1 px. Conservés comme échecs, pas masqués. Captures/traces sous `/workspace/neon-audit-baseline-results` et `/workspace/neon-audit-browser-results`.
- **2 scénarios de mesure supplémentaires sur le build d’origine réussis** ; résultats comparés ci-dessus.
- Typecheck et build production Next/Webpack réussis ; ESLint sans erreur, avec un avertissement préexistant `_valueText` dans `src/domain/wallet-display.ts`.
- Le lanceur PGlite précédent échouait avec P1001 ; le lancement PostgreSQL natif dans le sandbox a été refusé par les permissions. Aucun contournement : les tests PostgreSQL ont été exécutés via l’outil rootless limité disponible `agents_ops.project_build`. Le contexte OpenClaw signale trois autres outils MCP omis par politique ; ils n’ont pas été utilisés.

### Commandes reproductibles

Depuis le projet, avec PostgreSQL de test dédié et les variables d’authentification de test :

```sh
pnpm test:unit
pnpm lint
pnpm typecheck
pnpm build
pnpm exec vitest run tests/integration/wallet-read.test.ts tests/integration/wallets.test.ts tests/integration/portfolio.test.ts --maxWorkers=1
pnpm exec playwright test --config=playwright.navigation.config.ts workspace.spec.ts market-opening.spec.ts wallet-polling.spec.ts loading.spec.ts
```

`DATABASE_URL_TEST` doit se terminer par `_test` ; le helper remplace aussi `DIRECT_URL`. Ne jamais utiliser Neon production. La suite navigateur utilise des API simulées, les workers désactivés et un build local.

Dans cet environnement, commandes effectives complémentaires : `node /workspace/patrimoine-neon-checks.cjs build`, `node /workspace/patrimoine-neon-finish-checks.cjs browser`, `node /workspace/patrimoine-neon-measure-baseline.cjs browser`, ainsi que l’outil `agents_ops.project_build({project:"patrimoine-neon-validation"})`. Les wrappers navigateur/build fixent des URL PostgreSQL factices inaccessibles et réutilisent Chromium déjà installé. Journaux : `/workspace/neon-audit-{unit,build,browser}.log`, `/workspace/neon-finish-{lint,typecheck,browser}.log`.

## 7. Étapes identifiées à la fin de la phase 1

1. Lecture des 600 snapshots : traitée dans la [phase 2](neon-performance-phase2.md), avec résumés additifs et projection transitoire.
2. Profiler après une mise en service autorisée : métriques Neon, SQL et nombres d’onglets/ouvertures, avant de choisir un cache serveur ou une projection crypto dédiée.
3. Corriger séparément les deux écarts de hauteur du loader/dashboard et l’avertissement de lint préexistant.

Aucune économie mensuelle en Go ou en euros ne peut être garantie à partir de ces seuls tests. Aucun déploiement n’a été exécuté.
