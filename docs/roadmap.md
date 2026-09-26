# Plan de réalisation

Mis à jour le 23 septembre 2026. **Version locale 0.1.0 fonctionnelle, avec wallets DeBank gratuits.** Les fonctionnalités principales sont implémentées et vérifiées sur PostgreSQL et Chromium. La validation Docker et les compléments du plan initial restent explicitement ouverts.

## Bilan de la livraison locale

| Phase | Livré et fichiers principaux | Vérification / reste à faire |
| --- | --- | --- |
| 0 — Conception | Documents d’architecture, modèle, calculs et plan | Terminée ; contrats effectifs dans implementation.md |
| 1 — Socle | package.json, configurations Next/TypeScript, src/server/auth.ts, provision.ts, Prisma et 7 migrations, Dockerfile/Compose | Auth, isolation et migrations testées ; Docker fourni mais non exécuté |
| 2 — Actifs | src/shared/schemas.ts, components/forms.tsx, asset-image.tsx, server/images.ts | CRUD des fiches, inventaires sans coût d’achat, archivage, images privées et versions testés ; administration des référentiels différée |
| 3 — Transactions | src/domain, src/server/portfolio.ts, formulaires et journal | 9 types, révisions, annulations, concurrence et idempotence testés ; pagination serveur différée |
| 4 — Valorisation | modules/prices, components/charts.tsx, metal-price.tsx, portfolio-breakdown.tsx, workspace.tsx | Calculs, change, métaux, dates et fallback vérifiés ; wallets publics DeBank connectés ; cours des actifs manuels sans fournisseur actif |
| Wallets & DeFi | server/debank-public.ts, debank.ts, wallets.ts, wallet-worker.ts, components/wallets.tsx | Adresse seule, lecture gratuite automatique, staking/prêts/récompenses, reprise sur erreur ; wallet réel vérifié ; API officielle facultative |
| 5 — Historique | PortfolioSnapshot, components/history-view.tsx, scripts/snapshot.ts, server/snapshot-worker.ts | Captures immuables, groupes jour/mois/année, Dietz EUR et deux jobs quotidiens concurrents testés ; planificateur quotidien intégré au serveur |
| 6 — Fichiers | server/imports.ts, exports.ts, components/import-panel.tsx, public/import-transactions.csv | Aperçu et confirmation atomique testés ; import de fiches d’actifs différé |
| 7 — Démonstration et QA | prisma/seed.ts, tests/unit, tests/integration, tests/e2e, .github/workflows/ci.yml | Tests locaux réussis ; workflow CI livré, première exécution GitHub à confirmer ; audit manuel complet d’accessibilité à venir |
| 8 — Exploitation | README.md, docs/implementation.md, scripts/backup.ts | Sauvegarde restaurée dans une base neuve et comptages vérifiés ; hébergement distant non exécuté |

**Commandes exécutées :** pnpm install, db:generate, db:deploy, db:seed:demo, typecheck, lint, test:unit, test:integration, test:e2e, build, db:backup et db:restore. La procédure locale actuelle se trouve dans [README](../README.md).

**Résultats :** 44 tests unitaires réussis, 32 tests d’intégration PostgreSQL réussis, 5 scénarios Playwright validés (parcours complet, mobile 375 px, analyse axe sur neuf écrans, ajout gratuit d’adresse et positions synchronisées). Compilation de production, TypeScript et lint vérifiés. Lecture réelle d’un profil DeBank public et sauvegarde de ses tokens et positions DeFi vérifiées sans clé API. Reprise d’un inventaire Excel vérifiée avec rapprochement des quantités et valorisations, sans inventer de coûts d’achat. Restauration précédente dans patrimoine_restore_verification_20260922 : 8 actifs, 8 transactions, 401 snapshots et 3 208 prix, identiques à la source.

**Nettoyage et cours du 23 septembre :** huit fiches fictives et leurs opérations/prix supprimés, 401 captures de seed supprimées, huit captures mêlant données réelles et fictives recalculées. Les sept pièces importées et le wallet DeBank restent en place. Le taux EUR/USD BCE et les cours de l’or et de l’argent alimentent désormais les valorisations des pièces toutes les 15 minutes quand le serveur fonctionne. Sauvegardes préalables : `backups/avant-purge-demo-20260923.dump` et `backups/avant-cours-dynamiques-20260923.dump`.

