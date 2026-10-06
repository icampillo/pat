# Analyse de portefeuille par prompt

## Utilisation et périmètre

Sur le dashboard, à côté de **Vos investissements**, cliquer sur **Analyser avec une IA**.
La boîte de dialogue affiche le prompt, permet de le sélectionner et de le copier.
La copie réussie affiche **Prompt copié** ; si le navigateur refuse Clipboard, la
sélection manuelle reste disponible. Le contenu est figé pendant l'ouverture et
régénéré avec l'état courant à la prochaine ouverture.

Aucun fournisseur LLM, appel réseau supplémentaire, endpoint, stockage du prompt,
secret, dépendance, migration ou changement de schéma Prisma n'est ajouté.
L'actualisation habituelle du workspace reste indépendante de cette fonctionnalité.
Aucune donnée n'est envoyée automatiquement à une IA. Le partage intervient
uniquement lorsque l'utilisateur colle lui-même le texte dans un autre service.

## Inspection et architecture retenue

- Prisma stocke les actifs/catégories, transactions, prix datés, taux de change,
  snapshots et observations de wallets. L'immobilier est décrit dans les métadonnées.
- `src/server/portfolio-query.ts` rejoue le ledger, valorise les positions et les
  liquidités, ajoute les valeurs nettes on-chain, et expose `AppState` via l'API
  authentifiée existante. Jusqu'à 600 snapshots sont chargés.
- `src/domain/categories.ts` fournit déjà les positions par catégorie, les
  conversions, le traitement des dettes DeFi, les résidus de rapprochement,
  l'immobilier net et les calculs de poids/P&L. Ce code est réutilisé, pas recopié.
- `src/domain/ledger.ts` fournit le rendement Modified Dietz ajusté des flux.
- Le dashboard reçoit déjà `AppState` du cache de session du workspace.

```text
Prisma → valuation/getState → AppState
                           → buildPortfolioContext(state, currency, generatedAt?)
                           → PortfolioAnalysisContext
                           → buildPortfolioAnalysisPrompt(context)
                           → Dialog → Clipboard (action utilisateur)
```

Les deux builders sont des fonctions TypeScript indépendantes de React, de Prisma
et du réseau. Les types sont dans `src/shared/portfolio-analysis.ts`. Ils sont
sérialisables ; les métriques inconnues sont optionnelles, pas remplacées par zéro.
Le formatage est dans le builder de prompt, pas dans les calculs ou le composant.
Les critères de comparabilité de performance sont extraits, sans changement de
règle, dans `src/domain/portfolio-performance.ts` et partagés avec le dashboard.

## Données et métriques

| Élément | Traitement |
| --- | --- |
| Date | Génération et date de valorisation de l'état affiché, distinctes |
| Devise d'analyse | EUR ou USD, suivant la sélection du workspace ; ne modifie pas la base comptable |
| Total | Valeur totale déjà calculée côté serveur, liquidités et wallets inclus ; absent si incomplet |
| Allocation | Valeur et pourcentage par catégorie détenue, y compris catégories personnalisées ; liquidités regroupées par devise |
| Positions | Nom, symbole, catégorie, type action/ETF ou sous-catégorie lorsqu'enregistré, quantité, prix et devise de cotation, date, valeur, poids |
| PRU/coût | Coût restant historique dans la devise d'analyse, PRU = coût / quantité ; pas de conversion du coût ancien au taux d'aujourd'hui |
| P&L | Latent : valeur moins coût restant ; pourcentage uniquement si coût strictement positif |
| Concentration | Top 1/3/5/10 des lignes par valeur décroissante ; les rangs au-delà du nombre de lignes additionnent simplement toutes les lignes |
| Wallets/DeFi | Détail et valeur nette existants, dette non recomptée ; le résidu reste une ligne de rapprochement explicite |
| Immobilier | Valeur nette de dette à hauteur de la quote-part ; pas de faux prix unitaire/PRU/P&L générique |
| Qualité | Cotations/observations anciennes, coût inconnu, défaut de rapprochement et limites de performance signalés |

Les quantités et prix unitaires faibles utilisent des chiffres significatifs pour
ne pas être affichés artificiellement comme zéro. Les montants sont arrondis à
2 décimales uniquement dans le texte. Aucune valeur numérique non finie n'est rendue.
Les positions soldées/supprimées suivent le filtrage existant de catégorie.

Le total des lignes doit se rapprocher du total serveur à 0,000001 unité monétaire.
Sinon tous les poids et concentrations sont omis ; un sous-total connu n'est jamais
présenté comme un total complet. Les concentrations sont également omises en cas
de total nul, de valeur nette négative ou de wallet partiellement détaillé.
La concentration par ligne **n'est pas une exposition consolidée par sous-jacent** :
un même actif dans plusieurs comptes, tokens ou ETF peut être réparti sur plusieurs
lignes. Cette limite figure dans chaque prompt.

