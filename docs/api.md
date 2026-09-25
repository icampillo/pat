# Contrat API du MVP

Spécification cible conservée depuis la conception. Pour appeler la version 0.1.0, utiliser [le tableau des routes effectivement implémentées](implementation.md#api-actuelle) : certaines routes ont été regroupées et le portefeuille est actuellement déduit de la session. Toutes les routes métier sont préfixées par `/api/v1`. L’authentification reste sous `/api/auth/*`.

## 1. Règles communes

- Session obligatoire. `portfolioId` est fourni explicitement puis vérifié par rapport au propriétaire connecté, jamais utilisé comme preuve d'autorisation.
- Lectures sans effet de bord. Les exports sont des téléchargements privés, sans cache public.
- Identifiants UUID ; dates ISO 8601 avec décalage obligatoire, normalisées en UTC ; décimaux envoyés sous forme de chaînes, jamais de JSON `number` financier.
- Schémas Zod stricts côté client et serveur. Les champs inattendus sont rejetés ; champs calculés comme `averageCost`, `ownerId` ou `currentValue` interdits en entrée.
- Pagination par curseur opaque, taille 25 par défaut et 100 maximum. Les filtres et tris sont sur liste blanche.
- Mutations de ressources : `If-Match` contenant la version connue. Version absente : 428 ; obsolète : 412. Création : `Idempotency-Key` requise.
- Idempotence également requise pour import, snapshot, rafraîchissement et mutations financières répétables. Même clé et même payload normalisé : même résultat ; contenu différent : 409.
- Pour une requête rejouée, l'autorisation est vérifiée puis l'idempotence résolue avant de réappliquer le contrôle de version d'une mutation déjà réussie.
- POST/PATCH/DELETE authentifiés par cookie vérifient origine et protection CSRF. Les appels du job utilisent un secret dédié, jamais la session d'un utilisateur.

Succès de lecture :

```json
{
  "data": [],
  "meta": { "nextCursor": null }
}
```

Erreur métier :

```json
{
  "error": {
    "code": "INSUFFICIENT_QUANTITY",
    "message": "La quantité disponible ne permet pas cette vente.",
    "fields": { "quantity": "Maximum disponible : 0.25" },
    "requestId": "identifiant-technique"
  }
}
```

HTTP : 200 lecture/modification ; 201 création ; 204 suppression ; 400 syntaxe ; 401 session absente ; 404 ressource introuvable ou inaccessible ; 409 invariant ou clé conflictuelle ; 412 version dépassée ; 413 fichier trop volumineux ; 422 validation ; 428 version exigée ; 429 limitation ; 503 dépendance indispensable indisponible.

## 2. Authentification et lecture globale

| Méthode | Route | Contrat |
| --- | --- | --- |
| GET/POST | `/api/auth/[...all]` | Handlers Better Auth ; seules les fonctions configurées sont actives, inscription publique désactivée |
| GET | `/api/v1/me` | Utilisateur courant, préférences et portefeuille autorisé ; aucun secret |
| GET | `/api/v1/portfolios` | Portefeuilles autorisés ; un seul exploité dans l'UI du MVP |
| GET | `/api/v1/portfolios/{id}/summary` | Devise, période, catégorie ; totaux, coûts, gains, revenus, flux et couverture des prix |
| GET | `/api/v1/portfolios/{id}/allocation` | Répartition par catégorie ou devise de cotation, pourcentages seulement sur total complet |
| GET | `/api/v1/portfolios/{id}/performance` | Variation brute, résultat après flux, rendement Dietz, bornes réelles et motif d'indisponibilité |
| GET | `/api/v1/portfolios/{id}/positions` | Positions et liquidités avec plateforme, quantités et coût dérivés |

Paramètres communs aux analyses : `currency=EUR|USD`, `period=24h|7d|30d|1y|all`, `categoryId?`, `from?`, `to?`. Une période prédéfinie et une plage explicite ne peuvent pas être mélangées. L'intervalle effectif est toujours retourné.

Quand `categoryId` est présent, `/performance` renvoie la variation et les gains de la catégorie, avec `dietzReturn=null` et `reason=CATEGORY_RETURN_NOT_SUPPORTED`. Le rendement ajusté des flux est limité au portefeuille complet dans le MVP. Chaque mesure indique sa disponibilité indépendamment de celle du total.

Un prix ancien autorise une estimation accompagnée de sa date. Un prix absent produit `totalValue=null`, `knownSubtotal`, `missingAssets` et `quality=PARTIAL` ; pas un total trompeur.

## 3. Actifs et images

| Méthode | Route | Fonction |
| --- | --- | --- |
| GET | `/assets?portfolioId=…` | Recherche et filtres catégorie/statut/plateforme, pagination |
| POST | `/assets` | Fiche, spécialisation et transaction initiale facultative atomiques |
| GET | `/assets/{id}` | Fiche, projection de position, dernier prix et statut de fraîcheur |
| PATCH | `/assets/{id}` | Métadonnées et archivage ; quantité/PMA interdits |
| DELETE | `/assets/{id}` | Confirmation explicite ; archivage réversible de la fiche soldée, sans effacement |
| GET | `/assets/{id}/prices` | Historique paginé, dates de prix et de saisie |
| POST | `/assets/{id}/prices` | Prix manuel ou correction append-only avec source et date |
| POST | `/assets/{id}/images` | Upload multipart validé, taille maximale 5 Mio, formats autorisés |
| GET | `/assets/{id}/images/{imageId}` | Lecture privée après vérification du propriétaire |
| DELETE | `/assets/{id}/images/{imageId}` | Suppression explicite de la pièce jointe |

L’archivage refuse une quantité non nulle ou une opération future en attente. La fiche, les opérations, révisions, prix, image, snapshots et audits sont conservés. Aucune vente fictive ni purge définitive n’est créée. Une réactivation explicite est requise avant toute mutation du journal d’un actif archivé. Voir le [contrat de compatibilité DELETE actuel](implementation.md#cycle-de-vie-des-actifs).

Exemple de prix manuel :

```json
{
  "price": "65000.125",
  "currency": "EUR",
  "observedAt": "2026-09-22T14:00:00Z",
  "source": "manual"
}
```

Le nom d'un fournisseur externe n'est pas accepté comme source d'une saisie manuelle. Une observation future est refusée. Une correction indique `supersedesId` et un motif.

## 4. Transactions

| Méthode | Route | Fonction |
| --- | --- | --- |
| GET | `/transactions?portfolioId=…` | Filtrer par actif, type, plateforme, date et état |
| POST | `/transactions` | Valider, créer la révision et les écritures, recalculer, auditer et valider atomiquement |
| GET | `/transactions/{id}` | Révision courante et montants dérivés |
| PATCH | `/transactions/{id}` | Nouvelle révision, motif obligatoire, replay et contrôle de l'historique ultérieur |
| DELETE | `/transactions/{id}` | Annulation confirmée, nouvelle révision VOID, replay atomique |
| GET | `/transactions/{id}/revisions` | Historique privé des corrections |

Exemple d'achat :

```json
{
  "portfolioId": "UUID_PORTFOLIO",
  "assetId": "UUID_ASSET",
  "type": "BUY",
  "quantity": "0.025",
  "unitPrice": "60000",
  "fees": "2.50",
  "currency": "EUR",
  "occurredAt": "2026-09-22T12:00:00Z",
  "platformId": "UUID_PLATFORM",
  "settlement": "EXTERNAL_FUNDING",
  "comment": "Achat saisi manuellement"
}
```

Les UUID symboliques servent à expliquer le contrat et ne sont pas des valeurs valides. Le serveur calcule le brut `1500` et le montant avec frais `1502.50`. L'aperçu client reste indicatif ; le serveur revalide quantités, liquidités et taux.

Les variantes DEPOSIT/WITHDRAWAL distinguent actif et liquidités. TRANSFER indique la destination, REWARD la juste valeur, ADJUSTMENT la raison et la nature de la correction. DIVIDEND demande un montant et un compte de réception plutôt qu'une fausse quantité.

Un DELETE financier comporte `{ "confirmed": true, "reason": "…" }`, la version et une clé d'idempotence. Il ne fait pas disparaître les révisions. L'UI doit expliquer cette annulation avant confirmation.

## 5. Prix, snapshots et historique

| Méthode | Route | Fonction |
| --- | --- | --- |
| GET | `/price-providers?portfolioId=…` | Configuration, capacités et état ; aucune clé |
| POST | `/prices/refresh` | Liste d'actifs limitée ou portefeuille ; résultat par actif, fallback explicite |
| GET | `/prices/refresh-runs?portfolioId=…` | Historique des actualisations et erreurs nettoyées |
| POST | `/portfolios/{id}/snapshots` | Capture MANUAL de l'état présent, idempotente |
| GET | `/portfolios/{id}/snapshots` | Plage et granularité jour/mois/année ; captures observées |
| GET | `/snapshots/{id}` | Lignes figées, prix, taux, frais/coûts et qualité |
| POST | `/jobs/snapshots/daily` | Jeton de job, capture quotidienne des portefeuilles éligibles |

Le job n'accepte pas un `userId` arbitraire du navigateur. Secret vérifié en temps constant ; token absent des URLs et logs. Le script local et le handler appellent le même service. Le scheduler de production adaptera la méthode HTTP à la plateforme sans changer l'idempotence.

Un rafraîchissement partiellement réussi retourne 200 avec `status=PARTIAL`, la liste des nouveaux prix, ceux conservés et ceux manquants. Une base inaccessible retourne 503. Une API de marché absente n'empêche pas les lectures de portefeuille ni la saisie manuelle.

## 6. Import et export

| Méthode | Route | Fonction |
| --- | --- | --- |
| POST | `/imports/preview` | Multipart CSV, type, portefeuille et options de format ; aperçu et erreurs ligne/champ |
| GET | `/imports/{id}` | Aperçu privé, état, expiration et empreinte |
| POST | `/imports/{id}/commit` | `{ confirmed: true, previewHash: … }`, revalidation et transaction globale |
| GET | `/exports/assets.csv?portfolioId=…` | Actifs et projections ; filtres explicitement indiqués |
| GET | `/exports/transactions.csv?portfolioId=…` | Transactions et état ; décimaux non arrondis |
| GET | `/exports/history.csv?portfolioId=…` | Snapshots et lignes historiques, devise et dates exactes |
| GET | `/exports/portfolio.json?portfolioId=…` | Export complet versionné du domaine, hors authentification |

La confirmation ne contient pas les lignes du fichier : le serveur utilise le lot validé qu'il a conservé. Si le portefeuille a changé depuis l'aperçu, il répond 409 `PREVIEW_STALE` et demande un nouvel aperçu. Un lot déjà confirmé retourne ses identifiants d'origine sans écrire à nouveau.

Contrats CSV v1 :

- Actifs : `external_reference,name,symbol,category_key,subcategory,currency,platform,notes,initial_quantity,initial_unit_price,initial_fees,initial_date,metadata_json`.
- Transactions : `external_reference,asset_external_reference,type,quantity,unit_price,fees,currency,occurred_at,platform,destination_platform,cash_account,destination_cash_account,settlement,amount,carried_cost,fair_value,direction,adjustment_kind,comment`.
- Les champs requis varient selon le type ; colonnes inconnues ou catégorie/plateforme introuvable signalées dans l'aperçu. Pas de rapprochement silencieux uniquement par nom.
- Les soldes initiaux génèrent des transactions avec référence dérivée unique du lot et de la ligne. Ils ne modifient pas directement la projection.
- Les champs spécialisés des actifs sont portés par `metadata_json`, avec schéma discriminé par catégorie. Les exemples réels et modèles CSV seront fournis avec l'implémentation.

Les exports sont générés sur une vue cohérente du portefeuille ; le JSON inclut `schemaVersion`, `exportedAt`, `ledgerVersion`, catégories, plateformes, comptes, actifs, positions dérivées, transactions/révisions, prix, FX, snapshots, audit et métadonnées d'images. Les binaires d'images appartiennent à la sauvegarde complète. Headers `Content-Disposition` et `Cache-Control: private, no-store` obligatoires.

## 7. Référentiels et paramètres

| Méthode | Route | Fonction |
| --- | --- | --- |
| GET/PATCH | `/settings?portfolioId=…` | Devise d'affichage et fuseau ; ne modifie pas la devise comptable d'un journal existant |
| GET/POST | `/categories?portfolioId=…` | Catégories prédéfinies/personnalisées |
| PATCH/DELETE | `/categories/{id}` | Renommer/archiver ; suppression interdite si utilisée |
| GET/POST | `/platforms?portfolioId=…` | Lieux de conservation déclaratifs |
| PATCH/DELETE | `/platforms/{id}` | Modifier/archiver ; supprimer uniquement si non référencée |
| GET/POST | `/cash-accounts?portfolioId=…` | Comptes de trésorerie déclaratifs ; ouverture de solde par transaction |
| GET/POST | `/fx-rates?portfolioId=…` | Historique et saisie de taux, append-only |
| GET/POST | `/metal-spot-prices?portfolioId=…` | Prix du gramme fin utilisés pour les valorisations |
| GET | `/audit?portfolioId=…` | Audit paginé des mutations du propriétaire |

## 8. Tests de contrat

Pour chaque famille : accès sans session, accès à une ressource d'un autre utilisateur, validation des données, succès, version périmée et erreur de dépendance. Pour les mutations : double clic, réessai après timeout, charge utile différente avec même clé et deux écritures concurrentes. Les garanties sont vérifiées sur PostgreSQL réel, en plus des tests de handlers.
