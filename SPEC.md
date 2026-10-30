# SPEC.md — Phase 0 (cadrage) + amorce Phase 1

Statut : **cadrage validé en attente d'accord utilisateur**. Aucun code avant validation du plan (§5).
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

## 3. Questions bloquantes
Aucune bloquante. À confirmer (défaut appliqué sinon) : Q1 commune/type d'entreprise (H1) ; Q2 pile (H2).

## 4. Écart de procédure à signaler
`CLAUDE.md` citait une autre branche ; la branche de travail imposée par la session est `claude/serene-wozniak-2zgwtm` (corrigé).

## 5. Plan proposé (à valider avant tout code)
- P1 Reverse engineering : approfondir §1 (états, soldes, rapports, tarification) — doc seule.
- P2 Modèle de domaine + RULES.md (schéma SQLite, règles JSON paramétrables, cadre légal « à valider »).
- P3 Moteur de tri : paquet TS pur (filtres durs → score → conflits → décision → recalcul), tests unitaires d'abord.
- P4 Remplacements (planifiés/imprévus, classement, escalade, plan B, limites par statut).
- P5 App + démo (8 personnes, 3 mois d'historique) ; commandes remplies dans CLAUDE.md.
- P5b Site vitrine : **2 directions visuelles** proposées d'abord (palette + typo), attente de ton choix.
- P6 Tests : 25 cas métier + cas site ; TESTS.md avec sortie réelle, ≤ 3 itérations.
