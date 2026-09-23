# Implémentation de la version 0.1.0

État réel au 23 septembre 2026. Ce document précise le contrat actuellement exécutable ; les anciens documents d’architecture et d’API restent la cible d’évolution.

## Architecture effective

Next.js App Router, React, TypeScript strict, PostgreSQL 17, Prisma 7 avec adaptateur pg, Better Auth, Zod et Decimal.js. L’interface utilise Tailwind CSS et les primitives accessibles Radix. Les fonctions métier restent indépendantes des composants React.

Le navigateur reçoit un état du portefeuille préparé côté serveur. Une transaction PostgreSQL en lecture répétable rend les quantités, prix, taux et totaux cohérents. Les calculs métier utilisent des décimaux ; la conversion en Number est réservée au tracé des graphiques et au formatage de l’affichage. Les écritures JSON transportent les nombres financiers sous forme de chaînes.

Les mutations métier passent par une transaction sérialisable, une clé d’idempotence et une écriture de version du portefeuille. Trois tentatives au maximum sont permises en cas de conflit sérialisable. Les commandes d’édition des fiches et des transactions nécessitent If-Match. Les ventes sont vérifiées en rejouant le journal complet, y compris pour les opérations antidatées, corrigées ou annulées.

L’inscription publique est désactivée. user:create provisionne un utilisateur, son portefeuille, EUR/USD, les six catégories et une plateforme initiale. Plusieurs comptes peuvent exister ; leur isolation est vérifiée dans les services et les tests. Le premier portefeuille du propriétaire est celui utilisé par l’interface. Le choix d’un autre portefeuille est différé.

## Modèle réellement persisté

Voir [le schéma Prisma](../prisma/schema.prisma) et les migrations dans prisma/migrations. Les modèles sont User, Session, Account, Verification, RateLimit, Currency, Portfolio, AssetCategory, Platform, Asset, AssetImage, Transaction, TransactionRevision, PriceHistory, FxRate, PortfolioSnapshot, IdempotencyRecord, AuditLog et ImportBatch.

- Les caractéristiques spécialisées des actifs sont un JSON validé par Zod dans Asset.metadata. Les tables séparées de spécialisation décrites dans la conception ne sont pas encore nécessaires à cette version.
- Les plateformes sont des libellés dans les écritures ; la table Platform prépare leur administration future. Aucun compte bancaire ou compte d’exchange n’est connecté.
- Les quantités et coûts sont recalculés depuis le journal. Il n’existe pas de seconde table de soldes susceptible de diverger.
- Une reprise d’inventaire peut marquer `Asset.metadata.costBasis = UNKNOWN`. Les quantités sont portées par un ajustement initial ; son prix nul de stockage n’est pas interprété comme un coût d’achat gratuit. La valorisation renvoie les coûts, moyennes et gains inconnus à `null`, et `totals.incompleteCostBasis` empêche les performances trompeuses, même après une cession. `PortfolioSnapshot.investedEur` accepte `null`. La levée de ce marqueur suppose de renseigner les coûts dans les opérations.
- Une transaction conserve sa projection courante et des révisions immuables. Son annulation conserve la ligne et ajoute une révision. La suppression définitive d'un actif efface ses opérations et révisions, ses prix, son image et les captures qui le contiennent dans une transaction SQL.
- Les snapshots stockent les détails des positions, liquidités, prix, taux et catégories dans un JSON immuable, avec les totaux décimaux dans leur en-tête. Ils ne sont pas reconstruits silencieusement après une correction rétroactive.
- Les images normalisées sont conservées dans AssetImage, en base. Les sauvegardes PostgreSQL incluent donc les images. Le JSON métier les exporte en base64 WebP.

Des clés étrangères composites empêchent de rattacher une transaction, un prix, une image ou une catégorie au portefeuille d’un autre actif. Les contraintes SQL supplémentaires bornent les types, devises et signes autorisés. Les références externes et clés d’idempotence sont uniques par portefeuille.

