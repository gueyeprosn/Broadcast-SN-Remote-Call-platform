# Guide d'intégration vMix

## 1. Ce que vMix sait faire, et ce qu'il ne sait pas faire

| | État |
|---|---|
| Afficher une page WebRTC dans un Web Browser Input (CEF) | **Documenté** |
| Capter l'audio de cette page et le mixer | **Documenté** |
| Transparence / alpha sur un Web Browser Input | **Documenté** |
| Changer l'URL d'une entrée par l'API (`BrowserNavigate`) | **Documenté** |
| **Créer** une entrée navigateur par l'API (`AddInput Browser\|URL`) | **NON DOCUMENTÉ** — forums contradictoires |
| Autoriser micro/caméra dans un Web Browser Input | **NON DOCUMENTÉ** — ne pas supposer |
| Mix-minus automatique sur un Web Browser Input | **NON** — c'est propre à vMix Call |
| Produire du NDI/SRT depuis une page WebRTC | **NON** — nécessite une passerelle |

## 2. La page de sortie `/output/<outputKey>`

C'est **notre** page, pas celle du moteur. Elle est volontairement minimale :

- `<body>` sans couleur de fond (permet l'alpha vMix) ;
- aucun bouton, menu, logo, bordure, curseur ;
- un seul iframe plein cadre vers le moteur, avec
  `&view=<streamId>&solo&room=<room>&password=<secret>&cleanoutput&autostart`
  et le bitrate du profil ;
- `<meta name="robots" content="noindex,nofollow">` ;
- en-tête `X-Robots-Tag: noindex` et `Cache-Control: no-store` ;
- `overflow:hidden`, `cursor:none`, `user-select:none`.

Pourquoi passer par notre page plutôt que coller l'URL du moteur directement dans
vMix :

1. **Révocation.** `outputKey` est vérifiée côté serveur à chaque chargement. Si la
   session est terminée ou l'accès révoqué, la page sert un cadre noir au lieu du flux.
   Une URL de moteur collée dans vMix, elle, reste valable indéfiniment.
2. **Secret de salle hors du champ de configuration vMix.** Le `password` de la salle
   n'apparaît pas dans le réglage « URL » de l'entrée, lisible d'un coup d'œil par
   quiconque passe devant la machine de régie, ni dans l'historique du navigateur
   embarqué.

   **Mais il reste présent dans le code de la page** servie à cette entrée : le moteur
   exige que tout client qui rejoint la salle détienne le mot de passe. C'est une
   limite inhérente au moteur, mesurée et documentée — voir `11-KNOWN-LIMITS.md` §L1.
   Ne présentez pas cette page comme un cloisonnement cryptographique : c'est une
   réduction de l'exposition, pas une barrière.
3. **Stabilité.** Si le profil qualité change, ou si l'on migre de moteur, l'URL dans
   vMix ne change pas.
4. **Diagnostic.** La page peut afficher une mire d'erreur nommée (« session terminée »,
   « accès révoqué ») visible directement dans la vignette vMix.

**Dimensions recommandées pour le Web Browser Input :** largeur et hauteur **égales à
la résolution du profil** du correspondant (1280×720 pour Broadcast). Mettre une taille
supérieure ne crée pas de détail ; une taille inférieure centre la page dans un cadre
plus petit et dégrade l'image.

## 3. Mise en service manuelle (chemin garanti)

1. Dans la régie Broadcast SN, carte du correspondant → **Copier le lien vMix**.
2. Dans vMix : `Add Input` → `More` → **Web Browser**.
3. Coller l'URL. Régler **Width 1280 / Height 720**.
4. `OK`. L'entrée apparaît ; son audio est mixable immédiatement.
5. Renommer l'entrée avec le nom du correspondant (`SetInputName` le fait aussi).
6. Router l'audio selon `04-AUDIO-MIXMINUS.md` §2.

À faire une fois par correspondant. Les entrées peuvent être préparées **avant**
l'émission : la page affiche un cadre d'attente nommé tant que le correspondant n'est
pas connecté.

## 4. Module vMix de l'application

`Admin → vMix` permet de déclarer une ou plusieurs `VmixConnection` :

