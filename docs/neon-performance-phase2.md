# Neon — phase 2 : snapshots, portées de lecture et historiques

Date : 13 octobre 2026. Suite de [l’audit initial](neon-performance.md).

## Résultat et périmètre

Travail local dans `/projects/patrimoine`, sans commit, push, déploiement ni accès Neon production. Les changements de la phase 1 et les fichiers utilisateur préexistants sont conservés. Aucune dépendance ajoutée.

Les lectures ordinaires ne transfèrent plus les JSON complets des snapshots. Une colonne nullable `summary` contient une projection versionnée, ajoutée sans toucher aux captures originales. Les anciennes captures sans résumé restent lisibles **après la migration de schéma**, grâce à une projection SQL ciblée ; aucune reprise automatique pendant une requête HTTP.

Sur le même jeu synthétique, la lecture complète reçoit **26 533 645 → 317 324 octets de trames PostgreSQL DataRow (−98,80 %)**, pour les mêmes valeurs et points historiques. Ce n’est ni le volume des fichiers PostgreSQL, ni le trafic TLS/TCP total, ni une mesure de transfert facturé par Neon.

## 1. Architecture snapshots

### Décision

Conserver `PortfolioSnapshot.data`, les en-têtes décimaux, les références quotidiennes et les dates existantes. Ajouter `summary JSONB NULL`, version 1 :

- sommes EUR/USD par couple **identifiant et clé de catégorie enregistrés dans la capture** ;
- valeurs on-chain déjà valorisées au moment de la capture ;
- valeurs des liquidités ;
- propagation des valeurs inconnues et distinction entre historique absent et valeur nulle.

`capture()` écrit le JSON complet et le résumé dans **la même transaction RepeatableRead**. Un doublon quotidien retourne la capture existante, sans modifier ses valeurs. Le job automatique, ses verrous, retries et règles de jour Europe/Paris ne changent pas.

`getState()` lit les petits résumés et les colonnes utiles aux courbes, sans `data`. Si le résumé est absent ou sa version n’est pas reconnue, PostgreSQL extrait uniquement catégories, quantités et valeurs sauvegardées, liquidités et totaux on-chain. Les positions wallets, prix détaillés, métadonnées d’actifs et flux sont exclus de cette projection. Le résumé historique nul est calculé côté Node uniquement pendant cette transition.

**Limite transitoire :** la projection évite le transfert des JSON complets, mais PostgreSQL doit encore lire/décompresser leur contenu. Le backfill enlève ce travail répété. Le SQL ne calcule pas les sommes en flottants : le calcul historique partagé conserve les conversions numériques, sommes décimales et arrondis de l’ancien lecteur.

### Cohérence historique

Aucun recalcul à partir des quantités, cours, taux ou composition actuels. Renommer une catégorie, reclasser un actif ou changer le FX courant ne réécrit pas le passé. Les anciennes catégories `POKEMON` et `ONE_PIECE` continuent à être regroupées dans `OTHER`, comme avant cette intervention. Les groupes source sont conservés dans le résumé, plutôt que de figer ce reclassement lors de la reprise.

Les catégories actuellement affichables déterminent toujours les courbes présentées. Les JSON complets gardent les détails et anciennes catégories, même si celles-ci ne sont plus proposées par l’interface.

### Détail et exports

`GET /snapshots/:id`, l’historique CSV et l’export JSON restent complets et protégés par la session/propriété. Ces parcours explicites peuvent toujours lire de gros volumes : c’est nécessaire à leur fonction. Aucun snapshot ni relevé d’origine n’est supprimé. Les lectures ordinaires restent sans effet d’écriture.

## 2. API progressive et cache

Le contrat `/api/v1/state` est conservé ; pas de refonte en dizaines d’endpoints indépendants.

| Portée | Contenu | Données exclues de PostgreSQL |
| --- | --- | --- |
| `full` (défaut) | Valorisation, journal, catégories, comptes, dernières positions wallets, références quotidiennes résumées | Anciens JSON de snapshots complets, anciennes observations wallets et cours inutiles |
| `live` | Même valorisation, sans historique de snapshots ; acquis phase 1 | Toute lecture de snapshots |
| `settings` | Portefeuille, taux, comptes d’import, configuration et statuts wallets scalaires | Valorisation, journal, snapshots, positions wallets, métadonnées complètes |
| `wallets` | Portefeuille, taux, configuration et dernières positions wallets | Actifs et journal comptable, snapshots, observations wallets anciennes |

