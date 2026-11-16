# Phase 1 — Audit technique

> Document de vérification. Chaque capacité listée ci-dessous a été lue dans la
> documentation officielle ou dans le code source du dépôt, le 2026-11-16.
> Les points marqués **NON VÉRIFIÉ** n'ont pas de source officielle et ne doivent pas
> être présentés comme fonctionnels avant essai réel.

## 1. Licence VDO.Ninja — contrainte structurante

`steveseguin/vdo.ninja` est sous **GNU AGPL-3.0**.

Conséquences juridiques directes sur ce projet :

| Scénario | Obligation |
|---|---|
| Nous utilisons `https://vdo.ninja` (service public) via iframe | Aucune obligation de copyleft sur notre code. Simple usage réseau d'un service tiers. |
| Nous auto-hébergeons VDO.Ninja **sans modification** | Aucune obligation de copyleft sur notre code. Conserver les notices. |
| Nous **modifions** VDO.Ninja et le servons sur le réseau | AGPL §13 : nous devons offrir le code source correspondant **de notre version modifiée** à tout utilisateur qui interagit avec elle. |
| Nous intégrons du code VDO.Ninja **dans** notre application | AGPL §5c : l'œuvre entière doit passer sous AGPL. |

**Décision d'architecture retenue : ne jamais modifier ni importer le code VDO.Ninja.**
Broadcast SN Remote Call reste une œuvre séparée qui communique avec VDO.Ninja
uniquement par :
- des **URL** (paramètres documentés),
- l'**API IFrame** (`postMessage`), interface publique documentée.

C'est la frontière la plus sûre juridiquement *et* techniquement : elle permet de
remplacer le moteur plus tard sans toucher à l'application (voir `MediaEngine`
dans `02-ARCHITECTURE.md`).

---

## 2. API IFrame VDO.Ninja — contrat réel

Source : `docs.vdo.ninja/guides/iframe-api-documentation`, `iframe-api-for-directors`,
et surtout le code de référence `iframe-examples.js` du dépôt (les deux pages de doc
sont incomplètes ; le fichier JS est la source de vérité).

### 2.1 Commandes parent → iframe (commandes « sur soi »)

Forme : `iframe.contentWindow.postMessage(obj, targetOrigin)`

```jsonc
{"mic":      true | false | "toggle"}   // micro local (flux publié)
{"mute":     true | false | "toggle"}   // écoute locale (haut-parleur)
{"camera":   true | false | "toggle"}
{"speaker":  true | false | "toggle"}
{"volume":   0..200}                    // % (100 = nominal)
{"panning":  0..180}                    // 90 = centre
{"bitrate":  -1 | 0..6000, "target":"*"}// kbps ; -1 = défaut
{"close":    true}                      // raccroche
{"reload":   true}
{"record":   true | false}
{"keyframe": true}
{"automixer":true | false}
{"sceneState":true | false}
{"sendChat": "texte"}
{"style":    "<css>"}
{"changeAudioDevice": 1|2|3|4}
{"changeVideoDevice": 1|2|3|4}
{"function": "previewWebcam"}
{"getStats":          true}
{"getLoudness":       true | false}
{"getStreamIDs":      true}
{"getDeviceList":     true}
{"getDetailedState":  true}
```

Ciblage DOM d'un flux reçu (page de visualisation / mixer) :

```jsonc
{"target":"<streamID>|*", "add": true}
{"target":"<streamID>|*", "remove": true}
{"target":"<streamID>", "replace": true}
{"target":"<streamID>", "settings": {"style":"...", "muted":true, "volume":0.5}}
```

### 2.2 Commandes réalisateur (ciblant un invité)

Forme vérifiée dans `guestTargetedAPI(target)` :
`{"action": <action>, "target": <slot|streamID|UUID>, "value": <valeur>}`

Actions vérifiées : `mic`, `speaker`, `camera`, `hangup`, `soloChat`,
`soloChatBidirectional`, `soloVideo`, `display`, `forward`, `forceKeyframe`,
`group`, `addScene`, `muteScene`, `mixorder`, `volume`, `zoom`,
`sendChat`, `sendDirectorChat`, `startRoomTimer`,
`ptzZoom`, `ptzPan`, `ptzTilt`, `ptzFocus`, `ptzAutofocus`,
`remoteMirror`, `remoteRotate`.

Forme héritée également acceptée :
`{"function":"targetGuest","target":"1","action":"mic","value":"toggle"}`

Certaines requêtes acceptent un identifiant de rappel `cib`, renvoyé tel quel
dans `e.data.cib`.

