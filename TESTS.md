# TESTS.md — journal de vérification

Commandes : `npm test` (58 tests, Vitest) ; `node app/test/ui-smoke.mjs <url>` (UI applicative) ; `npm run test:site` (site vitrine, Playwright, serveur lancé).
Sorties réelles conservées dans `tests-logs/` (fichiers `stepN-*.log`, un jeu par étape ; `*.log` est ignoré par git, les journaux de l'étape en cours sont ajoutés de force au commit). Un ✅ = exécuté, sortie conservée, comparé à l'attendu.
Relance complète après chaque correction (non-régression) : dernier passage : 58/58 unitaires, 14/14 UI, site OK (`tests-logs/step3-*.log`).

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
| T32-T35 | (inchangés) rejoués avec connexion par cookie : droits par rôle toujours validés | ✅ | 1 |
| UI | Parcours manager/employé/admin, DE/EN, console, durée par défaut « à valider par un juriste », rappel des 2 semaines | ✅ 14/14 | 2 (**test** — Léa a déjà 10 j ouvrés en attente : le rappel est correctement « satisfait » ; assertion scindée Léa/Luc) |

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
| Contrastes | 14 paires de tokens ≥ 4,5:1 en clair (min 5,13) et sombre (min 5,94) | ✅ |
| Console / réseau | 0 erreur, 0 requête en échec | ✅ |
| Chargement | DOMContentLoaded et load < 100 ms en local ; 25 Ko transférés, polices incluses | ✅ (local seulement) |
| Sémantique / alternatives | header/main/footer, un `h1`, maquette décrite, aucune image sans `alt` | ✅ |

## Non couvert (aucun ✅ revendiqué)
- Contrastes mesurés sur les tokens, pas sur le rendu pixel (dégradés, texte sur image : il n'y en a pas) ; pas d'audit axe/lecteur d'écran réel.
- Temps de chargement mesuré en local, pas sur réseau réel ; un seul navigateur (Chromium).
- Traductions DE/EN : relecture humaine à faire. Règles légales : non validées par un juriste (voir RULES.md).
- Interface applicative : pas de test d'accessibilité automatisé.
