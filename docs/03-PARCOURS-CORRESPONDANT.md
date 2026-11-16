# Parcours complet d'un correspondant, du lien jusqu'à vMix

Chaque étape indique **qui agit**, **ce qui est persisté** et **ce qui est vérifié
côté serveur**. C'est le document de référence pour comprendre où se situe un
problème pendant un direct.

---

### 1. Le réalisateur crée la session
`POST /api/productions/:id/sessions`

- Génère `Session.roomName` = `snrc-<base32(10)>` — jamais le nom de l'émission
  (le nom de salle circule dans l'URL du moteur média).
- Génère `Session.roomSecret` (32 octets) → sert de `&password` côté moteur.
- État : `SCHEDULED`.
- Audit : `session.create`.

### 2. Le réalisateur ajoute un correspondant
`POST /api/sessions/:id/participants` `{ displayName, role }`

- Génère **`Participant.streamId`** = `g<base32(8)>` — **immuable pour la session**.
  C'est lui qui garantit qu'une entrée vMix retrouve le bon correspondant après un
  rafraîchissement (cf. `01-AUDIT.md` §3).
- Génère `Participant.outputKey` (clé publique opaque de la page `/output/...`),
  distincte du `streamId`.
- État : `INVITED`.

### 3. Création de l'invitation
`POST /api/sessions/:id/invitations` `{ participantId, ttlMinutes }`

- Jeton = 32 octets aléatoires, affiché **une seule fois**, stocké uniquement en
  **SHA-256**. Un vol de base ne permet pas de rejoindre.
- `expiresAt` obligatoire (défaut 12 h), `maxUses` (défaut 5 — un journaliste
  recharge souvent sa page).
- Lien remis : `https://<host>/join/<token>`
- Audit : `invitation.create`.

### 4. Le correspondant ouvre le lien
`GET /join/<token>` → `GET /api/invite/<token>`

Vérifications serveur, dans cet ordre, avec motifs distincts :
`inexistant` · `révoqué` · `expiré` · `quota épuisé` · `session terminée`.

Si valide : pose un cookie `snrc_participant` (HttpOnly, SameSite=Lax, Secure en prod)
portant `{ participantId, sessionId, scope:'participant' }`, signé, durée = min(TTL
restant, 12 h). `Invitation.usedCount++`, état participant → `READY`.

### 5. Salle de préparation (avant connexion)
Aucun média n'est publié à cette étape. Tout se passe dans le navigateur du
correspondant, via `getUserMedia` **sur notre propre page**, pas dans l'iframe :

- Logo, nom de l'émission, nom du correspondant (lus du serveur, pas de l'URL).
- `navigator.mediaDevices.getUserMedia` demandé **explicitement** sur action de
  l'utilisateur (obligatoire sur iOS/Safari).
- Aperçu caméra, sélection caméra / micro, sélection de la sortie audio
  **uniquement si `HTMLMediaElement.setSinkId` existe** (absent sur Safari/iOS →
  le sélecteur n'est pas affiché, au lieu d'être affiché et inopérant).
- VU-mètre micro réel (`AudioContext` + `AnalyserNode`), pas une animation.
- Test de connexion : résolution d'un serveur STUN par `RTCPeerConnection` +
  collecte de candidats → indique `host` / `srflx` / `relay`. Un correspondant qui
  n'obtient que `host` sera probablement bloqué : on le dit avant l'antenne.
- Choix du profil qualité (cf. §9 du cahier des charges) → mémorisé sur le participant.
- Les pistes de test sont **arrêtées** avant d'entrer en salle pour libérer les
  périphériques (sinon `NotReadableError` dans l'iframe).

### 6. Entrée en salle
Clic sur « Rejoindre la régie ». L'application demande au serveur
`POST /api/participants/me/join` qui **revalide** le cookie, l'état de session et la
non-révocation, puis renvoie l'URL du moteur construite **côté serveur** :

```
<engineOrigin>/?room=<roomName>
               &password=<roomSecret>
               &push=<streamId>
               &label=<displayName urlencodé>
               &view                      ← vide : publish-only
               &quality=<profil>
               &cleanish
               &videodevice=<id>&audiodevice=<id>
               &autostart
```

L'URL n'est **jamais** construite dans le navigateur : sinon le correspondant
pourrait se promouvoir `&director`.

État participant → `CONNECTING`, puis `LIVE` sur l'événement `guest-connected`
remonté par la régie.

### 7. Pendant l'appel
Notre page (le parent) affiche **son propre** habillage et pilote l'iframe :

| Élément | Source réelle |
|---|---|
| Retour vidéo régie | second iframe `view=<returnStreamId>&solo&room=...&cleanoutput` |
| Prévisualisation locale | l'iframe du moteur (`previewWebcam`) |
| Micro on/off | `{"mic": true|false}` → **coupe le flux publié** |
| Caméra on/off | `{"camera": true|false}` |
| Volume du retour | `{"volume": 0..200}` |
| ON AIR / STANDBY | **événement applicatif SSE**, décidé par la régie — jamais déduit du média |
| Messages du réalisateur | `gotChat` (+ SSE pour l'historique) |
| Qualité réseau | `getStats` toutes les 2 s, chiffres mesurés |
| Déconnexion | `{"close": true}` puis `POST /api/participants/me/leave` |

**ON AIR n'est pas déduit de l'état WebRTC.** Un flux peut être parfaitement connecté
sans être à l'antenne. Le voyant rouge suit uniquement la décision de la régie
(ou, si une connexion vMix est mappée et interrogeable, l'état réel de l'entrée au
Program — cf. `05-VMIX-INTEGRATION.md` §5).

### 8. Réception en régie
La console tient une iframe `&director=<room>&password=<secret>&cleanish`.
Elle en reçoit : `guest-connected`, `guest-disconnected`, `stats`, `loudness`,
`streamIDs`. Elle n'affiche **que** des chiffres mesurés ; un indicateur sans donnée
est affiché `—`, pas `0`.

### 9. Apparition dans vMix

Deux chemins, le premier est celui qui est documenté et garanti :

**A. Manuel (recommandé, garanti)**
1. Régie : « Copier le lien vMix » sur la carte du correspondant.
2. vMix : *Add Input → More → Web Browser*, coller l'URL, régler 1280×720.
3. L'audio de la page est capté nativement par vMix.

L'URL copiée est **notre** page de sortie, pas celle du moteur :
`https://<host>/output/<outputKey>` — cf. `05-VMIX-INTEGRATION.md` §2.

**B. Assisté par l'API vMix (optionnel)**
1. Admin : configurer l'adresse de l'agent vMix, tester la connexion.
2. L'application lit le XML, liste les entrées, et l'opérateur **associe** un
   correspondant à une entrée Web Browser **existante**.
3. L'application envoie `Function=BrowserNavigate&Value=<url%20encodée>&Input=<GUID>`.
4. `AddInput` (création automatique) est proposé mais marqué **non garanti**
   (cf. `01-AUDIT.md` §4.2) et désactivé par défaut.

### 10. Fin de session
`POST /api/sessions/:id/end` → état `ENDED`, toutes les invitations révoquées,
`{"action":"hangup"}` envoyé à chaque invité, cookies participants invalidés par
changement de `Session.tokenEpoch`.
