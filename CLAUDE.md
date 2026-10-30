# CLAUDE.md — conventions du projet

Projet : prototype de gestion des congés et remplacements pour PME suisse (canton de Fribourg).
Cas de référence : pharmacie, ouverture lun–sam, ≥ 1 pharmacien présent obligatoire.
Produit de référence : https://leavewise.nanocorp.app — inspiration fonctionnelle uniquement.

## Règles non négociables
- Ne rien copier du produit de référence : ni code, ni textes, ni nom, ni logo, ni design.
- Toute affirmation sur le produit de référence porte une étiquette : [OBSERVÉ], [DÉDUIT], [HYPOTHÈSE À VALIDER].
- Décision automatique = modifiable, justifiée (règle, critère, score), tracée (auteur, horodatage). L'humain tranche.
- Données sensibles (situation familiale, santé) : désactivées par défaut, activation explicite admin + consentement employé, jamais exposées aux collègues ni managers non autorisés, jamais utilisées pour pénaliser.
- Règles légales suisses = paramètres « à valider par un juriste ». Jamais présentées comme avis juridique.
- Données fictives uniquement. Aucune dépendance payante ni service externe sans accord.
- Un test n'est ✅ que avec sortie d'exécution réelle conservée. Max 3 itérations puis escalade.

## Langue
- Docs et UI : français. i18n prête DE/EN (fichiers `locales/fr|de|en`). Aucun texte en dur dans les composants.
- Code : identifiants en anglais, commentaires rares, en français ou anglais selon le fichier voisin.

## Structure cible
README.md · SPEC.md · RULES.md · DESIGN.md · TESTS.md · app/ · site/ · demo/ (données + script)

## Commandes
- Installer : `npm install`
- Lancer : `npm run dev` puis http://localhost:3000 (données fictives, état dans `app/data/`)
- Démo scriptée : `npm run demo`
- Tests : `npm test` ; UI : `node app/test/ui-smoke.mjs http://localhost:3000` (serveur lancé) ; types : `npm run typecheck` ; site : `npm run site:build` puis `npm run test:site` (serveur lancé, http://localhost:3000/site/)

## Workflow
- Branche : `claude/serene-wozniak-2zgwtm`. Un commit par fin de phase. Pas de PR sans demande.
- Plan présenté et validé avant tout code. Choix visuel (2 directions) validé avant le site.
- Fin de phase : résumé ≤ 5 lignes (décisions, hypothèses ouvertes, phase suivante) + auto-vérification.
