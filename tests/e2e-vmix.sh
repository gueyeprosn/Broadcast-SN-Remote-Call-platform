#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Broadcast SN Remote Call — tests d'intégration vMix
#
# PÉRIMÈTRE. Ce script exerce NOTRE chaîne d'intégration de bout en bout :
#   application → agent local → API HTTP vMix
# en remplaçant vMix par `tests/mock-vmix.mjs`, qui reproduit la forme documentée
# de son API.
#
# CE QUE CELA PROUVE : que notre code lit correctement le XML d'état, construit
# et encode correctement les commandes, applique ses listes blanches, refuse les
# entrées de mauvais type, et synchronise ON AIR depuis le Program.
#
# CE QUE CELA NE PROUVE PAS : le comportement réel de vMix. Deux points exigent
# une installation Windows réelle et restent NON VALIDÉS :
#   • `AddInput Browser|<url>` (non documenté) ;
#   • les autorisations micro/caméra dans un Web Browser Input.
# Voir docs/10-TEST-REPORT.md.
#
# Prérequis : application démarrée (`npm run dev`), base migrée et peuplée.
# Usage     : bash tests/e2e-vmix.sh
# ──────────────────────────────────────────────────────────────────────────────
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
B=${APP_URL_TEST:-http://localhost:3000}
MOCK_PORT=${MOCK_VMIX_PORT:-18088}
AGENT_PORT=${AGENT_PORT:-18099}
D=$(mktemp -d)
J=$D/cookies.txt
PGDATABASE=${PGDATABASE:-snrc}
export PGDATABASE

PW=${SEED_ADMIN_PASSWORD:-}
ADMIN_EMAIL=${SEED_ADMIN_EMAIL:-}
if [ -f "$ROOT/.env" ]; then
  [ -z "$PW" ] && PW=$(grep -E '^SEED_ADMIN_PASSWORD=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"')
  [ -z "$ADMIN_EMAIL" ] && ADMIN_EMAIL=$(grep -E '^SEED_ADMIN_EMAIL=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"')
  AGENT_TOKEN=$(grep -E '^VMIX_AGENT_TOKEN=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"')
fi
if [ -z "$PW" ] || [ -z "${AGENT_TOKEN:-}" ]; then
  echo "SEED_ADMIN_PASSWORD et VMIX_AGENT_TOKEN sont requis (.env ou environnement)." >&2
  exit 2
fi

pass=0; fail=0
chk() {
  if [ "$2" = "$3" ]; then printf '  OK   %s\n' "$1"; pass=$((pass+1));
  else printf '  FAIL %s (attendu "%s", obtenu "%s")\n' "$1" "$2" "$3"; fail=$((fail+1)); fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
# Écrit un corps JSON dans un fichier et renvoie « @chemin ». Deux raisons :
#  - éviter l'échappement de guillemets imbriqués dans une substitution de
#    commande, qui fait redécouper le JSON par le shell ;
#  - UN FICHIER PAR APPEL. Avec un nom fixe, une variable gardée pour plus tard
#    pointait sur un contenu entre-temps écrasé par l'appel suivant, et le
#    serveur recevait le mauvais corps — en silence.
body() {
  # `mktemp` et non un compteur : `body` est presque toujours appele dans une
  # substitution de commande, donc dans un sous-shell, ou un increment de
  # variable est perdu pour le parent. Le compteur serait reste a 1 et chaque
  # appel aurait reecrit le meme fichier.
  # Le gabarit `mktemp` exige que les X terminent le nom : « body-XXXXXX.json »
  # est refuse par le mktemp de BSD (macOS). On se passe d'extension, curl n'en
  # a pas besoin.
  local fichier
  fichier=$(mktemp "$D/body-XXXXXX")
  printf '%s' "$1" > "$fichier"
  printf '%s' "@$fichier"
}
j() { python3 -c 'import json,sys
try: d=json.load(sys.stdin)
except Exception: print(""); raise SystemExit
for part in sys.argv[1].split("."):
    d = d.get(part) if isinstance(d,dict) else None
    if d is None: break
print("" if d is None else d)' "$1"; }

cleanup() {
  [ -n "${MOCK_PID:-}" ] && kill "$MOCK_PID" 2>/dev/null
  [ -n "${AGENT_PID:-}" ] && kill "$AGENT_PID" 2>/dev/null
  rm -rf "$D"
}
trap cleanup EXIT

echo "── 0. Mise en place du simulateur et de l'agent"
node "$ROOT/tests/mock-vmix.mjs" "$MOCK_PORT" > "$D/mock.log" 2>&1 &
MOCK_PID=$!
SNRC_AGENT_TOKEN="$AGENT_TOKEN" AGENT_PORT="$AGENT_PORT" VMIX_PORT="$MOCK_PORT" \
  AGENT_RETURN_BUSES=A node "$ROOT/packages/vmix-agent/agent.mjs" > "$D/agent.log" 2>&1 &
AGENT_PID=$!
for _ in $(seq 1 30); do
  sleep 0.3
  curl -fsS "http://127.0.0.1:$AGENT_PORT/health" >/dev/null 2>&1 && break
done
chk "simulateur vMix joignable" 200 "$(code "http://127.0.0.1:$MOCK_PORT/api/")"
chk "agent joignable"           200 "$(code "http://127.0.0.1:$AGENT_PORT/health")"
chk "l'agent relaie l'etat XML" ok "$(curl -s -H "X-SNRC-Agent-Token: $AGENT_TOKEN" "http://127.0.0.1:$AGENT_PORT/vmix" | grep -q '<vmix>' && echo ok || echo echec)"

echo "── 1. Preparation de la session"
psql -qc 'TRUNCATE "RateLimit"' >/dev/null 2>&1
LOGIN_BODY=$(python3 -c 'import json,sys;print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$ADMIN_EMAIL" "$PW")
curl -s -c "$J" -X POST -H 'Content-Type: application/json' --data-binary "$(body "$LOGIN_BODY")" $B/api/auth/login > "$D/login.json"
chk "connexion regie" "ADMIN" "$(j user.role < "$D/login.json")"

PROD_ID=$(curl -s -b "$J" -X POST -H 'Content-Type: application/json' --data-binary '{"name":"Integration vMix"}' $B/api/productions | j production.id)
SESS=$(curl -s -b "$J" -X POST -H 'Content-Type: application/json' --data-binary '{"name":"Essai integration"}' $B/api/productions/$PROD_ID/sessions)
SESS_ID=$(printf '%s' "$SESS" | j session.id)
PART=$(curl -s -b "$J" -X POST -H 'Content-Type: application/json' --data-binary '{"displayName":"Moussa Sow"}' $B/api/sessions/$SESS_ID/participants)
PART_ID=$(printf '%s' "$PART" | j participant.id)
OUTKEY=$(printf '%s' "$PART" | j participant.outputKey)
chk "correspondant cree" ok "$([ -n "$PART_ID" ] && echo ok || echo echec)"

echo "── 2. Declaration de la connexion en mode AGENT"
CONN_BODY=$(python3 -c 'import json,sys;print(json.dumps({"label":"Agent de test","host":"127.0.0.1","port":int(sys.argv[1]),"mode":"AGENT","returnBuses":["A"]}))' "$AGENT_PORT")
CONN=$(curl -s -w '\n%{http_code}' -b "$J" -X POST -H 'Content-Type: application/json' --data-binary "$(body "$CONN_BODY")" $B/api/vmix/connections)
CONN_CODE=$(printf '%s' "$CONN" | tail -1)
if [ "$CONN_CODE" = "201" ]; then
  VM_ID=$(printf '%s' "$CONN" | head -1 | j connection.id)
else
  VM_ID=$(curl -s -b "$J" $B/api/vmix/connections | python3 -c "
import json,sys
for c in json.load(sys.stdin)['connections']:
    if c['host']=='127.0.0.1' and c['port']==$AGENT_PORT:
        print(c['id']); break")
fi
chk "connexion AGENT disponible" ok "$([ -n "$VM_ID" ] && echo ok || echo echec)"

echo "── 3. Test de connexion a travers l'agent"
TEST=$(curl -s -b "$J" -X POST $B/api/vmix/connections/$VM_ID/test)
chk "version vMix lue"            "29.0.0.70" "$(printf '%s' "$TEST" | j version)"
chk "edition vMix lue"            "4K"        "$(printf '%s' "$TEST" | j edition)"
chk "nombre d'entrees lu"         "4"         "$(printf '%s' "$TEST" | j inputCount)"
chk "entrees Web Browser reperees" "2"        "$(printf '%s' "$TEST" | j browserInputCount)"
chk "lastStatus consigne le succes" "ok" "$(psql -tAc "SELECT \"lastStatus\" FROM \"VmixConnection\" WHERE id='$VM_ID'" | tr -d ' ')"

echo "── 4. Lecture des entrees"
INPUTS=$(curl -s -b "$J" $B/api/vmix/connections/$VM_ID/inputs)
chk "GUID de l'entree navigateur 2" "22222222-2222-2222-2222-222222222222" "$(printf '%s' "$INPUTS" | python3 -c "
import json,sys
for i in json.load(sys.stdin)['inputs']:
    if i['number']==2: print(i['key'])")"
chk "le type Colour n'est pas candidat" "False" "$(printf '%s' "$INPUTS" | python3 -c "
import json,sys
for i in json.load(sys.stdin)['inputs']:
    if i['number']==1: print(i['isBrowser'])")"
chk "entree au Program lue" "1" "$(printf '%s' "$INPUTS" | j activeNumber)"

echo "── 5. Association a une entree Web Browser"
curl -s -X POST "http://127.0.0.1:$MOCK_PORT/_reset" >/dev/null
MAP_BODY=$(python3 -c 'import json,sys;print(json.dumps({"participantId":sys.argv[1],"inputKey":"22222222-2222-2222-2222-222222222222"}))' "$PART_ID")
MAP=$(curl -s -w '\n%{http_code}' -b "$J" -X POST -H 'Content-Type: application/json' --data-binary "$(body "$MAP_BODY")" $B/api/vmix/connections/$VM_ID/map)
chk "association acceptee" 200 "$(printf '%s' "$MAP" | tail -1)"
chk "l'entree n'est affectee qu'a un seul correspondant" "1" "$(psql -tAc "SELECT count(*) FROM \"VmixInputMapping\" WHERE \"connectionId\"='$VM_ID' AND \"inputKey\"='22222222-2222-2222-2222-222222222222'" | tr -d ' ')"

CALLS=$(curl -s "http://127.0.0.1:$MOCK_PORT/_calls")
chk "BrowserNavigate envoye" ok "$(printf '%s' "$CALLS" | python3 -c "
import json,sys
calls=json.load(sys.stdin)
print('ok' if any(c['function']=='BrowserNavigate' for c in calls) else 'absent')")"
chk "l'URL pointe notre page de sortie" ok "$(printf '%s' "$CALLS" | python3 -c "
import json,sys
calls=json.load(sys.stdin)
nav=[c for c in calls if c['function']=='BrowserNavigate']
print('ok' if nav and nav[0]['value'].endswith('/output/$OUTKEY') else (nav[0]['value'] if nav else 'absent'))")"
chk "les caracteres speciaux sont percent-encodes" ok "$(printf '%s' "$CALLS" | python3 -c "
import json,sys
calls=json.load(sys.stdin)
nav=[c for c in calls if c['function']=='BrowserNavigate']
raw=nav[0]['rawQuery'] if nav else ''
# La documentation vMix exige l'encodage de ? & # dans BrowserNavigate.
print('ok' if nav and '%3A%2F%2F' in raw else raw[:120])")"
chk "l'entree est ciblee par son GUID" ok "$(printf '%s' "$CALLS" | python3 -c "
import json,sys
calls=json.load(sys.stdin)
nav=[c for c in calls if c['function']=='BrowserNavigate']
print('ok' if nav and nav[0]['input']=='22222222-2222-2222-2222-222222222222' else 'numero')")"
chk "SetInputName renomme l'entree" "Moussa Sow" "$(printf '%s' "$CALLS" | python3 -c "
import json,sys
calls=json.load(sys.stdin)
ren=[c for c in calls if c['function']=='SetInputName']
print(ren[0]['value'] if ren else 'absent')")"
chk "les commandes vers une meme entree sont espacees" ok "$(printf '%s' "$CALLS" | python3 -c "
import json,sys
from datetime import datetime
calls=[c for c in json.load(sys.stdin) if c['input']=='22222222-2222-2222-2222-222222222222']
if len(calls)<2: print('une seule commande'); raise SystemExit
t=[datetime.fromisoformat(c['at'].replace('Z','+00:00')) for c in calls]
gap=(t[1]-t[0]).total_seconds()
# Limite rapportee : des commandes trop rapprochees peuvent etre perdues.
print('ok' if gap>=0.7 else f'{gap:.2f}s')")"
chk "mapping enregistre en base" "22222222-2222-2222-2222-222222222222" "$(psql -tAc "SELECT \"inputKey\" FROM \"VmixInputMapping\" WHERE \"participantId\"='$PART_ID'" | tr -d ' ')"

echo "── 6. Refus d'une entree de mauvais type"
BAD_BODY=$(python3 -c 'import json,sys;print(json.dumps({"participantId":sys.argv[1],"inputKey":"11111111-1111-1111-1111-111111111111"}))' "$PART_ID")
BAD=$(curl -s -w '\n%{http_code}' -b "$J" -X POST -H 'Content-Type: application/json' --data-binary "$(body "$BAD_BODY")" $B/api/vmix/connections/$VM_ID/map)
chk "entree Colour refusee" 409 "$(printf '%s' "$BAD" | tail -1)"
chk "le refus nomme le type reel" ok "$(printf '%s' "$BAD" | head -1 | grep -q 'Colour' && echo ok || echo vague)"
GUID_BODY=$(python3 -c 'import json,sys;print(json.dumps({"participantId":sys.argv[1],"inputKey":"99999999-0000-0000-0000-000000000000"}))' "$PART_ID")
chk "GUID inexistant refuse" 404 "$(code -b "$J" -X POST -H 'Content-Type: application/json' --data-binary "$(body "$GUID_BODY")" $B/api/vmix/connections/$VM_ID/map)"

echo "── 7. Commandes audio"
curl -s -X POST "http://127.0.0.1:$MOCK_PORT/_reset" >/dev/null
AUD_OFF=$(python3 -c 'import json,sys;print(json.dumps({"participantId":sys.argv[1],"action":"AudioOff"}))' "$PART_ID")
chk "AudioOff accepte" 200 "$(code -b "$J" -X PATCH -H 'Content-Type: application/json' --data-binary "$(body "$AUD_OFF")" $B/api/vmix/connections/$VM_ID/map)"
AUD_BUS=$(python3 -c 'import json,sys;print(json.dumps({"participantId":sys.argv[1],"action":"AudioBusOff","value":"A"}))' "$PART_ID")
chk "AudioBusOff A accepte (c'est le mix-minus)" 200 "$(code -b "$J" -X PATCH -H 'Content-Type: application/json' --data-binary "$(body "$AUD_BUS")" $B/api/vmix/connections/$VM_ID/map)"
AUD_ON_A=$(python3 -c 'import json,sys;print(json.dumps({"participantId":sys.argv[1],"action":"AudioBusOn","value":"A"}))' "$PART_ID")
RESP=$(curl -s -w '\n%{http_code}' -b "$J" -X PATCH -H 'Content-Type: application/json' --data-binary "$(body "$AUD_ON_A")" $B/api/vmix/connections/$VM_ID/map)
chk "AudioBusOn sur le bus de retour refuse (409)" 409 "$(printf '%s' "$RESP" | tail -1)"
chk "le refus explique le mix-minus" ok "$(printf '%s' "$RESP" | head -1 | grep -qi 'mix-minus' && echo ok || echo vague)"
VOL_BAD=$(python3 -c 'import json,sys;print(json.dumps({"participantId":sys.argv[1],"action":"SetVolume","value":"500"}))' "$PART_ID")
chk "SetVolume hors bornes refuse" 502 "$(code -b "$J" -X PATCH -H 'Content-Type: application/json' --data-binary "$(body "$VOL_BAD")" $B/api/vmix/connections/$VM_ID/map)"
chk "aucune commande hors liste n'a atteint le simulateur" ok "$(curl -s "http://127.0.0.1:$MOCK_PORT/_calls" | python3 -c "
import json,sys
bad={'BusXSendToMaster','RemoveInput','Cut','Shutdown'}
print('ok' if not any(c['function'] in bad for c in json.load(sys.stdin)) else 'FUITE')")"

echo "── 8. Synchronisation ON AIR depuis vMix"
curl -s -X POST "http://127.0.0.1:$MOCK_PORT/_program?input=2" >/dev/null
SYNC_BODY=$(python3 -c 'import json,sys;print(json.dumps({"sessionId":sys.argv[1]}))' "$SESS_ID")
SYNC=$(curl -s -b "$J" -X POST -H 'Content-Type: application/json' --data-binary "$(body "$SYNC_BODY")" $B/api/vmix/connections/$VM_ID/sync)
chk "synchronisation effectuee" "2" "$(printf '%s' "$SYNC" | j activeNumber)"
chk "le correspondant passe ON AIR"        "t"    "$(psql -tAc "SELECT \"onAir\" FROM \"Participant\" WHERE id='$PART_ID'" | tr -d ' ')"
chk "la source ON AIR est marquee VMIX"    "VMIX" "$(psql -tAc "SELECT \"onAirSource\" FROM \"Participant\" WHERE id='$PART_ID'" | tr -d ' ')"
curl -s -X POST "http://127.0.0.1:$MOCK_PORT/_program?input=1" >/dev/null
curl -s -b "$J" -X POST -H 'Content-Type: application/json' --data-binary "$(body "$SYNC_BODY")" $B/api/vmix/connections/$VM_ID/sync >/dev/null
chk "retour en standby quand le Program change" "f" "$(psql -tAc "SELECT \"onAir\" FROM \"Participant\" WHERE id='$PART_ID'" | tr -d ' ')"

