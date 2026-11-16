#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Broadcast SN Remote Call — tests de la rétention des données
#
# Exerce la politique de conservation sur l'application réellement démarrée :
# autorisations, purge en cascade, réparation des dates manquantes, protection
# du journal d'audit, signalements, et le planificateur lui-même.
#
# Le script manipule directement `purgeAfter` en base pour simuler le passage du
# temps : attendre 30 jours n'est pas une option.
#
# Prérequis : `npm run dev` démarré, base migrée et peuplée, CRON_SECRET présent
# dans .env **avant** le démarrage du serveur (la configuration est mise en cache).
#
# Usage : bash tests/e2e-retention.sh
# ──────────────────────────────────────────────────────────────────────────────
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
B=${APP_URL_TEST:-http://localhost:3000}
D=$(mktemp -d)
J=$D/admin.txt
JD=$D/director.txt
PGDATABASE=${PGDATABASE:-snrc}
export PGDATABASE

PW=${SEED_ADMIN_PASSWORD:-}
ADMIN_EMAIL=${SEED_ADMIN_EMAIL:-}
CRON_SECRET=${CRON_SECRET:-}
if [ -f "$ROOT/.env" ]; then
  [ -z "$PW" ] && PW=$(grep -E '^SEED_ADMIN_PASSWORD=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"')
  [ -z "$ADMIN_EMAIL" ] && ADMIN_EMAIL=$(grep -E '^SEED_ADMIN_EMAIL=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"')
  [ -z "$CRON_SECRET" ] && CRON_SECRET=$(grep -E '^CRON_SECRET=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"')
fi
if [ -z "$PW" ] || [ -z "$CRON_SECRET" ]; then
  echo "SEED_ADMIN_PASSWORD et CRON_SECRET sont requis (.env ou environnement)." >&2
  exit 2
fi

pass=0; fail=0
chk() {
  if [ "$2" = "$3" ]; then printf '  OK   %s\n' "$1"; pass=$((pass+1));
  else printf '  FAIL %s (attendu "%s", obtenu "%s")\n' "$1" "$2" "$3"; fail=$((fail+1)); fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
body() { printf '%s' "$1" > "$D/body.json"; printf '%s' "@$D/body.json"; }
j() { python3 -c 'import json,sys
try: d=json.load(sys.stdin)
except Exception: print(""); raise SystemExit
for part in sys.argv[1].split("."):
    d = d.get(part) if isinstance(d,dict) else None
    if d is None: break
print("" if d is None else d)' "$1"; }
q() { psql -tAc "$1" | tr -d ' '; }

trap 'rm -rf "$D"' EXIT

psql -qc 'TRUNCATE "RateLimit"' >/dev/null 2>&1

echo "── 1. Préparation"
LOGIN_BODY=$(python3 -c 'import json,sys;print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$ADMIN_EMAIL" "$PW")
chk "connexion administrateur" "ADMIN" "$(curl -s -c "$J" -X POST -H 'Content-Type: application/json' --data-binary "$(body "$LOGIN_BODY")" $B/api/auth/login | j user.role)"

# Un compte réalisateur, pour vérifier que la rétention lui est fermée.
DIR_EMAIL="retention-test-$$@exemple.org"
DIR_PW="motdepasse-retention-$$"
DIR_BODY=$(python3 -c 'import json,sys;print(json.dumps({"email":sys.argv[1],"displayName":"Test Retention","role":"DIRECTOR","password":sys.argv[2]}))' "$DIR_EMAIL" "$DIR_PW")
curl -s -b "$J" -X POST -H 'Content-Type: application/json' --data-binary "$(body "$DIR_BODY")" $B/api/users >/dev/null
DIR_LOGIN=$(python3 -c 'import json,sys;print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$DIR_EMAIL" "$DIR_PW")
chk "connexion realisateur" "DIRECTOR" "$(curl -s -c "$JD" -X POST -H 'Content-Type: application/json' --data-binary "$(body "$DIR_LOGIN")" $B/api/auth/login | j user.role)"

echo "── 2. Autorisations"
chk "etat refuse a un anonyme"            401 "$(code $B/api/admin/retention)"
chk "etat refuse a un realisateur"        403 "$(code -b "$JD" $B/api/admin/retention)"
chk "etat autorise a un administrateur"   200 "$(code -b "$J" $B/api/admin/retention)"
chk "purge refusee a un anonyme"          401 "$(code -X POST $B/api/admin/retention)"
chk "purge refusee a un realisateur"      403 "$(code -b "$JD" -X POST $B/api/admin/retention)"
chk "purge refusee avec un faux secret"   401 "$(code -X POST -H 'X-SNRC-Cron-Token: faux-secret-de-planificateur' $B/api/admin/retention)"
chk "le refus de secret est journalise"   ok  "$(q "SELECT count(*) FROM \"AuditLog\" WHERE action='retention.run' AND outcome='denied'" | python3 -c "import sys;print('ok' if int(sys.stdin.read())>0 else 'aucun')")"
chk "le secret n'apparait pas dans le journal" ok "$(q "SELECT count(*) FROM \"AuditLog\" WHERE detail::text LIKE '%faux-secret-de-planificateur%'" | sed 's/^0$/ok/')"

echo "── 2b. Refus propres au niveau des pages"
# Une page n'est pas une route d'API : un refus doit renvoyer l'utilisateur là où
# il a le droit d'être, pas lui servir une erreur 500 brute.
redir() { curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -b "$1" "$B$2"; }
chk "page Retention : realisateur renvoye" "307 $B/productions?refuse=retention.read" "$(redir "$JD" /admin/retention)"
chk "page Utilisateurs : realisateur renvoye" "307 $B/productions?refuse=user.read" "$(redir "$JD" /admin/users)"
chk "page Retention : administrateur admis" "200 " "$(redir "$J" /admin/retention)"
chk "le motif du refus est affiche" ok "$(curl -s -b "$JD" "$B/productions?refuse=retention.read" | grep -q 'administrateurs' && echo ok || echo absent)"
chk "page Retention : anonyme renvoye vers la connexion" "307 $B/login" "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$B/admin/retention")"
chk "session inexistante et session interdite : meme reponse" ok "$(python3 -c "
import sys
print('ok' if sys.argv[1] == sys.argv[2] else f'{sys.argv[1]} != {sys.argv[2]}')" "$(redir "$JD" /control/inexistant-00000)" "$(redir "$JD" /control/cm00000000000000000000000)")"

echo "── 2c. Changement de son propre mot de passe"
# Tout le monde doit pouvoir changer son mot de passe, y compris un rôle sans
# aucun écran d'administration. Et le mot de passe ACTUEL doit être exigé :
# sinon un poste laissé ouvert permet de verrouiller son titulaire dehors.
DIR_ID=$(curl -s -b "$JD" $B/api/auth/me | j user.id)
PW_NEW="motdepasse-change-$$"
pwbody() { python3 -c 'import json,sys;print(json.dumps({"currentPassword":sys.argv[1],"newPassword":sys.argv[2]}))' "$1" "$2"; }

chk "page Mon compte accessible a un realisateur" 200 "$(code -b "$JD" $B/account)"
chk "page Mon compte refusee a un anonyme" 307 "$(code $B/account)"
chk "mot de passe actuel errone -> refus" "bad_current_password" "$(curl -s -b "$JD" -X POST -H 'Content-Type: application/json' --data-binary "$(body "$(pwbody 'pas-le-bon-mot-de-passe' "$PW_NEW")")" $B/api/account/password | j error.code)"
chk "nouveau mot de passe trop court -> refus" 400 "$(code -b "$JD" -X POST -H 'Content-Type: application/json' --data-binary "$(body "$(pwbody "$DIR_PW" 'court')")" $B/api/account/password)"
chk "nouveau identique a l'actuel -> refus" "unchanged_password" "$(curl -s -b "$JD" -X POST -H 'Content-Type: application/json' --data-binary "$(body "$(pwbody "$DIR_PW" "$DIR_PW")")" $B/api/account/password | j error.code)"
chk "changer son mot de passe par la route Utilisateurs est refuse" "use_account_route" "$(curl -s -b "$J" -X PATCH -H 'Content-Type: application/json' --data-binary "$(body "$(python3 -c 'import json;print(json.dumps({"password":"peu-importe-la-valeur"}))')")" $B/api/users/$(curl -s -b "$J" $B/api/auth/me | j user.id) | j error.code)"

# `-c` en plus de `-b` : le changement renvoie un cookie de session rafraîchi,
# qu'un navigateur enregistre automatiquement. Sans `-c`, le bocal garderait
# l'ancien jeton et la session paraîtrait fermée à tort.
chk "changement accepte avec le bon mot de passe actuel" 200 "$(code -b "$JD" -c "$JD" -X POST -H 'Content-Type: application/json' --data-binary "$(body "$(pwbody "$DIR_PW" "$PW_NEW")")" $B/api/account/password)"
chk "l'ancien mot de passe ne fonctionne plus" 401 "$(code -X POST -H 'Content-Type: application/json' --data-binary "$(body "$(python3 -c 'import json,sys;print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$DIR_EMAIL" "$DIR_PW")")" $B/api/auth/login)"
chk "le nouveau fonctionne" 200 "$(code -X POST -H 'Content-Type: application/json' --data-binary "$(body "$(python3 -c 'import json,sys;print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$DIR_EMAIL" "$PW_NEW")")" $B/api/auth/login)"
chk "la session de l'auteur reste ouverte (cookie rafraichi)" 200 "$(code -b "$JD" $B/account)"
chk "le cookie rafraichi porte le nouvel epoch" ok "$(python3 -c "
import base64, json, sys
tok = sys.argv[1].split('.')[1]
tok += '=' * (-len(tok) % 4)
epoch = json.loads(base64.urlsafe_b64decode(tok))['epoch']
print('ok' if epoch == int(sys.argv[2]) else f'cookie={epoch} base={sys.argv[2]}')" \
  "$(grep snrc_session "$JD" | awk '{print $7}')" \
  "$(q "SELECT \"tokenEpoch\" FROM \"User\" WHERE email='$DIR_EMAIL'")")"