Les notes privées, commentaires de transactions, coordonnées, adresses de wallets,
identifiants techniques et secrets ne sont pas ajoutés au texte. Les noms d'actifs
et les libellés de wallets restent visibles : l'utilisateur doit relire son texte
avant partage, notamment s'il a lui-même mis une information personnelle dans un nom.

## Performances disponibles et indisponibles

### Globales 30 jours / YTD

Modified Dietz est réutilisé, en EUR uniquement (les flux exposés sont en EUR).
Une capture complète doit exister **à la borne ou dans les 24 heures précédentes**.
Le dernier snapshot dans cette fenêtre est retenu, avec ses propres valeurs
historiques ; aucun taux courant n'est appliqué rétroactivement. Les dates réelles
sont affichées, avec le libellé explicite **estimation Modified Dietz, après flux**.
Le début d'année respecte UTC ou Europe/Paris, les deux fuseaux pris en charge.
Ce sont donc des estimations sur la période réellement observable, pas une promesse
de rendement exact aux bornes calendaires.

Comme sur le dashboard, le rendement est masqué si les flux ne sont pas comparables :
wallet inclus ou capture WALLET dans l'historique, immobilier, coût incomplet,
historique révisé ou affichage USD. Une valeur initiale absente, un dénominateur
nul/négatif ou l'absence de capture suffisamment proche supprime aussi la métrique.
Les apports ne sont pas assimilés à des gains.

### Non fournies dans cette V1

- **30 jours par position** : l'API expose un pourcentage calculé depuis la cotation
  la plus proche, sans limite d'écart et sans date de référence dans `AssetView`.
  Impossible de certifier la période à partir de cet état. Les prix datés existent
  en base : une future lecture ciblée peut lever cette limite.
- **YTD par position** : non calculé/exposé aujourd'hui ; nécessite des cotations de
  référence et une définition explicite rendement de prix vs rendement après flux.
- **Performance totale depuis l'origine** : les 600 snapshots chargés ne garantissent
  pas une valorisation initiale couvrant toute la vie du portefeuille. P&L latent
  et coût restant ne remplacent pas un rendement total.
- **Rendement global USD** : flux historiques USD non exposés ; leur conversion avec
  le taux actuel serait incorrecte.
- **Coûts et P&L wallets, inventaires à coût inconnu, immobilier générique** : données
  insuffisantes dans les projections existantes, aucune acquisition fictive créée.
- Profil investisseur, allocation cible, géographie, secteurs, composition ETF,
  volatilité, drawdown, corrélations : hors périmètre et non fabriqués.

Il s'agit d'un audit du schéma et des calculs, pas d'une lecture des données privées
de production. La présence effective des captures nécessaires est évaluée à chaque
construction de contexte sur les données déjà affichées à l'utilisateur.

## Fichiers

Créés :

- `src/shared/portfolio-analysis.ts` : contrat typé.
- `src/domain/portfolio-analysis.ts` : contexte, agrégation, concentration, performances et qualité.
- `src/domain/portfolio-analysis-prompt.ts` : instructions factuelles et rendu du texte.
- `src/domain/portfolio-performance.ts` : éligibilité au rendement partagée avec le dashboard.
- `src/components/portfolio-analysis-dialog.tsx` : interface Radix, copie et secours manuel.
- `tests/unit/portfolio-analysis.test.ts` : 23 tests.
- `tests/navigation/portfolio-analysis.spec.ts` : 2 scénarios Playwright sans base réelle.
- `docs/portfolio-analysis.md` : ce rapport.

Modifiés :

- `src/components/pages/dashboard.tsx` : bouton et réutilisation du garde de performance.
- `src/app/globals.css` : taille responsive de la modal et zone de texte.
- `README.md` : accès à la fonctionnalité et au rapport.

Les modifications préexistantes de `next-env.d.ts` sont préservées ; `.astra/` et
`patrimoine-local.dump` restent intacts et non suivis. Aucun commit/push/déploiement.

## Vérifications

Commandes reproductibles avec les dépendances déjà installées :

```sh
npm run test:unit
npm run lint
npm run typecheck
VERCEL=1 NEXT_TELEMETRY_DISABLED=1 WALLET_WORKER_DISABLED=1 MARKET_WORKER_DISABLED=1 SNAPSHOT_WORKER_DISABLED=1 npm run build
DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused_test node_modules/.bin/playwright test --config playwright.navigation.config.ts tests/navigation/portfolio-analysis.spec.ts
```

`pnpm` n'est pas exposé dans le PATH de cette session. Les scripts npm utilisent les
mêmes exécutables locaux, sans réinstallation ni modification du lockfile.