**Pièges à ne pas confondre** (point explicitement demandé au §6 du cahier des charges) :

| Commande | Effet réel |
|---|---|
| `{"action":"mic", target}` | Coupe **le micro publié** par le correspondant. Il n'émet plus. Visible par lui. |
| `{"mute": true}` (sur soi) | Coupe **l'écoute locale** de l'iframe courante. N'affecte pas ce que les autres reçoivent. |
| `{"action":"muteScene", target, value}` | Retire l'audio de l'invité **d'une scène** donnée, sans couper son micro. |
| `AudioOff` (vMix) | Coupe l'entrée **dans vMix** uniquement. Le correspondant continue d'émettre. |
| `{"action":"soloChat"}` | Talkback **privé** réalisateur → invité (unidirectionnel). `soloChatBidirectional` = bidirectionnel. |

Ce sont quatre opérations distinctes. L'interface de régie les expose séparément et
ne les mélange jamais derrière un bouton unique « Mute ».

### 2.3 Événements iframe → parent

Clés vérifiées dans le code de la page de référence :

```jsonc
{"stats": {"inbound": {...parStreamID}, "outbound": {...},
           "total_inbound_connections": n, "total_outbound_connections": n}}
{"action":"guest-connected",    "streamID":"...", "value":{"label":"..."}}
{"action":"guest-disconnected", "streamID":"..."}
{"action":"director-connected"}
{"action":"view-stats-updated"}
{"action":"image-frame-capture","value":{"imageData": Blob}}
{"loudness": {"<streamID>": dB, ...}, "mode":"snapshot"|"update"}
{"streamIDs": {"<streamID>":"label", ...}}
{"deviceList": [{"kind":"videoinput","label":"..."}, ...]}
{"gotChat": {"msg":"..."}}
{"guestList": [...]}        // réponse à une requête director
{"detailedState": {...}}    // réponse à getDetailedState
{"callback": {"result": ...}, "cib": "<id>"}
{"sensors": {"lin":{...},"acc":{...},"gyro":{...},"mag":{...}}}
{"frame": {...}, "trackID":"...", "streamID":"...", "kind":"video"|"audio"}
```

### 2.4 Faille de sécurité connue de l'API — à compenser chez nous

Le code de référence VDO.Ninja :
- envoie ses messages avec `targetOrigin = '*'` ;
- ne valide côté réception que `e.source`, **pas `e.origin`**.

**Nous ne pouvons pas corriger cela chez eux** (et nous ne devons pas modifier leur
code, cf. §1). Nous compensons **de notre côté** :
- nous n'envoyons jamais vers `'*'`, toujours vers l'origine exacte du moteur ;
- nous rejetons tout message entrant dont `e.origin` n'est pas l'origine attendue
  **et** dont `e.source` n'est pas la `contentWindow` de notre iframe ;
- nous ne faisons jamais confiance au contenu d'un message pour une décision
  d'autorisation : les droits sont réévalués côté serveur.

Implémenté dans `src/lib/media/iframe-bridge.ts`.

---

## 3. Paramètres d'URL VDO.Ninja vérifiés

Publication / correspondant : `&push=<id>`, `&label=`, `&quality=`, `&videodevice=`,
`&audiodevice=`, `&effects=`, `&proaudio`, `&meshcast`, `&roombitrate=`,
`&totalroombitrate=`.

Réception / mixer : `&view=<id[,id...]>`, `&solo`, `&scene`, `&videobitrate=`
(défaut 2500 kbps, **inopérant pour un invité en salle de groupe**),
`&audiobitrate=` (défaut 32 kbps), `&codec=h264|vp9|vp8|av1`, `&novideo`, `&noaudio`,
`&excludeaudio=<id>`, `&showlabels`, `&broadcast`.

Salle / réalisateur : `&room=`, `&director=`, `&codirector=`, `&password=`, `&hash=`,
`&mixminus`, `&directoronly`, `&scenemutebutton`.

Sortie propre : `&cleanoutput` (le plus strict, supprime aussi le menu contextuel),
`&cleanish` (variante souple, conserve le clic droit — s'applique à `&push`, `&room`,
`&view`, `&scene`), `&cleanviewer` (identique à `cleanoutput` mais seulement sur les
liens de visualisation).

### Motif de contribution officiellement recommandé

Vérifié sur `guides/large-production-rooms-with-isolated-guest-feeds` :

```
Correspondant :  https://vdo.ninja/?room=ROOM&push=GUEST_01&label=Guest%2001&view
Entrée vMix   :  https://vdo.ninja/?view=GUEST_01&solo&room=ROOM
```

