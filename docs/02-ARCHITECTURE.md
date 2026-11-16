# Phase 2 — Architecture technique

## 1. Principe directeur

Une seule règle gouverne tout le découpage :

> **L'application ne contient aucun code du moteur média, et le moteur média ne
> contient aucune logique métier.**

Raisons : contrainte AGPL (cf. `01-AUDIT.md` §1), et besoin déclaré de pouvoir
remplacer VDO.Ninja par un moteur WebRTC propre plus tard.

## 2. Couches

```
┌──────────────────────────────────────────────────────────────────────┐
│ PRÉSENTATION      app/(auth) app/(console) app/join app/output       │
│                   Composants Tailwind, thème régie TV                │
├──────────────────────────────────────────────────────────────────────┤
│ LOGIQUE MÉTIER    src/server/services/*                              │
│                   productions, sessions, participants, invitations   │
│                   Aucun accès direct à Prisma depuis l'UI            │
├──────────────────────────────────────────────────────────────────────┤
│ AUTORISATION      src/server/auth/*  + src/lib/rbac.ts               │
│                   Toute route passe par requireRole()/requireCap()   │
├──────────────────────────────────────────────────────────────────────┤
│ TRANSPORT MÉDIA   src/lib/media/engine.ts   ← interface stable       │
│                   src/lib/media/vdoninja.ts ← implémentation         │
│                   src/lib/media/iframe-bridge.ts ← postMessage sûr   │
├──────────────────────────────────────────────────────────────────────┤
│ INTÉGRATION VMIX  src/lib/vmix/*  (client HTTP + allowlist)           │
│                   + agent local optionnel (packages/vmix-agent)       │
├──────────────────────────────────────────────────────────────────────┤
│ PERSISTANCE       Prisma / PostgreSQL                                │
├──────────────────────────────────────────────────────────────────────┤
│ INFRA             Docker Compose · Nginx · TLS · logs                │
└──────────────────────────────────────────────────────────────────────┘
```

## 3. L'abstraction `MediaEngine`

`src/lib/media/engine.ts` définit ce dont l'application a besoin, **sans jamais
nommer VDO.Ninja** :

```ts
interface MediaEngine {
  readonly id: string
  readonly origin: string
  publisherUrl(ctx: PublisherContext): string   // lien correspondant
  directorUrl(ctx: RoomContext): string         // lien régie
  receiverUrl(ctx: ReceiverContext): string     // lien vMix (sortie propre)
  returnBusUrl(ctx: ReturnContext): string      // retour programme
  capabilities: EngineCapabilities               // ce que le moteur sait faire
  commands: EngineCommandMap                     // traduction commande → message
}
```

`EngineCapabilities` est un objet **déclaratif** lu par l'interface : si le moteur ne
sait pas faire `setGuestVolume`, le bouton correspondant n'est pas rendu — il n'est pas
rendu puis inopérant. C'est la façon d'appliquer la règle « ne jamais présenter une
fonction inexistante ».

Pour brancher un autre moteur (SFU maison, LiveKit, Janus…), on écrit une seconde
implémentation de cette interface. Aucune page, aucun service métier ne change.

## 4. Flux média — les quatre chemins

```
                    ┌────────────────────────────────────────┐
                    │  Salle média (VDO.Ninja room)          │
  CORRESPONDANT     │                                        │
  /join/<token>     │   push=<streamId>  &view (publish-only)│
  ──────────────────┼──────────────► (1) contribution        │
                    │                                        │
  RÉGIE             │   director=<room>                      │
  /control/<id>     │ ◄─────────────► (2) supervision+ordres │
  (iframe cachée)   │                                        │
                    │                                        │
  SORTIE VMIX       │   view=<streamId>&solo&room=<room>     │
  /output/<key>     │ ◄────────────── (3) flux isolé propre  │
  (dans vMix)       │                                        │
                    │                                        │
  RETOUR PGM        │   push=<returnId>&novideo? …           │
  /return/<id>      │ ──────────────► (4) retour programme   │
  (Chrome régie)    │                                        │
                    └────────────────────────────────────────┘
```

1. **Contribution** — le correspondant publie et ne reçoit rien des autres invités
   (`&view` vide). Un seul flux montant : économie de bande passante mobile.
2. **Supervision** — la régie est `&director` de la salle. C'est ce canal qui porte
   mute/camera/hangup/talkback. Il est hébergé dans une iframe **non visible comme
   telle** : notre UI affiche ses propres vignettes et pilote l'iframe par `postMessage`.