chk "le changement est journalise" ok "$(q "SELECT count(*) FROM \"AuditLog\" WHERE action='account.password.change' AND outcome='ok'" | python3 -c "import sys;print('ok' if int(sys.stdin.read())>0 else 'aucun')")"
chk "le refus est journalise aussi" ok "$(q "SELECT count(*) FROM \"AuditLog\" WHERE action='account.password.change' AND outcome='denied'" | python3 -c "import sys;print('ok' if int(sys.stdin.read())>0 else 'aucun')")"
chk "aucun mot de passe en clair dans le journal" ok "$(q "SELECT count(*) FROM \"AuditLog\" WHERE detail::text LIKE '%$PW_NEW%' OR detail::text LIKE '%$DIR_PW%'" | sed 's/^0$/ok/')"
# Le reste de la campagne réutilise ce cookie : il est toujours valide.
DIR_PW=$PW_NEW

echo "── 3. Politique annoncée"
STATUS=$(curl -s -b "$J" $B/api/admin/retention)
RET_DAYS=$(printf '%s' "$STATUS" | j status.policy.sessionDays)
chk "duree de conservation lue" ok "$(python3 -c "
import sys
v=sys.argv[1]
print('ok' if v.isdigit() and 1 <= int(v) <= 3650 else v)" "$RET_DAYS")"
# La fenêtre d'audit dépend du déploiement : on vérifie sa cohérence, pas une
# valeur fixe. Que le DÉFAUT soit « jamais » est couvert par le test unitaire
# `resolvePolicy(30, 0).auditDays === null`.
AUDIT_DAYS_ANNOUNCED=$(printf '%s' "$STATUS" | j status.policy.auditDays)
chk "fenetre d'audit coherente" ok "$(python3 -c "
import sys
v = sys.argv[1]
if v == '': print('ok')          # aucune fenetre : jamais purge
elif v.isdigit() and 1 <= int(v) <= 3650: print('ok')
else: print(v)" "$AUDIT_DAYS_ANNOUNCED")"
printf '     politique en vigueur : sessions %s jours, audit %s\n' \
  "$RET_DAYS" "$([ -z "$AUDIT_DAYS_ANNOUNCED" ] && echo 'jamais purge' || echo "$AUDIT_DAYS_ANNOUNCED jours")"

