# Import Bourse : inventaires datés et variantes d’avis BoursoBank

## Causes racines

1. L’import des positions écrivait l’ADJUSTMENT initial à la date d’exécution de l’import, pas à la date du relevé. La protection contre les doublons considérait donc les achats réellement postérieurs au relevé comme potentiellement inclus dans cet inventaire.
2. Le parseur d’avis imposait le tableau détaillé (« Montant transaction brut », intérêts, courtages, commission, frais divers, net) et son nombre de cellules. Le tableau compact (« Montant brut », commission, frais, net) n’était pas reconnu ; dans l’avis Émergents fourni, la cellule Frais est vide.

## Correction

- L’API d’aperçu CSV exige `asOf`, un instant ISO avec fuseau. L’interface propose la date/heure du nom Bourso lorsqu’elle est identifiable, en Europe/Paris, sans cocher sa confirmation. L’utilisateur peut la modifier et doit la confirmer.
- Les heures inexistantes ou ambiguës aux changements d’heure sont refusées. Aucun défaut silencieux à la date du jour.
- `ImportBatch.payload.asOf` mémorise la date retenue. `Transaction.occurredAt` porte la date effective utilisée par le replay ; `Transaction.createdAt` reste la date réelle d’import. Aucune migration de schéma nécessaire.
- Les quantités, coûts initiaux et la convention existante de conversion FX à la date d’import sont conservés. La date effective ne prétend pas être une date d’achat, ni justifier un taux d’achat historique inconnu.
- Les références courtier restent prioritaires pour la déduplication, par compte. Un inventaire reste un ADJUSTMENT, jamais une alternative à un BUY/SELL. Les opérations antérieures ou égales à un inventaire apparaissent en `INVENTORY_REVIEW`, avec un lien vers l’inventaire, sans différences ADJUSTMENT → BUY et sans forçage CREATE.
- Les nouvelles opérations sur une fiche existante sont distinguées de celles créant une fiche. L’identification ISIN + compte et les cotations vérifiées restent utilisées.
- Le parseur sélectionne explicitement une variante de tableau et contrôle les devises, le sens débit/crédit, la quantité × le prix (tolérance de brut : 0,01), les détails et totaux des frais, puis le net exact. Dans le tableau compact, une cellule de frais omise n’est acceptée que si la cohérence brut/commission/net est établie. Les formats inconnus ou incohérents restent refusés avec diagnostic.
- Les anciens aperçus CSV non confirmés et dépourvus de date doivent être recréés. Les confirmations déjà enregistrées restent idempotentes.

## Correction des inventaires déjà importés

Aucune correction automatique ni modification de données réelles n’a été effectuée.

Pour le relevé nommé `export-positions-instantanees-23-09-2026_17-50-30.csv`, la suggestion est **23/09/2026 à 17:50:30 Europe/Paris**, soit **15:50:30 UTC**, à vérifier sur la source :

1. Ouvrir l’inventaire CSV concerné depuis le journal ou le lien de l’aperçu d’opérations. Répéter pour chaque position concernée du lot.
2. Saisir la date effective et un motif/source, puis « Vérifier la correction ».
3. Vérifier ancienne/nouvelle date, quantité, coût unitaire et date d’import conservée ; confirmer uniquement la date.
4. Relancer l’aperçu des avis. Sans autre mouvement : World **263 + 30 = 293** ; Émergents **6**.
5. PRU World attendu : **(coût initial conservé + 216,87 €) / 293**. PRU Émergents : **224,10 / 6 = 37,35 €**.

Endpoint authentifié : `POST /api/v1/securities/inventories/:transactionId/date`, corps d’aperçu `{ asOf, reason }`, puis confirmation `{ asOf, reason, confirmed: true, version }` avec la version du portefeuille retournée et une clé d’idempotence. L’aperçu ne laisse aucune écriture. La confirmation revalide le journal sous transaction sérialisable, ne change que `occurredAt` et la version, et conserve l’ancienne valeur dans la révision précédente.

