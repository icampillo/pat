# Passe qualité — 28 septembre 2026

## Audit préalable

Audit effectué sur l'arbre de travail, qui contient une refonte UX non commitée. Ces changements sont conservés. Aucun reset Git, aucune modification de .env, des secrets, des données utilisateur ou des migrations historiques.

### Cartographie

- App Router : pages privées (données partagées via React cache), authentification, API v1 authentifiée.
- UI : composants pages, formulaires, tableaux, wallets, contexte de mutations et shell ; styles globaux (2 320 lignes).
- Domaine : journal financier en decimal.js, immobilier/crédit, catégories, affichage wallets, CSV Bourse.
- Serveur : Prisma, commandes portefeuille, valorisation/snapshots, imports/exports, images, prix, DeBank et workers.
- Contrats partagés : Zod, AppState et vues, immobilier et wallets.
- Tests : unitaires, intégration PostgreSQL, E2E Playwright ; scripts opérationnels et migrations.

### Constats et risques

- Aucun fichier source entièrement orphelin dans le graphe imports/exports/imports dynamiques, complété par les entrées Next.js et scripts. Ne pas supprimer les composants seulement peu utilisés.
- Les anciennes routes assets/history/transactions servent de redirections, couvertes par navigation-redirects.test.ts. HistoryPage et TransactionsPage restent utilisés par activity.
- Sept dépendances sans import, configuration ni appel dans les scripts : @hookform/resolvers, @radix-ui/react-select, @radix-ui/react-slot, class-variance-authority, clsx, react-hook-form, tailwind-merge.
- Quatre classes CSS sans consommateur, y compris assemblages dynamiques et tests : performance-strip, performance-icon, wallet-card-top, wallet-balance.
- Calcul overall inutilisé dans PortfolioBreakdown ; type exporté Db sans référence.
- portfolio.ts (1 004 lignes) mélange autorisation/idempotence, commandes, valorisation et snapshots. Les transactions sérialisables et les verrous doivent être conservés.
- Un cast de confirmation d'annulation accepte des valeurs truthy non booléennes et peut lever TypeError sur un motif non textuel. Validation Zod ciblée nécessaire, sans modifier les règles financières.
- Cast mensonger de clé fournisseur vers CRYPTO ; casts de tableaux JSON malgré un garde Array.isArray ; erreurs UI forcées vers Error.
- Le helper JSON.parse(JSON.stringify(...)) propage implicitement any dans le modèle de lecture et les mutations. Une migration complète des DTO et contrats de réponses dépasse ce nettoyage sûr ; dette identifiée, pas masquée.
- Recherche du nom d'actif par find pour chaque transaction et recalcul du maximum des séquences à chaque ligne CSV : duplication de travail évitable.
- Formulaires immobiliers (329 lignes), fiche actif (323), imports Bourse (304), styles globaux volumineux. Pas de généricisation globale des formulaires.
- Les formats monétaires/quantités/dates wallets et workspace diffèrent intentionnellement : pas de mutualisation aveugle.
- Sessions, origine des mutations, filtres propriétaire, validations métier et confirmations examinés. Les journaux serveur utilisent des codes plutôt que les payloads. Recherche ciblée dans les fichiers suivis : pas de clé privée/token évident identifié ; ce n'est pas un audit exhaustif de l'historique Git.
- Aucun any explicite ni suppression TypeScript trouvé dans le code applicatif (hors client Prisma généré). Ne pas nettoyer les fichiers générés.

### Référence avant modifications

- typecheck : OK.
- lint : 0 erreur, 1 avertissement (overall inutilisé).
- test:unit : 81 tests / 12 fichiers, tous OK.
- pnpm absent du PATH du sandbox : utilisation de Corepack 11.19.0. Vérification automatique des modules désactivée uniquement dans l'environnement de commande pour éviter une réinstallation involontaire du node_modules partagé.

## Résultats

### Nettoyage réalisé