echo "── 4. Jeu d'essai"
PROD_ID=$(curl -s -b "$J" -X POST -H 'Content-Type: application/json' --data-binary '{"name":"Retention"}' $B/api/productions | j production.id)

# Trois sessions : une due, une en attente, une terminée sans date de purge.
#
# Les corps JSON sont assemblés dans une variable AVANT l'appel. Écrire
# `--data-binary "$(body "{\"a\":\"$x\"}")"` ne marche pas : le `$()` imbriqué
# dans des guillemets est réanalysé, le shell découpe le JSON sur les virgules
# et `body` est appelé plusieurs fois avec des fragments. Le défaut est
# silencieux — curl reçoit un argument surnuméraire et émet deux requêtes.
make_session() {
  local name=$1
  local payload sid pid

  payload=$(printf '{"name":"%s"}' "$name")
  sid=$(curl -s -b "$J" -X POST -H 'Content-Type: application/json' \
    --data-binary "$(body "$payload")" $B/api/productions/$PROD_ID/sessions | j session.id)
  [ -n "$sid" ] || { echo "  make_session: creation de session echouee" >&2; return 1; }

  payload=$(printf '{"displayName":"Correspondant %s"}' "$name")
  pid=$(curl -s -b "$J" -X POST -H 'Content-Type: application/json' \
    --data-binary "$(body "$payload")" $B/api/sessions/$sid/participants | j participant.id)
  [ -n "$pid" ] || { echo "  make_session: creation de correspondant echouee" >&2; return 1; }

  payload=$(printf '{"participantId":"%s","ttlMinutes":60}' "$pid")
  local status
  status=$(code -b "$J" -X POST -H 'Content-Type: application/json' \
    --data-binary "$(body "$payload")" $B/api/sessions/$sid/invitations)
  [ "$status" = "201" ] || echo "  make_session: invitation HTTP $status" >&2

  # Un passage à l'antenne, pour que la session porte un vrai événement de
  # connexion : sans cela la vérification de cascade ne prouverait rien.
  payload='{"onAir":true}'
  code -b "$J" -X PATCH -H 'Content-Type: application/json' \
    --data-binary "$(body "$payload")" $B/api/participants/$pid >/dev/null

  curl -s -o /dev/null -b "$J" -X POST -H 'Content-Type: application/json' \
    --data-binary '{"action":"end"}' $B/api/sessions/$sid/state
  printf '%s' "$sid"
}

