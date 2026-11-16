# Installation et déploiement

Deux chemins : **local** pour développer et recetter, **Ubuntu 24.04 + Docker** pour la
production.

> Les fichiers Docker et Nginx sont fournis et leur syntaxe est validée, mais ils
> **n'ont pas été construits ni démarrés** (Docker absent de la machine de
> développement). Traitez le premier `docker compose up --build` comme une étape de
> recette. Voir `11-KNOWN-LIMITS.md` §L16.

---

## 1. Installation locale

### Prérequis
- Node **20.11+** (testé sur 22.19)
- PostgreSQL **16+**

### Étapes

```bash
npm ci
```

```bash
cp .env.example .env
```

Générez les deux secrets et reportez-les dans `.env` :

```bash
openssl rand -base64 48
```

Créez la base et son rôle :

```bash
createuser snrc --createdb --pwprompt && createdb -O snrc snrc
```

Renseignez `DATABASE_URL` puis appliquez les migrations :

```bash
npm run db:migrate
```

Créez le compte administrateur. Le mot de passe vient de l'environnement : le script
**refuse** de s'exécuter sans lui, pour qu'aucun compte ne naisse avec un mot de passe
connu d'avance.

```bash
SEED_ADMIN_EMAIL="vous@exemple.org" SEED_ADMIN_PASSWORD="<au moins 12 caractères>" npm run db:seed
```

Vérifiez l'ensemble, puis démarrez :

```bash
npm run verify
```

```bash
npm run dev
```

L'application écoute sur `http://localhost:3000`.

> **En local, restez en mode développement.** `npm start` impose
> `NODE_ENV=production`, où l'application **refuse** un `APP_URL` en clair et pose des
> cookies `Secure` qu'un navigateur n'enverra pas sur `http://`. C'est voulu : HTTPS
> est obligatoire en production, et `getUserMedia` ne fonctionne de toute façon pas sur
> une origine non sécurisée (sauf `localhost`).

---

## 2. Production — Ubuntu 24.04

### 2.1 Préparation de la machine

```bash
sudo apt update && sudo apt install -y ca-certificates curl git
```

```bash
curl -fsSL https://get.docker.com | sudo sh
```

```bash
sudo usermod -aG docker "$USER" && newgrp docker
```

### 2.2 Récupération et configuration

```bash
git clone <votre-dépôt> /opt/snrc && cd /opt/snrc/deploy
```

```bash
cp .env.deploy.example .env && chmod 600 .env
```

Générez les secrets — **trois valeurs différentes** :

```bash
printf 'POSTGRES_PASSWORD=%s\nAUTH_SECRET=%s\nMEDIA_SECRET=%s\n' "$(openssl rand -base64 32)" "$(openssl rand -base64 48)" "$(openssl rand -base64 48)"
```

Renseignez aussi `SERVER_NAME` et `APP_URL` (**en `https://`**).

### 2.3 Certificat TLS

Premier certificat, avant que Nginx n'occupe le port 80 :

```bash
sudo docker run --rm -p 80:80 -v /opt/snrc/deploy/certs:/etc/letsencrypt certbot/certbot certonly --standalone -d remote.exemple.org --agree-tos --no-eff-email -m vous@exemple.org
```

Nginx attend `deploy/certs/fullchain.pem` et `deploy/certs/privkey.pem` :

```bash
sudo cp /opt/snrc/deploy/certs/live/remote.exemple.org/{fullchain.pem,privkey.pem} /opt/snrc/deploy/certs/
```

Renouvellement, à poser dans la crontab de `root` :

```bash
0 3 * * 1 cd /opt/snrc/deploy && docker compose run --rm --entrypoint certbot nginx renew --webroot -w /var/www/certbot && docker compose restart nginx
```

### 2.4 Démarrage

```bash
cd /opt/snrc/deploy && docker compose up -d --build
```

Les migrations sont appliquées par le point d'entrée du conteneur **avant** que le
serveur ne démarre : un schéma périmé empêche le démarrage plutôt que de provoquer des
erreurs diffuses en pleine émission.

Vérifications immédiates :

```bash
docker compose ps && docker compose logs --tail=50 app
```

```bash
curl -fsS https://remote.exemple.org/api/health
```

La réponse attendue contient `"database":"ok"`. Cette sonde interroge réellement
PostgreSQL : un `ok` signifie que la base répond.

### 2.5 Compte administrateur initial

```bash
cd /opt/snrc/deploy && docker compose exec -e SEED_ADMIN_EMAIL=vous@exemple.org -e SEED_ADMIN_PASSWORD='<secret>' app npx prisma db seed
```

Si le script de seed n'est pas disponible dans l'image, créez le compte depuis une
machine ayant accès à la base, ou ajoutez temporairement `prisma/seed.ts` au conteneur.
Connectez-vous ensuite, **changez immédiatement ce mot de passe** depuis
`Mon compte` (en haut à droite), puis videz `SEED_ADMIN_PASSWORD` : la variable ne
sert qu'au script de création et une valeur périmée qui traîne finit par induire en
erreur. Créez enfin les comptes réalisateur et technicien depuis `Admin → Utilisateurs`.

> « Mon compte » est accessible à **tous les rôles**, y compris un technicien qui n'a
> aucun écran d'administration. Le mot de passe actuel y est exigé, et le changement
> déconnecte toutes les autres sessions du compte.

### 2.6 Ce que la pile expose

