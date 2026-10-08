# Implémentation de la version 0.1.0

> Mise à jour du 8 octobre 2026 : les descriptions DeBank/Chromium ci-dessous sont historiques. Le runtime utilise désormais Zerion sans navigateur ; voir [la validation Zerion actuelle](zerion-validation.md).

État réel au 25 septembre 2026. Ce document précise le contrat actuellement exécutable ; les anciens documents d’architecture et d’API restent la cible d’évolution.

## Architecture effective

Next.js App Router, React, TypeScript strict, PostgreSQL 17, Prisma 7 avec adaptateur pg, Better Auth, Zod et Decimal.js. L’interface utilise Tailwind CSS et les primitives accessibles Radix. Les fonctions métier restent indépendantes des composants React.

Depuis le 6 octobre 2026, les routes affichent une structure sans données privées. Le navigateur charge l’état via `/api/v1/state` authentifié et le conserve dans un contexte partagé entre les pages, avec revalidation après écriture et en arrière-plan. Voir [le fonctionnement et la réception de la navigation](navigation-performance.md). L’état du portefeuille reste préparé côté serveur. Une transaction PostgreSQL en lecture répétable rend les quantités, prix, taux et totaux cohérents. Les calculs métier utilisent des décimaux ; la conversion en Number est réservée au tracé des graphiques et au formatage de l’affichage. Les écritures JSON transportent les nombres financiers sous forme de chaînes.

Les mutations métier passent par une transaction sérialisable, une clé d’idempotence et une écriture de version du portefeuille. Trois tentatives au maximum sont permises en cas de conflit sérialisable. Les commandes d’édition des fiches et des transactions nécessitent If-Match. Les ventes sont vérifiées en rejouant le journal complet, y compris pour les opérations antidatées, corrigées ou annulées.

L’inscription publique est désactivée. user:create provisionne un utilisateur, son portefeuille, EUR/USD, les six catégories et une plateforme initiale. Plusieurs comptes peuvent exister ; leur isolation est vérifiée dans les services et les tests. Le premier portefeuille du propriétaire est celui utilisé par l’interface. Le choix d’un autre portefeuille est différé.

## Modèle réellement persisté

Voir [le schéma Prisma](../prisma/schema.prisma) et les migrations dans prisma/migrations. Les modèles sont User, Session, Account, Verification, RateLimit, Currency, Portfolio, AssetCategory, Platform, Asset, AssetImage, Transaction, TransactionRevision, PriceHistory, FxRate, PortfolioSnapshot, IdempotencyRecord, AuditLog et ImportBatch.

- Les caractéristiques spécialisées des actifs sont un JSON validé par Zod dans Asset.metadata. Les tables séparées de spécialisation décrites dans la conception ne sont pas encore nécessaires à cette version.
- Les plateformes sont des libellés dans les écritures ; la table Platform prépare leur administration future. Aucun compte bancaire ou compte d’exchange n’est connecté.
- Les quantités et coûts sont recalculés depuis le journal. Il n’existe pas de seconde table de soldes susceptible de diverger.
- Une reprise d’inventaire peut marquer `Asset.metadata.costBasis = UNKNOWN`. Les quantités sont portées par un ajustement initial ; son prix nul de stockage n’est pas interprété comme un coût d’achat gratuit. La valorisation renvoie les coûts, moyennes et gains inconnus à `null`, et `totals.incompleteCostBasis` empêche les performances trompeuses, même après une cession. `PortfolioSnapshot.investedEur` accepte `null`. La levée de ce marqueur suppose de renseigner les coûts dans les opérations.
- Une transaction conserve sa projection courante et des révisions immuables. Son annulation conserve la ligne et ajoute une révision. L’archivage d’un actif conserve sa fiche, ses opérations (y compris annulées), révisions, prix, image, snapshots et audits. Aucune purge définitive n’est exposée, même pour une fiche vide.
- Les snapshots stockent les détails des positions, liquidités, prix, taux et catégories dans un JSON immuable, avec les totaux décimaux dans leur en-tête. Ils ne sont pas reconstruits silencieusement après une correction rétroactive.
- Les images normalisées sont conservées dans AssetImage, en base. Les sauvegardes PostgreSQL incluent donc les images. Le JSON métier les exporte en base64 WebP.

