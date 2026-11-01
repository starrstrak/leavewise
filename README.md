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

## Espace propriétaire (privé, complet, gratuit)
Un espace **réservé à une seule personne**, séparé de la démo publique : mêmes fonctions complètes (tous les rôles, tri, remplacements, règlement, audit, exports, horloge, réinitialisation), sans limite de plan, avec ses propres données.
- **Activation** : définir la variable d'environnement `OWNER_PASSWORD` (12 caractères minimum, 16+ aléatoires conseillés). Sans elle, l'espace n'existe pas. Le mot de passe n'est jamais dans le dépôt.
  - En local : `OWNER_PASSWORD='un-mot-de-passe-long-et-unique' npm run dev`
  - Sur Render : Environment > `OWNER_PASSWORD` (le Blueprint la déclare sans valeur).
- **Accès** : ouvrir l'application avec `/#owner`, onglet « Mon espace », saisir le mot de passe. Un cookie HttpOnly, SameSite=Strict (et Secure en HTTPS), valable 12 h, ouvre l'espace ; une bannière verte l'indique. L'onglet n'apparaît pas pour les autres visiteurs.
- **Protection** : comparaison en temps constant, verrouillage après 5 échecs par client sur 15 min, aucune route propriétaire sans cookie valide (401), données jamais mélangées avec la démo publique.
- **Persistance** : l'offre gratuite de Render n'a pas de disque : l'état est perdu au redémarrage. Utiliser « Exporter mon espace (JSON) » puis « Importer » pour le conserver.
- **Limite** : un seul mot de passe partagé, pas de compte nominatif ni d'authentification à deux facteurs. Pour un usage plus sensible, passer à une vraie authentification (voir SPEC.md, « Reste à faire par un humain »).