SID_DUE=$(make_session "Due")
SID_PENDING=$(make_session "Attente")
SID_ORPHAN=$(make_session "SansDate")

# Simulation du temps : la session « Due » a dépassé sa date de purge.
psql -qc "UPDATE \"Session\" SET \"purgeAfter\" = now() - interval '1 day' WHERE id = '$SID_DUE'" >/dev/null
# La session « SansDate » imite une session terminée avant la mise en place de
# la politique : état ENDED, aucune date de purge.
psql -qc "UPDATE \"Session\" SET \"purgeAfter\" = NULL, \"endedAt\" = now() - interval '2 days' WHERE id = '$SID_ORPHAN'" >/dev/null

chk "la session due a bien 1 correspondant" "1" "$(q "SELECT count(*) FROM \"Participant\" WHERE \"sessionId\"='$SID_DUE'")"
chk "la session due a bien 1 invitation"    "1" "$(q "SELECT count(*) FROM \"Invitation\" WHERE \"sessionId\"='$SID_DUE'")"
chk "la session due a des evenements"       ok  "$(q "SELECT count(*) FROM \"ConnectionEvent\" WHERE \"sessionId\"='$SID_DUE'" | python3 -c "import sys;print('ok' if int(sys.stdin.read())>0 else 'aucun')")"