Les comptes d’import des paramètres sont obtenus par projection SQL `platform/accountId`, et l’indicateur de données personnelles par `EXISTS`. Aucun JSON d’actif complet n’est renvoyé par ces requêtes. L’ouverture conserve le mécanisme existant de rafraîchissement du marché ; il peut consulter les instruments pour vérifier leur fraîcheur, mais ne déclenche plus de lecture patrimoniale globale depuis une page à portée limitée.

Les réponses restent `private, no-store`. Chaque lecture de page utilise son propre instant et **une transaction RepeatableRead**, avec un portefeuille déterminé par la session. Pas de cache serveur partagé entre utilisateurs. Les protections d’origine, d’idempotence et de version des mutations n’ont pas été modifiées.

### Navigation et invalidation

- Un seul store mémoire par workspace/session, fraîcheur 60 s, requêtes concurrentes mutualisées, réponses antérieures à une mutation ignorées.
- Un état complet frais sert aussi les pages paramètres/wallets : navigation sans nouvelle lecture métier.
- Un chargement direct des paramètres ou wallets demande seulement sa portée. Une navigation financière charge un état complet si nécessaire.
- Après une mutation ou actualisation limitée, la réponse remplace l’état partiel ; on ne mélange pas les valeurs provenant de transactions serveur différentes. Au retour au dashboard, l’état complet est rechargé si sa couverture a été perdue.
- Une navigation pendant une requête partielle vérifie la couverture à son achèvement : aucun écran bloqué après une réponse devenue trop étroite. Naviguer pendant une lecture complète ne la duplique pas.
- Polling scalaire et rafraîchissement `live` de la phase 1 restent en place ; depuis une page limitée, l’invalidation recharge cette portée seulement.

**Compromis explicite :** pas de cache indépendant par endpoint avec réconciliation de versions. Passer entre deux états partiels complémentaires peut demander une nouvelle lecture. Un état complet déjà disponible couvre toutes les pages tant qu’il reste frais ; un état invalidé ne prétend pas être réutilisable instantanément.

## 3. Historiques et granularité

| Historique | Stratégie |
| --- | --- |
| Patrimoine et catégories | Toutes les références quotidiennes réelles, sous forme de petits agrégats. Plus de troncature à 600 jours. Filtrage local 7j/30j/90j/1an/Tout, sans nouveau SQL à chaque changement de période. |
| Prix individuels | Chargement à l’ouverture, 50 observations par page, requête limitée à 51 lignes pour déterminer la suivante. Curseur `(observedAt, id)` stable, même avec dates identiques. Possibilité de consulter toutes les observations, sans ancienne limite de 500. |
| Wallet individuel | Chargement à l’ouverture de sa courbe ; SQL `DISTINCT ON` garde le dernier relevé **réel** de chaque jour Europe/Paris. Seulement date et total USD, aucun JSON de positions. Les relevés invalidés/futurs sont exclus ; les originaux sont conservés. |

Aucun lissage financier, interpolation, moyenne de remplacement ni conversion historique au FX courant. La courbe wallet annonce explicitement ses montants USD. Le changement de période et la fermeture/réouverture réutilisent l’historique en mémoire du composant ; une nouvelle réussite de synchronisation invalide ce composant via `lastSuccessAt`. Les ruptures de jours restent des lacunes, pas des montants fabriqués.

La granularité quotidienne des snapshots est déjà celle des références financières : les sous-échantillonner risquerait de changer les variations ou masquer un point significatif. Une période courte ne déclenche donc pas une seconde requête SQL : on privilégie les petits résumés réutilisables et le changement de période instantané. Coût restant linéaire avec le nombre de jours ; pagination/chargement par plages à envisager seulement si plusieurs décennies de résumés deviennent un problème mesuré.

## 4. Requêtes Prisma/PostgreSQL

Trois lectures sont remplacées par des sondages `LATERAL` groupés, une requête SQL par famille, **pas un aller-retour réseau par actif/wallet** :

