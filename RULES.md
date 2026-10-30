# RULES.md — règles métier et paramètres

Tout est paramétrable sans code : `app/src/rules.ts` (valeurs par défaut) et onglet « Règlement » (admin) → nouvelle **version** avec date d'entrée en vigueur. Une demande est évaluée avec la version en vigueur **à sa date de dépôt** (pas de rétroactivité). Chaque changement est tracé.

> **Valeurs légales : « à valider par un juriste ».** Elles ne constituent pas un avis juridique.

## Cadre légal (paramètres par défaut, à valider)
| Paramètre | Défaut | Base indicative (à valider) |
|---|---|---|
| Vacances annuelles | 4 semaines (5 avant 20 ans révolus, au prorata dans l'année du 20e anniversaire) | CO art. 329a |
| Au moins 2 semaines consécutives | `minConsecutiveDays` = 10 jours ouvrés ; **rappel non bloquant** affiché au manager (raison `min_consecutive_reminder` de la décision) et à l'employé (carte « Solde ») ; week-ends, fériés et fermetures enchaînent les périodes, demi-journées comptées entières | CO art. 329c |
| Maladie/accident pendant les vacances | jours crédités si certificat (`sicknessCreditsVacation`) | CO art. 329b-329c, jurisprudence |
| Repos quotidien | 11 h | LTr art. 15a |
| Repos hebdomadaire | 35 h (`legal.weeklyRestHours`), **appliqué** : par semaine ISO, au moins un repos ininterrompu ≥ 35 h entre deux événements de travail (horaires, affectations, blocs extra), rattaché à la semaine où il commence ; raison `weekly_rest` (blocage du candidat) dans le classement des remplaçants et dans l'alternative « remplaçant » du tri ; tous les créneaux d'un même besoin sont vérifiés ensemble | LTr art. 21 |
| Durée hebdomadaire maximale | 45 h | LTr art. 9 |
| Jours fériés FR | liste paramétrable, périmètre « catholique » par défaut (Fête-Dieu, Assomption, Toussaint, Immaculée Conception) | droit cantonal fribourgeois — varie selon la commune |
| Congés spéciaux, maternité, paternité, proche aidant | durées **par défaut** paramétrables (`legal.leaves`, modifiables par l'admin dans « Règlement », nouvelle version) : spécial 3 j ouvrés ; maternité 98 j calendaires ; paternité 14 j calendaires ; proche aidant 3 j ouvrés par événement, plafond indicatif 10 j/an ; justificatif attendu par type. **À valider par un juriste** : jamais présentés comme un droit garanti ; le moteur affiche durée, avertit en cas de dépassement ou de justificatif absent, ne bloque jamais | CO art. 329 al. 3, 329f-329i, LAPG — valeurs indicatives |

## Règlement interne d'exemple (fictif)
Préavis 14 j (levé pour une demande urgente justifiée) · durée max. 15 j calendaires · blocage 14-24 décembre (inventaire) · fermeture collective 28-31 décembre (déduite du solde) · échéance de dépôt pour juillet-août : 30 avril · report max. 5 j, perdu au 31 mars · solde négatif interdit · max. 2 absents simultanés.

## Couverture
Par demi-journée d'ouverture (lun-ven matin/après-midi, samedi matin ; fériés et fermetures exclus) : ≥ 1 **pharmacien présent**, effectif ≥ 2, absents simultanés ≤ 2. Qualifications : seul·e un·e pharmacien·ne compte comme « qualifié ». Assistantes : effectif seulement. **Apprentis et stagiaires : effectif seulement, jamais qualifiés, supervision requise.** Un créneau fermé par un plan B sort de l'obligation de couverture.

## Pipeline de tri
1. **Filtres durs** : emploi actif, préavis, blocage, date limite, durée max., solde, couverture (seules les violations *créées* par la demande lui sont imputées). Violation → « impossible en l'état » + raison + alternatives (partiel, scinder, décaler ±28 j, remplaçant).
2. **Score 0-100** = moyenne pondérée de : équité (jours pris sur 365 j vs moyenne), rotation (périodes de pointe accordées/refusées sur les années passées), urgence, ordre de dépôt. Poids par défaut 30/30/15/25. **Critère familial** : bonus additif ≤ 10 pts, **jamais négatif**, actif seulement si l'admin l'active **et** que l'employé a consenti. Égalité : départage par ordre de dépôt puis identifiant, signalée.
3. **Résolution** gloutonne par score décroissant ; chaque demande acceptée consomme la couverture des suivantes.
4. **Décision proposée** avec raisons en langue de l'interface. Rien n'est notifié à l'employé.
5. **Ajustement humain** : approuver/refuser/modifier avec **motif obligatoire** ; aperçu puis application ; cascade recalculée (`cascade.changed` dans l'audit). Nul ne décide de sa propre demande.
6. **Lot** : validation de plusieurs décisions ; notification **après** validation. Mode automatique (admin, désactivé par défaut) : seulement les demandes à **risque nul** (marge de couverture ≥ 1 et aucun concurrent).

## Remplacements
Besoin créé automatiquement à l'approbation d'une absence qui laisse un trou (planifié) ou à la déclaration d'une maladie/accident (imprévu, absence approuvée d'office). Classement des candidats : qualification (stagiaires/apprentis exclus), disponibilité, absence, déjà en poste, plafond hebdomadaire, repos quotidien (blocs extra, ex. garde de nuit), repos hebdomadaire (`weekly_rest`), heures déjà prévues, jours préférés, marge de temps partiel, remplaçant externe sans heures supplémentaires. Offre au premier ; rappel après 30 min puis expiration, offre suivante ; plus de candidat → escalade manager puis RH ; **plan B** (horaires réduits ou fermeture) avec nombre de demi-journées fermées affiché, motif obligatoire.

## Données sensibles (nLPD)
Désactivées par défaut. Activation : admin **et** consentement de l'employé (révocable). Visibles de l'employé et des RH/admin seulement ; masquées aux managers et collègues (le score affiché au manager est recalculé sans ce critère). Conservation 12 mois puis purge. Jamais utilisées pour pénaliser. Détails et références légales à faire valider.
