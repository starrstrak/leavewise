# Prototype congés et remplacements (générique ; démo : pharmacie, canton de Fribourg)

Prototype fonctionnel, **données fictives uniquement**. Gère demandes d'absence, tri automatique justifié, couverture minimale paramétrable (démo : « au moins un pharmacien »), remplacements planifiés et imprévus, audit. Les règles légales sont des paramètres **à valider par un juriste** (pas un avis juridique).

## Lancer en une commande
```bash
npm install && npm run dev
```
Puis ouvrir http://localhost:3000 (application) et http://localhost:3000/site/ (site vitrine). Choisir un utilisateur (le choix ouvre une session de démo à cookie signé, sans mot de passe ; secret local généré dans `app/data/`, jamais commité) : Claire Morel (manager), Paul Berset (gérant/admin), Léa Brunner (employée), etc. Langues FR/DE/EN (DE/EN « à relire »).

## Autres commandes
```bash
npm run demo        # parcours scripté en console (sortie : demo/demo-output.txt)
npm test            # 68 tests : métier, règles légales, sessions, validation d'API
npm run typecheck
npm run site:build  # régénère site/index.html depuis les gabarits et locales/fr.json
npm run test:site   # tests du site (serveur lancé, Chromium ; BROWSER=webkit|firefox possible)
npm run test:ui     # parcours de l'interface (serveur lancé)
npm run test:a11y   # axe-core sur le site et l'application (serveur lancé)
npm run test:contrast # contraste mesuré sur le rendu réel (serveur lancé)
```
Réinitialiser la démo : bouton « Réinitialiser la démo » (admin) ou supprimer `app/data/`.

## Prérequis des tests de navigateur
`npm install` installe Playwright et axe-core ; une fois : `npx playwright install chromium` (et `webkit` pour `BROWSER=webkit`). Firefox (Nightly fourni par Playwright) ne démarre pas dans notre environnement de développement, voir TESTS.md. Les scripts `test:*` lisent `PORT` (défaut 3000). Une CI GitHub Actions (`.github/workflows/ci.yml`, Node 22) rejoue typecheck, tests, build du site, UI, site, accessibilité et contraste ; sa première exécution sur GitHub n'est pas encore vérifiée.

## Sécurité de la démo
Session à cookie signé (choix de rôle sans mot de passe) : **ce n'est pas une authentification**, démo locale uniquement. Le secret de signature est généré dans `app/data/session.secret` (jamais commité). Ne pas exposer ce serveur sur un réseau.

## Structure
`app/` moteur, API, interface, tests · `.github/` CI · `demo/` données et script · `SPEC.md` `RULES.md` `TESTS.md` `DESIGN.md` · `site/` vitrine (direction « Alpin »).
Produit de référence : inspiration fonctionnelle uniquement, rien n'est copié.
