# Procédures de dépannage

Organisé par **symptôme observé**, pas par composant : en direct, on part de ce qu'on
voit.

---

## 1. Avant tout : où regarder

| Question | Où |
|---|---|
| L'application est-elle vivante ? | `curl -fsS https://<hôte>/api/health` → `"database":"ok"` |
| Que dit le serveur ? | `docker compose logs --tail=100 app` |
| Que s'est-il passé dans la session ? | panneau **Journal d'événements** de la régie |
| Qui a fait quoi ? | table `AuditLog` (actions réussies **et** refusées) |
| L'agent vMix répond-il ? | `curl -fsS http://<régie>:8099/health` |
| Que relaie l'agent ? | sa sortie standard, un objet JSON par commande |

Les champs sensibles sont masqués dans les journaux : vous n'y trouverez ni mot de
passe, ni jeton, ni secret de salle.

---

## 2. Le correspondant

### Rien ne se passe au clic sur « Autoriser »
Origine non sécurisée. `getUserMedia` exige HTTPS, sauf sur `localhost`.
→ Vérifiez que `APP_URL` est en `https://` et que le certificat est valide.

### « L'accès a été refusé » alors qu'il a accepté
Un refus précédent a été mémorisé par le navigateur.
→ Icône à gauche de l'adresse → autoriser caméra et micro → recharger.
→ iOS : *Réglages → Safari → Caméra / Microphone → Autoriser*.

### « La caméra est déjà utilisée »
Une autre application la tient. Cela arrive aussi si la salle de préparation n'a pas
libéré les pistes — l'application les arrête avant d'entrer en salle, précisément pour
éviter cela.
→ Fermer les autres applications, puis **Réessayer**. Un rechargement complet si besoin.

### Le sélecteur de sortie audio est absent
Comportement **voulu**. Il n'apparaît que si le navigateur implémente `setSinkId`,
absent de Safari. Afficher un sélecteur inopérant serait pire.
→ Choisir la sortie dans les réglages du système.

### Le VU-mètre ne bouge pas
Dans l'ordre : mauvais micro sélectionné · interrupteur du casque · micro coupé au
niveau du système · `AudioContext` indisponible (le VU-mètre affiche alors « non
mesuré », ce qui n'empêche pas d'émettre).

### Test de connexion rouge
Le réseau bloque le temps réel (hôtel, salle de presse, entreprise).
→ Partage de connexion mobile. C'est le contournement qui fonctionne.
→ À terme, un serveur TURN lèverait la plupart de ces cas ; `STUN_URLS` ne couvre que
le test de diagnostic, pas le relais média.

### Test orange « aucun serveur STUN configuré »
`STUN_URLS` est vide : le test ne constate que les routes locales et le dit.
→ Renseignez `STUN_URLS` pour un diagnostic complet.

### Il est connecté mais la régie ne le voit pas
1. Canal régie « en attente » ? → rechargez la console.
2. Correspondant arrivé **avant** l'ouverture de la console ? → le canal de supervision
   ne reçoit l'événement d'arrivée qu'une fois connecté. Faites-lui recharger sa page.
3. Vérifiez que son `streamId` sur sa carte correspond bien à celui attendu.

---

## 3. L'intégration vMix

### L'entrée Web Browser reste noire
| Cause | Vérification |
|---|---|
| Le correspondant n'est pas connecté | sa carte en régie affiche-t-elle « Connecté » ? |
| Mauvaise URL | elle doit finir par `/output/<clé>`, pas par l'URL du moteur |
| Session terminée ou accès révoqué | la page afficherait alors une **mire nommée** — s'il n'y a pas de mire, l'URL n'est pas la bonne |
| Taille d'entrée incohérente | réglez **1280×720** pour le profil Broadcast |
| vMix n'atteint pas l'application | ouvrez l'URL dans un navigateur du PC de régie |

Clic droit sur l'entrée → *Reload* force un rechargement.

### Mire « Lien de sortie inconnu »
La clé n'existe pas : l'URL est tronquée, ou le correspondant a été supprimé.
→ Recopiez le lien depuis la carte du correspondant.

### Mire « Session terminée » / « Accès révoqué »
Comportement attendu, et volontairement visible dans la vignette vMix : vous voyez
immédiatement pourquoi il n'y a pas d'image.

### Image mais pas de son dans vMix
1. L'entrée est-elle **activée** dans le mélangeur vMix (pas en `AudioOff`) ?
2. Est-elle routée sur le bus **M** (`AudioBusOn M`) ?
3. Le micro du correspondant est-il coupé ? Sa carte l'indique.
4. Le VU-mètre de sa carte bouge-t-il ? S'il bouge, le son arrive bien à la régie et le
   problème est dans le routage vMix.

### « vMix est injoignable »
Message volontairement précis. Dans l'ordre :

```bash
curl -fsS http://127.0.0.1:8088/api/
```

Si cela échoue sur le PC de régie, l'API vMix n'est pas activée : *Settings → Web*.

```bash
curl -fsS http://<régie>:8099/health
```

Si cela échoue, l'agent n'est pas démarré, ou le pare-feu Windows le bloque.

```bash
curl -s -H "X-SNRC-Agent-Token: <secret>" http://<régie>:8099/vmix | head -5
```

Un `<vmix>` attendu. Un 401 signifie que les secrets diffèrent entre l'agent
(`SNRC_AGENT_TOKEN`) et l'application (`VMIX_AGENT_TOKEN`).

