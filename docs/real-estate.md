# Immobilier — modèle et conventions MVP

## Intégration au projet

Un bien est un `Asset` de catégorie `REAL_ESTATE`, avec `metadata.realEstate` validé par Zod et versionné (`schemaVersion: 1`). Les colonnes existantes portent le nom, les notes, la devise et la version optimiste. Aucun modèle Prisma supplémentaire ni nouveau journal historique n'est introduit.

Les commandes existantes `POST /assets` et `PATCH /assets/:id` gardent l'isolation par portefeuille, l'idempotence, l'audit et `If-Match`. Les transactions génériques et imports de transactions sont refusés pour les biens, de même que leur conversion vers une catégorie du journal. Une fiche représente un bien ; son pourcentage de détention ne passe pas par la quantité du ledger.

L'estimation courante se saisit dans la fiche. Chaque changement non nul de valeur/date ajoute une observation `PriceHistory` dans la même transaction. Les observations fournissent les prix datés pour `valuation(at)`. La nouvelle date d'estimation ne peut pas précéder le dernier relevé. Aucune API externe n'est appelée. Effacer l'estimation rend la valeur courante inconnue sans supprimer les observations ou snapshots précédents.

## Valorisation et performances

- Valeur brute détenue = valeur du bien entier × détention / 100.
- Dette = capital restant dû **attribué à l'utilisateur**, sans nouvelle multiplication par la détention.
- Valeur nette = brut détenu − dette ; elle peut être négative.
- Plus-value brute du bien = (valeur actuelle − prix d'acquisition) × détention / 100. Elle exclut frais, intérêts, assurance et loyers et ne représente pas une rentabilité totale.
- Coût d'acquisition du bien entier = prix + frais d'acquisition + travaux initiaux.

Les montants inconnus restent `null`, distincts de zéro. L'absence de change rend seulement la devise non convertible inconnue ; un montant nul connu reste nul. Le prix manquant n'est pas remplacé par le prix d'achat. Avant acquisition, ou après archivage, la fiche ne contribue pas aux totaux courants. L'archivage n'est pas une vente et ne génère aucun produit de cession.

Les colonnes de coût investi et gain latent génériques reposent sur les flux du ledger. Elles restent indisponibles pour l'immobilier et pour les agrégats qui ne peuvent pas être calculés de façon comparable. Les gains réalisés, achats et revenus du journal conservent leur périmètre existant. Le rendement global Dietz est masqué en présence de fiches immobilières (y compris archivées), puisque les apports et mensualités immobiliers ne sont pas suivis dans les flux. Les variations d'equity sont nommées comme telles ; les performances locatives sont séparées.

`PortfolioSnapshot.data` conserve les montants de valorisation et le résumé immobilier à la date `at`. La dette utilise cette même date. Les courbes lisent uniquement les montants déjà sauvegardés via `snapshotCategoryValues`, avec les périodes existantes. Aucune commande de modification de bien, de prêt, d'estimation ou d'archivage ne réécrit les snapshots. Une valorisation ad hoc du passé utilise les paramètres actuels du bien et du prêt : elle n'est pas un historique versionné des contrats. Les captures enregistrées sont la référence historique immuable.

## Crédit

Prêt unique, amortissable à taux fixe, de 1 à 600 mois. Le montant emprunté, l'apport, le taux nominal annuel en points de pourcentage (`3.2` = 3,2 %) et la durée sont la source de vérité. La mensualité est calculée ; une mensualité saisie indépendamment est refusée par le schéma strict. L'apport est informatif, jamais déduit artificiellement du prix : frais financés et emprunt supérieur au prix restent possibles.

Le domaine utilise le clone Decimal.js existant (précision 60, arrondi au pair). Le taux mensuel vaut taux annuel / 1200. À taux zéro, mensualité = principal / durée. Intérêts, capital et paiements sont arrondis au centime à chaque échéance ; la dernière mensualité est ajustée pour solder exactement la dette. Aucun `number` n'intervient dans les calculs monétaires ; les conversions en nombres sont réservées à l'affichage et aux graphiques existants.

La première échéance est un mois après le début du prêt. Les dates sont des dates calendaires UTC, inclusives à minuit. Le jour d'origine est conservé, ramené au dernier jour du mois si nécessaire (31 janvier → 28/29 février → 31 mars). Avant la date de début, le prêt n'est pas décaissé : dette nulle. Les échéances passées sont supposées payées. Après la dernière, dette et charges de crédit récurrentes sont nulles. Frais de dossier/garantie supposés payés au début.

L'échéancier est déterministe, calculé à la demande, jamais stocké en base ni généré comme centaines de transactions. Le résumé expose capital payé/restant, intérêts et assurance payés/futurs/totaux, coûts payés/futurs, progression, échéances restantes et date de fin. L'interface rend 12 lignes par page. Les coûts du financement excluent le capital remboursé.

## Location

Uniquement pour `RENTAL`. Loyers et charges décrivent le bien entier. Loyer, charges non récupérables et taxe foncière doivent être renseignés explicitement, même à zéro. Assurance propriétaire, gestion et autres dépenses facultatives sont supposées nulles si omises ; cette hypothèse est affichée.

- Loyer annuel = loyer mensuel × 12.
- Dépenses annuelles = charges mensuelles × 12 + taxe + assurance propriétaire + gestion annuelle + autres dépenses.
- Rendement brut = loyer annuel / prix d'achat × 100.
- Rendement net avant fiscalité = (loyer annuel − dépenses annuelles) / coût d'acquisition × 100.
- Cash-flow mensuel de l'utilisateur = (loyer annuel − dépenses annuelles) / 12 × détention / 100 − mensualité − assurance du crédit attribué, uniquement lorsque le prêt est actif.

Un dénominateur nul produit un rendement inconnu. Le remboursement du capital n'entre jamais dans les charges du rendement net. Le cash-flow est une approximation mensuelle avant fiscalité et sans vacance locative.

## Migration et exploitation

Déployer la migration avec la procédure habituelle `pnpm db:deploy` avant la nouvelle version. `20260926090000_real_estate` insère seulement la catégorie absente dans chaque portefeuille, avec `ON CONFLICT DO NOTHING`. Aucune suppression ni modification des catégories existantes. Le provisionnement et les seeds consomment déjà la liste partagée et incluent donc automatiquement Immobilier ; aucun bien fictif n'est ajouté.

La migration a été vérifiée sur la base dédiée aux tests. Elle n'a pas été appliquée à la base utilisateur dans le cadre de l'implémentation.

## Fichiers

Créés :

- `src/shared/real-estate.ts` : schémas stricts, types et libellés.
- `src/domain/mortgage.ts` : mensualité, échéancier et résumé à une date.
- `src/domain/real-estate.ts` : equity, acquisition, plus-value brute et location.
- `src/components/forms/real-estate-form.tsx` : création et modification par sections.
- `src/components/real-estate-detail.tsx` : fiche, financement, location et tableau paginé.
- `prisma/migrations/20260926090000_real_estate/migration.sql` : catégorie des portfolios existants.
- `tests/fixtures/real-estate.ts` : fixtures financières réservées aux tests.
- `tests/unit/real-estate.test.ts`, `tests/integration/real-estate.test.ts`, `tests/e2e/real-estate.spec.ts` : tests du module.
- `docs/real-estate.md` : ce document.

Modifiés :

- `src/shared/schemas.ts`, `src/shared/types.ts` : catégorie, métadonnées et résultats typés.
- `src/server/portfolio.ts` : commandes, estimations, valorisation et snapshots existants.
- `src/domain/categories.ts` : slug, totaux brut/dette, positions et historique réutilisé.
- `src/components/asset-category-card.tsx`, `src/components/category-page.tsx` : présentation de la valeur nette.
- `src/components/forms/asset-form.tsx`, `src/components/forms/transaction-form.tsx` : formulaire spécialisé et exclusion du ledger générique.
- `src/components/pages/asset-detail.tsx`, `src/components/pages/dashboard.tsx` : fiche immobilière et sémantique des performances.
- `src/components/pages/assets.tsx`, `src/app/(private)/assets/new/page.tsx` : catégorie présélectionnée depuis « Ajouter un bien ».
- `src/components/assets/asset-table.tsx` : indication de la valeur nette dans la liste générale.
- `tests/e2e/journey.spec.ts` : sélection explicite du lien de transaction associé à l'actif, pour éviter l'ambiguïté avec l'action du journal vide déjà présente.

Les modifications préexistantes du worker de snapshots et de sa configuration ont été préservées. Ce module ne modifie ni les workers, ni les wallets, ni les formules du journal.

## Vérification et extensions

Tests unitaires : prêt standard, taux zéro, pourcentage vs fraction, arrondis, calendrier, assurance, coûts, prêt terminé, equity, copropriété, dette supérieure au prix, valeurs nulles et inconnues, rendements et cash-flow, validations strictes.

Tests d'intégration : captures à deux dates, prix historiques, immutabilité après modification, change, valeurs inconnues, archivage, idempotence, versions concurrentes, isolation utilisateur, refus du ledger générique et migration additive rejouable.

Test navigateur : création et modification depuis le formulaire, mensualité calculée, location conditionnelle, dashboard net/brut/dette, périodes du graphique, pagination, mobile et accessibilité.

Validation effectuée le 26 septembre 2026 : TypeScript sans erreur ; lint sans erreur (avertissement préexistant `overall` inutilisé dans `portfolio-breakdown.tsx`) ; 139 tests unitaires/intégration réussis. Les 10 parcours navigateur ont été validés : 9 lors de la suite complète, puis le parcours de liens profonds après correction de son sélecteur ambigu et le parcours immobilier après renforcement de l'attente de chargement. Captures visuellement vérifiées en 1440 px et 375 px ; aucune violation Axe sur les nouveaux écrans contrôlés.

Extensions possibles : événements datés `EXTRA_PAYMENT`, `RATE_CHANGE`, `PAYMENT_CHANGE`, `REFINANCE` dans le domaine du prêt, avec versionnement du contrat. Prévoir alors leur incidence sur les nouveaux snapshots sans modifier les anciens. Les prêts multiples, différés, impayés, fiscalité, ventes détaillées et refinancements ne font pas partie de ce MVP.