Le `&view` **sans valeur** sur le lien du correspondant est essentiel : il le rend
*publish-only* (il n'aspire pas les flux des autres invités). `&view=GUEST_01`
signifierait « demande ce flux » et casserait le mécanisme.

`push=` et `view=` doivent être **identiques et stables** pour qu'une entrée vMix se
reconnecte au même correspondant après un rafraîchissement. C'est la raison pour
laquelle `Participant.streamId` est immuable pour la durée d'une session chez nous.

Plafonds de bande passante documentés : dès qu'un director ou une scene est connecté,
la vue combinée qu'un invité reçoit des autres invités est plafonnée à **500 kbps**
par défaut (`&totalroombitrate`).

---

## 4. vMix — capacités réelles

### 4.1 Web Browser Input

Vérifié sur `vmix.com/help29/WebBrowser.html` :

- Moteur **Chromium Embedded Framework (CEF)**, « most features of Google Chrome »,
  **WebRTC supporté**, HTML5 audio/vidéo.
- Largeur / hauteur en pixels configurables. Si plus petit que la sortie, la page est
  centrée à cette taille réduite.
- **L'audio de la page est capturé nativement** et mixable comme n'importe quelle
  source vMix — pas besoin de capture audio du bureau. C'est le point clé qui rend
  l'intégration viable.
- Transparence / canal alpha supportés si `<body>` n'a pas de couleur de fond.
- CSS personnalisé injecté au chargement, **uniquement à partir du moteur V115+**.
- Interaction souris possible sur la vignette / Preview ; clavier via
  « Keyboard Enabled » (qui **désactive les raccourcis clavier vMix** tant qu'il est actif).

**NON VÉRIFIÉ / risque majeur** : la documentation vMix **ne dit rien** des
autorisations caméra et microphone dans le Web Browser Input. Nous ne pouvons donc
**pas** supposer qu'une page VDO.Ninja de *publication* (`&push`) fonctionne dans une
entrée navigateur vMix. Conséquence concrète sur l'architecture : le **retour programme
n'est pas publié depuis vMix**, il est publié depuis un navigateur Chrome réel sur le
PC de régie (page `/return/...`), alimenté par un câble audio virtuel + NDI/Virtual
Output. Voir `04-AUDIO-MIXMINUS.md`.

### 4.2 HTTP Web API

Vérifié sur `vmix.com/help29/DeveloperAPI.html` :

- Base : `http://127.0.0.1:8088/api/` — activée dans *Settings → Web*.
- Appel sans paramètre → **état complet en XML** (racine `<vmix>`, avec `<inputs>`,
  `<preview>`, `<active>`, `<overlays>`, `<transitions>`).
- Appel de fonction : `?Function=<Nom>&<params>`
- Paramètres : `Function`, `Input` (numéro à partir de 1, `0` = Preview, `-1` = Active ;
  ou nom **sensible à la casse**, titre complet ; ou GUID lu dans l'attribut `key` du XML),
  `Value`, `Duration` (ms, transitions), `Mix` (0 = principal, 1/2 = Mix — **4K/Pro
  uniquement**), `SelectedName`, `SelectedIndex`, `Channel`.
- Codes retour : **200** succès, **500** erreur.
- La page officielle **ne décrit aucune authentification**. L'interface Web vMix
  propose un identifiant/mot de passe dans ses réglages, mais ce n'est pas documenté
  sur la page API. → **Hypothèse de travail : l'API vMix n'est pas sûre et ne doit
  jamais être exposée à Internet.** Voir §5.

Fonctions vérifiées sur `ShortcutFunctionReference.html` :

| Domaine | Fonctions | Paramètres |
|---|---|---|
| Navigateur | `BrowserNavigate` | `Value` (URL), `Input` |
| | `BrowserReload`, `BrowserBack`, `BrowserForward` | `Input` |
| | `BrowserMouseEnabled`/`Disabled`, `BrowserKeyboardEnabled`/`Disabled` | `Input` |
| Entrées | `AddInput` | `Value` = `Type\|Filename` |
| | `RemoveInput`, `SetInputName` | `Input`, (`Value` = nom) |
| Audio | `Audio` (bascule), `AudioOn`, `AudioOff` | `Input` |
| | `SetVolume` | `Value` **0–100**, `Input` |
| | `AudioAuto`, `AudioAutoOn`, `AudioAutoOff` | `Input` |
| | `AudioBus`, `AudioBusOn`, `AudioBusOff` | `Value` = `M,A..G`, `Input` |
| | `BusXAudio`, `BusXSendToMaster` | `Value` = bus |
| | `SoloOn`, `SoloOff` | `Input` |
| | `SoloAllOff` | — |

**NON VÉRIFIÉ** : `AddInput` avec `Value=Browser|https://...`. La documentation
officielle ne liste que `Video`, `Image`, `Photos`, `Title`, `VideoList`, `Colour`,
`AudioFile`, `Flash`, `PowerPoint`. Le format `Browser|URL` apparaît **uniquement dans
des messages de forum**, avec des rapports contradictoires (un utilisateur dit que
l'entrée est créée avec un moteur navigateur ancien ; un autre affirme qu'on ne peut
pas créer d'entrée navigateur par l'API, seulement changer l'URL d'une entrée
existante).

→ **Décision** : le module vMix propose `AddInput` comme **opération optionnelle
marquée « non garantie »**, désactivée par défaut, et le mode d'emploi recommandé est
celui qui est documenté : l'opérateur crée N entrées Web Browser vides dans vMix,
l'application les découvre par le XML, et les pointe avec `BrowserNavigate`. C'est le
seul chemin officiellement documenté.

**Limite rapportée** : plusieurs commandes envoyées trop vite à une même entrée
navigateur peuvent être perdues, la page n'ayant pas fini de charger. → nous
sérialisons les commandes par entrée avec un délai minimal configurable.

**Encodage** : `?`, `&`, `#` dans l'URL passée à `BrowserNavigate` doivent être
percent-encodés.

### 4.3 vMix Call — ce qu'on ne doit PAS supposer

vMix Call fournit un mix-minus automatique à ses propres participants. **Cette
fonction n'existe pas pour les entrées Web Browser.** Une entrée navigateur est une
source audio/vidéo ordinaire : elle n'a pas de bus de retour automatique.

→ Le mix-minus de Broadcast SN Remote Call est **explicite**, construit par nous,
documenté dans `04-AUDIO-MIXMINUS.md`. Aucune partie du produit ne doit laisser croire
le contraire.

### 4.4 NDI / SRT

Une page WebRTC **ne produit pas** de NDI ni de SRT. Ces sorties nécessitent un
composant passerelle séparé (voir `05-VMIX-INTEGRATION.md` §6, prévu mais non
implémenté dans cette version).

---

## 5. Risques identifiés et essais nécessaires

| # | Risque | Gravité | Nécessite un essai réel |
|---|---|---|---|
| R1 | `AddInput Browser\|URL` non documenté | Moyenne | **Oui — vMix Windows** |
| R2 | Permissions caméra/micro dans le Web Browser Input vMix | Haute | **Oui — vMix Windows** |
| R3 | API vMix sans authentification documentée | Haute | Non — traitée par architecture (agent local) |
| R4 | `targetOrigin:'*'` et absence de contrôle d'origine côté VDO.Ninja | Haute | Non — compensée côté application |
| R5 | Plafond 500 kbps entre invités quand un director est connecté | Moyenne | Oui — mesure terrain |
| R6 | Maillage P2P : coût O(n²) → quand faut-il un SFU ? | Haute | Oui — montée en charge |
| R7 | Boucle audio / double retour | Haute | **Oui — protocole de test audio** |
| R8 | iOS/Safari : lecture audio bloquée sans geste utilisateur, pas de choix de sortie audio | Haute | **Oui — iPhone réel** |
| R9 | Reconnexion : dépend du navigateur et du moteur, non garantie | Moyenne | Oui |
| R10 | Commandes vMix perdues si envoyées trop vite | Faible | Oui |

Le détail des essais et leur état réel est dans `10-TEST-REPORT.md`.

---

## 6. Sources

- https://github.com/steveseguin/vdo.ninja — `LICENSE`, `iframe.html`, `iframe-examples.js`
- https://docs.vdo.ninja/guides/iframe-api-documentation
- https://docs.vdo.ninja/guides/iframe-api-documentation/iframe-api-for-directors
- https://docs.vdo.ninja/advanced-settings/cheat-sheet-of-basic-parameters
- https://docs.vdo.ninja/guides/large-production-rooms-with-isolated-guest-feeds
- https://docs.vdo.ninja/guides/room-audio-obs-meshcast-and-private-talk
- https://www.vmix.com/help29/DeveloperAPI.html
- https://www.vmix.com/help29/ShortcutFunctionReference.html
- https://www.vmix.com/help29/WebBrowser.html
