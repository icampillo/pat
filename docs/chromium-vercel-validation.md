# Chromium / Vercel — validation du 7 octobre 2026

> Mise à jour du 8 octobre 2026 : les descriptions DeBank/Chromium ci-dessous sont historiques. Le runtime utilise désormais Zerion sans navigateur ; voir [la validation Zerion actuelle](zerion-validation.md).

## Cause identifiée et portée de la preuve

Le build Next.js réussissait, mais le déploiement était rejeté pendant `Deploying outputs...`.
Dans les traces conservées du commit `a695d17`, l’API contenait simultanément :

- le symlink pnpm `node_modules/@sparticuz/chromium` ;
- les fichiers forcés sous `node_modules/@sparticuz/chromium/bin/*.br` ;
- ces mêmes fichiers sous leur chemin réel `node_modules/.pnpm/@sparticuz+chromium@153.0.0/...`.

L’inclusion forcée introduisait donc des fichiers descendants d’un répertoire déjà représenté par un symlink : la structure problématique décrite par l’erreur Vercel. Ce conflit est constaté dans les anciennes traces, et absent des nouvelles fonctions/ZIP. La cause côté service Vercel n’est toutefois pas confirmée par un redéploiement : aucun envoi ni déploiement n’a été effectué.

## Correction ciblée

- Remplacement de `@sparticuz/chromium@153.0.0` par `@sparticuz/chromium-min@153.0.0` dans `package.json` et `pnpm-lock.yaml`. Aucune autre version de dépendance changée.
- `next.config.ts` : retrait des inclusions Chromium Vercel, externalisation de `chromium-min`. Les inclusions Playwright du mode local standalone restent inchangées.
- `src/server/debank-public.ts` : seule la branche Vercel du lancement du navigateur change ; `executablePath(remotePack)` fournit le binaire à Playwright.
- Tests du lancement local, des packs x64/arm64, du miroir, des erreurs de téléchargement, de l’architecture non supportée et de la configuration Next.
- Documentation : `.env.example`, `README.md`, ce rapport et renvoi depuis le rapport cron historique.

Aucune modification des crons, jobs market/snapshot/wallet, verrous wallet, protections `CRON_SECRET`, `runtime` ou `maxDuration`. Pas de Puppeteer, service payant, `node-linker=hoisted`, migration ou accès à la base réelle. `.env`, `.astra/` et le dump privé sont préservés.

## Navigateur local et Vercel

**Local :** `chromium.launch({ headless: true, timeout: 20_000 })`, avec le navigateur Playwright installé localement. Aucun téléchargement Sparticuz dans cette branche.

**Vercel :** `chromium-min` télécharge et extrait un pack officiel dans `/tmp`, puis Playwright le lance avec les arguments Sparticuz. Le cache `/tmp/chromium` est réutilisé quand disponible. Le premier démarrage dépend du réseau et du temps de téléchargement/extraction ; les 20 secondes de `launch` ne bornent pas ce téléchargement préalable.

Playwright et playwright-core restent en **1.63.0** ; leur navigateur déclaré est **153.0.8010.12** (majeure 153). Package et pack Sparticuz sont tous deux exactement en **153.0.0**. La compatibilité de lancement réelle sur Vercel reste à tester.

