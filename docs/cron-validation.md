# Validation des jobs Vercel — 7 octobre 2026

## 1. Statut du build

**Réussi, code de sortie 0**, mode production Vercel (`VERCEL=1`), Node 24.21.0, Next.js 16.3.5, webpack. Génération Prisma, compilation, TypeScript, 15 pages statiques et collecte des traces terminées. Les trois routes cron apparaissent dans le build comme routes dynamiques.

Le binaire `pnpm` n’est pas exposé dans le PATH du conteneur. Les deux commandes du script `build` ont donc été exécutées directement, sans modifier ce script :

```sh
node node_modules/prisma/build/index.js generate
node node_modules/next/dist/bin/next build --webpack
```

Elles ont reçu `VERCEL=1`, `NEXT_TELEMETRY_DISABLED=1`, `DATABASE_URL` et `DIRECT_URL` factices sur `127.0.0.1:1/patrimoine_validation_test`, ainsi que des valeurs d’authentification de validation. Aucune connexion à la base réelle. Prisma/Next chargent `.env`, mais les variables explicites de processus priment ; aucun `.env` n’a été édité.

La compilation webpack a pris 4,6 minutes, puis TypeScript 119 secondes. Le conteneur (2 Gio RAM, 1 Gio swap, 2 CPU) était saturé pendant les premières validations concurrentes. Le délai initial n’était pas une erreur de compilation. Le build a été laissé jusqu’à sa sortie normale. Journal local : `/workspace/patrimoine-build-validation.log`.

## 2. Statut tests

**179 tests unitaires réussis dans 24 fichiers**, code de sortie 0. Dernière exécution avec `--maxWorkers=1` : 7,39 secondes, sans DB réelle ni fournisseur externe.

```sh
node node_modules/vitest/vitest.mjs run tests/unit --maxWorkers=1
```

`DATABASE_URL`, `DIRECT_URL` et `DATABASE_URL_TEST` ont toutes été remplacées dans le processus par une URL factice locale inaccessible. Les tests couvrent notamment les secrets absents/invalides/valides sur les trois routes, les réponses partielles 503, les erreurs masquées, la concurrence wallet bornée à un, l’éligibilité et les refus de verrou simulés, les délais et retries, la conservation des anciennes valeurs, les doublons de prix, les snapshots quotidiens et le refresh manuel après vérification du propriétaire.

Un serveur **Next de production local** a également été lancé temporairement sur `127.0.0.1:3198`, puis arrêté. Pour chacune des trois routes cron : deux requêtes (sans Authorization / mauvais Bearer) ont confirmé HTTP 401, JSON attendu et `Cache-Control: private, no-store`. Aucun job ni accès DB déclenché. `/login` répond 200.

Les contrôles de formatage Prettier du périmètre code/config/tests et `git diff --check` passent.

## 3. Statut TypeScript

**Réussi** pendant le build puis avec `node_modules/.bin/tsc --noEmit`, code 0.

## 4. Statut ESLint

**Réussi** avec `node_modules/.bin/eslint .`, code 0. L’exécution finale a été faite après le build pour ne plus saturer le conteneur.

## 5. Anciens timers et intégration Git

Les fichiers `src/instrumentation.ts`, `src/server/market-worker.ts`, `wallet-worker.ts` et `snapshot-worker.ts` sont supprimés. Aucun appel `startMarketWorker`, `startWalletWorker` ou `startSnapshotWorker` subsiste dans le code. `scripts/workers.ts` est désormais une passe ponctuelle avec déconnexion Prisma.

Occurrences restantes, sans worker Vercel permanent :

- `scripts/local-db.ts` : maintien en vie du PostgreSQL portable local, jamais importé par Next ;
- `src/components/workspace/context.tsx` : polling **navigateur**, nettoyé au démontage ;
- `data-store.ts` : timeout HTTP navigateur ;
- `debank-public.ts` : fermeture du navigateur après 90 secondes ;
- `provider-fetch.ts` : attente bornée, au plus une nouvelle tentative fournisseur ;
- `http.ts` et `debank.ts` : boucles de lecture de flux, terminées à EOF, avec limites de taille ;
- `scripts/check-navigation.ts` : attentes dans un script de vérification.

Les anciennes variables `*_WORKER_DISABLED` encore présentes dans certains scripts/configurations de test/Compose sont inertes. Les documents historiques datés décrivent parfois l’ancienne architecture ; README et documentation d’implémentation active ont été corrigés.

Revue des modifications Git et compilation : aucune référence manquante ni implémentation tronquée constatée. Aucun changement du schéma/migrations Prisma. Les fichiers cron/jobs/tests nouvellement créés sont encore **non suivis** et devront être inclus dans le commit utilisateur. `.astra/`, `patrimoine-local.dump` et le changement préexistant de `next-env.d.ts` sont préservés. Aucun commit, push ou déploiement effectué pendant cette reprise ; seules la documentation active et la mémoire ont été modifiées.

