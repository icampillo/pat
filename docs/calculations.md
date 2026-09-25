# Règles de calcul et exemples de référence

Spécification économique du MVP, à transformer en tests unitaires et d'intégration. Il ne s'agit pas d'un calcul fiscal français. Le moteur fiscal futur sera séparé.

## 1. Précision et ordre du journal

Le moteur reçoit et retourne des chaînes décimales. Il utilise decimal.js avec une précision de 60 chiffres. Persistance à 18 décimales, arrondi explicite HALF_EVEN ; affichage monétaire selon la devise, quantités selon l'actif. Le dernier mouvement clôturant une position consomme exactement le coût restant, pour éviter un résidu d'arrondi.

Les entrées sont ordonnées par `(occurredAt, sequence)` ; la séquence est serveur, stable entre révisions. Les calculs se font par actif sur l'ensemble des lieux de conservation. Chaque étape vérifie le solde du lieu concerné. Les frais exprimés dans une autre monnaie ou un autre actif sont représentés par une opération liée explicite au MVP.

Trois états sont distincts : valeur zéro connue, valeur absente, valeur connue mais ancienne. Toute somme impliquant une valeur absente est marquée partielle. Aucune absence n'est convertie en zéro.

## 2. Coût moyen et gains

Notations : Q quantité détenue ; C coût restant ; q quantité d'opération ; p prix unitaire ; f frais ; P prix actuel. Le même calcul est tenu dans la devise de cotation et dans la devise de base, avec les conversions datées propres à chaque écriture.

### Achat

```text
coût d'achat = q × p + f
Q' = Q + q
C' = C + coût d'achat
PMA' = C' / Q'
```

Le cash diminue de `q × p + f`. En financement extérieur, un apport du même montant et la consommation du cash sont générés dans la même opération ; le cash final ne change pas mais les apports nets augmentent.

### Vente

```text
PMA avant vente = C / Q
coût cédé = q × PMA avant vente
produit net = q × p − f
gain réalisé = produit net − coût cédé
Q' = Q − q
C' = C − coût cédé
```

Si q = Q, coût cédé = C exactement et C' = 0. La vente ne change pas le PMA des unités restantes. Son produit net augmente le cash, ou produit un retrait extérieur atomique si cette destination a été choisie.

### Valorisation

```text
valeur actuelle = Q × P
gain latent = valeur actuelle − coût restant
gain de cession total = gains réalisés cumulés + gain latent
```

Les revenus et frais généraux sont présentés séparément. Le tableau de bord distingue : achats cumulés frais inclus, coût restant des positions, apports nets, gains réalisés, gains latents et revenus. Un unique « montant investi » ambigu ne remplace pas ces mesures ; le libellé principal est « capital encore investi ».

### Exemple canonique

Toutes les valeurs sont en EUR.

| Étape | Quantité | Coût restant | PMA | Gain réalisé cumulé |
| --- | ---: | ---: | ---: | ---: |
| Achat 2 × 100, frais 2 | 2 | 202 | 101 | 0 |
| Achat 1 × 130, frais 1 | 3 | 333 | 111 | 0 |
| Vente 1 × 150, frais 3 | 2 | 222 | 111 | 36 |
| Prix actuel 140 | 2 | 222 | 111 | 36 |

Valeur actuelle 280 ; gain latent 58 ; gains réalisés + latents 94. Avec financement extérieur des deux achats et produit de vente conservé, cash = 147, patrimoine = 427, apports = 333. Une vente finale de 2 × 140 avec 2 de frais produit 56 de gain supplémentaire, laisse Q = 0 et C = 0, cash = 425, gains réalisés totaux = 92.

## 3. Sémantique des neuf types

| Type | Quantité et coût | Liquidités et performance |
| --- | --- | --- |
| BUY | Augmente Q et C, frais inclus | Consomme cash ; apport explicite si financement externe |
| SELL | Diminue Q et C au PMA ; gain réalisé | Produit du cash ; retrait explicite si sortie externe |
| DEPOSIT | Pour un actif : augmente Q avec coût d'origine obligatoire | Flux extérieur évalué à sa valeur lors de l'entrée ; cash si dépôt monétaire |
| WITHDRAWAL | Pour un actif : diminue Q et C au PMA, sans vente | Flux sortant à la valeur lors de la sortie ; cash si retrait monétaire |
| TRANSFER | Déplace entre plateformes, quantité et coût totaux inchangés | Déplace le cash entre comptes de même devise si applicable ; aucun apport/retrait extérieur |
| FEE | Frais autonomes ; si payé en actif, réduit Q et C | Frais généraux en cash ou charge en nature ; pas de duplication des frais de BUY/SELL |
| DIVIDEND | Q et C inchangés | Revenu encaissé en cash, rattaché à l'actif, pas un apport extérieur |
| REWARD | Augmente Q ; coût économique égal à la juste valeur reçue | Revenu en nature du même montant ; aucun cash fictif |
| ADJUSTMENT | Variation signée et motif, avec coût explicite à l'entrée et proportionnel à la sortie | Solde initial ou correction ; distinction obligatoire entre apport et correction de mesure |

