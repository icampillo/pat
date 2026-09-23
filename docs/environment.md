# État de l'environnement

## Mise à jour après implémentation — 22 septembre 2026

Le projet exécutable se trouve maintenant dans outputs/patrimoine. Git est initialisé ; les dépendances sont installées et verrouillées. Next.js a ajouté ses instructions AGENTS.md et CLAUDE.md. Node.js 24, pnpm 11 et PostgreSQL portable 17.10 fonctionnent localement. Le serveur PostgreSQL écoute uniquement sur 127.0.0.1:55432, avec deux bases séparées pour l’application et les tests. Ses données résident dans .local/postgres.

Chromium Playwright est installé. Les outils clients PostgreSQL 17.11 provenant des binaires EDB sont dans .local/pg-tools/bin : une sauvegarde et une restauration séparée ont été vérifiées. Docker reste absent ; les fichiers Dockerfile et Compose ne sont donc pas présentés comme testés. Aucun service Windows permanent ni hébergement distant n’a été installé. La configuration privée et les accès démo sont dans des fichiers ignorés par Git.

Les paragraphes suivants conservent les constats de l’inspection initiale ; ils ne décrivent plus l’état après développement. Voir [README](../README.md) pour les commandes actuelles.

Inspection réalisée le 22 septembre 2026, en lecture seule avant la création de ces documents.

## Répertoire

Répertoire de travail : `C:\Users\ilan\Documents\Codex\2026-09-22\files-pasted-by-the-user-tu`.

Constats :

- Deux dossiers initialement présents : `work` et `outputs`, sans fichiers détectés dans leur contenu.
- Aucun `package.json`, code source, fichier de dépendances verrouillées, schéma de données ou configuration de conteneur.
- `git rev-parse --show-toplevel` et `git status --short` indiquent que le répertoire n'est pas un dépôt Git.
- Aucun `AGENTS.md` trouvé aux niveaux parents contrôlés, de la racine du disque au dossier de travail.
- Aucun choix technique existant à préserver ; aucun nettoyage nécessaire.
- La demande jointe a été lue sans être modifiée.

Les livrables de conception se trouvent dans `outputs/patrimoine`. Ce dossier pourra devenir la racine du projet à la phase 1 ; il faudra conserver ses documents pendant l'initialisation.

## Outils vérifiés

| Élément | Résultat observé | Conséquence |
| --- | --- | --- |
| Système | Microsoft Windows 10.0.19045 | Commandes locales documentées pour PowerShell |
| PowerShell | 7.6.5 | Disponible |
| Node.js | v24.19.0 | Disponible pour le futur projet |
| pnpm | 11.19.0 | Gestionnaire retenu, version à déclarer dans `packageManager` |
| Git | 2.53.0.windows.3 | Disponible ; dépôt à initialiser |
| ripgrep | Commande disponible | Recherche de fichiers disponible |
| npm, yarn | Non résolus par `Get-Command` | Inutiles puisque pnpm fonctionne |
| Docker | Commande non résolue ; exécutable au chemin usuel absent | Docker Compose non vérifié |
| PostgreSQL / psql | Commande non résolue ; dossier d'installation usuel absent | Aucune base locale vérifiée |
| Python, uv | Non résolus par `Get-Command` | Non requis pour la stack proposée |

« Non détecté » signifie absent des emplacements vérifiés, pas une preuve d'absence sur toute la machine. Aucun inventaire de processus, de ports ou de comptes n'a été effectué. Aucun secret ou fichier `.env` n'a été lu.

## Vérifications réellement exécutées

```powershell
node --version
pnpm --version
git --version
git rev-parse --show-toplevel
git status --short
rg --files --hidden -g '!node_modules' -g '!.git' .
```

Les deux commandes Git échouent comme attendu hors dépôt. La recherche `rg` ne retourne aucun fichier dans le dossier initial. Ces résultats décrivent l'environnement ; ils ne constituent pas des tests applicatifs.

## Prérequis pour le développement

1. Conserver Node.js 24 et pnpm ; verrouiller les versions effectivement installées à la phase 1.
2. Disposer de Docker Engine avec Compose, ou d'un PostgreSQL accessible dédié au développement et d'un autre dédié aux tests.
3. Vérifier `docker version` et `docker compose version` avant les commandes de conteneurs. Sous Windows, la compatibilité de Docker Desktop, de la virtualisation et du système doit être contrôlée lors de son installation ; elle n'est pas établie par cette inspection.
4. Vérifier l'accès au registre de paquets au moment de l'installation. Aucun téléchargement de dépendances n'a été testé.
5. Ne pas remplacer PostgreSQL par un stockage navigateur ou une base simulée pour déclarer les tests d'intégration réussis.

La documentation Docker présente les [options d'installation de Compose](https://docs.docker.com/compose/install/). Ce document ne prescrit aucune installation système automatique.

## Limites actuelles

- Pas d'application, de serveur de développement ou d'URL de démonstration.
- Pas de dépendances installées, de migrations exécutées ou de seed chargé.
- Pas de validation réelle de Docker, PostgreSQL, du navigateur Playwright ou d'une cible de déploiement.
- Les fichiers de conception sont les seuls nouveaux livrables de cette phase.
