# Limites connues

Document destiné à être lu **avant** de mettre le produit en production.
Chaque limite indique son origine, son impact réel et ce qui la lèverait.
Les limites mesurées pendant les essais sont marquées **(mesurée)**.

---

## L1 — Le secret de salle est présent dans toute page qui rejoint la salle **(mesurée)**

**Origine** — modèle d'autorisation de VDO.Ninja : une salle est protégée par un
`&password` que **tout** client doit détenir pour s'y connecter.

**Conséquence** — la page du correspondant (`/join/...`) et la page de sortie vMix
(`/output/...`) contiennent le secret de la salle dans l'URL de leur iframe. Un
correspondant peut donc le lire dans le code source de sa propre page, puis
construire un lien `&director=<salle>&password=<secret>`.

**Atténuations en place**
- Un secret **par session**, jamais réutilisé d'une édition à l'autre (vérifié par
  les tests).
- La régie revendique le rôle director dès l'ouverture de la console ; la
  documentation du moteur précise que « le premier director à rejoindre contrôle la
  salle ».
- Fin de session : rotation de `tokenEpoch`, révocation de toutes les invitations,
  et la session suivante a une salle **et** un secret entièrement nouveaux.
- Les correspondants sont *publish-only* : ils ne reçoivent pas les flux des autres.

**Risque résiduel** — si la console de régie se déconnecte pendant une session, un
correspondant malveillant pourrait revendiquer le rôle director de cette salle.

**Ce qui lèverait la limite** — un moteur média avec des jetons par rôle et à durée
limitée, c'est-à-dire la seconde implémentation de `MediaEngine`. C'est la raison
d'être de cette abstraction.

---

## L2 — Le mix-minus n'est pas automatique

**Origine** — vMix Call fournit un mix-minus à ses propres participants. Une entrée
**Web Browser** est une source audio ordinaire et n'en bénéficie pas. VDO.Ninja ne
l'applique pas non plus automatiquement à nos liens de contribution.

**Conséquence** — si vous renvoyez le Master vers les correspondants, chacun s'entend
lui-même avec la latence du tour complet. Inexploitable à l'antenne.

**En place** — le mix-minus est construit explicitement, bus par bus
(`04-AUDIO-MIXMINUS.md`). L'application :
- déclare `nativeMixMinus: false`, et l'interface l'affiche ;
- refuse `AudioBusOn` sur un bus déclaré « bus de retour » (vérifié par les tests) ;
- refuse `BusXSendToMaster` en toute circonstance, côté serveur **et** côté agent.

**Limite restante** — le nombre de retours individuels est borné par le nombre de bus
vMix (A à G, soit 7). Au-delà, il faut un mélangeur audio externe. C'est une limite
de vMix.

---

## L3 — La reconnexion automatique n'est pas garantie

**Origine** — le paramètre `&retry` existe mais la documentation le réserve
principalement à Raspberry Ninja. Aucun engagement n'est documenté pour un
navigateur.

**Conséquence** — après une coupure réseau, un correspondant peut devoir recharger sa
page.