1. Dernier prix réel par actif à la date de valorisation : `LIMIT 1` exécuté dans PostgreSQL.
2. Dernière observation valide par wallet : `LIMIT 1` exécuté dans PostgreSQL. Avec Prisma installé, un `take: 1` relationnel ne suffisait pas à borner les lignes transférées.
3. Références de variation 30j : au plus deux observations réelles par actif, immédiatement avant/après la cible, avec les mêmes contraintes de dates et règles de départage qu’avant. L’ancien `distinct: ['assetId']` dédupliquait après transfert.

Sur la fixture : **11 066 → 677 lignes DataRow** pour une lecture complète. La valorisation, les lignes, variations, totaux, wallets et snapshots sont comparés à l’ancien lecteur.

Après `ANALYZE` des tables synthétiques, `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` confirme :

- dernier cours : `Limit → Index Scan`, 1 ligne par actif, 12 résultats ;
- dernier wallet : `Limit → Index Scan`, 1 ligne par wallet, 3 résultats ;
- références 30j : 24 résultats ; index existant, tri incrémental limité du côté ascendant ;
- index utilisés : `PriceHistory_assetId_observedAt_createdAt_idx` et `WalletObservation_walletId_fetchedAt_idx`.

**Aucun index ajouté.** Les sélections externes sur les petites tables utilisent parfois un parcours séquentiel choisi par PostgreSQL ; ce n’est pas un N+1 réseau. Avant mise à jour des statistiques de la fixture, PostgreSQL choisissait davantage de tris/bitmap scans : aucun index artificiel n’a été ajouté pour compenser des statistiques absentes.

### Lectures volontairement conservées

Le journal actif reste nécessaire au replay qui calcule quantités, coût, cash et flux. Le déplacer vers des agrégations SQL approximatives ou un cache de soldes constituerait une modification comptable plus large. Dashboard, pages d’actifs, catégories et activité continuent à partager l’état complet pour garder leurs interactions immédiates. Les positions wallets récentes restent détaillées dans cet état, notamment pour l’analyse et la répartition ; un résumé wallet supplémentaire n’a pas été introduit sans nouveau modèle de cohérence justifié.

Les exports complets et la consultation explicite des captures ne sont pas optimisés en supprimant des détails attendus. Le coût SQL de l’authentification n’est pas changé.

## 5. Mesures reproductibles, sans confusion de volumes

PostgreSQL isolé, Node 24, même propriétaire synthétique : 12 actifs, 5 040 prix, 3 wallets, 360 observations, 600 snapshots ; JSON source sérialisé de 35 850 octets par snapshot. Aucun compte/dump utilisateur. Cinq lectures après échauffement par scénario ; médiane et intervalle min/max. Les données de benchmark sont créées uniquement après vérification d’une base dédiée suffixée `_test`.

La baseline contient **le code à la fin de la phase 1**, pas un commit plus ancien. Les copies `portfolio-query-before.ts` et `wallet-state-before.ts` sont uniquement dans le projet de validation ; la version initiale est également conservée sous `/workspace/neon-phase2-baseline-{query,wallet}.ts`.

| Lecture | Instructions SQL¹ | Lignes DataRow | Octets DataRow² | Corps JSON HTTP³ | Médiane (min–max), ms⁴ |
| --- | ---: | ---: | ---: | ---: | ---: |
| Avant, complète | 20 | 11 066 | 26 533 645 | 447 578 | 227,34 (222,18–236,91) |
| Après, projection sans reprise | 19 | 677 | 1 277 924 | 447 578 | 119,90 (118,27–126,16) |
| Après, résumés repris | 19 | 677 | 317 324 | 447 578 | 23,52 (22,03–28,11) |
| Après, Paramètres | 10 | 8 | 690 | 1 165 | 3,41 (3,32–3,86) |
| Après, Wallets | 9 | 9 | 14 809 | 14 220 | 3,67 (3,48–4,84) |