Des clés étrangères composites empêchent de rattacher une transaction, un prix, une image ou une catégorie au portefeuille d’un autre actif. Les contraintes SQL supplémentaires bornent les types, devises et signes autorisés. Les références externes et clés d’idempotence sont uniques par portefeuille.

## API actuelle

Toutes les routes ci-dessous exigent une session. Les mutations exigent aussi une origine exactement égale à APP_ORIGIN et un en-tête Idempotency-Key de 8 à 150 caractères. Le portefeuille est déduit de la session. Les réponses métier portent Cache-Control: private, no-store.

| Méthode    | Route après /api/v1       | Fonction                                                                                                       |
| ---------- | ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| GET        | /state                    | Portefeuille, positions, journal, catégories, taux, 600 captures les plus récentes et `userName` de la session |
| POST       | /assets                   | Création d’une fiche                                                                                           |
| PATCH      | /assets/:id               | Remplacement validé de la fiche, If-Match obligatoire                                                          |
| DELETE     | /assets/:id               | Alias d’archivage confirmé, position soldée, If-Match ; aucune destruction                                     |
| POST       | /assets/:id/prices        | Prix manuel, ou calcul de métal à partir de gramPrice et premium                                               |
| GET        | /assets/:id/prices        | 500 observations de prix les plus récentes                                                                     |
| POST       | /assets/:id/refresh       | Vérification de la source et fallback vers la dernière observation                                             |
| GET / POST | /assets/:id/image         | Lecture privée ou chargement d’une image encodée en base64                                                     |
| POST       | /transactions             | Création et validation du journal                                                                              |
| PATCH      | /transactions/:id         | Corps transaction + reason, révision et If-Match                                                               |
| DELETE     | /transactions/:id         | Corps confirmed + reason, annulation avec révision et If-Match                                                 |
| POST       | /fx-rates                 | Taux EUR/USD daté                                                                                              |
| PATCH      | /settings                 | Nom du portefeuille, devise par défaut et fuseau                                                               |
| GET        | /api/cron/snapshot        | Job quotidien protégé par CRON_SECRET (hors API v1)                                                            |
| GET        | /snapshots/:id            | Détail immuable d’une capture                                                                                  |
| POST       | /imports/preview          | CSV ou avis PDF Bourso borné, rapprochement sans écriture financière                                           |
| POST       | /imports/:id/confirm      | Ajout atomique des nouvelles lignes et des ambiguïtés explicitement choisies                                   |
| GET        | /exports/assets.csv       | Fiches et valorisation courante                                                                                |
| GET        | /exports/transactions.csv | Journal, y compris les transactions annulées                                                                   |
| GET        | /exports/history.csv      | Toutes les captures et leurs détails JSON                                                                      |
| GET        | /exports/portfolio.json   | Données métier complètes ; comptes, secrets et sessions exclus                                                 |

Les routes de connexion et déconnexion sont gérées par Better Auth sous /api/auth. Les sessions expirent après sept jours ; les tentatives de connexion sont limitées à cinq par minute. Les mots de passe sont hachés. Les erreurs serveur journalisent un type d’erreur et un identifiant de requête, sans corps financier ni secret.

Une erreur de validation donne 422, un conflit de solde ou d’idempotence 409, une version obsolète 412, une version absente 428, une absence de session 401 et une origine tierce 403. Les corps JSON métier sont limités à 256 Ko ; les images disposent d’une limite dédiée. Les images autorisées sont JPG, PNG et WebP, au maximum 2 Mo et 16 mégapixels, normalisées en WebP de 1 200 pixels maximum avec suppression des métadonnées.

## Cycle de vie des actifs

