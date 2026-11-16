# Broadcast SN Remote Call

**Professional Remote Contribution Platform**

Plateforme de contribution audiovisuelle WebRTC pour vMix : recevoir des
correspondants, journalistes et invités distants, les superviser depuis une console de
régie, et récupérer un flux isolé par correspondant dans vMix.

---

## État réel du produit

Ce dépôt contient un MVP **exécutable et testé**, pas une maquette. Ce qui suit est
vérifiable par les commandes de la section « Vérifier ».

| | État |
|---|---|
| Authentification, rôles, autorisation serveur | fonctionnel, testé |
| Productions, sessions, correspondants, invitations | fonctionnel, testé |
| Interface correspondant (préparation + liaison) | fonctionnel ; **essais navigateurs réels non faits** |
| Console de régie (multiview, mesures, commandes) | fonctionnel ; mesures réelles, pas simulées |
| Page de sortie propre pour vMix | fonctionnel, testé |
| Module vMix + agent local | fonctionnel, testé **contre un simulateur** |
| Retour programme et talkback | implémenté ; **validation audio à l'oreille non faite** |
| Rétention des données : écran, purge manuelle, purge planifiée | fonctionnel, testé |
| Docker, Nginx | fournis, syntaxe validée, **jamais construits** |
| Sortie NDI / SRT | **non implémentée** |

Tests exécutés : **234 assertions automatisées, 234 réussies**, campagnes rejouées
plusieurs fois de suite avec le même résultat.
Rapport détaillé, avec ce qui n'a **pas** été exécuté et pourquoi :
[`docs/10-TEST-REPORT.md`](docs/10-TEST-REPORT.md).
Limites connues, mesurées ou documentées : [`docs/11-KNOWN-LIMITS.md`](docs/11-KNOWN-LIMITS.md).

---

## Trois décisions qui expliquent tout le reste

### 1. Le moteur média n'est pas modifié, et n'est pas importé

VDO.Ninja est sous **AGPL-3.0**. Nous n'en copions pas une ligne et nous ne le modifions
pas. L'application communique avec lui uniquement par des **URL** et par l'**API IFrame**
(`postMessage`), ses interfaces publiques documentées.

Cette frontière est à la fois la plus sûre juridiquement (notre code reste une œuvre
séparée) et la bonne décision technique : `src/lib/media/engine.ts` définit un contrat
`MediaEngine` que l'on pourra satisfaire avec un SFU propre, sans toucher ni l'interface
ni la logique métier.

### 2. Aucune capacité n'est annoncée sans avoir été vérifiée

`EngineCapabilities` est un objet déclaratif lu par l'interface. Un bouton dont la
capacité est absente **n'est pas rendu**, plutôt que rendu et inopérant.

Quatre capacités sont déclarées **fausses**, et les tests le vérifient :
`nativeMixMinus`, `guaranteedReconnect`, `ndiOutput`, `srtOutput`.

Même règle pour les mesures : une donnée non remontée s'affiche **« — »**, jamais
« 0 ». « 0 image par seconde » est une panne ; « non mesuré » est autre chose.

### 3. Le mix-minus est construit, pas supposé

vMix Call fournit un mix-minus à ses propres participants. Une entrée **Web Browser**
n'en bénéficie pas. Le mix-minus est donc monté explicitement, bus par bus
([`docs/04-AUDIO-MIXMINUS.md`](docs/04-AUDIO-MIXMINUS.md)), et l'application protège le
montage : elle refuse `AudioBusOn` sur un bus de retour, et refuse `BusXSendToMaster` —
côté serveur **et** côté agent, indépendamment.

---

## Le parcours en une image

```
CORRESPONDANT              SALLE MÉDIA                      RÉGIE
/join/<jeton>     ──push──►  (room + secret)   ◄──director──  /control/<session>
   publish-only                    │                          multiview + commandes
                                   │
                            ◄──view&solo──  /output/<clé>  ──► vMix Web Browser Input
                                   │
                            ──push──  /return/<session>  ◄──  vMix Bus A
                                                               (câble audio virtuel)
```

- Le correspondant est **publish-only** : un seul flux montant, ce qui compte sur une
  liaison 4G.