1. Nombre d’appels SQL du pilote, **y compris BEGIN/isolation/COMMIT**, hors authentification et hors rafraîchissement du marché séparé. Avant, une page simple demandait elle aussi la lecture complète.
2. Compte les champs reçus par `pg.Query.handleDataRow`, avec le cadrage DataRow (7 octets + 4 octets par champ + octets UTF-8/binaires). Mesure des résultats réellement retournés au pilote, plus fidèle qu’une somme de tailles JSON stockées. Exclut descriptions de colonnes, commandes, requêtes émises, handshake, TLS, TCP, connexions et règles de facturation Neon.
3. Taille UTF-8 de l’enveloppe JSON sérialisée par le contrat HTTP, **non compressée**, mesurée dans le test du lecteur ; pas une capture réseau du serveur HTTP réel avec PostgreSQL. Les tests navigateur séparés interceptent les API et vérifient le contrat rendu.
4. Temps de lecture serveur et sérialisation locale après échauffement, **pas un temps de chargement Vercel/Neon ni un LCP**. Les valeurs dépendent du matériel, des données et du cache PostgreSQL ; aucune extrapolation mensuelle.

Gains mesurés : −95,18 % de DataRow avant reprise ; −98,80 % après. Médiane complète environ −89,65 %. Le corps HTTP complet est volontairement **identique** : l’ancienne implémentation compactait déjà les gros snapshots après les avoir reçus. Les portées Paramètres et Wallets réduisent aussi le HTTP de 99,74 % et 96,82 % par rapport au chargement complet de ce jeu.

Les comparaisons EUR/USD couvrent les courbes globales 7j/30j/90j/1an/Tout, les détails de toutes les catégories et les variations 7/30j. Données manquantes et catégories retirées sont couvertes séparément. Au-delà de 600 jours, « Tout » contient désormais davantage de **vrais** points, ce qui est une extension explicitement testée, pas une modification de valeur.

Artefacts : [métriques JSON](neon-phase2-metrics.json), `tests/performance/neon.test.ts`, `/workspace/neon-phase2-integration.log` (plans), `/workspace/neon-phase2-browser.log` et captures/traces sous `/workspace/neon-phase2-browser-results`.

## 6. Migration additive et reprise

Migration : `prisma/migrations/20261013180000_snapshot_summary/migration.sql`.

```sql
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "summary" JSONB;
```

Elle n’ajoute ni défaut, ni suppression, ni index ; ne réécrit pas les références, en-têtes ou `data`. Une brève acquisition du verrou DDL reste nécessaire.

**Production non migrée.** Ordre de mise en service, uniquement après autorisation de l’opérateur :

1. Vérifier la base cible et l’état des migrations antérieures ; disposer de la sauvegarde habituelle. `db:deploy` applique toutes les migrations en attente, pas seulement celle-ci.
2. Appliquer la migration **avant** le code qui sélectionne `summary`, puis générer le client Prisma/build. L’ancienne version fonctionne avec cette colonne supplémentaire ; rollback applicatif possible en la laissant présente.
3. Vérifier que les nouvelles captures contiennent un résumé et que les anciennes sont lisibles via la projection. Le backfill n’est pas un prérequis au bon calcul.
4. Lancer la reprise explicite, après validation de la base :

```sh
pnpm exec tsx scripts/backfill-snapshot-summaries.ts --apply --batch=100
```

Le script refuse de travailler sans `--apply`. Taille de lot validée entre 1 et 500. Il projette uniquement les champs utiles, écrit `summary` seulement s’il est encore SQL NULL, et affiche uniquement les compteurs. Reprise relançable après interruption ; pas de modification d’un résumé existant ni des données d’origine. Pas de transaction longue sur toute la table. Pour une grande base, ajuster la taille/charge hors pic ; la recherche des résumés manquants peut rescanner la table, aucun index permanent ajouté pour cette opération ponctuelle.

Contrôle SQL en lecture seule, sur la base choisie par l’opérateur :

```sql
SELECT count(*) AS captures,
       count(*) FILTER (WHERE summary IS NULL) AS a_reprendre,
       count(*) FILTER (WHERE summary->>'version' = '1') AS resumes_v1
FROM "PortfolioSnapshot";
```

Ne pas utiliser `db push`, ne pas supprimer la colonne pour revenir à l’ancienne application. Aucune de ces commandes n’a été exécutée en production.

## 7. Validation