- `ACTIVE` : fiche disponible pour les opérations ordinaires et imports, avec ou sans quantité détenue. Une quantité nulle ne change pas automatiquement le statut.
- `ARCHIVED` : fiche retirée des choix de nouvelles opérations mais toujours consultable dans Mes actifs, sa page, le journal et les exports. Transactions, révisions, prix, image, snapshots et audits sont conservés. L’archivage ne crée aucune vente et ne modifie aucun calcul historique.
- La transition vers `ARCHIVED` rejoue le journal non annulé à l’instant courant avec Decimal.js et exige une quantité exactement nulle. Une opération datée après cet instant bloque aussi l’archivage (y compris dans la tolérance d’horloge d’une minute). Soldez/corrigez d’abord la position, ou attendez/corrigez la date concernée.
- Réactivez explicitement la fiche avant tout ajout, correction, annulation ou import de transaction, même antidaté, ainsi qu’avant une correction du coût depuis la fiche. La réactivation via PATCH ne modifie pas le journal. Les fiches et les prix restent consultables et peuvent recevoir des mises à jour descriptives ou de prix ; un archivage n’est pas un verrou d’immuabilité de la fiche courante.
- PATCH conserve le contrat de remplacement de fiche avec `status`. DELETE accepte `{ "confirmed": true }` et renvoie `{ id, status: "ARCHIVED", version, archived: true, deleted: false, snapshotsDeleted: 0 }`. C’est un changement intentionnel de sémantique de l’ancienne route destructive. Idempotence, If-Match, isolation Serializable et version du portefeuille sont conservés. Les transitions ajoutent un audit `ASSET_ARCHIVED` ou `ASSET_REACTIVATED` lié à l’actif.
- La valorisation ne filtre jamais sur le statut : un ancien actif déjà archivé avec un solde reste compté. Il faut le réactiver pour solder/corriger sa position ; aucune régularisation automatique ne réécrit les données existantes.
- Aucun changement de stockage ni migration : `status` et sa contrainte SQL ACTIVE/ARCHIVED existent déjà. `deletedAt` reste un champ de compatibilité historique, non renseigné par l’archivage. Les données détruites avant ce correctif ne sont pas recréées.

## Import et prix

L’import accepte soit `csv`, soit `pdfBase64`, avec `platform`, `currency` et `source` (`GENERIC` / `BOURSORAMA`). Le PDF impose un compte et force la source Bourso. Le modèle CSV est [import-transactions.csv](../public/import-transactions.csv). `transaction-csv.ts` normalise les colonnes, montants et dates ; `bourso-notice.ts` extrait un avis textuel via `unpdf`, puis applique le même parcours. Limites : CSV 200 Ko / 500 lignes, PDF 150 Ko / deux pages / une exécution Euronext Paris. Aucun document utilisateur n’est fourni avec les tests : le PDF de test est synthétique.

Les actifs sont identifiés par `asset_id`, ou par compte et ISIN/symbole. Un ISIN inconnu avec nom produit une fiche Bourse au prix manuel, créée uniquement à la confirmation. `import-matching.ts` privilégie les références courtier isolées par source et compte, puis compare les empreintes normalisées en conservant les occurrences multiples. Les statuts sont `EXISTING`, `NEW`, `CHANGED`, `AMBIGUOUS`. Une référence conflictuelle ou annulée n’est jamais recréée ; une opération sans référence fiable peut être ajoutée comme distincte après choix explicite. Les inventaires restent intacts, et les avis potentiellement antérieurs sont signalés.

L’aperçu conserve les données normalisées (pas le PDF), erreurs et version du portefeuille pendant 30 minutes. Un réimport entièrement connu renvoie `id: unchanged` sans persistance, audit ni incrément de version. La confirmation `{ confirmed: true, decisions?: [{ line, action: 'CREATE' | 'IGNORE' }] }` refait le rapprochement sous le verrou de mutation existant, ajoute les nouvelles lignes, ignore les ambiguïtés par défaut et valide le journal entier. Les choix explicites imposent une version inchangée ; les doublons concurrents peuvent être ignorés automatiquement. Le lot confirmé est rejouable sans écriture. Aucune migration n’est nécessaire. Le brut BUY/SELL conserve l’arrondi courtier (écart maximal de 0,01 avec quantité × cours) dans le coût et les flux ; les anciens montants à zéro restent calculés depuis quantité × cours.

### Validation de l’import (7 octobre 2026)

200 tests unitaires et 67 tests d’intégration réussis ; test ciblé supplémentaire réussi pour préserver le brut arrondi après édition du commentaire. TypeScript, ESLint, formatage ciblé, contrôle du diff et build production Next.js réussis. L’intégration utilise une base PGlite éphémère exposée uniquement sur `127.0.0.1:55439` : elle ne remplace pas une validation de concurrence sur un serveur PostgreSQL natif. Aucun test navigateur ni déploiement effectué lors de cette finalisation.