## API actuelle

Toutes les routes ci-dessous exigent une session. Les mutations exigent aussi une origine exactement égale à APP_ORIGIN et un en-tête Idempotency-Key de 8 à 150 caractères. Le portefeuille est déduit de la session. Les réponses métier portent Cache-Control: private, no-store.

| Méthode | Route après /api/v1 | Fonction |
| --- | --- | --- |
| GET | /state | Portefeuille, positions, journal, catégories, taux et 600 captures les plus récentes |
| POST | /assets | Création d’une fiche |
| PATCH | /assets/:id | Remplacement validé de la fiche, If-Match obligatoire |
| DELETE | /assets/:id | Suppression logique confirmée, sans quantité détenue, If-Match |
| POST | /assets/:id/prices | Prix manuel, ou calcul de métal à partir de gramPrice et premium |
| GET | /assets/:id/prices | 500 observations de prix les plus récentes |
| POST | /assets/:id/refresh | Vérification de la source et fallback vers la dernière observation |
| GET / POST | /assets/:id/image | Lecture privée ou chargement d’une image encodée en base64 |
| POST | /transactions | Création et validation du journal |
| PATCH | /transactions/:id | Corps transaction + reason, révision et If-Match |
| DELETE | /transactions/:id | Corps confirmed + reason, annulation avec révision et If-Match |
| POST | /fx-rates | Taux EUR/USD daté |
| PATCH | /settings | Nom du portefeuille, devise par défaut et fuseau |
| POST | /snapshots | Capture manuelle |
| GET | /snapshots/:id | Détail immuable d’une capture |
| POST | /imports/preview | CSV borné, aperçu persisté sans écriture financière |
| POST | /imports/:id/confirm | Confirmation explicite de toutes les lignes du lot |
| GET | /exports/assets.csv | Fiches et valorisation courante |
| GET | /exports/transactions.csv | Journal, y compris les transactions annulées |
| GET | /exports/history.csv | Toutes les captures et leurs détails JSON |
| GET | /exports/portfolio.json | Données métier complètes ; comptes, secrets et sessions exclus |

Les routes de connexion et déconnexion sont gérées par Better Auth sous /api/auth. Les sessions expirent après sept jours ; les tentatives de connexion sont limitées à cinq par minute. Les mots de passe sont hachés. Les erreurs serveur journalisent un type d’erreur et un identifiant de requête, sans corps financier ni secret.

Une erreur de validation donne 422, un conflit de solde ou d’idempotence 409, une version obsolète 412, une version absente 428, une absence de session 401 et une origine tierce 403. Les corps JSON métier sont limités à 256 Ko ; les images disposent d’une limite dédiée. Les images autorisées sont JPG, PNG et WebP, au maximum 2 Mo et 16 mégapixels, normalisées en WebP de 1 200 pixels maximum avec suppression des métadonnées.

## Import et prix

L’import accepte les transactions sur des actifs préexistants, identifiés par asset_id ou par un asset_symbol non ambigu. Le modèle est [import-transactions.csv](../public/import-transactions.csv). Le lot garde l’empreinte du CSV, les données normalisées, les erreurs et la version du portefeuille. Après 30 minutes ou une modification du portefeuille, il faut refaire l’aperçu. Une référence externe déjà présente ou un fichier déjà confirmé est refusé. La confirmation est atomique et rejouable sans doublon.

Les providers crypto, titres, métaux et cartes sont des adaptateurs explicitement non configurés. Leur indisponibilité conserve la dernière observation et sa date d’origine. Le prix au gramme est calculé avec Decimal.js à partir du poids brut, de la pureté et de la prime ; le cours du métal est saisi par l’utilisateur. Aucun prix de démonstration ne provient d’un marché réel.

## Wallets et DeBank