Les achats, ventes et transferts sont limités aux soldes disponibles ; pas de vente à découvert ni de marge. Une opération antidatée est revalidée sur tout le journal ultérieur.

Un dépôt d'actif exige quantité, coût d'origine connu et valeur lors de l'entrée. Si le coût d'origine est inconnu, l'interface demande de le renseigner et ne remplace pas silencieusement ce coût par zéro. Le gain latent depuis l'achat peut inclure un gain antérieur à l'entrée dans le portefeuille ; il ne doit pas être assimilé au rendement depuis l'entrée.

Un retrait en nature n'est pas une cession réalisée. Il emporte une partie de la plus-value latente. Par conséquent, « réalisés + latents des positions restantes » et « résultat sur une période après neutralisation des flux » sont deux indicateurs différents.

Un frais en actif consomme le coût proportionnel et enregistre une charge égale à la valeur actuelle sortie ; l'écart entre valeur et coût est isolé comme résultat économique sur sortie en nature. Cela évite de soustraire deux fois la valeur du frais. Les traitements fiscaux spécifiques restent hors périmètre.

Un ajustement d'ouverture porte une date effective et un coût. Un ajustement correctif ne devient pas un faux gain ni un faux dépôt : les rendements traversant cette correction sont signalés comme non comparables. L'utilisateur peut remplacer une transaction erronée par une révision lorsque c'est l'origine réelle du problème.

## 4. EUR, USD et change

Convention : `rate(EUR, USD)=1.10` signifie 1 EUR = 1,10 USD. Les taux sont saisis/historisés manuellement au MVP. Le taux utilisé pour une transaction ou un snapshot est figé dans sa ligne.

- Un achat USD conserve son coût USD et son coût EUR calculé au taux de la date d'achat.
- La valorisation EUR d'un prix USD utilise le taux du moment de valorisation, avec sa date et son statut d'ancienneté.
- Le gain EUR compare valeur EUR actuelle et coût EUR historique ; il inclut donc l'effet de change.
- Les snapshots enregistrent leurs valeurs EUR et USD avec leurs propres taux historiques. Changer l'affichage ne reconvertit pas toute la courbe avec le taux actuel.
- Le gain réalisé USD est calculé indépendamment : produit net converti au taux de vente moins coût USD constitué aux taux des acquisitions. Il ne s'obtient pas en convertissant le gain EUR au taux de vente. Les agrégats additionnent ces gains USD datés.
- Le coût restant et le gain latent USD utilisent eux aussi le coût USD historique. Si un taux d'acquisition USD manque, ces indicateurs restent inconnus même si la valeur actuelle USD est disponible. La saisie reste possible en EUR ; compléter un ancien taux exige une révision explicite.
- En l'absence du taux requis, le calcul concerné est indisponible ; les prix dans leur devise d'origine restent visibles.

Exemple : achat 100 USD à 0,90 EUR/USD, prix actuel 120 USD à 0,95 EUR/USD. Coût EUR = 90 ; valeur EUR = 114 ; gain latent EUR = 24. Le gain en cotation reste 20 USD. Il est incorrect de convertir ce seul gain USD au taux courant pour obtenir le gain EUR.

## 5. Métaux

```text
poids fin par unité = poids brut en grammes × pureté
valeur métal par unité = poids fin × prix du gramme fin
valeur avec prime fixe = valeur métal + prime fixe
valeur avec prime relative = valeur métal × (1 + prime / 100)
valeur de position = quantité de pièces × valeur unitaire
```

Les modes MANUAL, GRAM, METAL_MARKET et CUSTOM_COIN sont exclusifs. MANUAL/CUSTOM_COIN utilisent le prix unitaire indiqué ; GRAM/METAL_MARKET utilisent une référence de prix au gramme historisée. Le mode METAL_MARKET reste alimenté manuellement tant qu'aucun fournisseur externe n'est configuré.

