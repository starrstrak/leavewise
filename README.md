# Prototype congés et remplacements (pharmacie, canton de Fribourg)

Prototype fonctionnel, **données fictives uniquement**. Gère demandes d'absence, tri automatique justifié, couverture « au moins un pharmacien », remplacements planifiés et imprévus, audit. Les règles légales sont des paramètres **à valider par un juriste** (pas un avis juridique).

## Lancer en une commande
```bash
npm install && npm run dev
```
Puis ouvrir http://localhost:3000. Choisir un utilisateur : Claire Morel (manager), Paul Berset (gérant/admin), Léa Brunner (employée), etc. Langues FR/DE/EN (DE/EN « à relire »).

## Autres commandes
```bash
npm run demo        # parcours scripté en console (sortie : demo/demo-output.txt)
npm test            # 36 tests métier et API
npm run typecheck
```
Réinitialiser la démo : bouton « Réinitialiser la démo » (admin) ou supprimer `app/data/`.

## Structure
`app/` moteur, API, interface · `demo/` données et script · `SPEC.md` `RULES.md` `TESTS.md` `DESIGN.md` · `site/` vitrine (phase 5b, en attente du choix visuel).
Produit de référence : inspiration fonctionnelle uniquement, rien n'est copié.