# Une session restée « en direct » depuis longtemps : doit être signalée, pas supprimée.
SID_LIVE=$(curl -s -b "$J" -X POST -H 'Content-Type: application/json' --data-binary '{"name":"Oubliee en direct"}' $B/api/productions/$PROD_ID/sessions | j session.id)
curl -s -b "$J" -X POST -H 'Content-Type: application/json' --data-binary '{"action":"start"}' $B/api/sessions/$SID_LIVE/state >/dev/null
psql -qc "UPDATE \"Session\" SET \"startedAt\" = now() - interval '3 days' WHERE id = '$SID_LIVE'" >/dev/null

# Une ligne d'audit très ancienne : ne doit PAS être supprimée (fenêtre absente).
psql -qc "INSERT INTO \"AuditLog\" (id, \"actorKind\", action, outcome, \"createdAt\") VALUES ('retention-test-old-$$', 'system', 'test.ancien', 'ok', now() - interval '5 years')" >/dev/null
# Un compteur de limitation expiré : doit être purgé.
psql -qc "INSERT INTO \"RateLimit\" (key, count, \"windowEnd\") VALUES ('retention-test-$$', 9, now() - interval '1 hour')" >/dev/null

STATUS=$(curl -s -b "$J" $B/api/admin/retention)
chk "la session due est comptee"            ok "$(printf '%s' "$STATUS" | j status.sessionsDue | python3 -c "import sys;print('ok' if int(sys.stdin.read() or 0)>=1 else 'non comptee')")"
chk "la session en attente est comptee"     ok "$(printf '%s' "$STATUS" | j status.sessionsPending | python3 -c "import sys;print('ok' if int(sys.stdin.read() or 0)>=1 else 'non comptee')")"
chk "la session sans date est comptee"      ok "$(printf '%s' "$STATUS" | j status.sessionsMissingPurgeDate | python3 -c "import sys;print('ok' if int(sys.stdin.read() or 0)>=1 else 'non comptee')")"
chk "la session en direct oubliee est signalee" ok "$(printf '%s' "$STATUS" | j status.staleLiveSessions | python3 -c "import sys;print('ok' if int(sys.stdin.read() or 0)>=1 else 'non signalee')")"
chk "le compteur de limitation expire est compte" ok "$(printf '%s' "$STATUS" | j status.expiredRateLimits | python3 -c "import sys;print('ok' if int(sys.stdin.read() or 0)>=1 else 'non compte')")"

echo "── 5. Purge par l'administrateur"
RUN=$(curl -s -w '\n%{http_code}' -b "$J" -X POST $B/api/admin/retention)
chk "purge acceptee" 200 "$(printf '%s' "$RUN" | tail -1)"
REPORT=$(printf '%s' "$RUN" | head -1)
chk "au moins une session supprimee" ok "$(printf '%s' "$REPORT" | j report.deletedSessions | python3 -c "import sys;print('ok' if int(sys.stdin.read() or 0)>=1 else 'aucune')")"
chk "au moins une date reparee"      ok "$(printf '%s' "$REPORT" | j report.repairedPurgeDates | python3 -c "import sys;print('ok' if int(sys.stdin.read() or 0)>=1 else 'aucune')")"
chk "le compteur de limitation est purge" ok "$(printf '%s' "$REPORT" | j report.deletedRateLimits | python3 -c "import sys;print('ok' if int(sys.stdin.read() or 0)>=1 else 'aucun')")"
if [ -z "$(printf '%s' "$STATUS" | j status.policy.auditDays)" ]; then
  chk "aucune ligne d'audit supprimee (aucune fenetre definie)" "0" "$(printf '%s' "$REPORT" | j report.deletedAuditRows)"
fi

