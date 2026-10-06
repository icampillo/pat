# Navigation — 6 octobre 2026

## Cause identifiée dans le code

Le layout privé charge déjà `getPrivateData()` pour fournir le portefeuille à
l'interface. Huit routes rappelaient cette fonction à chaque navigation :
dashboard, portfolio, wallets, settings, activity, categories/[slug], assets/new
et transactions/new. Le cache React ne déduplique que dans une même requête.
Chaque nouvelle lecture `getState()` ouvre une transaction PostgreSQL, rejoue le
journal et charge notamment jusqu'à 600 snapshots pour construire les graphiques.

## Correction

Ces routes lisent maintenant le même `AppState` depuis `WorkspaceProvider`,
conservé par le layout Next.js entre les pages. Pas de cache serveur partagé entre
utilisateurs, pas de nouvelle dépendance, pas de modification des calculs ou de
la base. Les paramètres de catégorie et d'activité restent pilotés par l'URL.

Le layout reste authentifié côté serveur. Les API restent authentifiées et les
fiches individuelles `/assets/[id]` et `/transactions/[id]` conservent leurs
lectures et validations serveur. Le chargement initial et ces fiches peuvent
donc encore subir la latence de la base.

`router.refresh()` reste déclenché après un enregistrement et le polling des
wallets existant reste actif. Lors d'une navigation, un état de plus d'une minute
est aussi rafraîchi en arrière-plan, sans attendre pour afficher la page. Ce
n'est pas un abonnement temps réel : sans navigation ni polling actif, les mises
à jour externes nécessitent de recharger la page. Un `loading.tsx` privé permet de
conserver le cadre de navigation pendant le chargement d'une route.

## Vérifications reproductibles

```sh
npm run test:unit
npm run lint
npm run typecheck
VERCEL=1 npm run build
```

Résultats locaux : 105 tests unitaires réussis, lint et typecheck réussis, build
`VERCEL=1 npm run build` réussi.

`workspace-navigation.test.tsx` vérifie la réutilisation de l'état, les nouvelles
props du layout, les paramètres d'URL, la catégorie inconnue, le rafraîchissement
après écriture et le seuil de fraîcheur. Ces tests isolent les composants de page ;
ils ne constituent pas une mesure du navigateur en production.

Aucune base `DATABASE_URL_TEST` dédiée n'est configurée dans cet environnement :
les tests PostgreSQL et Playwright authentifiés n'ont pas été exécutés. Aucune
modification de `.env`, des données ou des migrations. Aucun déploiement effectué.

Après redéploiement, vérifier dans les outils réseau du navigateur les transitions
Tableau de bord → Portefeuille → Activité → Paramètres, puis une création/modification
et son affichage après retour au tableau de bord. Comparer le temps de navigation
et la taille des réponses RSC avant/après, avec le même compte et les mêmes données.
L'URL Vercel fournie redirige vers la connexion Vercel : le dashboard n'a pas
pu être mesuré en production et aucun gain chiffré n'est revendiqué.