Commandes reproductibles depuis le projet, avec Node 24 et les dépendances installées :

```sh
node node_modules/vitest/vitest.mjs run tests/unit
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
# Définir les TROIS variables vers une base locale dédiée dont le nom finit par _test.
# DIRECT_URL est également utilisée par Prisma migrate deploy dans les tests.
DATABASE_URL="$DATABASE_URL_TEST" DIRECT_URL="$DATABASE_URL_TEST" \
  node node_modules/vitest/vitest.mjs run tests/integration --maxWorkers=1
VERCEL=1 node node_modules/next/dist/bin/next build --webpack
```

Lors de cette validation, les trois URL de base et les paramètres d’authentification ont été explicitement remplacés dans les processus enfants, y compris pour le build ; aucun fichier `.env` modifié. Le seul PDF versionné est synthétique.

Les providers crypto, titres, métaux et cartes sont des adaptateurs explicitement non configurés. Leur indisponibilité conserve la dernière observation et sa date d’origine. Le prix au gramme est calculé avec Decimal.js à partir du poids brut, de la pureté et de la prime ; le cours du métal est saisi par l’utilisateur. Aucun prix de démonstration ne provient d’un marché réel.

## Wallets et DeBank

WalletConnection conserve une adresse EVM normalisée et unique par portefeuille, son inclusion dans le patrimoine, sa pause, les dates de synchronisation et un verrou temporaire. WalletObservation conserve chaque réussite ; invalidatedAt permet d’écarter une capture reconnue incomplète sans en effacer la trace. DeBankConfig choisit PUBLIC (gratuit par défaut) ou API, la fréquence et une éventuelle clé chiffrée. Les sessions et l’origine protègent ces mutations comme les autres routes.

| Méthode | Route après /api/v1 | Fonction                                                                              |
| ------- | ------------------- | ------------------------------------------------------------------------------------- |
| POST    | /wallets            | Ajouter une adresse ou un profil DeBank ; label, included et referenceUsd facultatifs |
| PATCH   | /wallets/:id        | Nom, activation et inclusion dans le patrimoine                                       |
| DELETE  | /wallets/:id        | Retrait logique ; observations conservées                                             |
| POST    | /wallets/:id/sync   | Programmer une lecture ; délai minimum d’une minute                                   |
| PATCH   | /debank/config      | mode PUBLIC/API, enabled, intervalMinutes 15/60/240, accessKey facultative            |
| DELETE  | /debank/config      | Supprimer la clé et mettre la synchronisation en pause                                |

Le cron Vercel quotidien appelle `syncDueWallets()`, qui recherche au plus 20 adresses échues et les traite séquentiellement, dans un budget de temps borné. Aucun planificateur ne démarre avec Next.js. Le refresh authentifié appelle le même cœur métier via `syncWallet()` dans `after()`. Un verrou SQL de 180 secondes évite les lectures concurrentes d’une adresse. Une pause ou une modification de configuration invalide les résultats déjà en vol. Le réseau est lu hors transaction ; l’observation et l’état de synchronisation sont publiés ensemble après vérification du verrou et de la révision de configuration. L’écriture de version du portefeuille reste conservée. Les erreurs produisent un recul progressif et conservent la dernière réussite. Les données sont automatiquement rafraîchies à l’écran.

### Fréquences et changements de périmètre

