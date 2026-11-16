# Rapport de tests

> Règle appliquée : **aucun test n'est déclaré réussi sans avoir été exécuté.**
> Les lignes marquées **NON EXÉCUTÉ** le sont restées, avec le motif.
> Date des exécutions : 2026-11-16. Machine : macOS (darwin 25.6), Node 22.19,
> PostgreSQL 16.15, moteur média `https://vdo.ninja`.

## Résumé

| Campagne | Commande | Résultat |
|---|---|---|
| Tests unitaires | `npm test` | **38 / 38** ✅ |
| Vérification de types | `npm run typecheck` | **0 erreur** ✅ |
| Analyse statique | `npm run lint` | **0 erreur, 0 avertissement** ✅ |
| Compilation de production | `npm run build` | **36 routes** ✅ |
| Intégration de l'API | `bash tests/e2e-api.sh` | **84 / 84** ✅ |
| Intégration vMix (simulateur) | `bash tests/e2e-vmix.sh` | **43 / 43** ✅ |
| Rétention, refus de pages, mot de passe | `bash tests/e2e-retention.sh` | **69 / 69** ✅ |
| Audit des dépendances d'exécution | `npm audit --omit=dev` | **0 vulnérabilité** ✅ |
| Image Docker / Nginx | — | **NON EXÉCUTÉ** (Docker absent) |
| Essais navigateurs et vMix Windows | — | **NON EXÉCUTÉ** (matériel requis) |

**Total exécuté : 234 assertions automatisées, 234 réussies.**
Les campagnes d'intégration ont été rejouées plusieurs fois de suite sur la même
base, avec le même résultat : elles sont idempotentes et utilisables en CI.

---

## 1. Tests unitaires — 38 assertions

`npm test` · fichiers `tests/*.test.ts`

### Moteur média (`tests/media-engine.test.ts`)
| Assertion | Ce qu'elle protège |
|---|---|
| le lien correspondant est *publish-only* (`&view` vide) | un `&view=<id>` casserait le motif de contribution et ferait aspirer les flux des autres |
| `push` = `streamId`, `room`, `label`, `quality=1`, `cleanoutput` | conformité au motif officiellement recommandé |
| le profil 480p utilise `&width`/`&height` | aucun palier `&quality` ne documente 480p (cf. L10) |
| le lien de réception vMix : `view`, `solo`, `cleanoutput`, `videobitrate=2500`, `codec=h264`, **pas de `push`** | un lien de réception ne doit jamais publier |
| le bus de retour est *publish-only*, `novideo`, `proaudio` | anti-bouclage par construction |
| le lien director porte `director` et pas de `push` | la régie n'émet pas par ce canal |
| le secret et le libellé sont percent-encodés | un secret contenant `&` casserait l'URL |
| `nativeMixMinus`, `guaranteedReconnect`, `ndiOutput`, `srtOutput` valent `false` | aucune capacité n'est annoncée à tort |
| les commandes invité correspondent au contrat réel (`mic`, `hangup`, `soloChatBidirectional`, `volume` borné à 200) | fidélité à l'API documentée |
| `{mic}` ≠ `{mute}` | micro publié et écoute locale sont deux choses distinctes |

### vMix (`tests/vmix-client.test.ts`)
| Assertion | Ce qu'elle protège |
|---|---|
| 11 adresses locales acceptées, 6 publiques refusées | l'API vMix ne doit jamais être joignable depuis Internet |
| une fonction hors liste blanche est refusée | surface de commande minimale |
| `BrowserNavigate` exige `Input` et une URL http(s) | `file:///` refusé |
| `SetVolume` borné à 0–100 | conformité documentée |
| `AudioBusOff` restreint aux bus `M`, `A`–`G` | |
| `AddInput` restreint au format `Browser\|<url>` | |
| `BusXSendToMaster` interdit | anti-bouclage |
| le XML d'état est lu : entrées, GUID, type, Program, Preview, overlays, entités échappées | lecture correcte de l'état réel |
| une réponse qui n'est pas du vMix est rejetée | pas de faux positif de connexion |

