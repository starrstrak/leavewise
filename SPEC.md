# SPEC.md — Phase 0 (cadrage) + amorce Phase 1

Statut : plan validé par l'utilisateur (« fais tout le nécessaire »). Phases 0-6 (hors site) réalisées ; phase 5b en attente du choix visuel.
Sources lues le 2026-10-30 : page EN `/` et page FR `/fr` du produit de référence (texte via fetch, rendu visuel via Chromium/Playwright, capture 1280 px).
Limite : seule la page vitrine est publique ; l'application elle-même n'est pas accessible. Tout ce qui touche au fonctionnement interne reste [DÉDUIT] ou [HYPOTHÈSE À VALIDER].

## 1. Produit de référence — ce qui est observé

### Vitrine (structure)
- [OBSERVÉ] Page unique à ancres : Fonctionnalités, Comment ça marche, Tarifs, FAQ. Bascule de langue **EN/FR uniquement** (pas de DE). Boutons « Se connecter » et « Commencer ».
- [OBSERVÉ] Ordre : hero (badge, titre avec fin en italique accentué, sous-titre, 2 CTA, mention essai 14 jours sans carte) → maquette d'app en fenêtre de navigateur → 3 chiffres → 3 fonctionnalités numérotées (section sombre) → 3 étapes → 2 tarifs → FAQ de **3** questions en cartes (pas d'accordéon) → CTA final → pied de page (Fonctionnalités, Tarifs, Confidentialité, Conditions, © 2026).
- [OBSERVÉ] Maquette : vue manager, « approbations en attente » (3), boutons Approuver/Refuser, une demande déjà approuvée, lien « voir le calendrier » (Juillet 2026). Types de congé affichés : congé annuel, maladie, personnel.
- [OBSERVÉ] Ambiance : fond crème chaud, vert forêt très sombre en accent, titres en serif (≈72 px, graisse 400), texte en sans-serif géométrique, cartes arrondies à ombre douce, étiquettes de section en petites capitales espacées. Plan mis en avant : carte sombre + pastille jaune.
- [OBSERVÉ] Chiffres clés : 3 h+/semaine, 100 % d'adoption libre-service, 0 litige. **Affirmations marketing non vérifiées** ; je ne les reprends pas comme faits (consigne projet).

