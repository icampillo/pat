# Patrimoine

Application privée de suivi des investissements : cryptomonnaies, métaux, actions/ETF, cartes Pokémon et One Piece. Interface française, EUR/USD, PostgreSQL et calculs décimaux.

**Version locale — 23 septembre 2026.** L’application fonctionne avec des données persistantes. Le portefeuille local contient les sept fiches de pièces importées et le wallet personnel synchronisé gratuitement depuis DeBank ; les actifs et historiques fictifs du jeu de démonstration ont été retirés. Le taux EUR/USD de référence BCE et les cours spot de l’or et de l’argent sont actualisés automatiquement. Les autres fournisseurs de marché restent non configurés. Le statut détaillé et les limites se trouvent dans [la roadmap](docs/roadmap.md).

## Ce qui fonctionne

- Connexion privée, sessions PostgreSQL, inscription publique désactivée et création des utilisateurs par commande locale.
- Wallets par adresse EVM : lecture gratuite du profil public DeBank, tokens, staking, prêts, dettes, récompenses et synchronisation automatique.
- Création, modification et archivage réversible des actifs soldés ; historique financier et images privées conservés, sans purge définitive.
- Neuf types d’opération, correction avec motif, annulation confirmée, historique des révisions et contrôle des soldes par plateforme.
- Quantités, coût moyen pondéré, capital détenu, gains réalisés/latents, revenus, liquidités et apports nets.
- Tableau de bord, répartition par catégorie/devise, EUR/USD et courbes sur plusieurs périodes.
- Prix manuels historisés ; pièces importées valorisées automatiquement selon poids fin, cours spot de l’or ou de l’argent et taux BCE. Fallback vers le dernier prix connu.
- Snapshots immuables, historique journalier/mensuel/annuel, commande quotidienne idempotente.
- Import CSV avec aperçu, validation et confirmation atomique ; exports actifs, transactions, historique et JSON avec images et révisions.

## Lancer le projet existant

Prérequis : Node.js 24 et pnpm 11.19.0. Ouvrir deux terminaux dans ce dossier.

Terminal 1 — PostgreSQL portable local :

```powershell
pnpm db:local
```

Terminal 2 — application :

```powershell
pnpm dev
```