- **315 tests unitaires réussis** : résumés équivalents à l’ancien lecteur, nulls, précision, catégories historiques, portées, concurrence, invalidation, session/polling.
- **109 tests d’intégration PostgreSQL validés cumulativement** : suite complète de 107 tests, puis suite ciblée de 7 dont 2 nouveaux (pas 114 tests distincts). Imports CSV/PDF, Bourse, immobilier, inventaires, transactions, marchés, Zerion, isolation et snapshots existants ; nouveaux tests de backfill relançable, données/export inchangés, reclassement/FX, pagination stable et propriétaire, références >600 jours, relevés wallets/jours DST.
- **1 benchmark comparatif PostgreSQL réussi**, assertions d’équivalence des valeurs et courbes ; cinq échantillons par scénario, plans examinés.
- Génération Prisma, validation du schéma et migrations appliquées sur base jetable ; second `migrate deploy` sans migration restante.
- TypeScript, ESLint et build Next production/Webpack exécutés. ESLint : 0 erreur, 1 avertissement préexistant `_valueText` dans `src/domain/wallet-display.ts`.
- **75/77 scénarios navigateur validés cumulativement** : les 37 scénarios dashboard réussis au premier passage, puis 38/40 scénarios de navigation, chargement, marché, polling et historiques validés après les corrections et la relance ciblée. Aucun test répété n’est compté deux fois.
- **2 échecs visuels préexistants conservés** : hauteur du skeleton/dashboard, écart de 1,625 px à 1440 px et de 26,1875 px à 375 px pour une tolérance de 1 px. Les mêmes écarts ont été reproduits avant cette phase (`/workspace/neon-audit-baseline-browser.log`). Aucune tolérance assouplie, aucun test ignoré et aucun changement de design dans cette intervention.
- Dernière reprise : TypeScript, ESLint, Prettier ciblé et `git diff --check` réussis ; l’avertissement ESLint préexistant reste présent. Aucun changement de code applicatif après le build Next réussi de 12:20 UTC.

### Bilan des corrections navigateur

L’en-tête partagé `PageHeading` ne consomme que les notifications, mais exigeait encore l’état financier complet. Il utilise désormais `useWorkspace('base')`, comme le shell. Les ouvertures directes de Paramètres et Wallets, les enregistrements et les synchronisations fonctionnent avec leurs réponses limitées. Les autres consommateurs du contexte ont été vérifiés.

Le scénario d’historique wallet avait deux sélecteurs incorrects : le contrôle de période est maintenant ciblé par son rôle `combobox` et son nom accessible, et le parcours utilise la barre latérale entière, puisque Paramètres se trouve hors du bloc « Navigation principale ». La relance des deux scénarios `scoped-history.spec.ts` réussit : cinq périodes wallet sans relecture, fermeture/réouverture sans relecture, passages Paramètres → Wallets → Dashboard puis navigation à état complet réutilisé, prix chargés à l’ouverture et pagination 50 → 52 lignes. Aucune assertion métier retirée.

Journaux de clôture : `/workspace/neon-phase2-recheck.log` (37 réussis, 3 échecs avant correction des sélecteurs), `/workspace/neon-phase2-history.log` (2/2 après correction), `/workspace/neon-phase2-final-{typecheck,lint}.log`. Captures et traces des écarts inchangés sous `/workspace/neon-phase2-recheck-results`. Le serveur Playwright est arrêté en fin d’exécution.

Le premier essai des tests complémentaires a signalé une fixture d’actif sans `symbol` obligatoire ; corrigée, puis tests et build relancés avec succès. Le banc de mesure avait aussi une annotation `this` TypeScript manquante, corrigée avant mesures retenues. Aucun de ces essais échoués n’est présenté comme réussi.

Commandes reproductibles, depuis le projet et avec un PostgreSQL de test dédié :

```sh
pnpm test:unit
pnpm lint
pnpm typecheck
pnpm build
pnpm test:integration
pnpm exec playwright test --config=playwright.navigation.config.ts \
  workspace.spec.ts market-opening.spec.ts wallet-polling.spec.ts loading.spec.ts \
  dashboard.spec.ts scoped-history.spec.ts
# Benchmark : chemin vers la copie du lecteur avant changements, dans la copie de validation.
PATRIMOINE_BASELINE_QUERY=/app/src/server/portfolio-query-before.ts \
  pnpm exec vitest run tests/performance/neon.test.ts --maxWorkers=1
```