echo "── 6. Effets vérifiés en base"
chk "la session due a disparu"              "0" "$(q "SELECT count(*) FROM \"Session\" WHERE id='$SID_DUE'")"
chk "ses correspondants ont disparu (cascade)" "0" "$(q "SELECT count(*) FROM \"Participant\" WHERE \"sessionId\"='$SID_DUE'")"
chk "ses invitations ont disparu (cascade)" "0" "$(q "SELECT count(*) FROM \"Invitation\" WHERE \"sessionId\"='$SID_DUE'")"
chk "ses evenements ont disparu (cascade)"  "0" "$(q "SELECT count(*) FROM \"ConnectionEvent\" WHERE \"sessionId\"='$SID_DUE'")"
chk "la session en attente est conservee"   "1" "$(q "SELECT count(*) FROM \"Session\" WHERE id='$SID_PENDING'")"
chk "la session sans date est conservee"    "1" "$(q "SELECT count(*) FROM \"Session\" WHERE id='$SID_ORPHAN'")"
chk "elle a recu une date de purge"         ok  "$(q "SELECT CASE WHEN \"purgeAfter\" IS NULL THEN 'absente' ELSE 'ok' END FROM \"Session\" WHERE id='$SID_ORPHAN'")"
chk "sa date est calculee depuis sa fin"    ok  "$(q "SELECT CASE WHEN \"purgeAfter\" > now() THEN 'ok' ELSE 'passee' END FROM \"Session\" WHERE id='$SID_ORPHAN'")"
chk "la session en direct est intacte"      "1" "$(q "SELECT count(*) FROM \"Session\" WHERE id='$SID_LIVE' AND state='LIVE'")"
# Le sort de la vieille ligne d'audit dépend de la politique configurée. Les
# deux branches sont vérifiées, selon ce que le serveur annonce — un test qui ne
# couvrirait qu'un seul réglage laisserait l'autre sans filet.
AUDIT_WINDOW=$(printf '%s' "$STATUS" | j status.policy.auditDays)
if [ -z "$AUDIT_WINDOW" ]; then
  chk "sans fenetre : la ligne d'audit de 5 ans est intacte" "1" "$(q "SELECT count(*) FROM \"AuditLog\" WHERE id='retention-test-old-$$'")"
else
  chk "avec une fenetre de $AUDIT_WINDOW jours : la ligne de 5 ans est supprimee" "0" "$(q "SELECT count(*) FROM \"AuditLog\" WHERE id='retention-test-old-$$'")"
  chk "des lignes d'audit ont ete supprimees" ok "$(printf '%s' "$REPORT" | j report.deletedAuditRows | python3 -c "import sys;print('ok' if int(sys.stdin.read() or 0)>=1 else 'aucune')")"
fi
chk "le compteur de limitation a disparu"   "0" "$(q "SELECT count(*) FROM \"RateLimit\" WHERE key='retention-test-$$'")"
chk "l'execution est journalisee"           ok  "$(q "SELECT count(*) FROM \"AuditLog\" WHERE action='retention.run' AND outcome='ok'" | python3 -c "import sys;print('ok' if int(sys.stdin.read())>0 else 'aucune')")"
chk "le journal nomme l'administrateur"     ok  "$(q "SELECT count(*) FROM \"AuditLog\" WHERE action='retention.run' AND \"actorKind\"='user' AND \"actorId\" IS NOT NULL" | python3 -c "import sys;print('ok' if int(sys.stdin.read())>0 else 'anonyme')")"

echo "── 7. Purge par le planificateur"
RUN2=$(curl -s -w '\n%{http_code}' -X POST -H "X-SNRC-Cron-Token: $CRON_SECRET" $B/api/admin/retention)
chk "purge acceptee avec le bon secret" 200 "$(printf '%s' "$RUN2" | tail -1)"
chk "rien a supprimer au second passage" "0" "$(printf '%s' "$RUN2" | head -1 | j report.deletedSessions)"
chk "l'execution planifiee est journalisee comme systeme" ok "$(q "SELECT count(*) FROM \"AuditLog\" WHERE action='retention.run' AND \"actorKind\"='system' AND outcome='ok'" | python3 -c "import sys;print('ok' if int(sys.stdin.read())>0 else 'aucune')")"
chk "le planificateur n'est pas rattache a un compte" ok "$(q "SELECT count(*) FROM \"AuditLog\" WHERE action='retention.run' AND \"actorKind\"='system' AND \"actorId\" IS NOT NULL" | sed 's/^0$/ok/')"

