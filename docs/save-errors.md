# Corrections des erreurs de sauvegarde — 2026-10-06

## Diagnostic et changements

Le message `Unexpected token 'A', "An error o"... is not valid JSON`
vient de la lecture JSON inconditionnelle des réponses dans le client partagé.
Une erreur texte/HTML de l'hébergement masque ainsi son statut HTTP. Le même
problème affectait la relecture du portefeuille après une écriture réussie.

- Lecture de l'enveloppe API commune aux sauvegardes et au cache du portefeuille :
  erreurs non JSON présentées en français avec le statut HTTP, erreurs métier
  préservées, réponse invalide jamais considérée comme une confirmation.
- Clé d'idempotence existante conservée en cas de confirmation indisponible :
  renvoyer exactement la même demande depuis le formulaire utilise la même clé.
  Aucun rejeu automatique ajouté. Cette protection reste limitée à la session
  montée et à une demande identique, comme auparavant.
- Une écriture confirmée reste un succès si la relecture échoue ; le cache
  conserve les dernières données et affiche séparément l'erreur d'actualisation.
- Après création/modification d'un métal, la synchronisation des cours externes
  était attendue après le commit avant d'envoyer la confirmation. Elle utilise
  désormais Next.js `after()` : elle ne bloque plus la réponse de sauvegarde.
  Les nouveaux cours apparaîtront lors d'une revalidation ultérieure (ou via
  l'actualisation explicite des cours), pas nécessairement dans la première
  relecture. La modification de la fiche elle-même est immédiatement relue.

L'attente de cotations est un risque concret de timeout après commit, propre aux
métaux ; elle n'explique pas à elle seule les erreurs des transactions.
Sans journaux de l'hébergement, le déclencheur exact des réponses texte de
production (timeout, indisponibilité, etc.) n'est pas établi. Cette correction
ne prétend pas réparer une éventuelle panne de l'hébergement ou de PostgreSQL.

## Vérification reproductible

```sh
npm run test:unit
npm run typecheck
npm run lint
VERCEL=1 npm run build
```

Résultats : 122 tests unitaires réussis, TypeScript, ESLint et build de production
réussis. Vérification Git des espaces réussie.

Tests de régression : réponses texte/HTML/vides et enveloppes invalides, erreurs
métier, session expirée, réessai avec la même clé sur actifs et transactions,
échec de relecture après succès, confirmation du métal avant la cotation et
échec de cotation isolé. Tests API isolés par mocks, aucune écriture réelle.

Pas de modification de données, migration ou configuration secrète ; pas de
push ni déploiement. Les outils MCP hôte sont incomplets dans cette session
(trois outils exclus par politique) : pas de validation des journaux de production.