Exécutions effectives dans cet environnement : CLIs Node du projet, wrappers `/workspace/patrimoine-neon-phase2-checks.cjs`, outil limité `agents_ops.project_build` sur `/projects/patrimoine-neon-phase2-validation`. PostgreSQL s’arrête par `trap` en fin de validation ; aucun service persistant lancé. Le build et le navigateur local utilisent des connexions PostgreSQL factices inaccessibles et des API synthétiques. Trois outils MCP sont signalés omis par la politique de l’environnement ; les outils rootless disponibles ont effectivement exécuté les tests SQL. Aucun accès hôte direct ni élévation de permissions.

## 8. Fichiers de cette phase

| Groupe | Fichiers |
| --- | --- |
| Stockage/reprise | `prisma/schema.prisma`, `prisma/migrations/20261013180000_snapshot_summary/migration.sql`, `scripts/backfill-snapshot-summaries.ts` |
| Lecteurs serveur | `src/domain/snapshot-summary.ts`, `src/server/snapshot-history.ts`, `src/server/portfolio-query.ts`, `src/server/wallet-state.ts`, `src/server/page-state.ts`, `src/server/detail-history.ts` |
| Contrat/API | `src/shared/types.ts`, `src/app/api/v1/[...path]/route.ts` |
| Store/navigation | `src/components/workspace/data-store.ts`, `context.tsx`, `shell.tsx`, `page-heading.tsx` ; `src/app/(private)/settings/page.tsx`, `wallets/page.tsx` |
| Pages/détails | `src/components/pages/settings.tsx`, `wallets.tsx` ; `src/components/assets/price-history.tsx` ; `src/components/wallets/history.tsx`, `connection-card.tsx`, `page.tsx`, `positions.tsx`, `zerion-settings.tsx` |
| Tests unitaires/SQL | `tests/unit/snapshot-summary.test.ts`, `portfolio-read-scope.test.ts`, `workspace-data-store.test.ts` ; `tests/integration/snapshot-read.test.ts`, `wallet-read.test.ts` ; `tests/performance/neon.test.ts` |
| Tests navigateur/fixtures | `tests/fixtures/workspace.ts` ; `tests/navigation/workspace.spec.ts`, `loading.spec.ts`, `wallet-polling.spec.ts`, `application-design.spec.ts`, `scoped-history.spec.ts` |
| Documentation | ce rapport, `docs/neon-phase2-metrics.json`, `neon-performance.md`, `implementation.md`, `navigation-performance.md`, `automatic-snapshots.md` |

Les autres modifications locales de phase 1 restent présentes, notamment l’instrumentation, `wallet-polling.ts`, tests/API/polling, commande de synchronisation et aperçu Bourse. `next-env.d.ts` est généré par Next. `.astra/`, `patrimoine-local.dump` et les anciens dossiers de validation utilisateur sont préservés. Aucun fichier de données privées n’est ajouté à la documentation ou à Git.

## 9. Limites restantes

- Aucune mesure Neon/Vercel réelle, pas d’économie mensuelle ou de facture garantie. Mesurer après une mise en service autorisée avec des parcours comparables.
- Les résumés allègent fortement le transfert, pas nécessairement la taille physique de stockage : les originaux sont volontairement gardés, et une colonne s’ajoute.
- Sans backfill, la projection historique coûte encore du CPU/TOAST PostgreSQL. Le code exige que la migration de schéma ait été appliquée avant lui.
- Lecture globale encore nécessaire aux pages financières ; journal comptable et positions wallets récents peuvent dominer le coût résiduel selon les données.
- Références quotidiennes et courbe wallet chargées intégralement sous forme compacte, puis filtrées en mémoire. Pas de réduction arbitraire des points ni de faux gain revendiqué pour un changement de période.
- Pagination des prix cohérente par requête, pas un export figé transactionnel à travers plusieurs clics si des observations sont ajoutées simultanément ; l’export complet reste disponible.
- Le contrat HTTP des prix passe d’un tableau à `{ items, nextCursor }` : consommateur interne et fixtures adaptés ; tout client externe éventuel doit l’être aussi.
- Les données restent privées et tous les accès propriétaires, mais les tests navigateur utilisent des API simulées, pas une session réelle contre Neon.
