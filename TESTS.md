# TESTS.md — journal de vérification

Sorties réelles conservées dans `tests-logs/` (un jeu `stepN-*.log` par étape ; `*.log` est ignoré par git, les journaux sont ajoutés de force aux commits). Un ✅ = exécuté, sortie conservée, comparé à l'attendu. Non-régression : la suite complète est relancée après chaque étape.

## Bilan réel (dernier passage : `tests-logs/step7-*.log`)
| Suite | Commande | Résultat |
|---|---|---|
| Unitaires, règles, API, sessions | `npm test` | **68/68** : `domain` 25, `flows` 11, `legal-rules` 14, `session` 8, `api-robustness` 10 |
| Types | `npm run typecheck` | 0 erreur |
| UI applicative | `npm run test:ui` | **14/14** |
| Site vitrine | `npm run test:site:chromium` / `:webkit` | **32/32** et **32/32** ; Firefox ⛔ non exécutable |
| Accessibilité (axe-core) | `npm run test:a11y` | 39 pages/états, **0 violation** |
| Contraste sur rendu réel | `npm run test:contrast` | 41 rendus, minimum **4,97:1**, 0 sous le seuil |
| CI | `.github/workflows/ci.yml` | rejouée en clone propre ✅ ; **exécution GitHub non vérifiée** |

Itérations par étape (max. 3 autorisées, jamais atteintes sauf Firefox) : étape 1 : 1 (échec réel avant toute modification : Playwright non déclaré) ; étape 2 : 2 ; étape 3 : 1 ; étape 4 : 1 ; étape 5 : 1 (accessibilité), 2 (contraste), **3 (Firefox, escaladé)** ; étape 6 : 1.
Écart de décompte à signaler : le brief de reprise annonçait 33 tests pour le site ; le journal du site compte **32** lignes `PASS` (aucune `FAIL`), y compris sur le dépôt avant mes modifications (`tests-logs/step1b-site.log`). Je n'ai pas pu expliquer les 33 ; seuls les 32 mesurés sont revendiqués.
Limites connues : voir « Non couvert » en fin de fichier.

## Cas métier (cahier des charges Phase 6)
| ID | Scénario | Attendu (justification) | Obtenu | Statut | Itér. |
|---|---|---|---|---|---|
| T01 | Demandes simultanées, même période | une accordée, l'autre « impossible » + demande concurrente citée (max. absents = 1) | conforme | ✅ | 1 |
| T02 | Seul pharmacien du jour absent (lundi) | impossible, `coverage_pharmacist`, alternative remplaçant Hugo | conforme | ✅ | 1 |
| T03 | Deux pharmaciens, même matin | la rotation (refus 2024-2025) départage : Luc accordé | conforme | ✅ | 1 |
| T04 | Demi-journées | 0,5 j déduit ; seules les demi-journées travaillées comptent | conforme | ✅ | 1 |
| T05 | Fériés FR (catholique/protestant) | Fête-Dieu non décomptée seulement si périmètre catholique | conforme | ✅ | 1 |
| T06 | Temps partiel et prorata | 20 / 12 / 16 / 15 j (moins de 20 ans : 5 sem.) | conforme | ✅ | 1 |
| T07 | Entrée/sortie en cours d'année, cap 20 ans | 10 / 5 / 0 / 14 j | conforme | ✅ | 1 |
| T08 | Solde négatif | bloqué par défaut ; toléré + avertissement si règle l'autorise | conforme | ✅ | 1 |
| T09 | Report de solde | plafonné à 5, consommé en premier, perdu après le 31.03 | écart au 1er passage : le solde incluait la fermeture de décembre (4 j) que le test omettait → **test erroné**, corrigé | ✅ | 2 |
| T10 | Annulation après approbation | demande → validation, solde recrédité, besoin annulé, audit | conforme | ✅ | 1 |
| T11 | Maladie pendant vacances approuvées | 1 j crédité avec certificat, 0 sans | conforme | ✅ | 1 |
| T12 | Maladie imprévue le matin même | besoin créé, offre immédiate à Hugo, RH alerté ; tardif si après l'ouverture | conforme | ✅ | 1 |
| T13 | Remplaçant qualifié indisponible | escalade manager puis RH, plan B avec impact, fermeture sans trou | conforme | ✅ | 1 |
| T14 | Remplaçant lui-même absent | écarté (`candidate_absent`), Luc reste | conforme | ✅ | 1 |
| T15 | Stagiaire/apprentie proposés à tort | jamais qualifiés (`not_qualified`), comptent dans l'effectif seulement | conforme | ✅ | 1 |
| T16 | Repos quotidien | Hugo écarté (6 h < 11 h), Luc proposé | conforme | ✅ | 1 |
| T17 | Égalité de score | signalée, départage par ordre de dépôt | conforme | ✅ | 1 |
| T18 | Urgente contre règlement | bloquée (blocage), décision humaine tracée avec motif | conforme | ✅ | 1 |
| T19 | Changement de règlement en cours d'année | version selon la date de dépôt, non rétroactive | conforme | ✅ | 1 |
| T20 | Manager absent | délégué, puis RH si délégué absent | conforme | ✅ | 1 |
| T21 | Plusieurs managers | tous notifiés, auteur tracé | conforme | ✅ | 1 |
| T22 | Après la date limite | `late_deadline` | conforme | ✅ | 1 |
| T23 | Période de blocage | refus + décalage proposé | conforme | ✅ | 1 |
| T24 | Fermeture collective | hors couverture, déduite du solde, pas de double décompte | conforme | ✅ | 1 |
| T25 | Critères sensibles | OFF par défaut, bonus seul, collègue non pénalisé, masqué aux managers, retrait + purge | conforme | ✅ | 1 |