### Rôles (`tests/rbac.test.ts`) et secrets (`tests/password.test.ts`)
| Assertion | Ce qu'elle protège |
|---|---|
| l'administrateur a l'intégralité des capacités | |
| le réalisateur invite et révoque ; **le technicien non** | la maîtrise de l'antenne reste au réalisateur |
| le technicien ne décide pas du ON AIR | |
| seul l'administrateur gère vMix et les comptes | |
| scrypt : paramètres `N=131072, r=8, p=1`, sel aléatoire, deux hachages différents | |
| mot de passe < 12 caractères refusé | |
| un enregistrement falsifié (`N` démesuré, format inconnu) est refusé **sans calcul** | déni de service par explosion mémoire |
| 500 `streamId` tirés : tous uniques, alphabet sans caractères ambigus | un correspondant dicte son identifiant au téléphone |
| `outputKey` distinct du `streamId` | |
| comparaison d'empreintes à temps constant | |

---

## 2. Intégration de l'API — 84 assertions

`bash tests/e2e-api.sh` contre l'application réellement démarrée et PostgreSQL réel.

| Section | Assertions | Points notables réellement vérifiés |
|---|---|---|
| 1. Accès non authentifié | 4 | toutes les routes de console répondent 401 |
| 2. Authentification | 7 | **message identique** pour mot de passe faux et compte inconnu (pas d'énumération) ; cookie marqué `HttpOnly` dans le bocal curl |
| 3. Production et session | 6 | le nom de salle est opaque, préfixé `snrc`, 16 caractères, et **ne contient pas** le nom de l'émission |
| 4. Correspondant et invitation | 7 | le jeton n'est **ni renvoyé par la liste**, ni stocké en clair ; l'empreinte en base fait bien 64 caractères (SHA-256) |
| 5. Jetons invalides | 3 | inexistant → 404, trop court → 404, `GET` → 405 (seul `POST` consomme) |
| 6. Entrée du correspondant | 7 | URL construites côté serveur et inspectées : `push` correct, `&view` **vide**, **aucun `&director`**, `quality=1`, `cleanoutput`, retour en `solo` sans `push` |
| 7. Cloisonnement des rôles | 3 | le cookie correspondant n'ouvre aucune route de console, et réciproquement |
| 8. Page de sortie vMix | 7 | iframe présent, `solo` + `cleanoutput`, **zéro `<button>`**, `Cache-Control: no-store`, `X-Robots-Tag`, mire nommée si clé inconnue ; le secret de salle est constaté **présent** (limite L1, assumée) |
| 9. Commandes régie | 14 | ON AIR propagé au correspondant avec `onAirSource = MANUAL` ; coupure micro vue par le correspondant ; bus `Z` refusé, bus `B` accepté ; message vide refusé ; talkback ouvert/fermé ; mesures à `null` acceptées, mesures mal typées refusées |
| 10. vMix | 9 | mode DIRECT vers `203.0.113.10` **refusé** (`forbidden_host`) ; doublon hôte/port → 409 explicite ; test sans vMix → **502 avec la cause réelle**, consignée en base ; `agentTokenHash` jamais renvoyé |
| 11. Flux d'événements | 2 | la console reçoit le flux SSE ; un anonyme est refusé (401) |
| 12. Révocation | 5 | jeton révoqué → `revoked` ; **le correspondant perd l'accès à la requête suivante** (403) ; la page de sortie affiche « Accès révoqué » |
| 13. Fin de session | 5 | toutes les invitations révoquées, `tokenEpoch` incrémenté, date de purge posée |
| 14. Limitation de débit | 1 | le bourrage de mot de passe reçoit un **429** avant le 14ᵉ essai |
| 15. Journal d'audit | 4 | les connexions **refusées** sont journalisées ; les révocations aussi ; **aucun jeton en clair** dans le journal |

### Deux constats issus de cette campagne

1. **Le garde-fou HTTPS fonctionne — et bloque le mode production en local.**
   `next start` impose `NODE_ENV=production`, où l'application refuse un `APP_URL`
   en clair et pose des cookies `Secure` que curl ne renvoie pas sur `http://`.
   La campagne tourne donc en mode développement. Ce n'est pas un contournement du
   contrôle : c'est le contrôle qui fait son travail. En production réelle, TLS est
   terminé par Nginx et `APP_URL` est bien en `https://`.

2. **Le secret de salle est présent dans la page de sortie.** Découvert par
   l'assertion correspondante, qui échouait. Après vérification, c'est inhérent au
   modèle de mot de passe du moteur. L'assertion a été **retournée** pour constater le
   fait, la limite est documentée en L1, et une affirmation trop forte de
   `05-VMIX-INTEGRATION.md` §2 a été corrigée.

---

## 3. Intégration vMix — 43 assertions

`bash tests/e2e-vmix.sh`

**Périmètre.** La chaîne complète *application → agent local → API HTTP vMix* est
exercée, vMix étant remplacé par `tests/mock-vmix.mjs`, qui reproduit la **forme
documentée** de son API (XML `<vmix>`, résolution d'`Input` par numéro/GUID/titre,
200 en succès et 500 en refus).

**Ce que cela prouve :** notre client est correct.
**Ce que cela ne prouve pas :** le comportement de vMix. Voir §5.

| Section | Assertions | Points notables |
|---|---|---|
| 0. Mise en place | 3 | l'agent relaie bien l'état XML |
| 3. Test de connexion | 5 | version `29.0.0.70`, édition `4K`, 4 entrées dont **2 Web Browser** correctement identifiées ; `lastStatus = ok` consigné |
| 4. Lecture des entrées | 3 | le GUID est lu depuis l'attribut `key` ; une entrée `Colour` n'est **pas** candidate |
| 5. Association | 9 | `BrowserNavigate` émis vers **notre** page `/output/<clé>` ; `://` bien percent-encodé en `%3A%2F%2F` ; entrée ciblée par **GUID** et non par numéro ; `SetInputName` applique le nom du correspondant ; **les deux commandes vers la même entrée sont espacées de ≥ 0,7 s** (limite rapportée de commandes perdues) |
| 6. Mauvais type d'entrée | 3 | entrée `Colour` → **409** avec le type réel dans le message ; GUID inconnu → 404 |
| 7. Commandes audio | 6 | `AudioBusOff A` accepté (c'est le mix-minus) ; `AudioBusOn A` **refusé en 409** avec explication du mix-minus ; `SetVolume=500` refusé ; **aucune commande hors liste n'a atteint le simulateur** |
| 8. Synchronisation ON AIR | 4 | entrée 2 au Program → le correspondant passe ON AIR avec `onAirSource = VMIX` ; retour en standby quand le Program change |
| 9. L'agent, dernière barrière | 5 | `Cut`, `RemoveInput`, `BusXSendToMaster` refusés **par l'agent** même demandés directement ; secret invalide → 401 ; le simulateur n'a rien reçu |
| 10. Agent arrêté | 2 | **502 avec la cause réelle**, consignée — jamais un faux « connecté » |

### Un défaut trouvé et corrigé pendant cette campagne

En rejouant la campagne une seconde fois, l'association d'un correspondant à une
entrée Web Browser **déjà affectée** à un correspondant d'une campagne précédente
remontait une **erreur 500** : la contrainte d'unicité `(connectionId, inputKey)`
était violée et l'exception n'était pas traduite.

Or réaffecter une entrée est une opération légitime et courante en régie — un
correspondant qui remplace un autre sur la même entrée. `mapParticipantToInput`
libère donc maintenant l'entrée de son précédent occupant **dans la même
transaction**, remet ce correspondant en ON AIR manuel (son voyant vMix n'a plus de
source), et renvoie `displaced` pour que la console annonce le déplacement au lieu de
le laisser découvrir à l'antenne. Une assertion vérifie désormais qu'une entrée ne
sert qu'un seul correspondant à la fois.

### Garde-fous de l'agent vérifiés séparément

| Essai | Résultat |
|---|---|
| secret de moins de 24 caractères | **refus de démarrer**, avec la commande de génération |
| `AGENT_BIND=0.0.0.0` sans TLS | **refus de démarrer** — le secret circulerait en clair |
| `/health` | répond sans authentification, sans détail sensible |
| `/vmix` sans secret, puis avec un faux secret | 401 dans les deux cas |

---

## 4. Rétention, refus de pages et mot de passe — 69 assertions

`bash tests/e2e-retention.sh`

Le script manipule directement `purgeAfter` en base pour simuler le passage du
temps : attendre 30 jours n'est pas une option.

| Section | Assertions | Points notables réellement vérifiés |
|---|---|---|
| 2. Autorisations (API) | 8 | état et purge **refusés à un réalisateur** (403) et à un anonyme (401) ; faux secret de planificateur → 401 **journalisé**, et le secret présenté n'apparaît pas dans le journal |
| 2b. Refus de pages | 6 | un réalisateur sur une page d'administration est **renvoyé (307)** vers les productions avec le motif, pas servi une erreur ; un anonyme va vers `/login` ; **une session inexistante et une session interdite donnent exactement la même réponse** |
| 2c. Mot de passe personnel | 14 | « Mon compte » ouvert à un **réalisateur** ; mot de passe actuel erroné, trop court, ou identique à l'ancien → refusés ; le passer par la route Utilisateurs est **refusé** (`use_account_route`) ; après changement l'ancien ne marche plus, le nouveau si, **la session de l'auteur reste ouverte** avec un cookie rafraîchi portant le nouvel `epoch` ; succès et refus journalisés, **aucun mot de passe en clair dans le journal** |
| 3. Politique | 3 | la politique annoncée est cohérente, et l'écran affiche laquelle est en vigueur |
| 4. Jeu d'essai | 8 | session due, session en attente, session terminée **sans date de purge**, session « en direct » depuis 3 jours, compteur de limitation expiré, ligne d'audit de 5 ans |
| 5. Purge administrateur | 5 | au moins une session supprimée, au moins une date réparée, compteur purgé |
| 6. Effets en base | 13 | la session due a disparu **avec ses correspondants, invitations et événements** (cascade) ; la session en attente est **conservée** ; la session sans date reçoit une date **calculée depuis sa fin** et n'est **pas** supprimée au même passage ; la session « en direct » est intacte ; **la ligne d'audit de 5 ans est intacte** ; l'exécution est journalisée et nomme l'administrateur |
| 7. Purge planifiée | 4 | acceptée avec le bon secret ; second passage sans suppression ; journalisée comme `system` et **non rattachée à un compte** |
| 8. Script du planificateur | 5 | le script `deploy/scheduler/purge.sh` **atteint réellement la route** à l'heure programmée et consigne le succès ; sans secret et avec une heure invalide, il **refuse de démarrer** (code 2) |
| 9. Nettoyage | 2 | le jeu d'essai est purgé et le compte d'essai supprimé : le script est rejouable sans laisser de trace |

### Les deux politiques d'audit sont couvertes

La campagne adapte ses assertions à la politique que le serveur annonce, et les deux
branches ont été exécutées :

| Configuration | Résultat observé |
|---|---|
| `AUDIT_RETENTION_DAYS=0` (défaut) | la ligne d'audit de 5 ans est **conservée**, `deletedAuditRows = 0` |
| `AUDIT_RETENTION_DAYS=365` | la ligne de 5 ans est **supprimée**, `deletedAuditRows ≥ 1` |

Vérifié en redémarrant le serveur avec chaque réglage. 69 / 69 dans les deux cas,
deux passages consécutifs chacun.

### Arithmétique horaire du planificateur

Vérifiée séparément sur 7 cas, dont le piège des zéros de tête (`PURGE_AT=08:09`,
que certains shells liraient en octal) et les franchissements de minuit :

| `PURGE_AT` | Heure courante | Attente calculée |
|---|---|---|
| `08:09` | 00:00:00 | 29 340 s |
| `04:17` | 04:16:00 | 60 s |
| `04:17` | 04:17:00 | 86 400 s (le lendemain) |
| `00:00` | 23:59:30 | 30 s |
| `23:59` | 00:00:00 | 86 340 s |

L'heure est recalculée depuis l'horloge à chaque tour : un `sleep 86400` dériverait à
chaque redémarrage du conteneur et finirait par tourner en pleine émission.

### Un second défaut trouvé et corrigé : les refus de pages rendaient une erreur 500

En vérifiant l'accès au nouvel écran de rétention, j'ai constaté qu'un réalisateur qui
tape une URL d'administration reçoit un **HTTP 500 brut**. L'accès était bien refusé —
`requireCapability` levait son exception — mais dans un composant serveur personne ne
la rattrape, donc Next rendait une page d'erreur.

Le défaut **préexistait sur `/admin/users`** : il n'est pas né avec la rétention, il a
seulement été révélé par elle.

Corrigé par `requirePageCapability()`, qui renvoie vers les productions avec le motif
du refus, et par `pageAccessDenied()` pour les erreurs d'accès remontées par les
services. Les six pages concernées ont été basculées. Au passage, une session
inexistante et une session appartenant à un autre réalisateur donnent désormais la
**même** réponse : distinguer les deux révélerait qu'une session existe.

### Changer son mot de passe : un trou fonctionnel, et un faux positif

L'écran Utilisateurs masquait **toutes** les actions sur la ligne de l'utilisateur
courant, y compris la réinitialisation du mot de passe. Un administrateur ne pouvait
donc pas changer le sien depuis l'interface ; les autres rôles, qui n'ont accès à
aucun écran d'administration, encore moins.

Corrigé par une page « Mon compte » ouverte à **tout utilisateur authentifié**, et une
route dédiée qui exige le mot de passe **actuel** — un poste laissé ouvert ne doit pas
permettre de verrouiller son titulaire dehors. Le chemin plus faible qui subsistait
dans la route Utilisateurs (changer son propre mot de passe sans le connaître) a été
fermé.

Une assertion a d'abord échoué : « la session de l'auteur reste ouverte » renvoyait
307. Vérification faite, l'application était correcte — le cookie rafraîchi portait
bien `epoch: 1`, comme la base. C'est mon enchaînement de test qui rejouait une
connexion avec un mot de passe déjà changé. Corrigé en passant `-c` à curl, comme un
navigateur enregistre un cookie, et une assertion compare désormais l'`epoch` du
cookie à celui de la base.

### Un défaut de mon propre script de test

Les premières passes échouaient sur « la session due a bien 1 invitation ». La cause
n'était pas dans l'application : écrire
`--data-binary "$(body "{\"a\":\"$x\"}")"` fait réanalyser le `$()` imbriqué, le
shell découpe le JSON sur les virgules, `body` est appelé avec des fragments et curl
reçoit un argument surnuméraire — donc **deux** requêtes, la première vide. Le défaut
est silencieux : le code de retour lu était celui de la seconde.

Reproduit en isolation, puis corrigé en assemblant les corps JSON dans une variable
avant l'appel. Les deux autres campagnes ont été relues pour la même forme ; elles ne
l'employaient pas.

---

## 5. Ce que les tests automatisés ne couvrent pas

Volontairement hors périmètre, parce qu'un test logiciel ne peut pas les trancher :

- la **qualité perçue** d'une image et d'un son ;
- le comportement réel du **CEF de vMix** ;
- la **latence** de bout en bout ;
- l'absence d'**écho** dans un vrai montage audio ;
- la tenue d'une liaison **4G** en mobilité.

---

## 6. Validations manuelles restantes

Les 18 scénarios demandés au cahier des charges, avec leur état réel.

| # | Scénario | État | Comment procéder |
|---|---|---|---|
| 1 | Correspondant sur Chrome | **NON EXÉCUTÉ** | ouvrir un lien d'invitation, vérifier aperçu, VU-mètre, entrée en salle, vignette dans le multiview |
| 2 | Correspondant sur Firefox | **NON EXÉCUTÉ** | idem ; vérifier en plus l'**absence** du sélecteur de sortie audio si `setSinkId` manque |
| 3 | Android / Chrome | **NON EXÉCUTÉ** | vérifier la demande explicite d'autorisation et l'ergonomie à une main |
| 4 | iPhone / Safari | **NON EXÉCUTÉ** | **point sensible** : autorisation sur geste utilisateur, pas de `setSinkId`, lecture audio bloquée sans interaction |
| 5 | 2 correspondants simultanés | **NON EXÉCUTÉ** | multiview sur 2 colonnes, mesures par carte |
| 6 | 4 correspondants simultanés | **NON EXÉCUTÉ** | surveiller le CPU/GPU du poste de régie ; valider ou corriger les seuils de L9 |
| 7 | Perte puis retour réseau | **NON EXÉCUTÉ** | couper le Wi-Fi du correspondant : bandeau « hors ligne » attendu, **sans promesse** de reconnexion |
| 8 | Refus d'autorisation caméra | partiellement : les messages par cause sont codés et typés | refuser dans le navigateur, vérifier le message et le bouton « Réessayer » |
| 9 | Changement de microphone | **NON EXÉCUTÉ** | changer en salle de préparation ; vérifier que l'aperçu et le VU-mètre suivent |
| 10 | Déconnexion / reconnexion | **NON EXÉCUTÉ** | le lien reste valable jusqu'à son expiration et son quota |
| 11 | Réception **vidéo** dans vMix | **NON EXÉCUTÉ** | Web Browser Input 1280×720 sur `/output/<clé>` |
| 12 | Réception **audio** dans vMix | **NON EXÉCUTÉ** | vérifier que l'audio de la page apparaît bien au mélangeur vMix |
| 13 | Retour programme | **NON EXÉCUTÉ** | Bus A → câble virtuel → `/return/<session>` dans Chrome |
| 14 | Talkback hors antenne | logique vérifiée (état serveur, un seul à la fois, journalisé) | vérifier **à l'oreille** que le Program ne contient pas la régie |
| 15 | Absence d'écho | **NON EXÉCUTÉ** | protocole A1–A10 de `04-AUDIO-MIXMINUS.md` §5 |
| 16 | Révocation d'invitation | **VÉRIFIÉ** (e2e §12) | — |
| 17 | Accès non autorisé | **VÉRIFIÉ** (e2e §1 et §7) | — |
| 18 | Dégradation de bande passante | **NON EXÉCUTÉ** | brider la liaison et vérifier que les mesures affichées **baissent réellement** |

### Validations exigeant vMix sous Windows

| # | Point | Pourquoi c'est bloquant |
|---|---|---|
| V1 | `AddInput Value=Browser\|<url>` | non documenté (L6). Tant que ce n'est pas vérifié, laissez `allowAddInput` désactivé. |
| V2 | Autorisations micro/caméra dans un Web Browser Input | non documenté (L7). Toute l'architecture du retour en dépend. |
| V3 | Capture de l'audio de la page au mélangeur | documenté, mais à constater |
| V4 | Alpha / transparence sur la page de sortie | documenté, à constater |
| V5 | Comportement du CEF après coupure réseau | non documenté |
| V6 | Perte de commandes rapprochées | nous espaçons de 750 ms ; à confirmer que cela suffit |

### Déploiement

| Point | État |
|---|---|
| Sortie `standalone` de Next | **VÉRIFIÉE** (`.next/standalone/server.js` produit) |
| Syntaxe YAML de `docker-compose.yml` | **VÉRIFIÉE** |
| Syntaxe des scripts shell | **VÉRIFIÉE** (`bash -n`) |
| Construction de l'image Docker | **NON EXÉCUTÉE** — Docker absent de la machine de développement |
| `nginx -t` sur la configuration | **NON EXÉCUTÉ** — Nginx absent |
| Migrations sur une base vierge | **VÉRIFIÉES** — `prisma migrate dev` a créé les 11 entités + `RateLimit` |
| Sauvegarde / restauration | **NON EXÉCUTÉE** |
| Purge planifiée (script `deploy/scheduler/purge.sh`) | **VÉRIFIÉE** hors Docker : le script atteint la route à l'heure dite |
| Service `scheduler` dans la pile Docker | **NON EXÉCUTÉ** — Docker absent |

---

## 7. Reproduire ces campagnes

```bash
npm ci
cp .env.example .env            # renseigner DATABASE_URL, AUTH_SECRET, MEDIA_SECRET
npm run db:migrate
SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... npm run db:seed
npm run verify                  # typecheck + tests unitaires + build
npm run dev                     # dans un second terminal
bash tests/e2e-api.sh
bash tests/e2e-vmix.sh
bash tests/e2e-retention.sh
```

Les trois scripts d'intégration **modifient la base** : à n'exécuter que sur une base de
développement. Ils sortent avec un code non nul si une assertion échoue, donc ils
s'intègrent tels quels à une chaîne d'intégration continue.
