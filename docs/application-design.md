# Harmonisation de l’application — 10 octobre 2026

## Référence et limites

Le dashboard actuel est la référence : Inter locale, accent #7434ff, texte #171922,
surfaces blanches, fond #fdfdfe, bordures #ececf3, cartes de rayon 16 px et ombres légères.
Aucun changement des données, calculs, API, synchronisations, imports ou snapshots.
Aucune dépendance ajoutée. Travail local, sans publication.

## Checklist du périmètre

- [ ] Base commune : tokens, police, boutons, champs, sélecteurs, badges, onglets,
  cartes, en-têtes, tableaux, filtres, messages et états vides.
- [ ] Navigation desktop, tablette, mobile ; menu latéral et liens de retour.
- [ ] Dashboard : palette/couleurs mutualisées sans altérer les tracés/interactions.
- [ ] `/portfolio` : indicateurs, liste filtrée, répartition, résumé wallets.
- [ ] `/categories/[slug]` : crypto, Bourse, métaux, immobilier, collections/autres.
- [ ] `/assets/[id]` : détail, édition, prix, image, réparation cotation, transactions,
  détail immobilier (estimations, crédit et coûts).
- [ ] `/assets/new` : création et variantes crypto, titres, métaux, collections, immobilier.
- [ ] `/activity` : transactions, recherche, actions et confirmation d’annulation.
- [ ] `/activity?view=history` : graphique, regroupements, tableau et export.
- [ ] `/transactions/new`, `/transactions/[id]` : création, correction, date d’inventaire.
- [ ] Imports : inventaire CSV Bourse et opérations CSV/PDF, prévisualisation,
  conflits, confirmation, erreurs et succès ; présents dans Bourse et Paramètres.
- [ ] `/wallets` : synthèse, filtres, tokens/DeFi, connexions, ajout modal/suppression.
- [ ] `/settings` : portefeuille, taux, sources, exports, Zerion et imports.
- [ ] `/login`, erreurs, 404, chargement initial/revalidation.
- [ ] Dialogues communs : confirmation, ajout wallet, analyse IA ; clavier et tactile.
- [ ] Alias `/`, `/assets`, `/transactions`, `/history` : destinations conservées.
- [ ] Vérifications : unitaires, lint, typecheck/build, navigation navigateur,
  parcours UI et captures desktop/tablette/mobile, accessibilité et mouvement réduit.

## Architecture UI

À compléter avec les composants mutualisés et les vérifications réellement exécutées.