echo "── 9. L'agent est bien la derniere barriere"
chk "Cut refuse par l'agent malgre une demande directe" 403 "$(code -H "X-SNRC-Agent-Token: $AGENT_TOKEN" "http://127.0.0.1:$AGENT_PORT/vmix?Function=Cut")"
chk "RemoveInput refuse par l'agent"                    403 "$(code -H "X-SNRC-Agent-Token: $AGENT_TOKEN" "http://127.0.0.1:$AGENT_PORT/vmix?Function=RemoveInput&Input=2")"
chk "BusXSendToMaster refuse par l'agent"               403 "$(code -H "X-SNRC-Agent-Token: $AGENT_TOKEN" "http://127.0.0.1:$AGENT_PORT/vmix?Function=BusXSendToMaster&Value=A")"
chk "secret invalide refuse"                            401 "$(code -H 'X-SNRC-Agent-Token: faux' "http://127.0.0.1:$AGENT_PORT/vmix")"
chk "le simulateur n'a recu aucune de ces commandes" ok "$(curl -s "http://127.0.0.1:$MOCK_PORT/_calls" | python3 -c "
import json,sys
bad={'Cut','RemoveInput','BusXSendToMaster'}
print('ok' if not any(c['function'] in bad for c in json.load(sys.stdin)) else 'FUITE')")"

echo "── 10. Agent arrete"
kill "$AGENT_PID" 2>/dev/null; AGENT_PID=""
sleep 0.5
chk "echec honnete quand l'agent est absent" 502 "$(code -b "$J" -X POST $B/api/vmix/connections/$VM_ID/test)"
chk "lastStatus consigne l'echec" ok "$(psql -tAc "SELECT \"lastStatus\" FROM \"VmixConnection\" WHERE id='$VM_ID'" | grep -qiE 'injoignable|refus|fetch' && echo ok || echo vide)"

echo
printf 'RESULTAT : %s reussis, %s echoues\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