**En place** — l'application ne promet rien : `guaranteedReconnect: false`, un bandeau
explicite côté correspondant (« si l'image ne revient pas, rechargez cette page »), et
un rappel dans le panneau « Limites du moteur » de la régie. Les entrées vMix, elles,
rechargent la page de sortie toutes seules si le CEF perd la connexion, et notre page
de sortie revalide alors l'accès côté serveur.

---

## L4 — Le bus d'événements applicatifs est mono-instance

**Origine** — `src/server/events/bus.ts` tient les abonnés et un tampon de 100
événements **en mémoire**.

**Conséquence** — avec plusieurs répliques de l'application derrière un répartiteur,
une console connectée à la réplique A ne recevrait pas les événements publiés par la
réplique B.

**En place** — la pile Docker fournie déploie **une seule** instance applicative, ce
qui est cohérent. Les flux média, eux, ne passent pas par l'application : une panne de
l'application n'interrompt ni les contributions ni les entrées vMix.

**Ce qui lèverait la limite** — remplacer `publish`/`subscribe` par Redis pub/sub.
Aucun autre fichier n'est concerné : c'est la raison de cette indirection.

---

## L5 — Server-Sent Events plutôt que WebSocket

Écart assumé par rapport au cahier des charges, justifié dans
`02-ARCHITECTURE.md` §5 : trafic quasi-unidirectionnel, pas de serveur Node séparé,
meilleure traversée des proxies, reconnexion native avec `Last-Event-ID`. Le sens
client → serveur passe par des `POST` idempotents, qui sont de toute façon les seuls à
devoir être autorisés et audités.

**Limite pratique** — un navigateur limite le nombre de connexions simultanées par
origine en HTTP/1.1 (6 environ). Derrière Nginx en **HTTP/2**, cette limite ne
s'applique pas ; la configuration fournie active HTTP/2.

---

## L6 — `AddInput Browser|<url>` n'est pas documenté — **non validé**

**Origine** — la référence officielle des fonctions vMix ne liste, pour `AddInput`, que
les types `Video`, `Image`, `Photos`, `Title`, `VideoList`, `Colour`, `AudioFile`,
`Flash`, `PowerPoint`. Le format `Browser|<url>` n'apparaît que dans des messages de
forum, avec des rapports contradictoires.

**En place** — le drapeau `allowAddInput` existe, il est **désactivé par défaut**,
l'interface le marque « non garanti », et l'agent le refuse aussi par défaut. La voie
recommandée et testée est : créer les entrées Web Browser à la main dans vMix, puis les
pointer avec `BrowserNavigate`.

**À valider** sur une installation vMix Windows réelle.

---

## L7 — Permissions micro/caméra dans une entrée Web Browser vMix — **non validé**

**Origine** — la documentation de l'entrée Web Browser confirme WebRTC et la capture de
l'audio de la page, mais **ne dit rien** des autorisations micro et caméra.

**Conséquence sur l'architecture** — nous ne publions **pas** le retour programme
depuis vMix. La page `/return/<session>` s'ouvre dans un vrai Chrome sur le PC de
régie, alimenté par un câble audio virtuel issu du Bus A.

C'est une contrainte, pas un contournement provisoire : tant que ce point n'est pas
vérifié, publier depuis vMix serait une promesse non tenue.

---

## L8 — Pas de sortie NDI ni SRT

Une page WebRTC ne produit ni NDI ni SRT. Obtenir ces protocoles exige un composant
passerelle séparé (abonné au flux, republiant via le SDK NDI ou libsrt/ffmpeg).

**Ce composant n'existe pas dans cette version.** `MediaEndpoint.kind` réserve les
valeurs `NDI` et `SRT`, aucune route ne les sert, et l'interface n'en propose rien.

---

## L9 — Maillage P2P : le point de bascule vers un SFU n'est pas mesuré

Les seuils de `02-ARCHITECTURE.md` §9 (1–4 sans réserve, 5–8 à surveiller, 9–16 à
répartir, au-delà SFU nécessaire) sont des **hypothèses** déduites de la documentation,
pas des mesures.

Point documenté et non négociable : dès qu'un director ou une scene est connecté, la
vue combinée qu'un invité reçoit des autres invités est plafonnée à **500 kbps** par
défaut (`&totalroombitrate`).

**À valider** par un essai de montée en charge avec de vrais correspondants.

---

## L10 — Le profil « Standard 480p » n'a pas de palier `&quality`

**Origine** — les valeurs documentées de `&quality` sont : `0` → 1920×1080,
`1` → 1280×720, `2` → 640×360, `-1` → défaut. **Aucun palier 480p.**

**En place** — le profil STANDARD n'envoie pas `&quality` et utilise
`&width=854&height=480`, qui sont documentés côté source. Vérifié par les tests
unitaires. La résolution réellement obtenue dépend de la caméra et reste **mesurée**
par la régie, jamais supposée.

---

## L11 — L'API IFrame du moteur n'est pas versionnée

Les clés exactes des statistiques renvoyées par `getStats` varient selon la version du
moteur et le navigateur. `normalizeMetrics` tente plusieurs noms connus et renvoie
`null` — affiché « — » — plutôt que `0` quand la donnée est absente.

Une mise à jour du moteur peut donc faire disparaître une mesure de l'affichage.
Elle ne peut pas faire afficher une valeur fausse : c'est le compromis retenu.

---

## L12 — Le talkback dépend d'une bascule côté moteur

`soloChat` est une bascule côté moteur, sans accusé de réception documenté. L'état
autoritatif est donc tenu côté serveur (un seul talkback ouvert par session, quel que
soit le nombre d'opérateurs), et l'interface impose un bouton maintenu enfoncé.

La documentation du moteur signale par ailleurs que « Solo Talk » a des limites avec
Meshcast et les sources embarquées : n'activez pas Meshcast sur une session où le
talkback est requis.

---

## L13 — Rôle « technicien » non affecté nominativement

Un technicien a accès en lecture aux productions et aux sessions de l'instance, sans
affectation nominative à une production. Pour une rédaction unique c'est le
comportement attendu ; pour une installation mutualisée entre plusieurs rédactions, il
faudrait une table d'affectation.

---

## L14 — Dépendances de développement : vulnérabilités résiduelles **(mesurée)**

`npm audit --omit=dev` → **0 vulnérabilité** sur les dépendances d'exécution.

`npm audit` complet → quelques avis **modérés**, tous dans la chaîne d'outillage
ESLint (`minimatch`), absente de l'image de production. Les corriger exigerait de
rétrograder `eslint-config-next`, ce qui réintroduirait une vulnérabilité **haute**
dans Next lui-même. Le choix est documenté plutôt que masqué.

---

## L15 — La purge planifiée dépend d'un service de la pile **(mesurée)**

La purge est désormais exécutable de deux façons : depuis `Admin → Rétention`, et par
le service `scheduler` de la pile Docker, qui appelle la route une fois par jour.

Deux conséquences à connaître :

- **Sans `CRON_SECRET`, la purge automatique n'existe pas.** Le chemin planificateur
  est fermé et le service refuse de démarrer. C'est délibéré — mieux vaut une purge
  manifestement absente qu'une purge qui tourne sans secret. Mais si vous retirez le
  service sans faire de purge manuelle, la base croît indéfiniment.
- **Le journal d'audit n'est jamais purgé par défaut** (`AUDIT_RETENTION_DAYS=0`). Sa
  croissance est visible dans l'écran de rétention ; surveillez-la.

Le script `deploy/scheduler/purge.sh` a été exécuté et vérifié hors Docker : il
atteint la route à l'heure programmée et consigne le résultat. Le service
`scheduler` dans la pile, lui, n'a pas été démarré (voir §L16).

---

## L16 — Docker et Nginx non exécutés **(mesurée : non)**

Le `Dockerfile`, le `docker-compose.yml` et la configuration Nginx sont fournis et
leur syntaxe YAML est validée, mais **ils n'ont pas été construits ni démarrés** :
Docker n'était pas installé sur la machine de développement. La sortie `standalone` de
Next, dont dépend l'image, est elle bien produite et vérifiée.

Traitez le premier `docker compose up --build` comme une étape de recette, pas comme
une formalité. Procédure et vérifications dans `06-DEPLOYMENT.md`.