- Retrait des sept dépendances directes identifiées, avec régénération du lockfile par pnpm install --lockfile-only --ignore-scripts. Aucune dépendance ajoutée, aucune version de dépendance conservée mise à jour. Pas de purge/réinstallation du node_modules partagé.
- Suppression des quatre classes mortes et de leurs 25 sélecteurs (83 lignes CSS retirées). Les sélecteurs encore utilisés dans les groupes partagés restent intacts ; aucun changement visuel intentionnel.
- Suppression du calcul overall inutilisé et du type Db sans consommateur.
- Suppression des casts de payload déjà protégé par Array.isArray ; les tableaux d'erreurs des aperçus d'import sont vérifiés et un format invalide bloque désormais la confirmation.
- Aucun fichier applicatif entier supprimé, aucune fonctionnalité ni route retirée. Les barrels forms/wallets sont petits et utilisés : conservés.

### Refactors et simplifications

| Fichier | Responsabilité / modification |
| --- | --- |
| src/server/portfolio.ts | Commandes et règles de mutation ; 1 004 → 535 lignes. Confirmation d'annulation validée avec Zod, clé du fournisseur correctement typée. |
| src/server/portfolio-store.ts | 84 lignes : propriétaire, idempotence, transaction sérialisable, contrôle de version et conversion du journal. |
| src/server/portfolio-query.ts | 401 lignes : valorisation, état de lecture, capture et worker de snapshots. Recherche des noms d'actifs via Map, plus par parcours répété. |
| src/server/imports.ts | Maximum de séquence calculé une seule fois, sans spread potentiellement trop volumineux ; gardes JSON explicites. |
| src/server/http.ts | Corps JSON exposé comme unknown : les services doivent le valider au lieu d'hériter implicitement de any. |
| src/shared/schemas.ts | Schéma de confirmation d'annulation, sans transformation du motif conservé dans l'audit. |
| src/shared/errors.ts et composants consommateurs | Un helper pour traiter unknown, préserver les messages Error et afficher un secours pour les autres rejets ; suppression des casts forcés dans les catch UI. |
| src/app/globals.css | 2 320 → 2 237 lignes ; seulement les styles sans consommateur retirés. |
| package.json / pnpm-lock.yaml | Dépendances directes et entrées transitives devenues inutiles supprimées. |

Imports mis à jour dans les routes, services, workers, scripts, seed et tests. Le seed et les scripts de maintenance n'ont PAS été exécutés. Aucun cycle ajouté entre les trois modules portefeuille : commandes → lectures → primitives de persistance ; les primitives ne dépendent pas des commandes.

Le déplacement des fonctions a été comparé au contenu initial : seuls command (validation/typage), mutate et runSnapshot (lecture sûre du code d'erreur), valuation (Map des noms) changent au-delà du déplacement. Les calculs financiers, l'isolation SQL, les bornes de reprise, les captures historiques et les contrôles propriétaire restent inchangés.

### Dépendances conservées intentionnellement

- Prisma/client, adaptateur pg, pg : persistance et génération.
- React/React DOM/Next, Zod, decimal.js, Recharts : usages directs ou runtime du framework.
- Radix Dialog et AlertDialog : dialogues actifs ; Slot reste une dépendance transitive si requise par Radix.
- Playwright et playwright-core : connecteur public DeBank et configuration de packaging, pas seulement tests E2E.
- Sharp : traitement et validation des images privées.
- Tailwind/PostCSS, outils de tests et embedded-postgres : configuration/scripts/tests. Pas de suppression fondée uniquement sur l'absence d'import applicatif.

### Validation réellement exécutée

| Contrôle | Résultat |
| --- | --- |
| pnpm typecheck | OK |
| pnpm lint | OK, 0 erreur et 0 avertissement |
| pnpm test:unit | OK, 90 tests / 14 fichiers (81 tests préexistants conservés, 9 nouveaux) |
| pnpm build | Compilation Turbopack réussie en 37,2 s, puis arrêt code 137 pendant le contrôle TypeScript du build. OOM constaté, limite du sandbox : 2 Gio. Build complet NON validé. |
| Intégration PostgreSQL | Non exécutée : préparation d'une base éphémère locale refusée par le sandbox (spawn EPERM lors du lancement sous l'utilisateur non privilégié existant). Aucune connexion à une base utilisateur, aucune migration appliquée par cette passe. |
| Playwright / navigateur | Non lancés ; pas de refonte de parcours UI. |
| git diff --check | OK |