| Service | Port sur l'hôte | Remarque |
|---|---|---|
| `nginx` | 80, 443 | seul point d'entrée |
| `app` | **aucun** | joignable uniquement par le réseau interne |
| `db` | **aucun** | PostgreSQL n'est pas joignable depuis l'hôte |
| `backup` | **aucun** | `pg_dump` quotidien, conservé 14 jours |

L'absence de `ports:` sur `db` et `app` est volontaire.

---

## 3. Agent vMix sur le PC de régie

Voir `packages/vmix-agent/README.md`. En résumé :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

La même valeur va dans `SNRC_AGENT_TOKEN` (agent) et `VMIX_AGENT_TOKEN` (application).

L'agent **refuse de démarrer** si le secret fait moins de 24 caractères, ou s'il doit
écouter hors de la boucle locale sans TLS.

---

## 4. Sauvegarde et restauration

Les sauvegardes arrivent dans `deploy/backup/`, une par jour, conservées 14 jours.

Restauration :

```bash
cd /opt/snrc/deploy && gunzip -c backup/snrc-AAAAMMJJ-HHMMSS.sql.gz | docker compose exec -T db psql -U snrc -d snrc
```

**Vérifiez la restauration avant d'en avoir besoin.** Une sauvegarde jamais restaurée
n'est pas une sauvegarde. Cette vérification n'a pas été faite ici
(`11-KNOWN-LIMITS.md` §L16).

Aucun média n'est stocké : une restauration rétablit les productions, sessions,
correspondants, mappings vMix et journaux, rien d'autre.

---

## 5. Rétention des données

| Donnée | Conservation | Réglage |
|---|---|---|
| Médias audio/vidéo | **jamais stockés** | — |
| Session terminée : correspondants, invitations, événements, mappings vMix | `RETENTION_DAYS` jours après la fin | défaut **30** |
| Journal d'audit | **jamais purgé** par défaut | `AUDIT_RETENTION_DAYS`, défaut **0 = jamais** |
| Compteurs de limitation de débit | dès l'expiration de leur fenêtre | — |
| Événements d'une session **encore ouverte** | au-delà de `RETENTION_DAYS` | défaut 30 |

`AUDIT_RETENTION_DAYS=0` est volontaire : le journal d'audit est la trace de qui a
fait quoi. Le purger doit être une décision explicite, pas l'effet de bord d'une
tâche de ménage. Mais il croît indéfiniment : surveillez sa taille depuis
`Admin → Rétention`, et posez une fenêtre quand votre politique le permet.

### 5.1 Écran d'administration

`Admin → Rétention` (administrateurs uniquement) affiche :

- ce qui sera supprimé **maintenant**, et la date de la prochaine purge ;
- les sessions terminées **sans date de purge**, que la purge répare ;
- la taille du journal d'audit ;
- les **signalements** : sessions restées « en direct » plus de 24 h (un
  « Terminer » oublié) et sessions préparées puis jamais démarrées. Elles ne sont
  **jamais supprimées automatiquement** ;
- les dix dernières exécutions, lues dans le journal d'audit.

Le bouton **Lancer la purge** déclenche une exécution immédiate, après une
confirmation qui énumère ce qui disparaîtra.

### 5.2 Purge planifiée

Le service `scheduler` de la pile Docker appelle la route de rétention une fois par
jour, par le réseau interne. Il exige `CRON_SECRET` :

```bash
openssl rand -base64 32
```

Reportez la valeur dans `deploy/.env` (`CRON_SECRET`), et réglez l'heure avec
`PURGE_AT` (HH:MM **UTC**, défaut `04:17`).

Le service **refuse de démarrer** sans secret, plutôt que de tourner en silence sans
rien purger. Le secret voyage dans l'en-tête `X-SNRC-Cron-Token`, jamais dans l'URL,
qui finirait dans les journaux d'accès de Nginx.

```bash
cd /opt/snrc/deploy && docker compose logs --tail=20 scheduler
```

Chaque passage écrit une ligne `[purge] … ok {…}` et une entrée dans le journal
d'audit (`action = retention.run`, `actorKind = system`). Un passage qui ne supprime
rien est journalisé aussi : savoir que la tâche tourne vaut autant que savoir ce
qu'elle a fait.

Si vous préférez votre propre planificateur :

```bash
curl -fsS -X POST -H "X-SNRC-Cron-Token: $CRON_SECRET" https://remote.exemple.org/api/admin/retention
```

Sans `CRON_SECRET`, ce chemin est **fermé** : seule une session administrateur peut
lancer la purge. Retirez alors le service `scheduler` du `docker-compose.yml`.

---

## 6. Supervision

- `GET /api/health` → état et latence de la base. Branchez-le à votre supervision.
- Journaux applicatifs : JSON sur la sortie standard, champs sensibles **masqués**
  (`password`, `token`, `secret`, `authorization`, `cookie`), rotation Docker à
  20 Mo × 5.
- Journal d'audit en base : actions réussies **et refusées**.

```bash
docker compose logs -f app | grep -E '"level":"(warn|error)"'
```

---

## 7. Mise à jour

```bash
cd /opt/snrc && git pull && cd deploy && docker compose up -d --build
```

Les migrations s'appliquent au démarrage. **Ne mettez jamais à jour pendant une
émission** : le redémarrage coupe les flux SSE et la console de régie, même si les
contributions et les entrées vMix, qui ne passent pas par l'application, survivent.