WalletConnection conserve une adresse EVM normalisée et unique par portefeuille, son inclusion dans le patrimoine, sa pause, les dates de synchronisation et un verrou temporaire. WalletObservation conserve chaque réussite ; invalidatedAt permet d’écarter une capture reconnue incomplète sans en effacer la trace. DeBankConfig choisit PUBLIC (gratuit par défaut) ou API, la fréquence et une éventuelle clé chiffrée. Les sessions et l’origine protègent ces mutations comme les autres routes.

| Méthode | Route après /api/v1 | Fonction |
| --- | --- | --- |
| POST | /wallets | Ajouter une adresse ou un profil DeBank ; label, included et referenceUsd facultatifs |
| PATCH | /wallets/:id | Nom, activation et inclusion dans le patrimoine |
| DELETE | /wallets/:id | Retrait logique ; observations conservées |
| POST | /wallets/:id/sync | Programmer une lecture ; délai minimum d’une minute |
| PATCH | /debank/config | mode PUBLIC/API, enabled, intervalMinutes 15/60/240, accessKey facultative |
| DELETE | /debank/config | Supprimer la clé et mettre la synchronisation en pause |

Le planificateur démarre dans l’instrumentation Node de Next. Toutes les 15 secondes, il recherche au plus 20 adresses échues et les traite séquentiellement. Un verrou SQL de 180 secondes évite les lectures concurrentes d’une adresse. Une pause ou une modification de configuration invalide les résultats déjà en vol. Le réseau est lu hors transaction ; l’observation et le snapshot WALLET sont publiés ensemble après vérification du verrou et de la révision de configuration. Les erreurs produisent un recul progressif et conservent la dernière réussite. Les données sont automatiquement rafraîchies à l’écran.

Le lecteur PUBLIC lance Chromium sans session personnelle, sur un hôte fixe et une adresse validée, attend « Data updated », développe les petites positions et lit le DOM rendu. Il interprète les petits nombres en indices et conserve les bornes inférieures à un centime. Il signale les protocoles dont le détail est inconnu. Le total public arrondi reste la référence ; les sous-totaux servent au détail et ne le remplacent pas. Les CAPTCHA, blocages et changements de format ne sont pas contournés. Le lecteur API utilise total_balance, all_token_list?is_all=false et all_complex_protocol_list avec la clé du propriétaire, sans réessai réseau immédiat. Les budgets et délais sont bornés.

Les wallets sont intégrés une fois aux totaux et aux répartitions, sans créer de transactions ni de coûts d’achat imaginaires. Les performances globales et Dietz sont masquées lorsque les données nécessaires manquent. Un échec du tout premier chargement laisse le patrimoine incomplet, pas artificiellement nul. Les adresses déjà représentées dans les fiches manuelles peuvent être exclues. Les sauvegardes SQL incluent observations et configurations ; l’export JSON version 2 inclut les wallets mais exclut les clés et verrous. Les captures invalidées affichent une valeur inconnue dans l’historique tout en conservant les données initiales et le motif dans leur détail.

## Périmètre vérifié et limites

Les suites de tests et leurs derniers résultats figurent dans [la roadmap](roadmap.md). L’installation locale Windows et la restauration ont été exécutées. Docker et les déploiements distants restent à valider sur leur environnement cible.

Les points suivants restent des évolutions : administration des catégories/plateformes, pagination serveur du journal, sélection de plusieurs portefeuilles, import de fiches d’actifs, intégrations de marché, conversion du rendement ajusté en USD, règles fiscales, rétention automatique des lots/idempotences et CI distante. La comparaison après flux reste une estimation Modified Dietz en EUR ; elle est masquée lorsque le journal a des révisions ou des ajouts rétroactifs par rapport aux captures. Les variations brutes de l’historique incluent les apports et retraits.

L’écran historique affiche les 600 captures les plus récentes ; son export contient l’intégralité. Le filtre « Tout » concerne les captures chargées. La version locale n’installe pas de tâche planifiée système : la commande snapshot --daily est prête à être planifiée. Aucun hébergement, compte financier ou service payant n’a été créé.