## 6. Routes cron créées

| Route GET            | Service partagé                                | Runtime | Durée maximale |
| -------------------- | ---------------------------------------------- | ------- | -------------- |
| `/api/cron/market`   | `syncMarketData()`                             | Node.js | 300 s          |
| `/api/cron/wallets`  | `syncDueWallets()`                             | Node.js | 300 s          |
| `/api/cron/snapshot` | `createPortfolioSnapshots()` → `runSnapshot()` | Node.js | 300 s          |

Toutes passent par `runCron()` : `CRON_SECRET` obligatoire, comparaison du Bearer en temps constant, secret absent refusé, réponse non cachée. Succès complet : 200 ; erreur ou travail restant : 503. Vercel ne retente pas automatiquement une exécution échouée.

Le refresh wallet authentifié passe par `walletCommand()` (session, propriété et mutation), puis `after(() => syncWallet(id))`. Cron et refresh partagent `syncWalletResult()` et son bail DB, sans copie de la synchronisation. La route API manuelle utilise également Node.js et 300 s ; `after()` reste attaché à la durée de cette invocation.

## 7. Configuration Vercel

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "buildCommand": "pnpm build",
  "crons": [
    { "path": "/api/cron/market", "schedule": "0 2 * * *" },
    { "path": "/api/cron/wallets", "schedule": "0 4 * * *" },
    { "path": "/api/cron/snapshot", "schedule": "0 6 * * *" }
  ]
}
```

Horaires **UTC**, une exécution quotidienne par route : compatibles Hobby. Précision Hobby : passage possible pendant l’heure prévue. L’espacement de deux heures laisse une marge entre les jobs, mais ne garantit pas le succès de la collecte avant le snapshot. Celui-ci conserve les dernières observations disponibles, sans inventer de données.

**Fluid Compute requis** pour les fonctions Hobby de 300 secondes. Conserver le preset Next.js et la sortie par défaut, pas `.next/standalone`.

### Chromium / DeBank

- `@sparticuz/chromium` **153.0.0**, dépendance de production verrouillée ; Playwright et playwright-core **1.63.0**, Chromium attendu **153.0.8010.12** : versions majeures alignées.
- Node 24 déclaré dans `package.json`, compatible avec les moteurs du paquet Chromium. Le paquet reconnaît explicitement `VERCEL` et prépare les bibliothèques AL2023 pour Node >= 20.
- `VERCEL=1` sélectionne le binaire serverless, ses arguments et son `executablePath()`. Hors Vercel, le navigateur installé via Playwright est utilisé.
- `serverExternalPackages` conserve Chromium/Playwright côté serveur. `outputFileTracingIncludes` inclut les archives pour `/api/cron/wallets` et `/api/v1/*`.
- Traces finales vérifiées, fichiers de route + dépendances tracées + trace serveur Next commune, dédupliqués : market **33,48 Mio**, snapshot **33,49 Mio**, wallets **106,74 Mio**, API v1 **107,68 Mio**. Aucun fichier tracé manquant.
- Les quatre archives `chromium.br`, `al2023.tar.br`, `fonts.tar.br` et `swiftshader.tar.br` sont présentes pour les deux routes utilisant le navigateur. Taille sous la limite standard de 250 Mo par fonction. Ce calcul n’est **pas** le paquet final généré par Vercel ; aucune option de fonctions volumineuses n’est nécessaire selon les traces locales.
- Le cron wallet traite séquentiellement au plus 20 wallets actifs/échus ; il cesse d’en démarrer après 120 s. Les caps marché (100 portefeuilles / 500 actifs Bourse) sont des limites MVP, pas une couverture illimitée : `hasMore` signale un dépassement. Une relance marché ne garantit pas de parcourir au-delà de ces caps ; une pagination sera nécessaire si ce volume est atteint. Aucun changement de ces limites n’a été ajouté pendant cette reprise de validation.

## 8. Variables d’environnement Vercel

- **À ajouter en Production : `CRON_SECRET`**, secret aléatoire, recommandé 32 octets minimum. Ne jamais utiliser de préfixe `NEXT_PUBLIC_`.
- **À conserver/vérifier :** `DATABASE_URL` (pool PostgreSQL/TLS adapté), `BETTER_AUTH_SECRET` existant, `BETTER_AUTH_URL` et `APP_ORIGIN` égaux à l’origine HTTPS finale.
- `VERCEL=1` doit être exposée automatiquement au build et au runtime via les variables système Vercel.
- `DIRECT_URL` : uniquement si déjà nécessaire pour les migrations administratives séparées ; aucune migration nouvelle dans cette tâche.
- Aucune clé DeBank payante obligatoire, aucun service navigateur distant, aucun `DATABASE_URL_TEST` de production, aucune variable worker à ajouter.

## 9. Migrations Prisma

**Aucune nouvelle migration, aucun changement de schéma, aucune migration exécutée.** `prisma validate` a également réussi, avec URLs DB factices et sans connexion à la base. Les tables `PriceHistory`, `WalletObservation`, `PortfolioSnapshot` et contraintes existantes sont réutilisées. Ne pas exécuter de reset ni de migration destructive. Une base déjà à jour n’a aucune action Prisma supplémentaire à faire pour ce changement.

## 10. Non testé et raisons

- **Intégration PostgreSQL réelle** : non exécutée. Précontrôle reproduit avec `embedded-postgres`, sans création de cluster : UID 0, aucun utilisateur postgres, `CapEff=0`, `NoNewPrivs=1`. Le paquet refuse PostgreSQL sous root. Aucune tentative de sudo, création d’utilisateur, changement de permissions ou recours à la base réelle.
- Restent à valider sur une DB jetable dédiée : migrations existantes, verrous/concurrence interconnexions, atomicité prix/observations, idempotence sous concurrence réelle des snapshots, refus interutilisateurs et suite complète `tests/integration` (market, securities, wallets, portfolio, inventory, categories, real-estate).
- **Playwright E2E** : non exécuté, son setup migre une DB `_test` dédiée indisponible ici. Il doit aussi recevoir `DIRECT_URL` pointant vers cette même DB, pas vers la production.
- **Exécution réelle Chromium et lecture DeBank publique** : non validées dans cette reprise. Le paquet extrait le binaire dans `/tmp`, monté `noexec` dans le sandbox. Ce montage n’a pas été modifié ou contourné. Les tests de parsing sur fixtures passent ; ils ne démontrent pas la disponibilité du site DeBank depuis une IP Vercel.
- **Infrastructure Vercel réelle** : ni accès administrateur ni déploiement, donc paquet final, mémoire/démarrage à froid, exécution du cron distant, éventuelle protection du déploiement et accès fournisseur/DB à vérifier sur la cible.
- Le runtime signale aussi trois outils MCP exclus par la politique ; aucune validation hôte/MCP n’est revendiquée. Ce blocage n’empêche pas les contrôles locaux ci-dessus.

Pour une validation DB ultérieure, utiliser une machine/CI avec PostgreSQL jetable, définir explicitement **les trois URL** `DATABASE_URL`, `DIRECT_URL`, `DATABASE_URL_TEST` vers cette base locale suffixée `_test`, puis lancer `pnpm test:integration` et `pnpm test:e2e`. Ne pas réutiliser les valeurs de `.env` sans vérifier l’isolation.

## 11. Actions manuelles exactes Vercel

1. Inclure les nouveaux fichiers cron/jobs/helpers/tests avec les changements existants dans la version que vous choisirez de publier ; exclure `.astra/` et le dump privé. L’agent n’a fait aucun push.
2. Dans les paramètres du projet : preset **Next.js**, Node.js **24.x**, build **`pnpm build`**, sortie par défaut, **Fluid Compute activé** (durée des routes 300 s).
3. Dans **Environment Variables → Production**, ajouter `CRON_SECRET` et vérifier les variables listées plus haut ; conserver la valeur existante de `BETTER_AUTH_SECRET`. Vérifier que les variables système sont exposées.
4. Déployer vous-même cette version en **Production**, sans ancien cache de build. Les previews ne constituent pas une validation des crons quotidiens. Pas de nouvelle migration à appliquer.
5. Dans **Settings → Cron Jobs**, vérifier les trois chemins/horaires. Depuis **Run**, déclencher market puis wallets puis snapshot et consulter **View Logs** : attendre `completed`, `failed: 0`, `hasMore: false` et HTTP 200. Un 503 `partial` demande une analyse/relance contrôlée, pas une annonce de succès.
6. Dans l’application, cliquer **Actualiser** sur un wallet existant, vérifier une nouvelle date de réussite et l’absence d’erreur `BROWSER`/`PUBLIC_BLOCKED`. Vérifier la nouvelle capture quotidienne et qu’une relance du snapshot n’en ajoute pas une seconde pour la même journée.
7. Effectuer les tests PostgreSQL/E2E manquants sur une base de test séparée, idéalement avant publication. Surveiller au moins le premier cycle quotidien et l’usage Hobby ; aucun abonnement payant n’a été activé.

## 12. Verdict

**READY WITH UNVALIDATED DB TESTS** — validation locale hors DB terminée, sous réserve des contrôles de cible Vercel/Chromium explicités ci-dessus. Aucun push, aucun déploiement, aucune donnée réelle modifiée.

### Références consultées

- [Limites et précision des crons Hobby](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Durées, mémoire et taille des fonctions](https://vercel.com/docs/functions/limitations)
- [Secret, relances et gestion des crons](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- Guide Next local : `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`.
