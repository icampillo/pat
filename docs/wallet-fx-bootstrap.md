# Crypto absente du dashboard après nettoyage de la base

## Cause et correction

Les observations Zerion sont en USD. Le dashboard en EUR et la catégorie Crypto nécessitent une ligne FxRate ; sans taux et pour un wallet non nul, les totaux EUR restent volontairement indisponibles. La page Wallets peut néanmoins afficher les données USD. Avant cette correction, la synchronisation des wallets ne créait pas le taux : il fallait attendre le cron de marché ou actualiser les cours dans les réglages.

`syncWalletResult`, commun au cron et aux synchronisations utilisateur, initialise maintenant le taux BCE si aucun taux applicable n'existe. Réutilisation du parseur et du client réseau existants ; lecture réseau hors transaction, puis vérification sous verrou portefeuille pour éviter les insertions concurrentes. Les taux existants, y compris manuels, sont préservés. Un échec BCE est journalisé sans rejeter l'observation Zerion ni inventer un taux. Aucun changement de schéma ou d'historique.

Pour une installation déjà touchée : Réglages → Taux de change → **Actualiser les cours et le taux**, puis revenir au dashboard. Après déploiement du correctif, une prochaine synchronisation wallet initialise aussi le taux manquant.

## Validation locale

- 222 tests unitaires réussis, dont bootstrap BCE, conservation du taux existant, relecture sous verrou et conservation de la synchronisation wallet en cas de panne FX.
- TypeScript, ESLint et git diff --check réussis.
- Commandes reproductibles : `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`, `pnpm build` (CLI locales utilisées directement dans le sandbox).
- Aucune lecture de la base de production : le taux absent est une cause identifiée dans le code correspondant au symptôme, pas un constat effectué sur les données réelles.
- Aucun push, déploiement ou changement des données utilisateur effectué. Intégration PostgreSQL et navigateur non exécutés pour cette correction.
- Build production Next.js `VERCEL=1` réussi (code 0), DATABASE_URL factice sur port local inaccessible ; aucune migration exécutée.
- Connectivité opérateur limitée : configuration MCP incomplète (trois outils omis par politique), aucune validation de production via MCP revendiquée.