- Chaque synchronisation réussie, automatique ou demandée par l’utilisateur, ajoute une `WalletObservation`. Elle ne crée aucun `PortfolioSnapshot`, même au premier succès. Les intervalles de 15, 60 ou 240 minutes déterminent l’éligibilité au prochain passage quotidien, pas la fréquence du cron.
- Seul le job `createPortfolioSnapshots()` appelé à 06 h UTC crée des captures de production. Il traite le portefeuille principal de chaque utilisateur, comme `owned()`, par pages de 25. Les propriétaires ayant déjà une référence du jour sont exclus des pages pour permettre une reprise après interruption.
- `runSnapshot(id, at)` calcule le jour en Europe/Paris, lit une transaction RepeatableRead, puis insère une capture DAILY immuable. Les conflits et erreurs transitoires SQL sont retentés jusqu’à trois fois. Une capture existante est retournée sans réévaluation ni remplacement. Les données manquantes restent null.
- La clé unique `referenceOwnerId/referenceDay` protège même les exécutions concurrentes sur plusieurs portefeuilles d’un utilisateur. `dailyKey` est conservé comme métadonnée historique, mais n’est plus écrit.
- Imports, inclusion/exclusion, retrait/restauration et synchronisation de wallets ne créent pas de snapshots. Les totaux courants et observations continuent de fonctionner. L’existence persistante d’un wallet, même retiré, masque la performance après flux qui serait trompeuse après un changement de périmètre.
- Dashboard, historique et courbes de catégories utilisent les références quotidiennes ; aucune valeur courante n’est ajoutée à la courbe historique. Un jour manquant interrompt la ligne, sans extrapolation. Les dates de capture sont affichées en Europe/Paris.
- La migration conserve tous les enregistrements historiques et leurs valeurs. Les références anciennes peuvent être de type MANUAL, WALLET ou SEED : leur provenance reste honnête. L’export CSV/JSON inclut aussi les captures non retenues.

Voir [le contrat et la validation des snapshots automatiques](automatic-snapshots.md). Le seul autre producteur est le seeder de démonstration, explicitement limité aux portefeuilles `isDemo`.

Le lecteur PUBLIC lance Chromium sans session personnelle, sur un hôte fixe et une adresse validée, attend « Data updated », développe les petites positions et lit le DOM rendu. Il interprète les petits nombres en indices et conserve les bornes inférieures à un centime. Il signale les protocoles dont le détail est inconnu. Le total public arrondi reste la référence ; les sous-totaux servent au détail et ne le remplacent pas. Les CAPTCHA, blocages et changements de format ne sont pas contournés. Le lecteur API utilise total_balance, all_token_list?is_all=false et all_complex_protocol_list avec la clé du propriétaire, sans réessai réseau immédiat. Les budgets et délais sont bornés.

Les wallets sont intégrés une fois aux totaux et aux répartitions, sans créer de transactions ni de coûts d’achat imaginaires. Les performances globales et Dietz sont masquées lorsque les données nécessaires manquent. Un échec du tout premier chargement laisse le patrimoine incomplet, pas artificiellement nul. Les adresses déjà représentées dans les fiches manuelles peuvent être exclues. Les sauvegardes SQL incluent observations et configurations ; l’export JSON version 2 inclut les wallets mais exclut les clés et verrous. Les captures invalidées affichent une valeur inconnue dans l’historique tout en conservant les données initiales et le motif dans leur détail.

## Périmètre vérifié et limites

Les suites de tests et leurs derniers résultats figurent dans [la roadmap](roadmap.md). L’installation locale Windows et la restauration ont été exécutées. Docker et les déploiements distants restent à valider sur leur environnement cible.

Le [workflow CI GitHub](ci.md) est défini pour les pushes et pull requests vers `main`, avec les versions du dépôt, PostgreSQL 17 éphémère, secrets générés et contrôles bloquants jusqu’à Playwright. Sa première exécution distante et l’activation du statut requis `Quality` dans les règles de `main` restent à confirmer après publication du workflow.

Les points suivants restent des évolutions : administration des catégories/plateformes, pagination serveur du journal, sélection de plusieurs portefeuilles, import de fiches d’actifs, intégrations de marché, conversion du rendement ajusté en USD, règles fiscales et rétention automatique des lots/idempotences. La comparaison après flux reste une estimation Modified Dietz en EUR ; elle est masquée lorsque le journal a des révisions ou des ajouts rétroactifs par rapport aux captures. Les variations brutes de l’historique incluent les apports et retraits.

L’écran historique affiche les 600 références quotidiennes les plus récentes ; son export contient l’intégralité. Le filtre « Tout » concerne les captures chargées. Les snapshots quotidiens nécessitent le cron Vercel ou une planification externe de `pnpm workers snapshot`, indépendamment du navigateur. La version locale n’installe pas de tâche planifiée système. Aucun hébergement, compte financier ou service payant n’a été créé.
