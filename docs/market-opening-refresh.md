# Actualisation du marché à l’ouverture

## Architecture et intégration

Avant : le layout privé montait `WorkspaceProvider`, qui lisait `/api/v1/state`. Les services `syncMarketData` (métaux/BCE et Bourse en parallèle) et `syncSecuritiesPrices` étaient utilisés par les boutons, le cron et les scripts. Les verrous de portefeuille protégeaient les écritures, pas les appels externes. La seule protection des cours était leur date d’insertion récente (60 secondes), ce qui ne couvrait ni les échecs ni les cours inchangés. Les textes « toutes les 15 minutes » ne correspondaient plus aux crons quotidiens.

Maintenant :

1. La lecture d’état existante reste une lecture de base sans appel fournisseur. Le dashboard affiche ses dernières valeurs dès sa réception.
2. Le provider du layout persistant lance séparément `POST /api/v1/market/refresh`, après le premier affichage des données. Le store conserve une seule promesse par ouverture, y compris lors du rejeu des effets React Strict Mode. Navigation, focus et timers de lecture ne relancent pas le marché ; un rechargement complet constitue une nouvelle ouverture.
3. L’endpoint authentifié et protégé par contrôle d’origine attend le service existant dans la requête HTTP indépendante (`runtime=nodejs`, `maxDuration=300`). Pas de travail détaché non garanti par Vercel, pas de timer serveur, pas de nouveau worker ni dépendance.
4. À la fin, même après un échec partiel, `store.refresh(true)` recharge `/api/v1/state`. Les anciennes données restent affichées pendant cette lecture. Aucun rechargement de page, blocage des actions ou snapshot.

## Cache et concurrence PostgreSQL

La migration additive `20261009160000_market_quote_cache` crée uniquement `MarketQuoteCache`. Elle ne modifie ni prix, ni taux, ni snapshots existants.

Une clé par cotation publique (`yahoo:<ticker>`, `gold-api:GOLD`, `gold-api:SILVER`, `ecb:EURUSD`) partage les tentatives et les résultats entre tous les utilisateurs et toutes les instances. Aucun identifiant utilisateur, wallet ou secret n’y est enregistré.

- L’UPSERT SQL atomique utilise l’horloge PostgreSQL pour refuser une nouvelle tentative avant cinq minutes, succès ou échec. Les dates des cotations ne pilotent plus ce cooldown.
- Un bail de 60 secondes couvre les deux tentatives HTTP bornées du client fournisseur existant. Son jeton protège la publication contre les résultats tardifs. Aucun verrou ni transaction SQL ne reste ouvert pendant le réseau ; compatible avec le pool PostgreSQL de Neon.
- Les appels concurrents attendent le résultat partagé par lectures SQL espacées d’une seconde, au plus 60 fois. Ils peuvent ensuite l’appliquer à leur propre portefeuille. Une Function interrompue conserve le cooldown ; son bail expiré permet une reprise à la prochaine invocation éligible.
- Un échec conserve la donnée du cache et les historiques de prix. Les lecteurs du cache en échec signalent une indisponibilité plutôt que d’inventer une nouvelle cotation. Les anciens prix et leurs dates restent visibles ; une notification non bloquante signale l’échec à l’ouverture.
- Le fixing BCE déjà enregistré pour aujourd’hui reste réutilisé sans appel externe. Sinon, la BCE partage elle aussi le cooldown, y compris pour l’initialisation FX des wallets. Les métaux sont demandés uniquement s’ils sont configurés ; les titres restent groupés par ticker, avec quatre lectures simultanées au maximum.
- Les transactions courtes et verrous de portefeuille existants empêchent les doublons d’observation lors de l’application du résultat. Le cron, les scripts et les deux boutons de rafraîchissement utilisent ce cache partagé. Les prévisualisations d’import Bourse conservent leur parcours de vérification distinct.

Le cooldown est **par cotation**, pas un blocage global : une nouvelle position d’un autre utilisateur peut obtenir son premier cours sans attendre une synchronisation sans rapport. Le cache ne transforme pas les cours différés ou le fixing BCE quotidien en données temps réel.

Les limites de lots existantes restent inchangées (100 portefeuilles pour les métaux, 500 actifs Bourse, budgets de traitement bornés). Un résultat partiel est signalé, sans boucle automatique de relance. Cette modification ne change pas la politique de pagination des très grands portefeuilles.

## Mise en service ultérieure — non exécutée

Appliquer `pnpm db:deploy` via la connexion de migration Neon habituelle **avant** de mettre le nouveau code en service. Générer le client avec `pnpm db:generate` (également exécuté par le build). La table de cache sera vide au départ ; la première demande la remplira. Aucune variable d’environnement supplémentaire.

Aucun push, déploiement, appel Vercel de production ou migration de la base réelle n’a été effectué. Les fichiers locaux préexistants non suivis sont préservés.

## Vérification reproductible

```sh
pnpm db:generate
pnpm typecheck
pnpm lint
pnpm test:unit
# DATABASE_URL_TEST doit désigner une base dédiée dont le nom finit par _test.
pnpm test:integration
pnpm build
pnpm exec playwright test --config=playwright.navigation.config.ts market-opening.spec.ts workspace.spec.ts
```

Le test navigateur utilise des réponses API déterministes et le build de production local. Il vérifie : affichage avant achèvement du marché, navigation pendant le traitement, une seule synchronisation par ouverture, relecture automatique, panne partielle, focus, nouvelle ouverture, absence de POST snapshot et non-régression du store/navigation.

Les tests SQL exercent les vrais UPSERT/verrous, succès inchangé, limite cinq minutes, échecs répétés, bail interrompu et jeton remplacé. Le scénario métier lance simultanément les services pour deux utilisateurs, deux appels du même portefeuille et le chemin global du cron : actions/ETF/or/argent/BCE sont partagés, sans doublon de prix ni snapshot.

### Résultats exécutés

- 224 tests unitaires (28 fichiers) : réussis.
- 78 tests d’intégration PostgreSQL (10 fichiers) : réussis. Validation dans le build rootless isolé `/projects/patrimoine-market-validation`, image `agents-project/patrimoine-market-validation:local`. Installation depuis le lockfile, aucune donnée/connexion réelle copiée.
- Prisma `validate`, `migrate deploy` deux fois et `migrate diff --exit-code` : réussis sur cette base éphémère.
- 7 tests Playwright/Chromium (2 nouveaux + 5 navigation/store) : réussis sur le build de production local. Les autres suites E2E n’ont pas été exécutées.
- TypeScript, ESLint, Prettier ciblé et `git diff --check` : réussis.
- Génération Prisma et build Next.js avec `VERCEL=1`, Node 24 et URL PostgreSQL factice inaccessible : réussis. Aucun accès fournisseur au build.

Dans le sandbox, les CLI locales ont été lancées directement via Node, sans modifier les dépendances. Logs locaux : `/workspace/market-opening-unit.log`, `/workspace/market-opening-build.log`, `/workspace/market-opening-browser.log`. Les binaires Chromium et bibliothèques utilisateur déjà présents ont été réutilisés ; aucun changement système. Le service de test Next et le PostgreSQL éphémère sont arrêtés.

Les tests ne constituent pas une validation d’invocation réelle sur Vercel/Neon ni une certification de disponibilité des fournisseurs. Le contexte OpenClaw signale trois outils MCP omis par politique ; ils n’ont pas été utilisés. L’outil limité `agents_ops.project_build` disponible a bien exécuté et confirmé la validation PostgreSQL ci-dessus.