- 23 tests ajoutés : exemples d'allocation et de concentration demandés, poids/tri,
  cash et catégories personnalisées, positions soldées, EUR/USD et coût historique,
  coût inconnu/zéro, valeurs absentes/non finies, total non rapproché, wallets/DeFi
  et résidu, immobilier, Dietz après apports, YTD/fuseau, périodes indisponibles,
  contenu du prompt, petits montants et absence de données privées techniques.
- 148 tests unitaires réussis, 21 fichiers.
- ESLint réussi sans avertissement.
- TypeScript strict réussi.
- Build de production Vercel réussi : Prisma generate, compilation webpack, vérification
  TypeScript, génération de 15 pages statiques et collecte des traces terminés, code 0.
- Prettier sur les fichiers TS/TSX ajoutés/modifiés et `git diff --check` réussis.
- Navigateur : première tentative arrêtée car Chromium était absent. Installation
  locale `node_modules/.bin/playwright install chromium` réussie, puis nouvelle
  tentative arrêtée avant le scénario avec `spawn ... EACCES` : le cache Chromium
  est dans `/tmp`, monté `noexec`. Aucun contournement de permission. Les 2 scénarios
  sont écrits mais **non validés** (dernier lancement limité au premier échec :
  1 échec de démarrage, 1 non exécuté). Pas de capture ni de contrôle axe revendiqué.
  Le serveur de test utilise une URL PostgreSQL volontairement inaccessible,
  des fixtures API et des workers désactivés ; aucun serveur laissé actif.
- Intégration PostgreSQL non exécutée : la base configurée dans `DATABASE_URL_TEST`
  n'a pas le suffixe `_test` exigé par les protections des suites existantes et
  n'est pas locale. Le point de connexion diffère de `DATABASE_URL` ; l'identité
  des deux bases n'est pas établie (le premier contrôle ne comparait que leurs noms).
  Aucun test, connexion ou écriture vers ces bases n'a été effectué dans cette
  intervention. Aucune modification de `.env`.
- Outils MCP hôte incomplets : le runtime signale 3 outils exclus par la politique.
  Aucune validation via ces outils n'est revendiquée.

## Prochaine étape

1. Finaliser les contrôles navigateur sur un environnement capable de lancer Chromium.
2. Exposer les dates de référence des cotations et assurer la couverture historique
   avant d'ajouter les performances par actif ou depuis l'origine.
3. Consolider les identités d'actifs entre comptes/chaînes et enrichir le suivi des
   flux DeFi/immobiliers avant de qualifier des risques par sous-jacent.
4. Pour une intégration LLM ultérieure, construire ce même contexte côté serveur à
   partir de l'état authentifié et prévoir consentement explicite, minimisation des
   données et limites de taille. Aucun fournisseur ni profil investisseur préparé
   artificiellement dans cette V1.

## Prompt enrichi — 2026-10-06

Le prompt demande désormais une note de comité d’investissement : synthèse
priorisée, diagnostic des expositions, revue des positions avec décisions
conditionnelles, opportunités hors portefeuille, rééquilibrage financé,
scénarios de stress et plan d’action.

L’absence de profil ne bloque plus les recommandations : l’IA doit expliciter
des scénarios prudent/équilibré/dynamique et les questions qui permettraient de
les départager. Les allocations proposées sont des hypothèses, jamais des
données enregistrées par l’application. Les calculs dérivés sont autorisés pour
les simulations uniquement, avec périmètre et financement vérifiables.

La recherche web est demandée seulement si l’IA destinataire en dispose :
sources datées pour les faits de marché, sinon candidats à étudier sans cours
ni valorisation inventés. Les opportunités doivent apporter une valeur marginale
par rapport aux lignes existantes et aux liquidités, avec contre-thèse,
recouvrement ETF, conditions d’entrée et d’invalidation.

Aucun changement des données exportées, de la copie, des calculs métier ou des
appels réseau. Aucun appel LLM exécuté : la qualité d’une réponse finale dépend
du modèle destinataire et des informations de profil/marché disponibles.

Validation de cette révision : 148 tests unitaires réussis (dont 23 sur
l’analyse), TypeScript, ESLint, Prettier ciblé et contrôle du diff réussis.
Commandes : `node_modules/.bin/vitest run tests/unit`,
`node_modules/.bin/tsc --noEmit`, `node_modules/.bin/eslint .`,
`node_modules/.bin/prettier --check src/domain/portfolio-analysis-prompt.ts tests/unit/portfolio-analysis.test.ts`,
`git diff --check`. Le binaire pnpm n’est pas disponible ; les binaires locaux
existants ont été utilisés sans installation. Build et navigateur non relancés
pour cette modification des instructions textuelles uniquement.