La [release officielle 153.0.0](https://github.com/Sparticuz/chromium/releases/tag/v153.0.0) a été vérifiée via l’API GitHub :

| Architecture Node | Pack officiel | Taille |
| --- | --- | --- |
| `x64` | `https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar` | 70 051 840 octets |
| `arm64` | `https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.arm64.tar` | 68 249 600 octets |

Le pack **x64**, correspondant à l’architecture **x86_64** des fonctions produites, a été téléchargé et son SHA-256 vérifié contre le digest publié :

```text
91b9f56d35a2cbb14279a1cbdaf1c86c0faa5fd82315bdd7334ff93bf35f224d
```

Le pack arm64 est publié dans cette même release ; son lancement n’a pas été testé.

`CHROMIUM_PACK_URL` est **facultative**. Absente ou vide, l’application sélectionne l’URL officielle versionnée selon `process.arch`. Pour un miroir HTTPS, fournir exactement le pack 153.0.0 de l’architecture cible. Toute mise à jour future de `chromium-min` doit aussi mettre à jour les URL et les tests. L’application ne vérifie pas elle-même le digest d’un miroir personnalisé.

## Validation exécutée

Environnement : Node **24.21.0**, pnpm **11.19.0**, Next.js **16.3.5**.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm test:unit --maxWorkers=1
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
```

Le build a été lancé par le builder Vercel, avec `VERCEL=1`, télémétrie désactivée, URL de base factice inaccessible et variables d’authentification factices. `prisma generate` ne lance aucune migration.

- Installation : réussie (première installation avec concurrence réduite après une limite mémoire).
- Tests unitaires : **184 tests / 25 fichiers réussis**, dont 5 nouveaux tests du navigateur.
- TypeScript, ESLint, Prettier ciblé et `git diff --check` : réussis.
- Build production : compilation, TypeScript, 15 pages statiques et traces réussis ; code de sortie **0**.
- Recherche des références : plus d’ancien package dans les dépendances, imports ou inclusions actives. Les mentions restantes de l’ancien package servent à l’historique et à l’assertion de non-régression. `outputFileTracingIncludes` subsiste uniquement pour Playwright hors Vercel.

### Packaging Vercel, au-delà du build Next

La CLI **Vercel 62.7.0** est disponible dans un outillage temporaire hors projet. `vercel build` standard ne pouvait pas continuer sans les paramètres du projet lié ; aucun compte n’a été connecté.

Le builder officiel **`@vercel/next@21.0.0`** a donc été appelé localement avec `framework: nextjs`, `nodeVersion: 24.x` et la commande `corepack pnpm build`. Il a produit **17 entrées Lambda**, regroupées en **4 fonctions distinctes**. Les ZIP ont été créés avec `createZip()` du builder et inspectés séparément avec `zipfile` Python :

- runtime **nodejs24.x**, architecture **x86_64** ;
- groupe API/crons : `maxDuration = 300`, `chromium-min` JavaScript présent ;
- groupe API/crons : **433 fichiers**, environ **12,07 Mio compressés / 33,46 Mio décompressés** ;
- **aucune archive Chromium `.br`**, aucun ancien package Chromium complet ;
- **aucun fichier descendant d’un symlink**, aucun symlink cassé ;
- intégrité CRC des quatre ZIP validée.

Le builder mutualise notamment market, wallets, snapshot et l’API dans une même fonction ; cela ne modifie pas les routes applicatives. Les symlinks pnpm normaux restent présents et valides.

Artefacts de diagnostic locaux hors Git : `/workspace/patrimoine-chromium-baseline.json`, `/workspace/patrimoine-chromium-vercel-build.log`, `/workspace/patrimoine-check-vercel-build.cjs` et `/workspace/patrimoine-vercel-packages/summary.json` (ZIP dans le même dossier).

La première tentative avait été tuée par la limite mémoire du conteneur (2 Gio, caches pnpm/npm dans `/tmp` en RAM). Après déplacement des caches de validation vers le disque de travail, le build et le packaging ont terminé. Aucun réglage pnpm du projet changé.

## Reste à vérifier sur Vercel

1. Déployer ce commit avec Next.js / Node 24 et Fluid Compute ; conserver les variables existantes, notamment `CRON_SECRET`. Aucun ajout obligatoire de variable Chromium.
2. Confirmer que le service dépasse effectivement `Deploying outputs...`. Le builder local ne reproduit pas l’acceptation côté plateforme ni tous les paramètres du projet réel.
3. Tester un démarrage froid : téléchargement du pack officiel, extraction, lancement Playwright, accès public DeBank et temps total dans les 300 secondes.
4. Tester une invocation chaude, l’actualisation manuelle et le cron wallets ; vérifier les résultats et erreurs éventuelles anti-bot/réseau.

Le sandbox ne valide pas l’exécution réelle du navigateur Vercel (`/tmp` local monté `noexec`). Aucun test DeBank réel, PostgreSQL/E2E, push ou déploiement effectué dans cette correction.