### « n'est pas une adresse de réseau local »
Refus **délibéré**. L'API vMix ne documente aucune authentification : la joindre en
direct à travers Internet exposerait l'antenne.
→ Utilisez le mode **AGENT**.

### « L'entrée est de type X, pas Web Browser »
Vous avez associé le correspondant à une entrée caméra, couleur ou titre.
→ Créez une entrée Web Browser dans vMix, puis **Entrées** pour recharger la liste.
La création par l'API n'est pas documentée, donc pas proposée.

### Une commande vMix semble perdue
Limite rapportée : plusieurs commandes rapprochées vers la même entrée navigateur
peuvent être perdues. L'application les espace de 750 ms.
→ Si cela se reproduit, augmentez `MIN_GAP_MS` dans `src/lib/vmix/client.ts` et
signalez-le : c'est un point à mesurer sur votre installation (`10-TEST-REPORT.md` V6).

---

## 4. Le son

### Un correspondant s'entend lui-même
C'est la panne la plus fréquente, et elle a presque toujours la même cause.

1. **Son entrée est-elle sortie du bus de retour ?** `AudioBusOff A` sur son entrée.
   C'est l'opération qui constitue le mix-minus — sans elle, rien ne fonctionne.
2. **A-t-il un casque ?** Sans casque, l'écho vient de chez lui, pas du montage.
3. **Double chemin audio ?** S'il reçoit à la fois l'audio de salle du moteur **et** un
   bus de retour vMix, sa voix peut revenir par l'un des deux. N'activez qu'un chemin.

Le test décisif : faites-lui écouter **son seul retour**, régie muette. S'il s'entend,
le problème est dans le routage des bus. S'il ne s'entend pas, c'est son casque.

### Larsen général
Un correspondant sans casque, ou un retour renvoyé au Master.
→ L'application refuse `BusXSendToMaster`, et l'agent aussi. Si la boucle existe, elle
a été créée **à la main dans vMix**. Vérifiez chaque bus de retour.

### La régie s'entend dans le programme
Le micro de talkback est routé vers le bus M.
→ L'application ne route jamais un micro de talkback vers un bus vMix. Cette liaison a
été faite manuellement : retirez-la.

### Le retour programme ne fonctionne plus
L'onglet Chrome de `/return/<session>` a été fermé ou mis en veille.
→ Rouvrez-le. Gardez-le au premier plan, ou désactivez la mise en veille des onglets
inactifs sur cette machine.
→ Vérifiez aussi que le câble audio virtuel est toujours sélectionné comme micro :
Windows change parfois de périphérique par défaut après un branchement USB.

---

## 5. L'application

### 401 immédiat après connexion
Le compte a changé de mot de passe, de rôle ou a été désactivé : `tokenEpoch` a été
incrémenté, ce qui invalide instantanément les sessions existantes. C'est voulu.
→ Reconnectez-vous.

### « Compte temporairement verrouillé »
8 échecs consécutifs → 15 minutes de verrouillage.
→ Attendez, ou faites réinitialiser le mot de passe par un administrateur.

### 429 « Trop de tentatives »
Limitation de débit. Elle est persistée en base, donc un redémarrage ne la remet pas à
zéro.
→ Attendez la durée indiquée. En développement : `TRUNCATE "RateLimit";`.

### Le badge « Supervision » reste rouge
Le flux SSE ne passe pas. Presque toujours un intermédiaire qui met en tampon.
→ Vérifiez `proxy_buffering off` et `gzip off` sur le bloc `/api/sessions/*/stream`
(la configuration fournie les pose).
→ Un proxy d'entreprise entre le navigateur et le serveur peut aussi tamponner.
→ Les flux média ne sont **pas** affectés : l'antenne continue.

### « Une erreur interne est survenue »
Message générique volontaire : le détail reste côté serveur.

```bash
docker compose logs --tail=200 app | grep route.unhandled
```

### Le conteneur ne démarre pas
Les migrations échouent avant le serveur. Le message le dit.
→ Vérifiez `DATABASE_URL` et que `db` est sain : `docker compose ps`.

### « En production, APP_URL doit être en HTTPS »
Refus de démarrage délibéré. Un `APP_URL` en clair produirait des liens d'invitation
non chiffrés et des cookies non sécurisés.
→ Corrigez `APP_URL`. En local, utilisez `npm run dev`.

### « AUTH_SECRET est resté à sa valeur d'exemple »
Refus de démarrage.
→ `openssl rand -base64 48`, deux valeurs **différentes** pour `AUTH_SECRET` et
`MEDIA_SECRET`.

---

## 6. Collecter un rapport d'incident

Après un incident en direct, rassemblez :

```bash
cd /opt/snrc/deploy && docker compose logs --since 2h app > /tmp/snrc-app.log
```

```sql
SELECT "createdAt", type, message, "participantId" FROM "ConnectionEvent"
WHERE "sessionId" = '<id>' ORDER BY "createdAt";
```

```sql
SELECT "createdAt", action, outcome, "actorLabel", target FROM "AuditLog"
WHERE "createdAt" > now() - interval '2 hours' ORDER BY "createdAt";
```

Plus : la sortie de l'agent vMix, les captures d'écran des cartes de correspondants
(les mesures y figurent), et ce que les correspondants ont **entendu**. Ce dernier point
n'est dans aucun journal et c'est souvent le plus décisif.