- L'entrée vMix reçoit un **flux isolé** par correspondant, sur une page sans aucun
  élément d'interface.
- Le retour programme est publié depuis un **vrai Chrome** sur le PC de régie, pas
  depuis vMix : les autorisations micro/caméra d'un Web Browser Input ne sont pas
  documentées, donc nous ne les supposons pas.

Détail étape par étape, avec ce qui est vérifié côté serveur à chacune :
[`docs/03-PARCOURS-CORRESPONDANT.md`](docs/03-PARCOURS-CORRESPONDANT.md).

---

## Démarrer

```bash
npm ci
```

```bash
cp .env.example .env
```

```bash
openssl rand -base64 48
```

Reportez deux valeurs **différentes** dans `AUTH_SECRET` et `MEDIA_SECRET`, renseignez
`DATABASE_URL`, puis :

```bash
npm run db:migrate
```

```bash
SEED_ADMIN_EMAIL="vous@exemple.org" SEED_ADMIN_PASSWORD="<12 caractères minimum>" npm run db:seed
```

```bash
npm run dev
```

Installation complète et production : [`docs/06-DEPLOYMENT.md`](docs/06-DEPLOYMENT.md).

---

## Vérifier

```bash
npm run verify
```

(types, tests unitaires, compilation)

Puis, l'application démarrée dans un autre terminal :

```bash
bash tests/e2e-api.sh
```

```bash
bash tests/e2e-vmix.sh
```

```bash
bash tests/e2e-retention.sh
```

Le second lance `tests/mock-vmix.mjs`, qui reproduit la **forme documentée** de l'API
vMix. Il valide notre client, **pas** vMix : ce que cela ne prouve pas est écrit en tête
du script et dans le rapport de tests.

Ces scripts modifient la base — base de développement uniquement. Ils rendent un code
de sortie non nul en cas d'échec, donc ils s'intègrent tels quels à une chaîne CI.

---

## Documentation

| Document | Contenu |
|---|---|
| [`01-AUDIT.md`](docs/01-AUDIT.md) | Phase 1 : licences, capacités **vérifiées** de l'API IFrame et de vMix, ce qui n'est **pas** documenté, risques |
| [`02-ARCHITECTURE.md`](docs/02-ARCHITECTURE.md) | Couches, abstraction `MediaEngine`, flux média, scénarios de défaillance, quand un SFU devient nécessaire |
| [`03-PARCOURS-CORRESPONDANT.md`](docs/03-PARCOURS-CORRESPONDANT.md) | Du lien jusqu'à l'apparition dans vMix, étape par étape |
| [`04-AUDIO-MIXMINUS.md`](docs/04-AUDIO-MIXMINUS.md) | Les quatre bus, le montage de référence, les garde-fous anti-boucle, le protocole de test audio A1–A10 |
| [`05-VMIX-INTEGRATION.md`](docs/05-VMIX-INTEGRATION.md) | Ce que vMix sait faire et ne sait pas faire, page de sortie, allowlist, pourquoi l'API vMix ne sort jamais du réseau local |
| [`06-DEPLOYMENT.md`](docs/06-DEPLOYMENT.md) | Local et Ubuntu 24.04, TLS, sauvegardes, rétention, supervision |
| [`07-GUIDE-CORRESPONDANT.md`](docs/07-GUIDE-CORRESPONDANT.md) | À transmettre avec le lien d'invitation |
| [`08-GUIDE-REALISATEUR.md`](docs/08-GUIDE-REALISATEUR.md) | Préparer une émission, la console, **les quatre « mute » à ne pas confondre** |
| [`09-TROUBLESHOOTING.md`](docs/09-TROUBLESHOOTING.md) | Par symptôme observé |
| [`10-TEST-REPORT.md`](docs/10-TEST-REPORT.md) | Ce qui a été exécuté, ce qui ne l'a pas été, et pourquoi |
| [`11-KNOWN-LIMITS.md`](docs/11-KNOWN-LIMITS.md) | 16 limites, avec origine, impact réel et ce qui les lèverait |
| [`packages/vmix-agent/README.md`](packages/vmix-agent/README.md) | Agent local sur le PC de régie |

---

## Structure