Une correction traversant une opération déjà présente du même actif/compte est refusée : son inclusion doit être examinée, sans suppression automatique. Les quantités, coûts, références, date d’import et taux de change sont inchangés. Les snapshots restent des observations historiques immuables ; `historyRevised` signale la révision du journal, sans fabriquer de valorisations anciennes.

## Tests et commandes reproductibles

Les quatre fixtures `tests/fixtures/bourso-{world,emerging}-anonymous.{txt,pdf}` sont synthétiques. Elles reproduisent les tableaux, dates, quantités, prix et frais utiles, avec des libellés/références fictifs, sans identité, adresse, numéro de compte ni document original. Les tests font réellement passer les PDF dans `unpdf`, sans mock d’extraction dans le nouveau scénario PostgreSQL.

```sh
pnpm test:unit
DATABASE_URL_TEST=postgresql://postgres@127.0.0.1:55439/bourse_validation_test pnpm test:integration
pnpm typecheck
pnpm lint
pnpm build
```

Les tests PostgreSQL refusent une base dont le nom ne se termine pas par `_test` et remplacent aussi DIRECT_URL. Ne pas utiliser la base applicative.

Une recette de validation complète avec PostgreSQL éphémère est disponible dans `docker/bourse-validation/Dockerfile` et `validate.sh`. Elle s’exécute **pendant le build**, sous l’utilisateur postgres, sans démarrage d’application ni publication de port. Construire depuis un contexte sans documents personnels ni fichiers d’environnement :

```sh
docker build -f docker/bourse-validation/Dockerfile -t patrimoine-bourse-validation .
```

Cette recette n’est pas un déploiement. Les résultats de la validation sont consignés dans le compte-rendu de la tâche.

## Résultats vérifiés le 9 octobre 2026

- **238 tests unitaires / 31 fichiers : réussis**, via `npm run test:unit`.
- **99 tests PostgreSQL / 12 fichiers : réussis**, dont les 10 nouveaux scénarios de chronologie/correction. PostgreSQL réel éphémère dans le build rootless `patrimoine-bourse-validation`, sans application démarrée ni port publié. Les sources, tests et migrations de cette copie ont été comparés octet par octet avec le projet avant validation (aucune différence).
- **Prisma validate et les 12 migrations existantes : réussis** sur cette base de test uniquement. Aucun changement de schéma ajouté par ce correctif.
- **TypeScript : réussi**, via `npm run typecheck`.
- **ESLint : 204 fichiers, zéro erreur et zéro avertissement**.
- **Build production : réussi**, via `npm run build`, avec DATABASE_URL et DIRECT_URL factices locales ; compilation, TypeScript, génération des 15 pages et traces terminés.
- **Prettier ciblé et `git diff --check` : réussis**.

Les nouveaux tests PostgreSQL confirment le parcours CSV du 23/09 importé le 09/10 puis PDF du 07/10 : **293 parts World et 6 parts Émergents**. Le coût initial synthétique World est de 263 × 7 €, puis 215,79 + 1,08 € ajoutés : coût total **2 057,87 €**, PRU **2 057,87 / 293**. Cette valeur de coût initial est une fixture, pas une affirmation sur le portefeuille réel. Émergents : **224,10 €**, PRU **37,35 €**.

Sont aussi vérifiés : références par compte, réimport sans aucune écriture supplémentaire, opérations incluses dans l’inventaire bloquées, achats/ventes avec frais nuls ou non nuls, correction de date auditée et idempotente, refus des corrections concurrentes ou traversant une opération, journal et snapshots préservés. Les cotations réseau sont simulées dans les tests.

Limites : le scénario navigateur a été adapté mais **n’a pas été exécuté** pour cette tâche. Les tests PostgreSQL émettent un avertissement de dépréciation du client `pg` (requêtes concurrentes sur un client, future version 9), sans échec ; Docker signale les variables d’authentification factices de la recette de test. Aucun secret réel n’a été utilisé dans le conteneur de validation.

**Aucun commit, push, déploiement, migration de production ni correction des données réelles.** Seules les fixtures synthétiques sont candidates à Git ; les documents originaux et fichiers personnels restent exclus.
