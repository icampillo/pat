# CI GitHub

Le workflow [CI](../.github/workflows/ci.yml) exécute un seul job `Quality` sur Ubuntu 24.04 à chaque push sur `main` et pour les pull requests ciblant `main`. Il peut aussi être lancé manuellement depuis Actions. Une nouvelle exécution annule celle encore en cours pour la même branche ou pull request. Le job est limité à 25 minutes.

## Versions et installation

- Node.js suit `engines.node` dans `package.json` (actuellement Node 24).
- pnpm suit `packageManager` dans ce même fichier (actuellement 11.19.0).
- `pnpm install --frozen-lockfile` utilise le lockfile commité sans le réécrire.
- Le cache contient le store pnpm, avec une clé dépendant de `pnpm-lock.yaml`. Ni `node_modules`, ni les bases, ni `.env`, ni `.local` ne sont mis en cache par ce workflow.
- Les actions sont épinglées à leurs commits ; les commentaires indiquent leur version majeure. PostgreSQL utilise `postgres:17-bookworm`, comme Docker Compose.

Les actions utilisées sont [checkout](https://github.com/actions/checkout), [setup-node](https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md#node-version-file) et [pnpm/action-setup](https://github.com/pnpm/action-setup). Aucune clé fournisseur, aucun secret de production et aucun secret GitHub personnalisé ne sont nécessaires.

## Base et secrets éphémères

Chaque job dispose d’un conteneur PostgreSQL neuf, sans volume persistant, exposé seulement sur `127.0.0.1:5432` dans le runner. Le healthcheck `pg_isready` vérifie la disponibilité de `patrimoine_ci_test` avant les étapes.

L’identifiant de démarrage PostgreSQL dépend du numéro d’exécution et de sa tentative. Avant les tests, il est remplacé par un mot de passe aléatoire de 32 octets ; le secret Better Auth est généré indépendamment avec la même taille. Les secrets et l’URL résultante sont masqués et transmis uniquement aux étapes suivantes via `GITHUB_ENV`.

`DATABASE_URL` et `DATABASE_URL_TEST` désignent tous deux cette unique base de CI. Une étape vérifie explicitement le protocole, l’hôte local, le port, l’utilisateur et le nom exact `patrimoine_ci_test`. Les protections existantes des tests contre les bases sans suffixe `_test` restent inchangées. Le setup des tests applique les vraies migrations avec `prisma migrate deploy`, sans reset ni accès à une base personnelle.

Les workers wallet et marché sont désactivés. Les tests utilisent leurs fixtures et mocks existants. Les téléchargements des dépendances et de Chromium nécessitent néanmoins le réseau.

## Étapes bloquantes

1. Installation verrouillée : `pnpm install --frozen-lockfile`.
2. Génération Prisma : `pnpm db:generate`.
3. Génération des types Next.js : `pnpm exec next typegen`, pour que le typecheck fonctionne sur un checkout neuf sans build préalable.
4. `pnpm typecheck`.
5. `pnpm lint`.
6. `pnpm test:unit`.
7. `pnpm test:integration` sur PostgreSQL dédié.
8. `pnpm build`.
9. Installation de Chromium et des bibliothèques Linux : `pnpm exec playwright install --with-deps chromium`.
10. `pnpm test:e2e`, avec le serveur isolé déjà configuré sur le port 3001 et son dossier `.next-e2e`.

Les étapes sont séquentielles et s’arrêtent au premier échec ; aucun `continue-on-error` ne transforme un échec en succès. Le token GitHub ne possède que `contents: read` et ses identifiants ne sont pas conservés dans le checkout. Le workflow utilise `pull_request`, sans exécuter les contributions avec les privilèges de `pull_request_target`.

Les traces Playwright restent sur le runner ; aucun artefact contenant des cookies, identifiants de test ou fichiers `.local` n’est publié automatiquement.

## Mise en service et merges

Après commit et push, consulter **Actions → CI → Quality** pour vérifier la première exécution Linux. Les commandes validées localement ne remplacent pas une exécution sur GitHub.

Pour empêcher un merge lorsque la CI échoue, configurer une règle de protection de `main` exigeant le statut **Quality**. Le workflow ne modifie pas les règles du dépôt : leur configuration reste une opération GitHub distincte. La première exécution permet à GitHub de proposer ce statut dans les contrôles requis.

En cas d’échec, ouvrir la première étape rouge et reproduire sa commande. Une erreur de lockfile doit être corrigée et commitée avec les dépendances concernées ; ne pas retirer `--frozen-lockfile`. Les changements métier et migrations suivent leurs lots habituels.