Tests ajoutés : confirmation booléenne/motif valide, commande d'annulation sans écriture en cas de payload invalide, conservation du motif et de la révision, erreurs UI inconnues, clé d'idempotence obligatoire, reprise des conflits bornée à trois tentatives, doublon et erreur inconnue. Un test d'intégration de non-mutation en cas d'annulation mal formée a également été ajouté et typechecké, mais il reste à exécuter sur PostgreSQL.

Les données d'environnement n'ont pas été éditées. Le build utilise la lecture habituelle de .env par Prisma/Next, sans affichage de ses valeurs ; seule la génération du client Prisma a été exécutée, pas une migration. Le fichier next-env.d.ts régénéré par le build a été ramené à son contenu initial (il était propre avant la passe).

Commandes reproductibles dans le sandbox, après disponibilité des dépendances :

```sh
# Shim Corepack local déjà préparé, sans installation globale.
export PATH=/workspace/.local/bin:$PATH
# Ne pas réinstaller automatiquement le node_modules partagé entre WSL et sandbox.
export pnpm_config_verify_deps_before_run=false
cd /projects/patrimoine
pnpm typecheck
pnpm lint
pnpm test:unit
NODE_OPTIONS=--max-old-space-size=1024 NEXT_TELEMETRY_DISABLED=1 pnpm build
```

Relancer le build dans un environnement disposant de plus de mémoire. Pour l'intégration, utiliser une base dédiée dont le nom finit par _test, jamais la base utilisateur ; pnpm test:integration applique les migrations à cette base de test uniquement.

### Risques et seconde passe recommandée

1. Exécuter les tests d'intégration sur PostgreSQL isolé et obtenir un build complet avant livraison ; une compilation seule n'est pas une validation de production.
2. Remplacer progressivement le sérialiseur JSON implicitement any par des DTO explicites et des contrats de réponses API. Priorité aux réponses de mutations, à AppState et aux observations wallets stockées. Ne pas imposer des génériques complexes à toute l'application.
3. Réduire le volume chargé par getState (transactions complètes, snapshots avec payload), avec mesures et tests de cohérence temporelle avant pagination/projections.
4. CSS : regrouper progressivement les couches historiques et variantes responsive encore actives, avec comparaison visuelle dédiée. Elles ne sont pas mortes simplement parce qu'elles se redéfinissent.
5. Formulaire immobilier et fiche actif : extraire uniquement des sections autonomes si de nouveaux changements le justifient ; éviter un système générique de formulaires.
6. Revoir les versions d'outillage dans une passe distincte : pnpm a signalé la fin de support d'ESLint 9. Ne pas effectuer de migration majeure opportuniste ici.

Limites d'environnement : trois outils MCP configurés sont omis par la politique de cette exécution. Aucun succès MCP, déploiement, conteneur persistant, push ou commit n'est revendiqué. Toutes les vérifications rapportées ci-dessus ont utilisé le terminal sandbox.

### Préservation de la refonte UX existante

Les fichiers de navigation, les nouveaux écrans activity, les cartes/positions wallets, le shell et docs/ui-design.md ont été comparés à une copie de l'arbre initial. Hors petits changements ciblés de gestion d'erreurs, suppression du calcul mort et nettoyage CSS, les modifications UX préexistantes sont préservées. Le diff Git global contient donc aussi du travail antérieur à cette passe : ne pas l'attribuer entièrement au nettoyage qualité.
