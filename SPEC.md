# SPEC.md — brouillon Phase 0

Statut : **brouillon**. Le produit de référence n'a pas pu être lu (hôte `leavewise.nanocorp.app` non résolu depuis la session : hors liste réseau autorisée). Aucune section ci-dessous n'est [OBSERVÉ]. Tout vient du brief utilisateur ou du savoir-faire général.

## 1. Produit de référence
| Élément | Étiquette | Source |
|---|---|---|
| Gestion congés PME, portail employé, file d'approbation manager, soldes auto, détection de conflits, notifications, rapports, audit, intégrations calendrier, plans Starter/Pro | [DÉDUIT] du brief (non vérifié sur le site) | brief |
| Page FR en `/fr`, essai 14 jours sans carte | [DÉDUIT] du brief | brief |
| Pages, rôles exacts, états de demande, prix, FAQ, mise en page, typographie | **non vérifié** | à lire |

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

## 3. Questions bloquantes
Q1. **Accès au site de référence** : autoriser `leavewise.nanocorp.app` dans les paramètres réseau de l'environnement, ou coller le contenu (EN + FR) ? Sans cela, Phase 1 = tout [DÉDUIT]/[HYPOTHÈSE].
Q2. `{{type_entreprise}}` et `{{commune}}` non remplis : je pars sur « pharmacie » et commune fictive. OK ?

## 4. Plan proposé (à valider avant code)
- P1 Reverse engineering → SPEC §Produit (étiqueté).
- P2 Modèle de domaine + RULES.md (schéma SQLite, règles paramétrables JSON).
- P3 Moteur de tri en paquet pur TS (filtres durs → score → conflits → décision → recalcul), testé unitairement.
- P4 Remplacements (planifiés/imprévus, classement candidats, escalade, plan B).
- P5 App + démo (8 personnes, 3 mois d'historique) ; P5b site vitrine après choix de 2 directions visuelles.
- P6 Tests (liste de 25 cas du brief + cas site), journal TESTS.md.