**Limites connues :** les 600 captures les plus récentes sont chargées dans l’interface, l’export reste complet ; journal sans pagination serveur ; Modified Dietz uniquement en EUR et masqué après corrections historiques ; données de spécialisation en JSON validé ; plateformes stockées comme libellés. Le seed existant ne réécrit pas un compte de démonstration déjà créé. Docker, Linux et un hébergement distant n’ont pas été exécutés. Un avertissement de dépréciation pg sur les lectures concurrentes apparaît parfois avec l’adaptateur Prisma actuel ; les suites passent avec les versions verrouillées.

## Prochaines étapes ciblées

**Snapshots automatiques — 26 septembre 2026 :** planificateur activé par défaut au démarrage Node, puis vérification chaque minute. Une capture par journée locale, reprise après redémarrage, nouvelles tentatives après panne et isolation des erreurs par portefeuille. Aucune reconstruction des journées hors ligne. Désactivation avec `SNAPSHOT_WORKER_DISABLED=1`, notamment dans Playwright. Validation : 70 tests unitaires et 15 tests d’intégration wallets/snapshots réussis, TypeScript et lint ciblé validés.

**Activation locale vérifiée :** image Docker de production compilée et conteneur applicatif recréé le 26 septembre 2026. Le démarrage a créé automatiquement la capture `DAILY` du 26 septembre à 16 h 16 (Europe/Paris), absente avant activation. Page de connexion disponible (HTTP 200), base Docker conservée.

**Lot 3 — Observations wallets et snapshots, 25 septembre 2026 :** une synchronisation DeBank réussie publie seulement son observation et son état courant. Les captures complètes restent manuelles, quotidiennes ou liées à un changement effectif de périmètre wallet (ajout/restauration inclus, inclusion/exclusion, retrait inclus). Pause et reprise conservent la valorisation. Anciens snapshots, observations, versioning, verrous et garde-fous Dietz préservés. Aucun changement de schéma ni migration. Le job quotidien reste à planifier séparément.

**Validation du lot 3 :** typecheck, lint (avertissement préexistant `overall`), 62 tests unitaires, 57 tests d’intégration PostgreSQL, build et 8 parcours Playwright réussis. Couverture des trois intervalles de synchronisation, dernières observations valides multi-wallets, instant de capture, totaux et catégories, immuabilité, quotidien concurrent/idempotent, pause, retrait/restauration et historique UI. Base PostgreSQL temporaire dédiée ; aucun accès aux données utilisateur. Avertissement de dépréciation pg inchangé.

**Lot 2 — CI GitHub, 25 septembre 2026 :** workflow séquentiel `CI / Quality` ajouté pour pushes et pull requests vers `main`. Versions Node/pnpm lues dans package.json, dépendances verrouillées, PostgreSQL 17 dédié avec healthcheck, secrets de test aléatoires, cache du store pnpm, génération des types Next.js, vérifications et Playwright. Aucun changement métier ni migration dans ce lot.

**Validation locale du lot 2 :** installation frozen et générations Prisma/Next.js réussies ; typecheck, 62 tests unitaires, 51 tests PostgreSQL, build et 8 parcours Playwright réussis. Les tests PostgreSQL et navigateur ont été exécutés sur un cluster temporaire neuf `patrimoine_ci_test` sur le port 55433, arrêté ensuite ; le premier essai sur la configuration locale avait échoué car PostgreSQL était arrêté. Lint réussi avec un avertissement de variable inutilisée dans une modification extérieure au lot ; avertissement pg connu. Workflow validé par actionlint 1.7.12, syntaxe Bash vérifiée et huit cas de contrôle de l’isolation testés. Exécution GitHub/Linux et protection de branche encore à confirmer après commit/push.

