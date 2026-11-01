# SPEC.md — Phase 0 (cadrage) + amorce Phase 1

Statut : plan validé par l'utilisateur (« fais tout le nécessaire »). Phases 0-6 et étapes techniques 1-7 réalisées (site vitrine, règles légales complétées, session signée, API durcie, accessibilité, CI). Chiffres réels dans TESTS.md.
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
H2. Pile **réelle** (révisée : le plan initial prévoyait SQLite, Fastify et React+Vite, jamais utilisés) : Node 22 + TypeScript (`tsx`), serveur `node:http` sans framework, état en fichier JSON (écriture atomique), interface en JavaScript natif sans build, locales JSON ; tests Vitest, Playwright, axe-core. Une commande : `npm run dev`. Zéro service externe, aucune dépendance d'exécution (uniquement des dépendances de développement).
H3. Auth de démo : choix d'un rôle (employé, manager, RH, admin) qui ouvre une **session à cookie signé** (HMAC-SHA256, HttpOnly, SameSite=Strict, 8 h ; secret local généré au premier lancement dans `app/data/session.secret`, 0600, ignoré par git). Aucun mot de passe, aucune donnée personnelle dans le jeton (identifiant fictif + expiration). Ce n'est **pas** une authentification réelle : n'importe quel visiteur peut choisir n'importe quel rôle (démo locale seulement).
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
Aucune bloquante. À confirmer : commune et type d'entreprise (H1) ; nom du produit : « Leavewise », **décision de l'utilisateur** (même nom que le produit de référence — voir risque ci-dessous).

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
Code : `app/src/` (`types`, `calendar`, `rules`, `balance`, `coverage`, `engine`, `replacement`, `leaves`, `actions`, `session`, `validate`, `views`, `i18n`, `server`), données fictives `demo/seed.ts`, locales `app/locales/`.
Écarts assumés : l'équité utilise des jours calendaires ; pas d'authentification réelle (choix de rôle de démo avec cookie signé, H3) ; persistance JSON mono-utilisateur.

## 6b. Robustesse de l'API (étape 4)
Validation sans dépendance (`app/src/validate.ts`) : dates réelles `AAAA-MM-JJ` (2000-2100), énumérations, booléens, tailles (texte ≤ 500, listes ≤ 200, identifiants `[A-Za-z0-9_.:-]{1,64}`), corps JSON objet de 64 Kio maximum. Codes : 400 (`invalid_json`, `invalid_date`, `invalid_value`, `text_too_long`… avec `field`), 413, 415, 422 (règle métier), 401/403 ; une erreur interne répond `internal_error` sans détail. La langue `lng` est en liste blanche (une valeur libre permettait de lire un fichier JSON arbitraire) ; la déclaration imprévue est limitée à maladie/accident (elle permettait de créer des vacances approuvées d'office). État : écriture atomique (temp, fsync, rename) ; fichier illisible conservé en `.corrupt-*`.

## 7. Décision de nommage
L'utilisateur a demandé de garder le nom « Leavewise », identique à celui du produit de référence. Cela déroge à la règle initiale « ne pas copier le nom » : exception décidée par l'utilisateur, consignée dans CLAUDE.md. Logo, design, textes et code restent propres. **Risque à valider** : confusion avec le produit existant et droits de marque (vérifier le registre suisse IPI avant toute mise en ligne). Le site précise qu'il s'agit d'un prototype fictif.

## 8. Reste à faire par un humain
Rien de ce qui suit n'a été fait ni ne peut l'être par le prototype ; chaque point conditionne toute mise en service.
1. **Validation juridique** de tous les paramètres de RULES.md (vacances, repos quotidien/hebdomadaire, durées de maternité, paternité, proche aidant et congés spéciaux, jours fériés par commune, durées maximales, conservation nLPD 12 mois, formulation du consentement). Rien n'est un avis juridique.
2. **Relecture DE/EN** par des locuteurs : `app/locales/de|en.json` et `site/locales/de|en.json` sont des traductions non relues (marquées « à relire »).
3. **Marque « Leavewise »** : vérifier la disponibilité et le risque de confusion avec le produit de référence au registre IPI (et, au besoin, international) avant toute mise en ligne ; décision d'exception consignée dans CLAUDE.md.
4. **Choix d'hébergement** (pays, fournisseur, sauvegardes, journalisation) : rien n'est hébergé ; aucune proposition n'a été faite. Le serveur de démo ne doit pas être exposé.
5. **Vraie authentification** : la session de démo ne contrôle pas l'identité (n'importe quel visiteur choisit son rôle). À remplacer (SSO ou mots de passe robustes, 2FA, gestion de comptes, réinitialisation, `Secure` sur le cookie, protection CSRF complète, limitation de débit), puis tests d'intrusion.
6. **Remplacement des données fictives** (équipe, historique, jours fériés, règlement interne) par les données réelles, avec registre de traitement, base légale et information des employés (nLPD) ; remplacer le stockage JSON mono-utilisateur par une base fiable avec sauvegarde.
7. **Vérifications non faites ici** : première exécution de la CI sur GitHub Actions ; Firefox (non exécutable dans l'environnement de développement) ; audit manuel d'accessibilité avec lecteur d'écran ; performances sur réseau réel ; revue de la PR par un humain.
8. **Vulnérabilités signalées par `npm audit`** (vitest, esbuild, tinypool : outils de développement) : à traiter lors d'une montée de version majeure, non automatisée ici.

## 8. Espace propriétaire (accès privé complet)
Demande : une session gratuite et complète pour tester et affiner l'application, accessible uniquement au propriétaire. Décisions : deuxième espace de données (`app/data/owner-state.json`) sélectionné par un cookie signé distinct, activé seulement si `OWNER_PASSWORD` est défini ; la démo publique reste inchangée. Hypothèses [HYPOTHÈSE À VALIDER] : un mot de passe unique suffit pour un prototype à données fictives ; l'état éphémère de l'hébergement gratuit est compensé par export/import JSON. Limites : pas de compte nominatif, pas de 2FA, jeton sans état (la déconnexion efface le cookie mais ne révoque pas un cookie déjà copié avant son expiration de 12 h ; changer `SESSION_SECRET` invalide tous les jetons).
