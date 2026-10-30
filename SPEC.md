# SPEC.md — brouillon Phase 0

Statut : **Phase 0 close, en attente de validation du plan**. Le produit de référence a été lu le 2026-10-30 (pages publiques seulement : accueil EN/FR, connexion, création d'espace, paiement, confidentialité, conditions). Aucune zone connectée n'a été vue : tout ce qui touche l'intérieur de l'app reste [DÉDUIT] ou [HYPOTHÈSE À VALIDER]. Reformulations propres, rien de copié.

## 1. Produit de référence
| Élément | Étiquette | Source |
|---|---|---|
| Site bilingue EN (`/`) et FR (`/fr`), sélecteur de langue en en-tête | [OBSERVÉ] | pages publiques |
| Positionnement : gestion des congés pour RH de PME, promesse de gain de temps (≥ 3 h/semaine), essai 14 jours sans carte | [OBSERVÉ] | accueil |
| Fonctions annoncées : portail employé (demande, suivi, annulation, soldes mis à jour à l'approbation), file d'approbation manager (approuver/refuser en un clic, solde et couverture d'équipe visibles), reporting/exports et pistes d'audit | [OBSERVÉ] | accueil |
| Parcours en 3 étapes : configurer l'espace (types de congés, règles, invitations) → employé demande → manager valide, employé notifié, RH garde la trace | [OBSERVÉ] | accueil |
| Démo d'écran sur l'accueil : vue manager, file « en attente », calendrier d'équipe mensuel, types annuel / maladie / personnel | [OBSERVÉ] | accueil (illustration statique) |
| Deux offres : une d'entrée (≤ 25 salariés, détection de conflits, notifications e-mail, reporting de base) et une Pro (illimité, exports avancés, pistes d'audit, support prioritaire, intégrations calendrier) ; prix en USD, par mois | [OBSERVÉ] | accueil, paiement |
| Connexion par espace (identifiant d'organisation + e-mail + mot de passe) ; même e-mail possible dans plusieurs organisations ; session côté serveur, cookie HTTP-only ; réinitialisation du mot de passe | [OBSERVÉ] | page connexion |
| Création d'espace en 5 étapes : société → politiques de congés (allocations, report) → invitations → rôles (admin/manager) → confirmation ; fuseau horaire choisi | [OBSERVÉ] | page création |
| Paiement externe via prestataire hébergé, activation par webhook | [OBSERVÉ] | page paiement (hors périmètre ici : aucun service externe) |
| Politique de confidentialité et conditions : isolation par organisation, mots de passe hachés, pas de revente de données | [OBSERVÉ] | pages légales |
| Rôles internes réels (au-delà admin/manager/employé), états exacts d'une demande, règles de remplacement, soldes détaillés, rapports concrets, écrans de l'app | **non vérifié** (zone connectée) | à ne pas inventer comme observé |
| Absence de toute notion de remplacement, de score ou de règle métier pharmacie dans ce qui est public | [DÉDUIT] de l'absence dans les pages lues | à confirmer |
| Cibles du reporting et « 0 litige » : chiffres marketing non vérifiables | [HYPOTHÈSE À VALIDER] | accueil |

## 2. Hypothèses par défaut (modifiables)
H1. Organisation : pharmacie, 8 personnes, commune fictive « Fribourg-exemple » tant que non précisée.
H2. Pile : Node 22 + TypeScript, SQLite (fichier local), API HTTP (Fastify), front React+Vite ou HTML léger ; tests Vitest + Playwright. Une commande : `npm run dev`. Zéro service externe.
H3. Auth de démo : sélecteur de rôle (pas de vrai login), 4 rôles : employé, manager, RH, admin.
H4. Vacances : 4 semaines/an (CO art. 329a), 5 semaines < 20 ans (art. 329a al. 1) — à valider juriste.
H5. Jours fériés FR : jeu par défaut paramétrable, à valider (catholique/protestant selon commune).
H6. Granularité : demi-journée (matin/après-midi).
H7. Statuts de demande : brouillon, soumise, approuvée, refusée, annulée, impossible-en-l'état (moteur), + « annulation demandée » après approbation.
H8. Critères sensibles OFF par défaut ; poids du score modifiables.
H9. Notifications : in-app + journal e-mail simulé (fichier), aucun envoi réel.
H10. Tarifs du site vitrine : valeurs d'exemple marquées « exemple », en CHF.
H11. i18n : clés FR/DE/EN ; DE/EN traduits au mieux, marqués « à relire ».

## 3. Questions pour validation
Q1. ~~Accès au site~~ résolu : lu, voir §1.
Q2. `{{type_entreprise}}` et `{{commune}}` non remplis : je pars sur « pharmacie » et commune fictive (H1). OK ?
Q3. Prix du site vitrine : le produit de référence est en USD ; nous utilisons des valeurs d'exemple en CHF (H10). OK ?
Q4. Paiement/webhook externe exclu du prototype (règle « aucun service externe »). OK ?

## 4. Plan proposé (à valider avant code)
- P1 Reverse engineering → SPEC §Produit (étiqueté).
- P2 Modèle de domaine + RULES.md (schéma SQLite, règles paramétrables JSON).
- P3 Moteur de tri en paquet pur TS (filtres durs → score → conflits → décision → recalcul), testé unitairement.
- P4 Remplacements (planifiés/imprévus, classement candidats, escalade, plan B).
- P5 App + démo (8 personnes, 3 mois d'historique) ; P5b site vitrine après choix de 2 directions visuelles.
- P6 Tests (liste de 25 cas du brief + cas site), journal TESTS.md.