**Lot archivage sûr — 23 septembre 2026 :** suppression destructive retirée. ACTIVE autorise les opérations ; ARCHIVED conserve toute l’histoire et requiert une position soldée sans opération future en attente. Réactivation explicite avant mutation du journal ; anciens actifs archivés toujours inclus dans la valorisation. DELETE est conservé comme alias d’archivage confirmé. Aucune purge, migration, suppression de données ou réécriture de snapshot. Contrat détaillé dans [implementation.md](implementation.md#cycle-de-vie-des-actifs).

**Validation de ce lot :** `pnpm typecheck`, `pnpm lint`, 62 tests unitaires, 51 tests PostgreSQL et 8 parcours Playwright réussis ; `pnpm build` réussi. Les scénarios vérifient aussi versions, idempotence, concurrence achat/archivage, isolation, opérations annulées et révisions, exports, imports CSV/Bourse, quantité décimale minimale, date légèrement future et réactivation. Vitest et Playwright ont nécessité l’autorisation de lancer leurs sous-processus Windows hors sandbox. Avertissement pg de dépréciation déjà connu, sans échec. Les données détruites avant ce lot ne sont pas restaurées.

- [ ] Valider Docker sur une machine équipée, depuis une base vide puis après redémarrage du volume.
- [ ] Configurer le déploiement et le job quotidien sur la cible effectivement choisie.
- [ ] Ajouter pagination serveur, sélection de portefeuille et administration des catégories/plateformes.
- [ ] Étendre l’import aux fiches d’actifs et le rendement ajusté à l’USD.
- [x] Définir la CI GitHub avec PostgreSQL dédié, secrets générés, contrôles qualité, build et Playwright ; voir [ci.md](ci.md).
- [ ] Confirmer la première exécution GitHub et rendre le statut Quality obligatoire pour les merges sur main.
- [ ] Réaliser un audit manuel avec lecteur d’écran.
- [ ] Définir la rétention des imports, clés d’idempotence, traces de test et sauvegardes.
- [ ] Brancher les fournisseurs de marché et les connecteurs uniquement au moment de leur activation explicite.

## Archive du plan initial

Les phases détaillées ci-dessous sont conservées comme spécification initiale. Leurs anciennes cases et leurs commandes cibles ne constituent pas le suivi courant : utiliser le bilan ci-dessus et [l’implémentation réelle](implementation.md). Elles montrent notamment les ambitions supplémentaires qui dépassent la première version locale.

## Phase 0 — Inspection, architecture et plan

- [x] Lire la demande et inspecter le répertoire existant.
- [x] Vérifier les outils et l'absence de dépôt/application existante.
- [x] Définir les hypothèses : personnel, manuel, EUR/USD, historique complet, fiscalité différée.
- [x] Choisir Next.js, PostgreSQL, Prisma et l'authentification.
- [x] Définir les modèles, relations, contraintes et index.
- [x] Définir les routes API, l'idempotence et la validation.
- [x] Formaliser les calculs et exemples de référence.
- [x] Préparer le plan détaillé et les critères d'acceptation.

**Fichiers créés :** `README.md`, `docs/environment.md`, `docs/architecture.md`, `docs/data-model.md`, `docs/calculations.md`, `docs/api.md`, `docs/roadmap.md`.

**Commandes exécutées :** inspection PowerShell, recherche `rg`, `node --version`, `pnpm --version`, `git --version`, contrôles Git hors dépôt. Versions observées : Node 24.19.0, pnpm 11.19.0, Git 2.53.0.

**Vérifications :** relecture de cohérence, puis contrôle documentaire exécuté : 7 documents, 13 liens locaux, 19 blocs de code/diagramme, 9 routes demandées, 11 modèles minimaux et 9 phases ; aucune anomalie détectée. Ce contrôle de structure ne valide pas une implémentation. Tests applicatifs non exécutés : aucune application, dépendance ou configuration de test. Aucun build ni migration.

**Problèmes restants :** Docker et PostgreSQL non détectés ; accès au registre de paquets et navigateurs Playwright non vérifiés. Ces points n'empêchent pas le cadrage mais conditionnent la validation des phases suivantes.

**Pour consulter maintenant :**

```powershell
Get-Content .\docs\architecture.md
Get-Content .\docs\roadmap.md
```

## Phase 1 — Socle, base de données et authentification

Choix : un seul projet Next.js et une base PostgreSQL ; les services contrôlent le propriétaire dès le départ, même avec un seul utilisateur.

- [ ] Initialiser Git dans la racine du projet sans écraser les documents.
- [ ] Créer Next.js App Router, TypeScript strict, pnpm-lock et alias `@/*`.
- [ ] Ajouter Tailwind, primitives shadcn nécessaires, Zod et gestion des erreurs.
- [ ] Figer des versions compatibles ; aligner Prisma 7 CLI/client/adaptateur.
- [ ] Créer le schéma Prisma, les contraintes SQL supplémentaires et la migration initiale.
- [ ] Ajouter PostgreSQL, volume persistant, healthcheck et base de test distincte.
- [ ] Configurer Better Auth, bootstrap local, inscription désactivée, sessions et rate limit partagé.
- [ ] Protéger pages, services, API, images et exports ; politiques de cache privé et d'origine.
- [ ] Créer Dockerfile, Compose, `.env.example`, `.gitignore` et `.dockerignore`.
- [ ] Créer les référentiels EUR/USD, catégories et plateforme initiale ; séparer ce seed du jeu de démonstration.

**Fichiers prévus :** `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.ts`, `src/app/*`, `src/server/*`, `prisma/schema.prisma`, `prisma/migrations/*`, `prisma.config.ts`, `Dockerfile`, `docker-compose.yml`, `.env.example`, scripts utilisateur et configs de test.

**Commandes cibles après création des scripts :**

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
docker compose up -d db
pnpm db:generate
pnpm db:migrate
pnpm user:create
pnpm typecheck
pnpm test:integration -- auth
pnpm build
```

La copie de `.env` ne s'effectue que s'il n'existe pas. Les secrets réels seront générés localement, sans affichage dans les logs ni inclusion dans Git. Les noms de scripts ci-dessus constituent un contrat à implémenter ; ils ne fonctionnent pas encore.

**Critères de sortie :** migration réussie sur base vide, session persistante après redémarrage, connexion invalide refusée, routes/API inaccessibles hors session, deuxième propriétaire de test isolé, données conservées après redémarrage des conteneurs.

## Phase 2 — Actifs et référentiels

Choix : données communes dans `Asset`, spécialisations typées et plateformes distinctes. Les propriétés financières restent dérivées.

- [ ] CRUD des actifs, catégories, plateformes et comptes déclaratifs.
- [ ] Schémas discriminés crypto, métaux, titres, cartes et autres.
- [ ] Archivage, statut vendu cohérent et suppression confirmée sans cascade historique.
- [ ] Images privées validées et contrôles d'accès.
- [ ] Formulaires client/serveur, gestion des versions et conflits.
- [ ] Tests des validations, relations croisées et accès entre propriétaires.

**Fichiers prévus :** `src/modules/assets/*`, référentiels, routes API associées, `src/app/(private)/assets/*`, composants de formulaires, tests d'intégration.

**Commandes cibles :** `pnpm typecheck`, `pnpm test:unit -- assets`, `pnpm test:integration -- assets`.

**Critères de sortie :** créer/modifier chaque catégorie, afficher les champs corrects, refuser une pureté invalide ou une référence étrangère, archiver sans perte, confirmer avant suppression. Quantité/PMA non modifiables par un PATCH de fiche.

## Phase 3 — Transactions, trésorerie et moteur de calcul

Choix : journal révisable, écritures atomiques, projection reconstruisible et coût moyen pondéré par actif. Le calcul est isolé de l'interface pour être vérifiable.

- [ ] Implémenter les neuf types de transaction et leurs variantes actif/liquidités.
- [ ] Implémenter les contreparties de trésorerie et les flux extérieurs sans double comptage.
- [ ] Calculer quantités, coûts, PMA, gains réalisés/latents et revenus.
- [ ] Gérer transactions antidatées, révisions, annulation, transferts et frais.
- [ ] Utiliser les taux datés et figer les conversions de chaque écriture.
- [ ] Ajouter idempotence, verrou par portefeuille, isolation SQL et reprises bornées.
- [ ] Rejouer le journal après édition ; refuser toute incohérence ultérieure.
- [ ] Ajouter formulaires et journal paginé, aperçu des effets et confirmations.

**Fichiers prévus :** `src/domain/*`, `src/modules/transactions/*`, `src/server/idempotency.ts`, pages transactions, tests financiers et tests de concurrence.

**Commandes cibles :** `pnpm test:unit -- ledger`, `pnpm test:unit -- valuation`, `pnpm test:integration -- transactions`, `pnpm typecheck`.

**Critères de sortie :** tous les exemples de `calculations.md` vérifiés ; double clic sans doublon ; ventes concurrentes sans solde négatif ; suppression d'un achat dépendant refusée ; projection = replay ; vente totale sans résidu.

## Phase 4 — Prix, valorisation et tableau de bord

Choix : introduire le contrat PriceProvider et le fournisseur manuel avec la valorisation, avant les graphiques, pour utiliser un même calcul partout. Les intégrations de marché effectives restent futures.

- [ ] Implémenter `PriceProvider`, registre, fournisseur manuel et calcul métallique.
- [ ] Ajouter contrats des fournisseurs crypto, actions/ETF et cartes non configurés.
- [ ] Historiser les prix, taux et corrections ; afficher dates et sources.
- [ ] Rafraîchissement manuel, erreurs sûres, fallback sur dernier prix connu.
- [ ] Construire `/dashboard` et `/portfolio`, résumés par catégorie/devise/plateforme.
- [ ] Afficher total, coût, apports, revenus, gains et meilleurs/moins bons actifs.
- [ ] Ajouter graphiques et tableaux accessibles, sélecteur EUR/USD et filtres.
- [ ] Traiter valeurs absentes, partielles, anciennes et portefeuille vide.

**Fichiers prévus :** `src/modules/prices/*`, `src/modules/valuation/*`, routes summary/allocation, dashboard, portfolio, composants graphiques et tests.

**Commandes cibles :** `pnpm test:unit -- prices`, `pnpm test:integration -- valuation`, `pnpm build`.

**Critères de sortie :** tableau de bord cohérent avec le journal ; fonctionnement sans API ni clé ; panne fournisseur sans perte du prix connu ; aucune nouvelle date frauduleuse sur un prix ancien ; pas de total complet avec un prix manquant.

## Phase 5 — Snapshots, historique et performance

Choix : captures immuables complètes avec sources et taux, distinctes de la valorisation courante. Le job quotidien et le bouton manuel partagent le même service.

- [ ] Persister en-tête et lignes d'actifs, de cash et de catégories atomiquement.
- [ ] Ajouter snapshots manuels et quotidiens idempotents, script et handler protégés.
- [ ] Configurer le scheduler local optionnel et documenter le cron futur.
- [ ] Construire `/history`, courbe jour/mois/année, filtres 24 h/7 j/30 j/1 an/début.
- [ ] Ajouter bornes effectives, qualité des captures et signalement des révisions antidatées.
- [ ] Implémenter variation brute, résultat après flux et pourcentage Dietz explicite.
- [ ] Vérifier fuseaux, changement d'heure, jours manquants et périodes sans données.

**Fichiers prévus :** `src/modules/snapshots/*`, scripts snapshots, routes history/jobs, page historique, tests snapshots/performance.

**Commandes cibles :** `pnpm snapshot -- --portfolio <uuid>`, `pnpm test:unit -- performance`, `pnpm test:integration -- snapshots`.

**Critères de sortie :** ancien snapshot inchangé après prix/transaction modifiés ; deux appels quotidiens = une capture ; total = lignes ; dépôt seul = rendement nul ; historique insuffisant explicite ; aucune capture rétrospective inventée.

## Phase 6 — Import et export

Choix : prévisualisation persistée, confirmation explicite et validation atomique. Les fichiers sont des données sensibles, pas une voie de contournement des règles métier.

- [ ] Modèles CSV d'actifs/transactions et documentation des colonnes.
- [ ] Parsing borné, validation complète, normalisation explicite des décimaux/dates.
- [ ] Aperçu avec erreurs et doublons ; confirmation privée avec empreinte et version.
- [ ] Import atomique, références stables et protection contre un second import involontaire.
- [ ] Export actifs et transactions CSV, historique CSV, JSON complet versionné.
- [ ] Neutralisation des formules CSV et préservation des décimaux/Unicode.
- [ ] Gestion des fichiers trop grands, lots expirés et changements après aperçu.

**Fichiers prévus :** `src/modules/imports/*`, routes imports/exports, UI settings/import, modèles sous `public/templates/`, tests de portabilité.

**Commandes cibles :** `pnpm test:unit -- csv`, `pnpm test:integration -- imports`, `pnpm test:integration -- exports`.

**Critères de sortie :** aperçu sans mutation financière, ligne invalide = aucune écriture, réessai sans doublon, tentative d'accès au lot d'un autre propriétaire refusée, export fidèle aux décimaux et à l'historique.

## Phase 7 — Démonstration et validation complète

Choix : seed déterministe séparé des données réelles ; validation du parcours sur PostgreSQL et dans le navigateur.

- [ ] Seed avec Bitcoin, Ethereum, ETF S&P 500, action fictive, pièce d'or, pièce d'argent, Pokémon et One Piece.
- [ ] Transactions variées, liquidités, prix et change fictifs datés, et 400 jours de snapshots pour tester 1 an.
- [ ] Seed rejouable dans le portefeuille de démonstration sans reset d'une base réelle.
- [ ] Tests unitaires des invariants et tests par propriétés utiles.
- [ ] Tests API et intégration PostgreSQL des cas critiques et des conflits.
- [ ] Playwright desktop/mobile : parcours principal, import/export, session et confirmations.
- [ ] Vérifications accessibilité, clavier, zoom, tableaux et graphiques.
- [ ] Vérifications erreurs/états vides et fonctionnement sans fournisseur externe.
- [ ] CI avec PostgreSQL dédié ; secrets absents des artefacts de test.

**Fichiers prévus :** `prisma/seed.ts`, fixtures, `vitest.config.ts`, `playwright.config.ts`, tests, workflow CI.

**Commandes cibles :**

```powershell
pnpm db:seed:demo
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

**Critères de sortie :** suites réellement exécutées sans échec, totaux de référence vérifiés, navigation mobile utilisable, contrôles essentiels au clavier, aucune donnée fictive injectée dans un portefeuille réel. Un test empêché par l'environnement reste marqué non exécuté.

## Phase 8 — Exploitation et livraison du MVP

Choix : migrations explicites, sauvegardes contrôlées et restauration testée avant toute déclaration de disponibilité durable.

- [ ] README final d'installation Windows/Linux, configuration, commandes et dépannage.
- [ ] Guide de sauvegarde PostgreSQL + fichiers privés, chiffrement et rétention.
- [ ] Scripts de sauvegarde/restauration avec contrôle de destination et absence de secrets dans les logs.
- [ ] Exercice de restauration dans une base distincte et vérification des totaux.
- [ ] Guide de déploiement Node.js/Docker et adaptations Railway, Render, Vercel + PostgreSQL.
- [ ] Pooling et connexion de migration, TLS, secrets, stockage privé et cron de production.
- [ ] Test Docker complet depuis une base vide puis test après redémarrage avec volume existant.
- [ ] Mise à jour de la roadmap avec résultats réels et limites restantes.

**Fichiers prévus :** `README.md` final, `docs/installation.md`, `docs/configuration.md`, `docs/backup-restore.md`, `docs/deployment.md`, scripts d'exploitation, Dockerfile/Compose finalisés.

**Commandes cibles :** `docker compose build`, `docker compose up -d`, `pnpm db:deploy`, `pnpm backup`, `pnpm restore:verify`, puis smoke test de connexion et lecture du patrimoine.

**Critères de sortie :** installation reproductible documentée, persistance après redémarrage, sauvegarde restaurée et vérifiée, secrets absents du dépôt et des images, routes privées protégées. Le déploiement sur un compte externe est une étape ultérieure selon la cible effectivement choisie.

## Évolutions à préparer, sans les implémenter dans le MVP

| Évolution | Point d'extension prévu |
| --- | --- |
| Coinbase, Binance, Kraken et autres exchanges | Adaptateur d'import + références externes/idempotence ; connexion sur autorisation explicite |
| Wallets blockchain et courtier | Adaptateurs de synchronisation ; aucune clé privée dans les modèles d'actifs |
| Prix de marchés et marketplaces de cartes | PriceProvider par catégorie et mapping d'identifiants publics |
| Synchronisation automatique | Journal et jobs idempotents avec checkpoints par source |
| Fiscalité française | Moteur fiscal distinct, règles versionnées ; ne pas réutiliser implicitement le PMA économique |
| Plusieurs portefeuilles / utilisateurs | Scopes propriétaire/portefeuille déjà imposés ; UI et gestion des droits ultérieures |
| Partage avec conseiller ou famille | Adhésions/rôles futurs ; aucun lien public de données financières |
| Factures et preuves d'achat | Abstraction de stockage privé utilisée par les images |
| Notifications et alertes | Événements métier et jobs ultérieurs, sans service de notification prématuré |
| PWA/mobile | API indépendante et composants responsive, stratégie hors ligne à concevoir |
| Dividendes et intérêts avancés | Enregistrement manuel des dividendes/récompenses dès le MVP ; calendriers et synchronisation ultérieurs |
| Objectifs et rééquilibrage | Services d'analyse en lecture seule au-dessus des positions et des catégories |

## Définition de terminé du MVP

La validation exhaustive du plan initial exige tous ses critères, y compris Docker et l’environnement cible. La version locale 0.1.0 constitue désormais une application développée et testée ; le bilan de livraison en tête de ce document fait foi pour son périmètre et ses limites.