| Champ | Rôle |
|---|---|
| `label` | nom de la machine de régie |
| `host` / `port` | adresse de l'API (défaut `127.0.0.1:8088`) |
| `mode` | `DIRECT` (le serveur joint vMix) ou `AGENT` (via l'agent local) |
| `agentToken` | secret partagé avec l'agent (jamais dans une URL) |
| `allowAddInput` | autorise `AddInput` — **désactivé par défaut**, marqué non garanti |
| `allowProgramControl` | autorise Cut/Fade/Transition — **désactivé par défaut** |

Opérations exposées :

- **Tester la connexion** → `GET /api/` sans paramètre, parse du XML, retourne
  version, édition et nombre d'entrées. Un échec est rapporté tel quel (timeout,
  connexion refusée, XML invalide) — jamais « connecté » par défaut.
- **Lister les entrées** → XML `<inputs>`, avec `key` (GUID), `number`, `title`, `type`.
  Les entrées de type `Browser` sont signalées comme candidates.
- **Associer** un participant à une entrée → `VmixInputMapping`.
- **Pointer l'entrée** → `BrowserNavigate` + `Value=<url percent-encodée>` +
  `Input=<GUID>`. Les commandes vers une même entrée sont sérialisées avec un délai
  minimal de 750 ms (limite rapportée : commandes perdues si la page n'a pas fini de
  charger).
- **Renommer** → `SetInputName`.
- **Audio** → `AudioOn` / `AudioOff` / `SetVolume` / `AudioBusOn` / `AudioBusOff`.
- **Recharger** → `BrowserReload`.

### Allowlist stricte

`src/lib/vmix/functions.ts` est une **liste blanche typée**. Toute fonction non
listée est refusée avant tout appel réseau. Chaque entrée porte un niveau de risque :

| Niveau | Exemples | Garde |
|---|---|---|
| `SAFE` | `BrowserNavigate`, `BrowserReload`, `SetInputName`, lecture XML | rôle `DIRECTOR`+ |
| `AUDIO` | `AudioOn/Off`, `SetVolume`, `AudioBus*` | rôle `TECHNICIAN`+ |
| `PROGRAM` | `Cut`, `Fade`, `Transition*`, `OverlayInput*` | rôle `DIRECTOR`+, `allowProgramControl`, **et confirmation explicite** |
| `DESTRUCTIVE` | `RemoveInput`, `AddInput` | rôle `ADMIN`, drapeau dédié, confirmation nominative |

`BusXSendToMaster` est refusé pour tout bus déclaré comme bus de retour : c'est la
protection anti-boucle du §4 de `04-AUDIO-MIXMINUS.md`.

## 5. ON AIR réel depuis vMix

Si une connexion vMix est joignable, l'application interroge le XML toutes les 2 s
et lit `<active>` / `<preview>` ainsi que `<overlays>`. Un participant mappé à
l'entrée active est marqué **ON AIR (vMix)** — distinct visuellement de
**ON AIR (manuel)** décidé par le réalisateur. Les deux ne sont jamais confondus.

Sans connexion vMix, seul le mode manuel existe, et l'interface le dit.

## 6. Pourquoi ne jamais exposer l'API vMix sur Internet

La page officielle de l'API **ne documente aucune authentification**. Une API vMix
accessible depuis Internet permet à n'importe qui de couper l'antenne.

Règles appliquées :
- Mode `DIRECT` **refusé** si `host` n'est pas une adresse privée ou de bouclage
  (vérifié dans `src/lib/vmix/client.ts`, liste RFC1918 + loopback + `.local`).
  Ce n'est pas un conseil dans la documentation : c'est un refus à l'exécution.
- Mode `AGENT` pour tout le reste : un petit service Node tourne sur le PC de régie,
  établit une connexion **sortante** vers l'application, et traduit les ordres en
  appels `127.0.0.1:8088`. Aucun port entrant n'est ouvert sur le PC de régie.
  L'agent applique **sa propre** allowlist, indépendamment du serveur : même un
  serveur compromis ne peut pas lui faire exécuter `RemoveInput`.
- L'`agentToken` circule dans un en-tête, jamais dans une URL ou un paramètre.

## 7. NDI / SRT (prévu, non implémenté)

Une page WebRTC ne produit ni NDI ni SRT. Pour l'obtenir il faudra un composant
passerelle distinct : un processus serveur qui s'abonne au flux WebRTC (par exemple
via `whip`/`whep` ou un SFU) et republie en NDI (SDK NDI) ou SRT (libsrt/ffmpeg).

Ce composant **n'existe pas dans cette version**. Il est réservé dans
l'architecture (`MediaEndpoint.kind = 'NDI' | 'SRT'`) mais aucune route ne le sert, et
l'interface n'en propose rien. Voir `11-KNOWN-LIMITS.md`.
