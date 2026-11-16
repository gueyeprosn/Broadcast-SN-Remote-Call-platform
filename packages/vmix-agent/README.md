# Agent vMix local

Petit service Node, sans aucune dépendance, à installer **sur le PC de régie Windows**
à côté de vMix.

## Pourquoi il existe

La page officielle de l'API HTTP de vMix ne décrit **aucune authentification**
(`docs/01-AUDIT.md` §4.2). Exposer `127.0.0.1:8088` au-delà de la machine permettrait à
quiconque d'envoyer `Function=Cut` ou `Function=RemoveInput` pendant un direct.

L'agent ajoute ce qui manque :

1. **un secret partagé**, comparé à temps constant, transmis dans l'en-tête
   `X-SNRC-Agent-Token` — jamais dans l'URL, qui finirait dans des journaux ;
2. **sa propre liste blanche**, indépendante de celle du serveur applicatif : même un
   serveur compromis ne peut pas lui faire exécuter `RemoveInput`, `Cut` ou
   `BusXSendToMaster` ;
3. **un journal local** de chaque commande acceptée *et* refusée.

## Installation

```bash
cd packages/vmix-agent
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Reportez la valeur obtenue :

- dans `SNRC_AGENT_TOKEN` pour l'agent ;
- dans `VMIX_AGENT_TOKEN` du `.env` de l'application — **la même valeur**.

Puis, dans une invite de commandes sur le PC de régie :

```bash
set SNRC_AGENT_TOKEN=<le-secret>
set AGENT_PORT=8099
set VMIX_HOST=127.0.0.1
set VMIX_PORT=8088
set AGENT_RETURN_BUSES=A
node agent.mjs
```

Dans l'application : `Admin → vMix → Déclarer une connexion`, mode **AGENT**,
hôte = adresse du PC de régie, port = **8099** (celui de l'agent, pas celui de vMix).

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `SNRC_AGENT_TOKEN` | — | **Obligatoire**, 24 caractères minimum. |
| `AGENT_BIND` | `127.0.0.1` | Interface d'écoute. Toute autre valeur **exige TLS**. |
| `AGENT_PORT` | `8099` | Port de l'agent. |
| `VMIX_HOST` / `VMIX_PORT` | `127.0.0.1` / `8088` | Où joindre vMix. |
| `VMIX_TIMEOUT_MS` | `4000` | Délai d'attente d'une réponse vMix. |
| `AGENT_TLS_CERT` / `AGENT_TLS_KEY` | — | Certificat et clé pour HTTPS. |
| `AGENT_RETURN_BUSES` | `A` | Bus de retour protégés : `AudioBusOn` y est refusé. |
| `AGENT_ALLOW_PROGRAM` | `false` | Autorise `Cut`, `Fade`, `PreviewInput`, `Transition*`. |
| `AGENT_ALLOW_ADD_INPUT` | `false` | Autorise `AddInput` — **non documenté** pour le type Browser. |
| `AGENT_ALLOW_REMOVE_INPUT` | `false` | Autorise `RemoveInput`. |

L'agent **refuse de démarrer** si :

- le secret fait moins de 24 caractères ;
- `AGENT_BIND` n'est pas la boucle locale et qu'aucun certificat TLS n'est fourni.

Ce ne sont pas des avertissements, ce sont des refus.

## Fonctions toujours interdites

`BusXSendToMaster` (boucle de programme), `Shutdown`, `Restart`, `ScriptStart`,
`ScriptStartDynamic`. Aucun drapeau ne les débloque.

## Points d'entrée

| Méthode | Chemin | Effet |
|---|---|---|
| `GET` | `/health` | État de l'agent, sans authentification, sans détail sensible. |
| `GET` | `/vmix` | État complet de vMix en XML. Secret requis. |
| `GET` | `/vmix?Function=…&Input=…&Value=…` | Commande, après validation. Secret requis. |

Les codes retour de vMix sont relayés tels quels (200 succès, 500 refus vMix).
Un agent qui ne joint pas vMix renvoie **502** avec la cause réelle — il ne prétend
jamais que la commande est passée.

## Variante tunnel sortant — non implémentée

Le montage le plus sûr serait un agent qui **n'écoute rien** et ouvre lui-même une
connexion sortante persistante vers l'application, laquelle lui pousse les commandes.
Aucun port entrant ne serait alors ouvert sur le PC de régie, ce qui est précieux
derrière un NAT ou un pare-feu d'entreprise.

Cette variante **n'est pas écrite** dans cette version. L'agent actuel écoute, par
défaut sur la boucle locale, ce qui couvre le cas « application et vMix sur le même
réseau de régie ». Ne le déployez pas sur une interface publique.