## Cas complémentaires (flux, API, sécurité)
| ID | Scénario | Statut | Itér. |
|---|---|---|---|
| T26 | « Impossible » non validable en lot ; forçage sans motif refusé | ✅ | 1 |
| T27 | Lot ; notifications seulement après validation | ✅ | 1 |
| T28 | Ajustement humain : aperçu, application, cascade recalculée, audit | ✅ | 3 (1: **code** — « avant » excluait la demande ciblée ; 2: **test** — la demande de Claire couvrait aussi l'après-midi) |
| T29 | Mode automatique : risque nul seulement, si activé | ✅ | 2 (**code** — marge de couverture comptée sur les pharmaciens même pour une assistante) |
| T30 | Remplacement : relance, expiration, acceptation, refus, escalade | ✅ | 1 |
| T31 | Données de démo : tri complet, justifications | ✅ | 1 |
| T32 | API : employé sans accès file/audit/collègues | ✅ | 1 |
| T33 | API : manager sans critère sensible, RH avec | ✅ | 1 |
| T34 | API : exports réservés | ✅ | 2 (**test** — en-tête CSV sans guillemets) |
| T35 | API : règlement modifiable par l'admin, versionné | ✅ | 1 |
| T36 | Nul ne décide de sa propre demande | ✅ | 2 (**test** — données : lundi non couvert) |
| T37-T42 | Repos hebdomadaire 35 h : cas passant (61,5 h), bloqué (30 h), limite (35 h accepté, 34,5 h refusé), seuil paramétrable, raison `weekly_rest` dans le classement, créneaux vérifiés ensemble | ✅ | 2 (1 : **code** — un repos qui précède lundi comptait pour la semaine suivante ; 2 : **test** — la semaine du 1er juin 2026 contient la Fête-Dieu, d'où un repos légitime de 37,5 h ; semaine du 8 juin utilisée) |
| T43-T47 | Congés spéciaux/maternité/paternité/proche aidant : paramètres, durée et « à valider » sans blocage, jours ouvrés, plafond annuel, bout en bout FR modifiable par version | ✅ | 1 |
| T48-T50 | Rappel « 2 semaines consécutives » : 10 j / 9 j, enchaînement par week-end, refusées ignorées, visible au manager, non bloquant, seuil paramétrable | ✅ | 1 |
| T51-T58 | Session à cookie signé : cookie absent (401 `no_session`, `x-user` inopérant), falsifié (8 variantes : signature, charge modifiée, autre secret, forme) 401 `invalid_session`, expiré 401 `session_expired` (horloge injectée, limite à la seconde), attributs HttpOnly/SameSite=Strict/Max-Age, déconnexion, rôle inconnu, Origin étranger refusé, charge du jeton minimale, secret 0600 généré/stable/régénéré, ignoré par git | ✅ | 1 |
| T59-T65 | Entrées de l'API : JSON invalide / corps non objet / type de contenu (400, 415), limite 64 Kio (413, Content-Length et transfert fragmenté), dates (format, calendrier réel, bornes, ordre), énumérations et booléens, déclaration imprévue limitée à maladie/accident, tailles de texte/liste/identifiant, langue en liste blanche, plage de couverture ≤ 92 j, règlement (champs inconnus, nombres hors bornes, poids tous nuls) | ✅ | 1 |
| T66-T68 | Persistance : écriture atomique (temp + fsync + rename, aucun `.tmp` résiduel), échec d'écriture sans perte, état illisible ou de forme invalide conservé en `.corrupt-*` | ✅ | 1 |
| T32-T35 | (inchangés) rejoués avec connexion par cookie : droits par rôle toujours validés | ✅ | 1 |
| UI | Parcours manager/employé/admin, DE/EN, console, durée par défaut « à valider par un juriste », rappel des 2 semaines | ✅ 14/14 | 2 (**test** — Léa a déjà 10 j ouvrés en attente : le rappel est correctement « satisfait » ; assertion scindée Léa/Luc) |

Contrôle de sensibilité de l'étape 4 : limite de corps neutralisée → T60 échoue ; liste blanche de langue neutralisée → T64 échoue ; écriture non atomique → T67 échoue ; code restauré (68/68).

Contrôle de sensibilité des tests (phase 6) : deux mutations du code (couverture désactivée ; stagiaire qualifié) font échouer respectivement 6 et 3 tests, puis retour à 36/36 après restauration.

## Site vitrine (direction A)
Exécuté : `node site/site-tests.mjs http://localhost:3113/site/` → `tests-logs/site.log`. Itérations : 2 (1 : **test erroné**, la boucle de Tab sortait du document et testait `body`/le lien d'évitement après retour ; corrigée pour s'arrêter à la fin du cycle).
| Exigence | Vérification réelle | Statut |
|---|---|---|
| Mobile 375 / tablette 768 / bureau 1280 | pas de défilement horizontal, titre et cartes visibles, nav repliée < 960 px | ✅ |
| Liens et ancres | 6 ancres internes, 4 liens (dont `legal.html#privacy/terms/contact`) valides ; défilement sous la barre fixe | ✅ |
| Bascule FR/DE/EN | 121 clés présentes dans les 3 langues ; 111 textes de l'accueil et 11 de `legal.html` identiques au fichier de langue, `lang` mis à jour ; sans JS = `fr.json` | ✅ |
| Clavier | lien d'évitement en premier, 25 éléments atteignables, anneau de focus ≥ 2 px partout ; FAQ Entrée/Espace ; menu mobile Entrée/Échap | ✅ |
| Accordéon FAQ | ouverture/fermeture souris et clavier | ✅ |
| Contrastes (tokens) | 14 paires de tokens ≥ 4,5:1 en clair (min 5,13) et sombre (min 5,94) ; **mesure sur le rendu réel : voir « Qualité et accessibilité »** | ✅ |
| Console / réseau | 0 erreur, 0 requête en échec | ✅ |
| Chargement | DOMContentLoaded et load < 100 ms en local ; 25 Ko transférés, polices incluses | ✅ (local seulement) |
| Sémantique / alternatives | header/main/footer, un `h1`, maquette décrite, aucune image sans `alt` | ✅ |

## Qualité et accessibilité (étape 5)
Commandes (serveur lancé) : `npm run test:a11y`, `npm run test:contrast`, `npm run test:site:chromium|webkit|firefox`. Journaux : `tests-logs/step5-*.log`.
| Contrôle | Résultat réel | Statut |
|---|---|---|
| axe-core 4.14 (WCAG 2.0/2.1/2.2 A+AA + bonnes pratiques) sur le site (index FR clair/sombre, `legal.html`, DE, EN, mobile 375 avec menu ouvert, FAQ ouverte) et l'application (3 rôles × tous les onglets × clair/sombre, DE/EN) | 39 pages/états ; **0 violation** (0 grave/critique, 0 modérée/mineure) | ✅ |
| Contraste mesuré sur le rendu réel (texte transparent puis pixels de fond réellement peints, pire pixel par texte, seuil 4,5:1 ou 3:1 grand texte) : site clair/sombre/thème forcé/DE/EN/mobile, application 3 rôles × onglets × clair/sombre, liens d'évitement focalisés | 41 rendus ; **minimum 4,97:1** ; 0 sous le seuil | ✅ |
| Site sur Chromium | 32/32 | ✅ |
| Site sur WebKit (Playwright 1.64.1, WebKit 27.2) | 32/32, **avec Option+Tab** pour le parcours clavier : Safari/WebKit ne tabule par défaut que sur les contrôles de formulaire (vérifié : séquence SELECT > SUMMARY…), ce n'est pas un défaut du site | ✅ |
| Site sur Firefox (Nightly 157 fourni par Playwright) | **non exécutable ici** : `Could not find profile folder` au lancement, y compris en lançant le binaire seul (`-headless -profile …`) ; 3 tentatives (lancement par défaut, profil persistant, binaire direct), puis arrêt. Journal : `tests-logs/step5-site-firefox.log`. **Aucun ✅ revendiqué pour Firefox** | ⛔ non vérifié |

Itérations : accessibilité **1** (critique : grille de couverture `role="table"` sans lignes → vraie `<table>` ; au passage `h1`, bannière dans le `header`, en-tête de colonne nommé, `role="img"` invalide sur `figure`) ; contraste **2** (1 : **script** — le lien d'évitement hors écran était mesuré sur le fond de l'en-tête, faux positif, désormais mesuré à l'état focalisé ; 2 : **code** — lien d'évitement de l'application en thème sombre `#0000ee` sur fond sombre = 1,71:1 → `color: var(--ink)`). L'assertion de `site-tests.mjs` sur `figure[role=img]` a été changée en `figure.preview[aria-labelledby=previewCap]` : le rôle ARIA invalide a été retiré, la description par `figcaption` est conservée et toujours vérifiée. Le journal `step5-a11y-run1.log` conserve la détection initiale (6 critiques) et `step5-contrast-run1/2.log` les mesures en échec, preuve que les contrôles détectent bien.

## Intégration continue (étape 6)
Fichier : `.github/workflows/ci.yml` (Node 22, `ubuntu-latest`, permissions `contents: read`, aucun secret, aucun service externe ; seules ressources téléchargées : paquets npm et Chromium de Playwright). Étapes : `npm ci` → `typecheck` → `npm test` → `site:build` puis `git diff --exit-code` sur `site/index.html` et `site/legal.html` (pages périmées = échec) → Chromium → serveur en tâche de fond (attente active, échec si le serveur s'arrête) → `test:ui` → `test:site` → `test:a11y` + `test:contrast` → arrêt du serveur et dépôt des journaux en artefact. `shell: bash` (donc `pipefail`) pour qu'un test en échec ne soit pas masqué par `| tee`. Les scripts `test:*` lisent `PORT` (défaut 3000).
| Vérification | Résultat réel | Statut |
|---|---|---|
| Rejeu des mêmes commandes dans un **clone propre** du dépôt (`npm ci`, port 3010) : 68/68 unitaires, site à jour, UI 14/14, site 32/32, axe 0 violation, contraste 0 sous le seuil (`tests-logs/step6-ci-simulation.log`) | conforme | ✅ |
| Garde « pages du site périmées » : locale modifiée sans reconstruction → `git diff --exit-code` échoue ; `pipefail` propage l'échec à travers `tee` (`tests-logs/step6-ci-negative-checks.log`) | conforme (1 itération **test** : première tentative sans clé existante, refaite) | ✅ |
| Syntaxe YAML du workflow | chargée sans erreur | ✅ |
| **Première exécution sur GitHub Actions** | **non vérifiée** : aucun push possible depuis cet environnement (pas d'identifiants GitHub) ; le rejeu local n'utilise ni `ubuntu-latest`, ni `playwright install --with-deps`, ni `actions/*` | ⛔ non vérifié |

## Non couvert (aucun ✅ revendiqué)
- Firefox : voir ci-dessus. Pas d'audit avec lecteur d'écran réel (VoiceOver, NVDA) ; axe-core ne couvre qu'une partie des critères WCAG, un audit manuel reste nécessaire.
- Temps de chargement mesuré en local, pas sur réseau réel.
- Traductions DE/EN : relecture humaine à faire. Règles légales : non validées par un juriste (voir RULES.md).