Exemple purement fictif : poids 6,45 g, pureté 0,900, prix fin 80 EUR/g, prime fixe 10 EUR. Poids fin = 5,805 g ; métal = 464,40 EUR ; pièce = 474,40 EUR ; deux pièces = 948,80 EUR. Ne pas multiplier deux fois par la pureté ou par la quantité.

## 6. Variation de valeur et rendement

Pour chaque période, distinguer :

```text
variation brute = valeur finale − valeur initiale
résultat après flux = valeur finale − valeur initiale − apports + retraits
```

Un dépôt de 1 000 EUR n'est pas un gain de 1 000 EUR. Un achat financé par du cash déjà détenu n'est pas un nouvel apport. Une vente dont le produit reste dans le portefeuille n'est pas un retrait. Les transferts internes ne modifient ni les apports ni le résultat.

Le pourcentage ajusté utilise Modified Dietz, annoncé comme approximation :

```text
F_i = flux extérieur signé (apport positif, retrait négatif)
w_i = (fin − dateFlux_i) / (fin − début)
R = (V_fin − V_début − somme(F_i)) / (V_début + somme(w_i × F_i))
```

Convention d'intervalle : flux `]début, fin]`, valeurs prises aux bornes réellement disponibles. Si le dénominateur est nul/négatif, si une valorisation est partielle, si un flux manque de taux ou si le journal a été corrigé après capture dans l'intervalle, le rendement est indisponible avec motif. Pas de pourcentage trompeur.

Exemple sans performance : début 1 000, apport 500 à mi-période, fin 1 500 → variation brute +500, résultat 0, rendement 0 %. Fin 1 600 → résultat 100, dénominateur 1 250, rendement 8 %.

Le tri des meilleures/moins bonnes positions utilise le gain latent relatif au coût restant, frais d'achat inclus, avec indication explicite de la période si un rendement de période est choisi. Les bases nulles et prix absents sont exclus du classement en pourcentage et restent visibles en montant. Les actifs vendus restent consultables dans les gains réalisés.

Le rendement Dietz du MVP porte sur le portefeuille complet, liquidités comprises. Le filtre catégorie présente valeur, variation et gains réalisés/latents de la catégorie ; il n'affiche pas un rendement Dietz utilisant les seuls flux externes globaux. Un futur rendement par catégorie devra aussi comptabiliser les achats/ventes et changements de catégorie comme flux à la frontière de cette catégorie.

Les observations DeBank fréquentes actualisent la valorisation courante sans créer de flux ni de snapshot complet. Les captures manuelles, quotidiennes ou de changement d’inclusion figent les observations disponibles et leur conversion. Sans flux wallet fiables, Dietz reste masqué lorsqu’un wallet est inclus ou qu’une capture WALLET figure dans l’historique chargé, même après son retrait. Une pause de synchronisation conserve sa valeur ; une exclusion change le périmètre, pas le résultat d’investissement.

## 7. Tests minimaux de référence

| Cas | Résultat attendu |
| --- | --- |
| Exemple achats/vente ci-dessus | Q=2, C=222, PMA=111, réalisé=36, latent=58 |
| Vente finale | Q=0, C=0 sans résidu |
| 0,1 + 0,2 unité | 0,3 exactement dans le domaine |
| Vente de 4 alors que Q=3 | Rejet, aucune écriture partielle |
| Transfert de 0,2 BTC entre plateformes | Quantité/coût globaux inchangés ; soldes locaux corrects |
| Suppression d'achat nécessaire à une vente ultérieure | Rejet 409 et rollback |
| Deux ventes simultanées d'un même solde | Une seule peut consommer la quantité disponible |
| Dividende 10 EUR | Cash et revenus +10, quantité inchangée, apport nul |
| Récompense 0,1 unité valant 10 EUR | Q +0,1, coût +10, revenu +10, aucun apport |
| Exemple de change | Gain EUR 24, gain de cotation USD 20 |
| Exemple de métal | Deux pièces valorisées 948,80 EUR |
| Nouveau prix après snapshot | Ancien snapshot strictement identique |
| Prix manquant sur un actif détenu | Total partiel, pas de valorisation zéro |
| Dépôt à mi-période sans variation | Rendement 0 % |
| Révision antidatée | Projection actuelle reconstruite, captures conservées et comparaison signalée |
| Réimport d'un lot confirmé | Aucun nouvel actif ni transaction |

Ajouter des tests par propriétés : conservation quantité/coût des transferts, coût nul quand quantité nulle, agrégats égaux à leurs lignes, et équivalence entre replay complet et projection persistée.