### Produit (ce que la vitrine affirme)
- [OBSERVÉ] Rôles : salarié (soumet, suit, annule, voit son solde), manager (file d'approbation, voit couverture d'équipe, solde, historique), RH (types de congé, règles, invitations, audit, rapports).
- [OBSERVÉ] États visibles : en attente, approuvé ; refuser et annuler existent comme actions. Aucun modèle d'états complet publié.
- [OBSERVÉ] Soldes mis à jour automatiquement à l'approbation. Notification immédiate employé à l'approbation/refus. E-mail inclus dès le plan d'entrée.
- [OBSERVÉ] Détection de conflits (plan d'entrée). Exports : pistes d'audit, synthèses de soldes, justificatifs de règles (plan Pro).
- [OBSERVÉ] Tarifs : 2 plans, jusqu'à 25 salariés puis illimité, prix mensuels en **USD**, Pro = exports/audit de conformité/support prioritaire/intégrations calendrier. Aucun fournisseur de calendrier nommé.
- [OBSERVÉ] Non publié : types de congé complets, règles d'annulation, canaux de notification autres qu'e-mail, droits RH détaillés, tarif annuel.

### Déductions et hypothèses
- [DÉDUIT] Entités : organisation, utilisateur, rôle, type de congé, politique, solde, demande, décision, notification, entrée d'audit, équipe.
- [DÉDUIT] Cycle : brouillon (non observé) → en attente → approuvée | refusée ; annulation par l'employé.
- [HYPOTHÈSE À VALIDER] Calcul des soldes : acquisition par prorata/période, déduction à l'approbation. Non observé.
- [HYPOTHÈSE À VALIDER] Rôles RH/admin séparés ; délégation manager ; multi-managers. Non observé.
- [DÉDUIT] Écart brief ↔ observé : le brief attend 5–7 questions FAQ, 6 cartes, sélecteur FR/DE/EN ; le site de référence a 3, 3 et EN/FR. Je suis le brief pour notre site (pas de copie).

## 2. Hypothèses par défaut (modifiables)
H1. Organisation : pharmacie de 8 personnes, commune fictive « Fribourg-exemple » (`{{commune}}` et `{{type_entreprise}}` non fournis).
H2. Pile : Node 22 + TypeScript, SQLite local, API Fastify, front React+Vite ; tests Vitest + Playwright. Une commande : `npm run dev`. Zéro service externe.
H3. Auth de démo : sélecteur de rôle (employé, manager, RH, admin), pas de vrai login.
H4. Vacances : 4 semaines/an, 5 semaines < 20 ans, ≥ 2 semaines consécutives (CO 329a ss.) — **à valider par un juriste**.
H5. Jours fériés FR : jeu par défaut paramétrable, **à valider** (varient selon commune).
H6. Granularité : demi-journée.
H7. États : brouillon, soumise, approuvée, refusée, annulée, « impossible en l'état » (moteur), « annulation demandée » (après approbation).
H8. Critères sensibles OFF par défaut ; pondérations modifiables.
H9. Notifications : in-app + journal e-mail simulé en fichier.
H10. Tarifs vitrine : valeurs marquées « exemple », en CHF.
H11. i18n : `locales/fr|de|en`, DE/EN marqués « à relire ».
H12. Chiffres clés vitrine : formulations vérifiables ou marquées « exemple » (pas de « 0 litige »).

## 3. Questions
Aucune bloquante. À confirmer : commune et type d'entreprise (H1) ; nom du produit (provisoire « Remplacia » dans l'app, à fixer avec l'identité visuelle).

## 4. Écart de procédure à signaler
`CLAUDE.md` citait une autre branche ; la branche de travail imposée par la session est `claude/serene-wozniak-2zgwtm` (corrigé).

## 5. Reverse engineering → ce que nous reconstruisons (Phase 1)
| Élément du produit de référence | Étiquette | Notre implémentation |
|---|---|---|
| Portail libre-service (déposer, suivre, annuler, solde) | [OBSERVÉ] | onglet « Mes demandes » |
| File d'approbation manager, un clic, couverture/solde/historique visibles | [OBSERVÉ] | onglet « Tri » + décision justifiée, lot, aperçu des impacts |
| Détection de conflits | [OBSERVÉ] (plan d'entrée) | simulation de couverture par demi-journée |
| Soldes mis à jour à l'approbation | [OBSERVÉ] | solde dérivé des demandes approuvées (jamais stocké) |
| Notification employé à l'approbation/refus ; e-mail | [OBSERVÉ] | notifications in-app + e-mail simulé, **après** validation |
| Exports d'audit, soldes, justificatifs | [OBSERVÉ] (Pro) | CSV audit/soldes/demandes (RH/admin) |
| Calendrier d'équipe | [OBSERVÉ] (mini-maquette) | grille de couverture 4 semaines |
| Tarification 2 paliers ≤ 25 salariés / illimité | [OBSERVÉ] | site vitrine : paliers « exemple » en CHF |
| États brouillon/annulation demandée, délégation, multi-managers, rôle admin séparé | [HYPOTHÈSE À VALIDER] | implémentés selon H7 |
| Tri automatique, remplacements, qualifications, droit suisse | absents de la vitrine | **ajouts propres au brief** |

États d'une demande : brouillon → soumise → approuvée | refusée | annulée ; approuvée → annulation demandée → annulée | approuvée.
Entités : Employé, Qualification, Demande d'absence, Décision, Règlement (versions), Besoin de remplacement (offres), Affectation, Créneau fermé (plan B), Notification, Entrée d'audit, Profil sensible (consentement), Historique de pointe.

## 6. Domaine, moteur, remplacements (Phases 2-4) — voir RULES.md
Code : `app/src/` (`types`, `calendar`, `rules`, `balance`, `coverage`, `engine`, `replacement`, `actions`, `server`), données fictives `demo/seed.ts`, locales `app/locales/`.
Écarts assumés : repos hebdomadaire (35 h) et durées légales des congés spéciaux non codés ; l'équité utilise des jours calendaires ; pas d'authentification réelle (sélecteur de rôle, H3) ; persistance JSON mono-utilisateur.