3. **Sortie vMix** — une URL par correspondant, `&solo` (flux isolé, pas de mosaïque),
   `&cleanoutput` (aucun élément d'interface). C'est l'URL mise dans un Web Browser Input.
4. **Retour programme** — publié depuis un **vrai Chrome** sur le PC de régie, pas
   depuis vMix (cf. `01-AUDIT.md` §4.1, risque R2). Détail dans `04-AUDIO-MIXMINUS.md`.

## 5. Événements applicatifs

Deux canaux distincts, à ne pas confondre :

| Canal | Portée | Technologie |
|---|---|---|
| Événements **média** | états de connexion WebRTC, stats, loudness | `postMessage` iframe ↔ parent |
| Événements **applicatifs** | ON AIR, messages réalisateur, révocation, mapping vMix | SSE serveur → client + `POST` client → serveur |

### Choix assumé : SSE plutôt que WebSocket

Le cahier des charges demande « WebSocket pour les événements applicatifs ».
Nous utilisons **Server-Sent Events**. Raison : le trafic applicatif est
quasi-unidirectionnel (serveur → consoles et correspondants), SSE fonctionne dans un
handler Next.js standard sans serveur Node séparé, traverse mieux les proxies
d'entreprise, et se reconnecte tout seul (`Last-Event-ID`). Le sens client → serveur
passe par des `POST` idempotents, qui sont de toute façon les seuls à devoir être
autorisés et audités.

`src/server/events/bus.ts` isole ce choix derrière `publish(topic, event)` /
`subscribe(topic)`. Passer à un vrai WebSocket (ou à Redis pub/sub pour plusieurs
instances) ne touche que ce fichier. **Limite actuelle : le bus est en mémoire, donc
mono-instance.** Documenté dans `11-KNOWN-LIMITS.md`.

## 6. Modèle de rôles

| Rôle | Peut |
|---|---|
| `ADMIN` | tout, + gestion des utilisateurs, + connexions vMix |
| `DIRECTOR` | créer productions/sessions, inviter, piloter la régie, mapper vMix |
| `TECHNICIAN` | voir la régie, lire les métriques, piloter l'audio ; **pas** d'invitation, **pas** de révocation |
| `CORRESPONDENT` | rejoindre via jeton d'invitation uniquement ; aucune session applicative |

Le correspondant **n'est pas un `User`**. Il est authentifié par un jeton
d'invitation à usage et durée limités, échangé contre un cookie de participant
restreint à une seule session. Un correspondant ne peut donc jamais atteindre une
route de console, même par erreur de routage.

Matrice complète et testable : `src/lib/rbac.ts`.

## 7. Arborescence

```
app/
  (public)/login/page.tsx
  (console)/layout.tsx                 garde d'authentification
  (console)/productions/page.tsx
  (console)/productions/[id]/page.tsx
  (console)/control/[sessionId]/page.tsx   ← Control Room
  (console)/admin/users/page.tsx
  (console)/admin/vmix/page.tsx
  join/[token]/page.tsx                ← correspondant (pré-connexion + appel)
  output/[streamKey]/page.tsx          ← sortie propre vMix
  return/[sessionId]/page.tsx          ← publication du retour programme
  api/…
src/
  components/…                          UI régie
  lib/
    media/{engine,vdoninja,iframe-bridge,protocol}.ts
    vmix/{client,functions,xml}.ts
    {env,db,rbac,ids,logger}.ts
  server/
    auth/{password,session,guard}.ts
    services/{production,session,participant,invitation,vmix,metrics,audit}.ts
    events/bus.ts
prisma/schema.prisma
packages/vmix-agent/                    agent local optionnel (Node)
deploy/{docker-compose.yml,nginx/,Dockerfile}
docs/
```

## 8. Scénarios de défaillance traités

| Défaillance | Comportement attendu |
|---|---|
| Refus d'autorisation caméra/micro | message explicite + instructions par navigateur, pas de boucle de demande |
| Caméra occupée par une autre application | erreur nommée (`NotReadableError`) + bouton « réessayer » |
| Perte réseau correspondant | bandeau « hors ligne », tentative de reconnexion **bornée**, puis bouton manuel |
| Perte réseau régie | la contribution et les entrées vMix **continuent** (elles ne passent pas par la régie) |
| Base de données indisponible | la régie passe en mode dégradé lecture seule ; les flux continuent |
| Jeton d'invitation expiré/révoqué | refus côté serveur **et** fermeture du média en cours (`{"close":true}`) |
| vMix inaccessible | état « déconnecté » dans le panneau vMix, aucune commande envoyée, pas de faux positif |
| Horloge/token désynchronisé | refus explicite 401 avec motif distinct de « non autorisé » |

## 9. Quand un SFU devient nécessaire (risque R6)

VDO.Ninja en salle fonctionne en **maillage P2P**. Pour `n` participants qui se voient
tous : `n(n-1)/2` connexions, et chaque invité fait `n-1` flux montants.

Dans notre motif de contribution, les correspondants sont *publish-only* : chaque
correspondant n'a que **1 flux montant** (vers la régie/les scènes), pas `n-1`.
Le coût se déplace donc sur le **récepteur** (PC de régie), qui décode `n` flux.

Seuils pratiques retenus comme hypothèses de travail à valider (R6) :

| Correspondants | Montage |
|---|---|
| 1–4 | P2P direct, 720p, sans réserve |
| 5–8 | P2P direct, surveiller le CPU/GPU du PC de régie ; envisager `&codec=h264` pour le décodage matériel |
| 9–16 | répartir les entrées sur deux machines de réception, ou activer un relais (`&meshcast`) pour les flux non critiques |
| > 16 | **un SFU est nécessaire.** C'est le point de bascule qui justifie le moteur média propre prévu par l'interface `MediaEngine`. |

Ces seuils sont des hypothèses issues de la documentation, **pas des mesures**.
À valider par un essai de montée en charge (`10-TEST-REPORT.md`).
