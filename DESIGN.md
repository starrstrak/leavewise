# DESIGN.md — direction retenue : A « Alpin »

Choix de l'utilisateur : direction A (clair, clinique, rassurant). Identité propre ; rien du site de référence n'est repris (palette, typographie, textes, structure des composants sont les nôtres). **Exception : le nom « Leavewise » est conservé sur demande de l'utilisateur** (voir SPEC.md §7). Le logo (croix + sur carré turquoise) est propre.

## Tokens
Fichier unique : `site/tokens.css` (couleurs, polices, tailles, rayons, ombres, espacements ; clair par défaut, sombre automatique via `prefers-color-scheme` ou forcé par le bouton de thème).
| Rôle | Clair | Sombre |
|---|---|---|
| Fond / surface | `#f5f8fa` / `#ffffff` | `#0b1422` / `#131f33` |
| Encre / texte secondaire | `#14213d` / `#455468` | `#e8eef5` / `#a7b5c6` |
| Accent | `#0b6f78` (turquoise profond) | `#52c1ca` |
| Pastille « Recommandé » | `#e7c66a` | idem |
- Écart avec la proposition : l'accent a été assombri (`#0E7C86` → `#0b6f78`) pour tenir le contraste AA avec du texte blanc.
- Polices : Manrope (titres) et Inter (texte), variables, licence OFL (fichiers dans `site/fonts/`, texte de licence joint), auto-hébergées : aucune ressource externe. Icônes : SVG en ligne, décoratives.
- Rayons 6/10/16 px, boutons en pilule ; ombres froides légères ; échelle d'espacement 4-112 px ; typographie fluide (`clamp`).

## Structure de la page (brief)
Barre fixe (logo, liens, FR/DE/EN, thème, Se connecter, Essai gratuit) → hero (badge, titre avec fin en accent, sous-titre, 2 boutons, mention) → maquette de la vue manager avec « Pharmacien présent ✓ » → 3 chiffres → 6 fonctionnalités numérotées → 3 étapes → 3 tarifs (« Recommandé » en carte sombre) → FAQ en accordéon (6 questions, dont nLPD et droit suisse) → appel final → pied de page (Confidentialité, Conditions, Contact, page `legal.html`).

## Contenus et promesses
Tous les textes sont originaux (`site/locales/fr|de|en.json`, DE/EN « à relire »). Les chiffres sont ceux du dépôt (36 tests, 3 langues, 0 donnée sensible par défaut) et sont signalés « chiffres du prototype, pas des résultats de clients ». Les tarifs CHF sont marqués « Exemple ». Aucune statistique client inventée.

## Accessibilité et responsive
Mobile d'abord (menu replié < 960 px), lien d'évitement, balises sémantiques, un seul `h1`, FAQ en `<details>` natif, focus visible 3 px, `prefers-reduced-motion` respecté, cibles ≥ 44 px, maquette décrite par `figcaption`. Contrastes AA vérifiés par script sur les paires de tokens, clair et sombre.

## Génération
`site/index.template.html` + `locales/fr.json` → `npm run site:build` produit `index.html` et `legal.html` (français par défaut, lisible sans JavaScript, sans dérive possible avec `fr.json`). `site/site.js` applique DE/EN.