Ouvrir [http://localhost:3000](http://localhost:3000). Les identifiants locaux existants sont dans **.local/demo-access.json**, ignoré par Git. Ce compte contient désormais les données personnelles ; conserver ce fichier privé et ne pas le publier. Le serveur de développement écoute seulement sur la machine locale ; employer localhost pour respecter l’origine de connexion configurée.

Le dossier .local/postgres contient les données persistantes. Arrêter le terminal PostgreSQL proprement avec Ctrl+C. Les données restent disponibles au prochain lancement.

## Cours et change automatiques

Le cron quotidien de marché interroge le [taux de référence EUR/USD de la BCE](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml) et les cours publics [XAU/XAG de Gold API](https://gold-api.com/llms.txt). Le taux BCE est publié les jours ouvrés ; sa date est affichée dans **Paramètres → Taux de change**. Le bouton **Actualiser les cours et le taux** lance une lecture immédiate. Une actualisation en ligne de commande est aussi disponible avec `pnpm market:sync`.

Les sept pièces importées utilisent le cours spot en USD par once troy, converti en EUR par gramme avec le taux BCE, puis multiplié par le poids et la pureté de chaque pièce. L’once troy vaut 31,1034768 g. Les cotations et leurs sources sont conservées dans l’historique ; les quantités et l’absence de coût d’achat restent inchangées. La valeur calculée est celle du métal fin avec la prime enregistrée sur la fiche (zéro pour l’import actuel) : une éventuelle valeur numismatique n’est pas estimée. Si un fournisseur est indisponible, le dernier cours enregistré reste visible avec sa date, sans créer de cotation fictive.

## Installer depuis une copie du code

```powershell
pnpm install --frozen-lockfile
pnpm wallet:install
pnpm setup:local
pnpm db:local
```

Dans un second terminal :

```powershell
pnpm db:generate
pnpm db:deploy
pnpm db:seed:demo
pnpm dev
```

setup:local génère des secrets aléatoires dans .env et refuse d’écraser un fichier existant. Le serveur portable écoute sur 127.0.0.1:55432 et crée deux bases : patrimoine et patrimoine_test. Pour un autre PostgreSQL, renseigner les URL dans .env à partir de .env.example et ne pas utiliser db:local.

Pour des données personnelles séparées de la démonstration :

```powershell
pnpm user:create
```

La commande demande un nom, une adresse e-mail et un mot de passe masqué. Elle crée un portefeuille vide avec ses catégories. Les comptes sont isolés ; l’interface utilise un portefeuille par compte.

## Docker Compose

Docker n’est pas installé sur la machine de développement : ces fichiers sont fournis mais leur exécution n’a pas été validée ici.

1. Générer .env avec setup:local, ou copier .env.example si aucun .env n’existe, puis remplacer les secrets.
2. Arrêter le serveur Node local pour libérer le port 3000.
3. Lancer :

```powershell
docker compose up -d --build
docker compose --profile tools run --rm tools pnpm user:create
```

Compose démarre PostgreSQL, attend son healthcheck, applique les migrations, puis démarre l’application. La cible tools du Dockerfile sert au provisionnement et aux migrations. L’image finale Next.js fonctionne sous l’utilisateur non-root node et installe Chromium avec ses dépendances système pour les wallets gratuits ([installation Playwright](https://playwright.dev/docs/browsers#install-system-dependencies)). Le volume postgres_data conserve la base. Les identifiants sont injectés à l’exécution ; .env est exclu du contexte de build. Le conteneur utilise son propre PostgreSQL sur le port local 5432, distinct du PostgreSQL portable sur 55432. Ce déploiement Docker reste à vérifier sur une machine équipée.

Pour créer la démonstration Docker :

```powershell
docker compose --profile tools run --rm tools pnpm db:seed:demo
```

La base patrimoine_test est créée au premier démarrage du volume. Le script SQL d’initialisation n’est pas rejoué sur un volume déjà initialisé. Ne pas supprimer le volume pour appliquer une migration. Voir [l’ordre de démarrage Compose](https://docs.docker.com/compose/how-tos/startup-order/).

## Wallets gratuits avec DeBank

Ouvrir **Wallets & DeFi**, coller une adresse EVM ou son URL de profil DeBank, puis **Ajouter le wallet**. Aucun compte DeBank, clé API, connexion de wallet ni signature n’est nécessaire. La lecture gratuite est le mode par défaut. Après une mise à jour du code, lancer `pnpm db:deploy`, `pnpm db:generate`, puis redémarrer le serveur. `pnpm wallet:install` installe Chromium si nécessaire ; il est déjà disponible sur cette machine.

Le serveur ouvre un navigateur invisible et lit les données rendues du profil public. Il attend la fin du chargement, déplie les petits soldes et protocoles, et ferme le navigateur. Il ne clique sur aucun bouton de retrait ou de transaction et n’utilise ni cookies personnels ni signatures d’API internes.

La première lecture et le bouton **Actualiser** déclenchent le même service que le cron, via `after()` dans l’invocation HTTP authentifiée. Sur Vercel, le cron automatique passe une fois par jour. Dans **Paramètres → Connexion DeBank**, les délais de 15 minutes, 1 heure ou 4 heures sont des délais minimaux d’éligibilité, pas des fréquences de cron. Une pause conserve la dernière observation. Aucun worker permanent n’est nécessaire.

Les données ont la couverture, les arrondis et la fraîcheur affichés par DeBank. Une modification du site ou un blocage peut interrompre la lecture ; l’application conserve alors la dernière observation et affiche l’erreur. Le total net n’est ajouté qu’une fois au patrimoine ; les détails de staking et les récompenses ne sont pas additionnés une seconde fois. Les fiches manuelles restent comptées : exclure le wallet du total si elles représentent déjà les mêmes positions.

Le lecteur ne reconstruit pas les achats passés, les coûts d’achat ni les transactions ; aucun faux achat n’est créé. Les performances agrégées sont indisponibles quand le coût des wallets est inconnu. Les wallets sont valorisés en USD ; la conversion du patrimoine en EUR utilise le taux enregistré dans les paramètres. Les NFT individuels ne sont pas importés. Le JSON métier contient les observations des wallets ; le CSV des actifs concerne les fiches manuelles.

Le mode **API officielle** reste facultatif et nécessite une clé DeBank Cloud et ses crédits ; il n’est jamais activé automatiquement. La clé est chiffrée en AES-GCM avec une clé dérivée de BETTER_AUTH_SECRET et liée au portefeuille. Les exports métier excluent la clé, même chiffrée. Conserver BETTER_AUTH_SECRET avec les sauvegardes ; après rotation, renseigner à nouveau la clé API. [Documentation DeBank](https://docs.cloud.debank.com/en/readme/open-api).

Diagnostic gratuit en lecture seule, sans modifier le portefeuille :

```powershell
pnpm wallet:check 0xVotreAdresse
```

## Tests et compilation

Le workflow GitHub **CI / Quality** vérifie les pushes sur `main` et les pull requests vers `main` : installation verrouillée, génération Prisma et types Next.js, typecheck, lint, tests unitaires/PostgreSQL, build et Playwright. Il utilise un PostgreSQL 17 éphémère dédié et des secrets de test générés, sans secret de production. Voir [le fonctionnement de la CI et le contrôle requis pour les merges](docs/ci.md).

```powershell
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

Les tests d’intégration et de navigateur utilisent exclusivement DATABASE_URL_TEST et refusent une base dont le nom ne se termine pas par _test. Ils créent des comptes isolés de test ; ils ne vident pas la base. Playwright lance son serveur sur 3001 et utilise .next-e2e afin de cohabiter avec le développement sur 3000.

Les parcours vérifient connexion, actif, image, transactions, snapshot, export/import, ajout gratuit d’adresse et positions synchronisées. Les autres scénarios couvrent le mobile à 375 px et l’accessibilité sur neuf écrans. Les tests utilisent des réponses DeBank synthétiques sans appel externe. Une lecture réelle gratuite du wallet fourni a aussi été vérifiée. Ces contrôles ne constituent pas un audit exhaustif avec lecteurs d’écran.

## Snapshots et import

À la création d’un actif, saisir la quantité détenue et, si vous le connaissez, le coût d’acquisition total en euros. Une opération d’inventaire est créée automatiquement pour enregistrer cette quantité ; elle ne prétend pas dater l’achat. Si le coût reste vide, les quantités et la valorisation s’affichent, mais les gains qui dépendent du prix d’achat restent indisponibles. Le coût peut ensuite être renseigné depuis la fiche tant qu’elle ne contient qu’une opération initiale. Pour une pièce d’or ou d’argent, indiquer le métal, le poids brut et la pureté : sa valeur est calculée automatiquement à partir du cours spot et du taux de change. Les prix repris d’un classeur conservent leur date d’observation : l’import ne les transforme pas en cours de marché actuels.

Un bouton crée une capture manuelle. Pour la commande quotidienne, récupérer portfolio.id dans l’export JSON :

```powershell
pnpm snapshot --portfolio <uuid-du-portefeuille> --daily
```

Le cron quotidien `/api/cron/snapshot` crée les captures manquantes du jour local de chaque portefeuille. La contrainte unique existante conserve au plus un snapshot quotidien par journée locale, même avec plusieurs invocations ; les captures manuelles restent possibles. Le démarrage de Next.js ne lance plus de planificateur.

Les journées manquées ne sont pas reconstruites. Une erreur est isolée par portefeuille et signalée en HTTP 503 ; Vercel ne retente pas automatiquement les crons échoués. Une relance authentifiée le même jour peut compléter les captures manquantes. La commande ci-dessus reste disponible. Les captures figent les dernières données enregistrées, sans forcer leur synchronisation. Les captures anciennes restent inchangées après une correction rétroactive, et l’estimation de performance après flux est alors désactivée.

Les synchronisations DeBank (cron quotidien ou demande manuelle) conservent leurs observations et actualisent les valeurs courantes sans créer de snapshot complet. Les captures supplémentaires concernent les demandes manuelles et les changements d’inclusion des wallets. Mettre la synchronisation en pause conserve la dernière valeur dans le patrimoine. Voir [les règles de fréquence et de périmètre](docs/implementation.md#fréquences-et-changements-de-périmètre).

L’import de nouvelles opérations se trouve dans Paramètres et dans la catégorie Bourse. Identifier les actifs par `asset_id` ou par symbole et compte ; un ISIN et un nom permettent aussi de créer une fiche Bourse (prix manuel, sans cotation inventée). CSV UTF-8, séparateur virgule, point-virgule ou tabulation, nombres français acceptés, dates ISO 8601 avec fuseau ou dates seules ISO / JJ/MM/AAAA. Types BUY/SELL/DEPOSIT/WITHDRAWAL/TRANSFER/FEE/DIVIDEND/REWARD/ADJUSTMENT, avec alias français pour achat, vente, dividende, frais, dépôt et retrait. La référence du courtier est recommandée ; sans référence, le rapprochement compare les données et leur nombre d’occurrences. Limites : 200 Ko, 500 lignes, aperçu valable 30 minutes. Les opérations connues sont ignorées ; les différences sont présentées sans modifier l’historique. Le journal est revérifié à la confirmation, qui reste atomique. Voir [l’API actuelle](docs/implementation.md).

Pour BoursoBank, déposer un **nouvel avis d’opéré PDF** et saisir exactement le compte de la position existante (distinguer PEA et CTO). Formats acceptés : PDF textuel, une exécution d’achat/vente au comptant sur Euronext Paris, deux pages maximum, 150 Ko. L’aperçu affiche la quantité, le cours, le montant brut et les frais ; l’heure est convertie depuis Europe/Paris et la référence empêche le double import. Le brut arrondi du courtier est conservé. Les scans et autres présentations sont refusés. Conserver les positions actuelles comme point de départ et ajouter uniquement les nouveaux avis non inclus dans l’inventaire ; un ancien avis potentiellement couvert est signalé pour vérification, jamais ajouté automatiquement.

Les exports CSV servent à la consultation ; le modèle d’import est distinct. Le JSON est un export métier complet, pas un remplacement de la sauvegarde PostgreSQL des comptes et sessions.

## Sauvegarder et restaurer

Les dumps contiennent des données privées. backups/ et .local/ sont ignorés par Git. Stocker les sauvegardes dans un emplacement protégé et conserver séparément les secrets de configuration.

Installer les outils clients PostgreSQL de la même version majeure que le serveur ou d’une version compatible. Le paquet PostgreSQL portable ne fournit pas pg_dump. Sur cette machine, les outils officiels 17.11 ont été extraits dans .local/pg-tools/bin, automatiquement détecté. Ailleurs, définir PGBIN vers le répertoire des outils ou les ajouter au PATH. Source : [binaires officiels distribués par EDB](https://www.enterprisedb.com/download-postgresql-binaries).

```powershell
pnpm db:backup
pnpm db:restore --file backups/nom-du-fichier.dump --database patrimoine_restore_verification
```

La restauration crée une **nouvelle base** ; elle refuse une cible existante ou un nom ne commençant pas par patrimoine_restore_. Vérifier ensuite ses données, puis modifier DATABASE_URL et redémarrer l’application pour l’utiliser. La commande ne remplace jamais la base courante. Un dump existant n’est pas écrasé.

Avec Docker, créer le dump dans le conteneur pour éviter la redirection binaire PowerShell :

```powershell
docker compose exec db pg_dump -U patrimoine -d patrimoine -Fc -f /tmp/patrimoine.dump
docker compose cp db:/tmp/patrimoine.dump ./backups/patrimoine-docker.dump
```

Pour restaurer, copier le dump dans le conteneur, créer une nouvelle base et lancer pg_restore --exit-on-error --no-owner --no-privileges vers cette nouvelle cible. Adapter le nom d’utilisateur si POSTGRES_USER a été personnalisé.

Une sauvegarde puis une restauration séparée ont été exécutées localement : les 8 actifs, 8 transactions, 401 snapshots et 3 208 prix de démonstration ont été retrouvés.

## Déploiement ultérieur

Le projet est une application Node.js avec PostgreSQL, pas un export statique. Pour un hébergement Node compatible : installer les dépendances verrouillées, exécuter db:deploy contre la base cible, installer Chromium avec pnpm wallet:install, compiler avec pnpm build, puis lancer pnpm start. Sur Linux, utiliser pnpm exec playwright install --with-deps chromium pour installer également les bibliothèques système ; cette étape nécessite les droits d’installation système. Pour le conteneur, utiliser la cible runner après un job de migration avec la cible tools ; le Dockerfile inclut déjà le navigateur.

Renseigner DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL et APP_ORIGIN. Les deux URL publiques doivent correspondre exactement à l’origine HTTPS finale. Utiliser les paramètres TLS requis par PostgreSQL et un pool de connexions adapté à l’hébergeur. Les images sont stockées en base, sans dépendance à un disque éphémère. Prévoir les sauvegardes, le job de snapshots et un mécanisme de restauration testé sur la cible. Aucun déploiement distant n’a été effectué.

## Structure et décisions

- src/domain : calculs purs avec Decimal.js.
- src/server : authentification, transactions SQL, valorisation, import/export et images.
- src/modules/prices : contrats de fournisseurs et fallback.
- src/app et src/components : routes Next.js, formulaires, graphiques et navigation.
- prisma : schéma, migrations SQL et seed fictif.
- scripts et tests : exploitation locale et vérifications automatisées.

La [documentation d’implémentation](docs/implementation.md) décrit les choix effectifs et les écarts par rapport aux documents de conception initiaux : [architecture](docs/architecture.md), [modèle](docs/data-model.md), [calculs](docs/calculations.md), [API cible](docs/api.md).
# Import de positions Bourse (BoursoBank)

Depuis le tableau de bord, cliquer sur **Importer un CSV Bourse**, ou ouvrir la catégorie **Bourse**. Le fichier BoursoBank « export-positions-instantanees » est accepté directement : `name;isin;quantity;buyingPrice;lastPrice;intradayVariation;amount;amountVariation;variation`. Les nombres français et les espaces de milliers sont reconnus. Préciser le compte (pour distinguer PEA et CTO) et la devise du relevé, absente de cet export ; EUR est proposé par défaut. Un modèle générique est disponible dans `public/import-bourse.csv`.

L’analyse résout les ISIN vers une cotation action/ETF Yahoo Finance, récupère son cours daté et affiche le résultat avant confirmation. Les correspondances ambiguës sont refusées : ajouter le ticker complet dans le CSV pour choisir la cotation. Seules EUR et USD sont prises en charge, conformément au modèle de l’application. Aucune quantité ni aucun montant personnel n’est envoyé au fournisseur de cours ; seules les identifications de produits le sont.

À la confirmation, l’import crée les actifs, leurs positions initiales, leurs coûts connus, les prix et un snapshot dans une même transaction. Pour l’export Bourso, le coût est reconstitué par `amount - amountVariation` lorsque ces valeurs sont disponibles, après contrôle de cohérence avec le PRU arrondi ; sinon, le PRU renseigné est multiplié par la quantité. Un coût absent reste inconnu. Le fichier est un inventaire actuel, pas un historique d’achats : aucune date d’achat n’est inventée, et les éventuelles conversions du coût utilisent le taux disponible à l’import. Les prix `lastPrice` et variations du CSV ne sont pas utilisés comme des cotations en direct.

Les doublons de produit au sein du même compte sont signalés. Un relevé inchangé affiche « déjà à jour », sans écriture en base. Une position déjà présente avec la même quantité et le même coût est ignorée ; une position différente bloque la confirmation et doit être mise à jour via les transactions ou les nouveaux avis d’opéré. Les titres absents du fichier ne sont jamais supprimés automatiquement. Ce parcours ne reconstruit pas les ventes, dividendes ni autres mouvements depuis un relevé de positions.

Les actifs créés par cet import utilisent `pricingMode: SECURITIES_MARKET` et un ticker de cotation vérifié. Le job de marché actualise leurs cours via le cron quotidien ; le bouton **Actualiser les cours Bourse** permet une relance immédiate. La date du fournisseur est conservée, les observations identiques ne sont pas dupliquées, et un échec conserve le dernier cours connu. La récupération Bourse et celle des métaux sont indépendantes ; une panne des métaux ne bloque pas les titres. Le taux BCE peut également être actualisé si un fournisseur de métaux ne répond pas.

La récupération utilise les endpoints publics Yahoo Finance sans clé API. Leur disponibilité n’est pas garantie et les cours peuvent être différés selon la place ; voir [les sources et délais Yahoo Finance](https://help.yahoo.com/kb/SLN2310.html). Le fournisseur est isolé dans `src/modules/prices/securities.ts` pour pouvoir le remplacer sans modifier l’import ou l’interface.

La migration `20260923160000_bourse_label` renomme le libellé existant « Actions & ETF » en « Bourse ». La clé technique `SECURITIES` et la route `/categories/stocks` restent compatibles avec les données et les liens existants.


## Déploiement Vercel

Vercel utilise le preset **Next.js** et `pnpm build` (voir `vercel.json`). Laisser le dossier de sortie à sa valeur par défaut : ne pas le remplacer par `.next/standalone`. Activer les variables système Vercel (`VERCEL=1`, normalement exposée automatiquement) au build et à l’exécution. Le mode standalone et les inclusions forcées de Playwright sont réservés à Node/Docker. Après cette correction, redéployer sans le cache de build.

Configurer côté Vercel `DATABASE_URL` (PostgreSQL accessible depuis Vercel), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` et `APP_ORIGIN` (ces deux URL doivent correspondre au domaine utilisé). Conserver `BETTER_AUTH_SECRET` : ce secret sert aussi au chiffrement des clés DeBank. Appliquer les migrations avec `pnpm db:deploy` dans un job séparé et contrôlé, jamais au build des previews. Aucun secret ne doit être commité.

### Jobs quotidiens et wallets serverless

Les trois anciens workers et l’instrumentation de démarrage ont été supprimés. `vercel.json` programme `/api/cron/market` à 02 h UTC, `/api/cron/wallets` à 04 h UTC et `/api/cron/snapshot` à 06 h UTC, une fois par jour : compatible Hobby, avec déclenchement possible pendant l’heure prévue. Les routes exigent `Authorization: Bearer <CRON_SECRET>` ; Vercel fournit cet en-tête à partir de la variable Production `CRON_SECRET`. Générer un secret aléatoire d’au moins 32 octets, sans le commiter. Activer **Fluid Compute** et utiliser Node.js 24 : les routes déclarent `maxDuration = 300`.

Hors Vercel, un ordonnanceur externe peut lancer les mêmes jobs ponctuels (la commande se termine naturellement) :

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm wallet:install
pnpm workers
```

`pnpm workers [market|wallets|snapshot|all]` exécute une passe puis déconnecte Prisma. Sur Node/Docker, fournir les bibliothèques Chromium et planifier la commande extérieurement. Les variables historiques `*_WORKER_DISABLED` n’ont plus d’effet : aucun timer serveur ne démarre. Aucun appel fournisseur n’est effectué au build.

Sur Vercel, `@sparticuz/chromium-min@153.0.0` télécharge le pack officiel distant **153.0.0** adapté à `process.arch` (`x64` ou `arm64`), puis Playwright le lance en runtime Node et le ferme après la lecture. Les archives Chromium ne sont pas embarquées dans les fonctions. `CHROMIUM_PACK_URL` est facultative : vide, elle utilise la release GitHub officielle versionnée ; un miroir HTTPS doit fournir exactement le même pack pour la même architecture. Le premier démarrage nécessite un téléchargement (~67 Mio en x64) ; les invocations chaudes réutilisent `/tmp/chromium`. Voir [la validation du packaging Chromium](docs/chromium-vercel-validation.md). Hors Vercel, Playwright utilise le navigateur installé localement. Aucun service navigateur distant ni abonnement n’est activé. Le cron traite les wallets séquentiellement (maximum 20 et budget de temps) ; les réponses partielles signalent `hasMore` et HTTP 503. Voir [l’audit et la validation serverless](docs/cron-validation.md) pour les limites et les contrôles avant/après déploiement.

Le build local ne valide pas l’empaquetage final des fonctions Vercel : un redéploiement reste nécessaire pour confirmer la disparition de l’erreur initiale.

## Analyser avec une IA (prompt local)

Dans le dashboard, **Analyser avec une IA** ouvre un résumé structuré du portefeuille
à consulter et copier dans l'IA de votre choix. Aucun appel LLM ni envoi automatique
n'est effectué. Le prompt utilise la devise affichée et signale les données ou
performances indisponibles. [Architecture, métriques, limites et validations](docs/portfolio-analysis.md).