```
app/                      routes Next.js (App Router)
  (console)/              régie, productions, administration — authentification requise
  join/[token]/           correspondant : préparation puis liaison
  output/[key]/           page propre pour un Web Browser Input vMix
  return/[sessionId]/     publication du retour programme
  api/                    API HTTP
src/
  components/             interface de régie et interface correspondant
  lib/
    media/                engine.ts (contrat) · vdoninja.ts (adaptateur) · iframe-bridge.ts
    vmix/                 client.ts · functions.ts (liste blanche) · xml.ts
    rbac.ts               matrice rôles → capacités
  server/
    auth/                 scrypt, sessions JWT, gardes
    services/             logique métier — aucun accès Prisma depuis l'interface
    events/bus.ts         bus d'événements applicatifs (SSE)
    services/retention.ts politique de conservation et purge
prisma/schema.prisma      11 entités + limitation de débit
packages/vmix-agent/      agent local, sans dépendance
deploy/                   Dockerfile, docker-compose, Nginx, planificateur de purge
tests/                    unitaires, intégration API, intégration vMix, simulateur vMix
docs/                     les 11 documents ci-dessus
```

---

## Sécurité — ce qui est appliqué à l'exécution

Pas des recommandations : des refus.

| Contrôle | Où |
|---|---|
| HTTPS obligatoire en production, secrets d'exemple refusés | `src/lib/env.ts` — refus de démarrage |
| Mots de passe en **scrypt** (N=2¹⁷), paramètres bornés à la relecture | `src/server/auth/password.ts` |
| Jetons d'invitation stockés en **SHA-256** seulement, affichés une fois | `src/server/services/invitation.ts` |
| Révocation effective à la **requête suivante** (relecture de l'état en base) | `src/server/auth/guard.ts` |
| `tokenEpoch` : invalide d'un coup toutes les sessions d'un compte ou d'une session | schéma + services |
| Limitation de débit **persistée** en base, par IP et par compte | `src/server/services/ratelimit.ts` |
| Message d'erreur unique à la connexion (pas d'énumération de comptes) | `app/api/auth/login/route.ts` |
| Origine des messages `postMessage` **vérifiée** en émission et en réception | `src/lib/media/iframe-bridge.ts` |
| URL du moteur construites **côté serveur** uniquement | `app/api/participants/me/join/route.ts` |
| Liste blanche typée des fonctions vMix, avec niveaux de risque | `src/lib/vmix/functions.ts` |
| API vMix refusée hors adresses privées, agent avec sa propre liste blanche | `src/lib/vmix/client.ts`, `packages/vmix-agent/` |
| Journal d'audit des actions **réussies et refusées** | `src/server/services/audit.ts` |
| Purge planifiée par secret dédié, refus de démarrage sans secret | `app/api/admin/retention/`, `deploy/scheduler/purge.sh` |
| Refus de page renvoyé proprement, sans révéler l'existence d'une session | `src/server/auth/guard.ts` |
| Changer son mot de passe exige le mot de passe actuel ; les autres sessions tombent | `app/api/account/password/route.ts` |
| Journaux applicatifs avec masquage des champs sensibles | `src/lib/logger.ts` |

`npm audit --omit=dev` → **0 vulnérabilité** sur les dépendances d'exécution.

Le moteur média impose en revanche une limite qu'il faut connaître : **toute page qui
rejoint la salle contient le secret de la salle**. Mesuré, assumé, atténué, documenté en
[`11-KNOWN-LIMITS.md`](docs/11-KNOWN-LIMITS.md) §L1.

---

## Prochaines étapes

Dans l'ordre où elles apportent le plus :

1. **Essais navigateurs réels** — Chrome, Firefox, Android, et surtout **iPhone/Safari**.
2. **Protocole audio A1–A10** sur un vrai montage vMix : c'est ce qui valide le
   mix-minus.
3. **Deux points à trancher sur vMix Windows** : `AddInput Browser|<url>`, et les
   autorisations micro/caméra d'un Web Browser Input.
4. **Recette Docker** : construire l'image, démarrer la pile, restaurer une sauvegarde.
5. **Serveur TURN** : lèverait la plupart des réseaux qui bloquent le temps réel.
6. **Montée en charge** pour mesurer, et non supposer, le point de bascule vers un SFU.