echo "── 8. Script du planificateur"
# Passage programmé dans ~5 s : on vérifie que le script atteint réellement la
# route et consigne le succès.
# PURGE_AT est à la minute : on vise donc la PROCHAINE frontière de minute, et
# la suivante s'il reste moins de 8 s — sinon le script calculerait un passage
# déjà écoulé et attendrait 24 h.
AT=$(python3 - <<'PYEOF'
import time
now = time.gmtime()
remaining = 60 - now.tm_sec
boundary = time.time() + (remaining if remaining >= 8 else remaining + 60)
t = time.gmtime(boundary)
print(f'{t.tm_hour:02d}:{t.tm_min:02d}')
PYEOF
)
printf '     passage programme a %s UTC (il est %s)\n' "$AT" "$(date -u +%H:%M:%S)"
# Pas de `timeout` : absent de macOS. On lance en arrière-plan et on arrête.
RETENTION_URL="$B/api/admin/retention" CRON_SECRET="$CRON_SECRET" PURGE_AT="$AT" \
  sh "$ROOT/deploy/scheduler/purge.sh" > "$D/sched.log" 2>&1 &
SCHED_PID=$!
# Au plus 60 s d'attente + marge : le passage doit avoir eu lieu.
sleep 80
kill "$SCHED_PID" 2>/dev/null
wait "$SCHED_PID" 2>/dev/null
chk "le planificateur annonce son heure de passage" ok "$(grep -q 'planificateur demarre' "$D/sched.log" && echo ok || echo muet)"
chk "le planificateur a appele la route avec succes" ok "$(grep -q '\[purge\].* ok ' "$D/sched.log" && echo ok || printf 'journal: %s' "$(tail -2 "$D/sched.log" | tr '\n' ' ')")"
chk "son appel apparait dans le journal d'audit" ok "$(q "SELECT count(*) FROM \"AuditLog\" WHERE action='retention.run' AND \"actorKind\"='system' AND outcome='ok'" | python3 -c "import sys;print('ok' if int(sys.stdin.read())>=2 else 'un seul')")"

# Sans secret : refus de démarrer, pas de démarrage silencieux.
OUT=$(CRON_SECRET="" sh "$ROOT/deploy/scheduler/purge.sh" 2>&1; echo "rc=$?")
chk "sans secret, le planificateur refuse de demarrer" ok "$(printf '%s' "$OUT" | grep -q 'rc=2' && echo ok || printf '%s' "$OUT")"
# Heure invalide : refus explicite.
OUT=$(CRON_SECRET="$CRON_SECRET" PURGE_AT="25:00" sh "$ROOT/deploy/scheduler/purge.sh" 2>&1; echo "rc=$?")
chk "heure invalide refusee" ok "$(printf '%s' "$OUT" | grep -q 'rc=2' && echo ok || printf '%s' "$OUT")"

echo "── 9. Nettoyage du jeu d'essai"
psql -qc "DELETE FROM \"AuditLog\" WHERE id='retention-test-old-$$'" >/dev/null
psql -qc "UPDATE \"Session\" SET state='ENDED', \"endedAt\"=now(), \"purgeAfter\"=now() - interval '1 day' WHERE \"productionId\"='$PROD_ID'" >/dev/null
curl -s -b "$J" -X POST $B/api/admin/retention >/dev/null
# Le compte d'essai est supprimé, pas seulement désactivé : à raison d'un par
# passage, des comptes inertes s'accumuleraient dans la liste des utilisateurs.
# Il ne possède aucune production, la contrainte `Restrict` ne s'y oppose donc pas.
psql -qc "DELETE FROM \"User\" WHERE email='$DIR_EMAIL'" >/dev/null 2>&1 \
  || psql -qc "UPDATE \"User\" SET \"isActive\"=false WHERE email='$DIR_EMAIL'" >/dev/null
chk "sessions d'essai purgees" "0" "$(q "SELECT count(*) FROM \"Session\" WHERE \"productionId\"='$PROD_ID'")"
chk "compte d'essai retire" "0" "$(q "SELECT count(*) FROM \"User\" WHERE email='$DIR_EMAIL' AND \"isActive\"")"

echo
printf 'RESULTAT : %s reussis, %s echoues\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
