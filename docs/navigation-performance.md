# Navigation et chargement — 6 octobre 2026

## Diagnostic

L'utilisateur signale une navigation très lente malgré le faible volume de données.
Les images jointes n'étaient pas accessibles pendant cette intervention : aucune
mesure n'en est déduite. L'analyse du code montre que la première correction
(réutilisation du contexte dans les pages) conservait deux causes structurelles :

- Le layout privé appelait encore `getState()`. Son rendu serveur pouvait donc
  attendre la transaction de valorisation complète, même pour une autre page.
  Le `loading.tsx` enfant ne couvre pas l'attente du layout parent.
- Les wallets déclenchaient `router.refresh()` toutes les 15 secondes ; les
  écritures et certains formulaires le déclenchaient aussi, parfois deux fois.
  Cela reconstruisait les données et invalidait le cache des routes. Les liens
  visibles des tableaux pouvaient en plus précharger une route par actif.

Il s'agit d'un diagnostic du code, pas d'un profilage de la base de production.

## Flux livré

```text
Routes Next.js sans données privées → WorkspaceProvider conservé entre les pages
                                        ↓ lecture initiale / revalidation
                                  GET /api/v1/state
                                        ↓ session authentifiée
                                  getState(propriétaire)
```

- Le layout ne lit plus la base. Les pages principales sont précompilées ; les
  catégories et fiches individuelles utilisent également l'état partagé.
- Une instance de cache par workspace monté, en mémoire uniquement : pas de
  `localStorage`, de cache serveur inter-utilisateur ou de réponse privée dans le
  HTML/RSC. `/api/v1/state` ajoute `userName` au DTO existant ; l'API authentifie
  chaque lecture et garde `Cache-Control: private, no-store`.
- Une lecture en vol est partagée. Les données reçues sont réutilisées pendant
  60 secondes. La navigation, le retour au premier plan et un timer visible
  déclenchent une revalidation si nécessaire ; le contenu existant reste affiché.
- Quand un wallet activé est `PENDING` ou `SYNCING` et que la synchronisation est
  activée, le timer passe à 5 secondes. Sinon, il vérifie toutes les 60 secondes.
  Pas de polling dans les onglets masqués, ni de chevauchement des lectures du timer.
- Après une écriture réussie, la revalidation est attendue avant la navigation du
  formulaire. Une lecture antérieure est annulée et son résultat ignoré ; plusieurs
  sauvegardes concurrentes attendent la dernière revalidation. Les aperçus d'import
  ne rechargent pas le portefeuille. Idempotence et `If-Match` sont conservés.
- Un échec de lecture conserve les dernières valeurs avec une erreur et un bouton
  de reprise. Délai maximal de lecture : 30 secondes. Un 401 retire les données du
  contexte et redirige vers la connexion ; la sortie du workspace annule la lecture.
- Seuls les liens du menu principal/paramètres préchargent leurs routes. Les listes
  ne préchargent plus une fiche par ligne. Les liens affichent un indicateur durant
  une transition en attente grâce à `useLinkStatus`.
- Loaders squelette au premier chargement et aux frontières de route ; indicateur
  discret d'actualisation ; état de chargement pour l'historique des prix. Les
  animations respectent `prefers-reduced-motion`.

Le HTML public ne contient qu'une structure de chargement : l'accès aux données
reste protégé côté API, y compris images, exports et mutations. La redirection
vers `/login` se fait désormais après le 401 de l'API, pas dans le layout serveur.
Aucun calcul financier, schéma, donnée ou fichier `.env` n'a été modifié.

## Vérifications reproductibles

```sh
npm run test:unit
npm run lint
npm run typecheck
VERCEL=1 npm run build
npx tsx scripts/check-navigation.ts
```

- 112 tests unitaires réussis ; lint sans avertissement ; TypeScript réussi.
- Build de production réussi : dashboard, portefeuille, activité, paramètres et
  wallets statiques ; routes à identifiants dynamiques sans lecture du portefeuille.
- Contrôle HTTP réussi : serveur temporaire avec workers désactivés, secret
  éphémère et URL de base volontairement inaccessible ; 8 routes HTML et 8 RSC
  répondent, 3 lectures API anonymes sont refusées (401, private/no-store).
  Aucun compte réel utilisé et serveur arrêté après le contrôle.

Les tests du cache couvrent déduplication, fraîcheur, réponses anciennes,
concurrence des sauvegardes, erreurs/reprise, expiration de session et démontage.
Les tests API vérifient l'authentification et l'identifiant propriétaire transmis
à la lecture. Ce sont des tests isolés, pas des tests d'intégration PostgreSQL.

## Vérification navigateur à terminer

```sh
npx playwright install chromium
npx playwright test --config playwright.navigation.config.ts
```

Cette suite est séparée des tests E2E PostgreSQL et utilise le build de production
avec des réponses API de test. Elle couvre le loader initial, les transitions,
les fiches, la sauvegarde, les erreurs et le polling masqué ; elle prépare une
vérification axe et une capture du dashboard.

Tentative locale bloquée avant tout scénario : `EACCES` au lancement de Chromium,
installé dans `/tmp` monté `noexec`. Aucune permission système modifiée ; aucun
scénario navigateur ni contrôle visuel/accessibilité déclaré réussi. Les outils
MCP hôte sont également incomplets dans cette session.

Le premier chargement et les revalidations gardent le coût actuel de `getState()`
(transaction cohérente et jusqu'à 600 snapshots). Cette correction retire ce coût
du chemin de navigation, elle ne revendique pas d'accélération SQL ni de mesure
chronométrée sur Vercel. Aucun déploiement ou push effectué. Après déploiement,
vérifier dans Network qu'une navigation avec des données fraîches ne provoque
pas de nouvelle lecture `/api/v1/state`, puis contrôler une sauvegarde et sa
revalidation. Le chargement de fichiers JS/RSC de nouvelles routes reste normal.
