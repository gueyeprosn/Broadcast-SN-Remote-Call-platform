#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Broadcast SN Remote Call — campagne de tests d'intégration de l'API
#
# Ce script exerce l'application réellement démarrée : authentification, rôles,
# invitations, parcours du correspondant, construction des URL du moteur, page de
# sortie vMix, commandes de régie, flux d'événements, révocation, limitation de
# débit et journal d'audit.
#
# Il ne couvre PAS ce qui exige du matériel ou un vMix Windows : voir
# docs/10-TEST-REPORT.md pour la liste des validations manuelles restantes.
#
# Prérequis
#   1. PostgreSQL accessible et migrations appliquées :  npm run db:migrate
#   2. Compte administrateur créé                     :  npm run db:seed
#   3. Application démarrée en mode développement     :  npm run dev
#      (le mode production exige APP_URL en HTTPS et pose des cookies `Secure`,
#       que curl ne renverra pas sur http — c'est voulu.)
#   4. `psql` doit pouvoir joindre la base : les assertions de persistance la
#      lisent directement.
#
# Usage
#   SEED_ADMIN_PASSWORD='...' bash tests/e2e-api.sh
#   (ou laissez le script lire .env)
#
# Le script modifie la base : à n'exécuter que sur une base de développement.
# ──────────────────────────────────────────────────────────────────────────────
set -u

# Mot de passe administrateur : variable d'environnement, sinon .env.
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PW=${SEED_ADMIN_PASSWORD:-}
if [ -z "$PW" ] && [ -f "$ROOT/.env" ]; then
  PW=$(grep -E '^SEED_ADMIN_PASSWORD=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"')
fi
ADMIN_EMAIL=${SEED_ADMIN_EMAIL:-}
if [ -z "$ADMIN_EMAIL" ] && [ -f "$ROOT/.env" ]; then
  ADMIN_EMAIL=$(grep -E '^SEED_ADMIN_EMAIL=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"')
fi
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@example.org}
PGDATABASE=${PGDATABASE:-snrc}
export PGDATABASE
if [ -z "$PW" ]; then
  echo "SEED_ADMIN_PASSWORD est absent (ni variable d'environnement, ni .env)." >&2
  exit 2
fi

B=http://localhost:3000
D=$(mktemp -d)
J=$D/cookies-dir.txt
P=$D/cookies-part.txt
rm -f "$J" "$P"
pass=0; fail=0

# La limitation de débit du login est persistée en base : on remet les compteurs
# à zéro avant la campagne, sinon les essais d'authentification volontairement
# erronés épuisent le quota et faussent la suite.
psql -qc 'TRUNCATE "RateLimit"' >/dev/null 2>&1

chk() {
  if [ "$2" = "$3" ]; then printf '  OK   %s\n' "$1"; pass=$((pass+1));
  else printf '  FAIL %s (attendu "%s", obtenu "%s")\n' "$1" "$2" "$3"; fail=$((fail+1)); fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
# Écrit un corps JSON dans un fichier et le renvoie : évite tout échappement de
# guillemets imbriqués dans une substitution de commande.
body() { printf '%s' "$1" > "$D/body.json"; printf '%s' "@$D/body.json"; }

j() { python3 -c 'import json,sys
try: d=json.load(sys.stdin)
except Exception: print(""); raise SystemExit
k=sys.argv[1].split(".")
for part in k:
    if d is None: break
    d = d.get(part) if isinstance(d,dict) else None
print("" if d is None else d)' "$1"; }

echo "── 1. Accès non authentifié"
chk "GET /api/productions sans session" 401 "$(code $B/api/productions)"
chk "GET /api/users sans session"       401 "$(code $B/api/users)"
chk "POST /api/vmix/connections sans session" 401 "$(code -X POST -H 'Content-Type: application/json' -d '{}' $B/api/vmix/connections)"
chk "GET /api/auth/me sans session renvoie user null" "" "$(curl -s $B/api/auth/me | j user)"

echo "── 2. Authentification"
# Les corps JSON contenant une variable sont construits par python puis écrits
# dans un fichier : imbriquer des guillemets échappés dans une substitution de
# commande fait redécouper le corps par le shell.
BAD_BODY=$(python3 -c 'import json,sys;print(json.dumps({"email":sys.argv[1],"password":"mot-de-passe-faux-0000"}))' "$ADMIN_EMAIL")
UNK_BODY=$(python3 -c 'import json;print(json.dumps({"email":"inconnu@example.org","password":"mot-de-passe-faux-0000"}))')
R_BAD=$(curl -s -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary "$(body "$BAD_BODY")" $B/api/auth/login)
R_UNK=$(curl -s -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary "$(body "$UNK_BODY")" $B/api/auth/login)
chk "mauvais mot de passe -> 401" 401 "$(printf '%s' "$R_BAD" | tail -1)"
chk "compte inconnu -> 401"       401 "$(printf '%s' "$R_UNK" | tail -1)"
M_BAD=$(printf '%s' "$R_BAD" | head -1 | j error.message)
M_UNK=$(printf '%s' "$R_UNK" | head -1 | j error.message)
chk "message identique (pas d'enumeration de comptes)" "$M_BAD" "$M_UNK"
chk "mot de passe trop court rejete par validation" 400 "$(code -X POST -H 'Content-Type: application/json' --data-binary '{"email":"pas-une-adresse","password":""}' $B/api/auth/login)"

LOGIN_BODY=$(python3 -c 'import json,sys;print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$ADMIN_EMAIL" "$PW")
LOGIN=$(curl -s -c "$J" -X POST -H 'Content-Type: application/json' --data-binary "$(body "$LOGIN_BODY")" $B/api/auth/login)
chk "connexion reussie" "ADMIN" "$(printf '%s' "$LOGIN" | j user.role)"
chk "cookie de session HttpOnly" "1" "$(grep -c 'snrc_session' "$J" || true)"
chk "le cookie est marque HttpOnly" "1" "$(grep -c '^#HttpOnly_' "$J" || true)"

echo "── 3. Production et session"
PROD=$(curl -s -b "$J" -X POST -H 'Content-Type: application/json' --data-binary '{"name":"Journal de 20h","description":"Edition quotidienne"}' $B/api/productions)
PROD_ID=$(printf '%s' "$PROD" | j production.id)
# Le slug est unique : à la deuxième campagne il reçoit un suffixe, ce qui est
# le comportement attendu. On vérifie donc le motif, pas une valeur fixe.
chk "production creee avec un slug unique" ok "$(python3 -c "
import re,sys;print('ok' if re.fullmatch(r'journal-de-20h(-\\d+)?', sys.argv[1]) else sys.argv[1])" "$(printf '%s' "$PROD" | j production.slug)")"
chk "nom trop court refuse" 400 "$(code -b "$J" -X POST -H 'Content-Type: application/json' --data-binary '{"name":"x"}' $B/api/productions)"

SESS=$(curl -s -b "$J" -X POST -H 'Content-Type: application/json' --data-binary '{"name":"Edition du 16 novembre"}' $B/api/productions/$PROD_ID/sessions)
SESS_ID=$(printf '%s' "$SESS" | j session.id)
ROOM=$(printf '%s' "$SESS" | j session.roomName)
RET=$(printf '%s' "$SESS" | j session.returnStreamId)
chk "session creee" "SCHEDULED" "$(printf '%s' "$SESS" | j session.state)"
chk "nom de salle opaque (prefixe snrc)" ok "$(python3 -c "print('ok' if '$ROOM'.startswith('snrc') and len('$ROOM')==16 else '$ROOM')")"
chk "le nom de salle ne contient pas le nom de l'emission" ok "$(python3 -c "print('FUITE' if 'journal' in '$ROOM'.lower() else 'ok')")"
chk "identifiant de bus de retour genere" ok "$(python3 -c "print('ok' if '$RET'.startswith('r') and len('$RET')==11 else '$RET')")"

echo "── 4. Correspondant et invitation"
PART=$(curl -s -b "$J" -X POST -H 'Content-Type: application/json' --data-binary '{"displayName":"Awa Diop","qualityProfile":"BROADCAST"}' $B/api/sessions/$SESS_ID/participants)
PART_ID=$(printf '%s' "$PART" | j participant.id)
STREAM=$(printf '%s' "$PART" | j participant.streamId)
OUTKEY=$(printf '%s' "$PART" | j participant.outputKey)
chk "correspondant cree" "Awa Diop" "$(printf '%s' "$PART" | j participant.displayName)"
chk "streamId au format attendu" ok "$(python3 -c "
import re;print('ok' if re.fullmatch(r'g[abcdefghjkmnpqrstuvwxyz23456789]{10}','$STREAM') else '$STREAM')")"
chk "outputKey distinct du streamId" ok "$(python3 -c "print('ok' if '$OUTKEY'!='$STREAM' and len('$OUTKEY')==22 else 'probleme')")"

INV=$(curl -s -b "$J" -X POST -H 'Content-Type: application/json' --data-binary "{\"participantId\":\"$PART_ID\",\"ttlMinutes\":60}" $B/api/sessions/$SESS_ID/invitations)
TOKEN=$(printf '%s' "$INV" | j invitation.token)
chk "jeton d'invitation genere" ok "$(python3 -c "print('ok' if len('$TOKEN')>=40 else 'longueur '+str(len('$TOKEN')))")"
LIST=$(curl -s -b "$J" $B/api/sessions/$SESS_ID/invitations)
chk "la liste des invitations ne renvoie pas le jeton" absent "$(printf '%s' "$LIST" | grep -q "$TOKEN" && echo PRESENT || echo absent)"
chk "le jeton n'est pas stocke en clair" absent "$(psql -tAc "SELECT count(*) FROM \"Invitation\" WHERE \"tokenHash\"='$TOKEN'" | tr -d ' ' | sed 's/^0$/absent/')"
chk "l'empreinte stockee est bien un SHA-256" ok "$(psql -tAc "SELECT length(\"tokenHash\") FROM \"Invitation\" LIMIT 1" | tr -d ' ' | sed 's/^64$/ok/')"

echo "── 5. Jetons invalides"
chk "jeton inexistant -> 404" 404 "$(code -X POST $B/api/invite/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)"
chk "jeton trop court -> 404" 404 "$(code -X POST $B/api/invite/abc)"
chk "GET sur /api/invite refuse (POST uniquement)" 405 "$(code $B/api/invite/$TOKEN)"

echo "── 6. Entree du correspondant"
ACC=$(curl -s -c "$P" -X POST $B/api/invite/$TOKEN)
chk "invitation acceptee" "Awa Diop" "$(printf '%s' "$ACC" | j participant.displayName)"
chk "cookie participant pose" "1" "$(grep -c 'snrc_participant' "$P" || true)"
JOIN=$(curl -s -b "$P" -X POST -H 'Content-Type: application/json' --data-binary '{"cameraEnabled":true,"micEnabled":true}' $B/api/participants/me/join)
PUB=$(printf '%s' "$JOIN" | j publisherUrl)
RETU=$(printf '%s' "$JOIN" | j returnUrl)
printf '     publisherUrl = %s\n' "$PUB"
printf '     returnUrl    = %s\n' "$RETU"
URLCHK=$(python3 - "$PUB" "$RETU" "$STREAM" "$RET" <<'PY'
import sys
from urllib.parse import urlparse, parse_qs
pub, ret, stream, retid = sys.argv[1:5]
p = parse_qs(urlparse(pub).query, keep_blank_values=True)
r = parse_qs(urlparse(ret).query, keep_blank_values=True)
out = []
out.append('push_ok' if p.get('push') == [stream] else 'push_KO')
out.append('view_vide_ok' if p.get('view') == [''] else 'view_KO')
out.append('pas_de_director' if 'director' not in p else 'DIRECTOR_FUITE')
out.append('quality_720' if p.get('quality') == ['1'] else 'quality_KO:' + str(p.get('quality')))
out.append('clean_ok' if 'cleanoutput' in p else 'clean_KO')
out.append('ret_view_ok' if r.get('view') == [retid] else 'ret_view_KO')
out.append('ret_solo_ok' if 'solo' in r else 'ret_solo_KO')
out.append('ret_pas_de_push' if 'push' not in r else 'RET_PUSH_FUITE')
print(' '.join(out))
PY
)
chk "URL correspondant et retour conformes" \
  "push_ok view_vide_ok pas_de_director quality_720 clean_ok ret_view_ok ret_solo_ok ret_pas_de_push" "$URLCHK"
chk "capacites : mix-minus natif declare absent" "False" "$(printf '%s' "$JOIN" | j capabilities.nativeMixMinus)"
chk "capacites : reconnexion non garantie"       "False" "$(printf '%s' "$JOIN" | j capabilities.guaranteedReconnect)"
chk "capacites : NDI declare absent"             "False" "$(printf '%s' "$JOIN" | j capabilities.ndiOutput)"

echo "── 7. Cloisonnement des roles"
chk "le correspondant n'atteint pas la console" 401 "$(code -b "$P" $B/api/productions)"
INVB=$(body "{\"participantId\":\"$PART_ID\"}")
chk "le correspondant ne peut pas inviter"      401 "$(code -b "$P" -X POST -H 'Content-Type: application/json' --data-binary "$INVB" $B/api/sessions/$SESS_ID/invitations)"
chk "le realisateur n'est pas un correspondant" 401 "$(code -b "$J" $B/api/participants/me/state)"

echo "── 8. Page de sortie vMix"
OUT=$(curl -s $B/output/$OUTKEY)
chk "la page de sortie contient un iframe" ok "$(printf '%s' "$OUT" | grep -q '<iframe' && echo ok || echo absent)"
chk "elle passe &solo et &cleanoutput"     ok "$(printf '%s' "$OUT" | grep -q 'solo' && printf '%s' "$OUT" | grep -q 'cleanoutput' && echo ok || echo manquant)"
chk "aucun bouton dans la sortie"          "0" "$(printf '%s' "$OUT" | grep -c '<button' || true)"
chk "en-tete Cache-Control: no-store"      ok "$(curl -sI $B/output/$OUTKEY | grep -qi 'cache-control: no-store' && echo ok || echo absent)"
chk "en-tete X-Robots-Tag: noindex"        ok "$(curl -sI $B/output/$OUTKEY | grep -qi 'x-robots-tag' && echo ok || echo absent)"
chk "cle de sortie inconnue -> mire nommee" ok "$(curl -s $B/output/cleinexistante0000000 | grep -q 'inconnu' && echo ok || echo autre)"
SECRET=$(psql -tAc "SELECT \"roomSecret\" FROM \"Session\" WHERE id='$SESS_ID'" | tr -d ' ')
# LIMITE CONNUE (docs/11-KNOWN-LIMITS.md, L1) : toute page qui rejoint la salle
# porte le secret de salle, le modèle du moteur l'exige. Le test constate ce
# fait au lieu de laisser croire le contraire.
chk "limite connue : le secret de salle est dans la page (modele du moteur)" present "$(printf '%s' "$OUT" | grep -q "$SECRET" && echo present || echo absent)"
chk "le secret de salle est propre a la session" ok "$(psql -tAc "SELECT count(DISTINCT \"roomSecret\") = count(*) FROM \"Session\"" | tr -d ' ' | sed 's/^t$/ok/')"

echo "── 9. Commandes regie"
chk "mise a l'antenne" 200 "$(code -b "$J" -X PATCH -H 'Content-Type: application/json' --data-binary '{"onAir":true}' $B/api/participants/$PART_ID)"
chk "ON AIR vu par le correspondant" "True" "$(curl -s -b "$P" $B/api/participants/me/state | j participant.onAir)"
chk "source ON AIR = MANUAL (pas vMix)" "MANUAL" "$(curl -s -b "$P" $B/api/participants/me/state | j participant.onAirSource)"
chk "coupure du micro" 200 "$(code -b "$J" -X PATCH -H 'Content-Type: application/json' --data-binary '{"micAllowed":false}' $B/api/participants/$PART_ID)"
chk "micro coupe vu par le correspondant" "False" "$(curl -s -b "$P" $B/api/participants/me/state | j participant.micAllowed)"
chk "bus de retour invalide refuse" 400 "$(code -b "$J" -X PATCH -H 'Content-Type: application/json' --data-binary '{"returnBus":"Z"}' $B/api/participants/$PART_ID)"
chk "bus de retour valide accepte"  200 "$(code -b "$J" -X PATCH -H 'Content-Type: application/json' --data-binary '{"returnBus":"B"}' $B/api/participants/$PART_ID)"
chk "message au correspondant"      200 "$(code -b "$J" -X POST -H 'Content-Type: application/json' --data-binary '{"text":"Antenne dans 10 secondes"}' $B/api/participants/$PART_ID/message)"
chk "message vide refuse"           400 "$(code -b "$J" -X POST -H 'Content-Type: application/json' --data-binary '{"text":""}' $B/api/participants/$PART_ID/message)"
TB_OPEN=$(body "{\"participantId\":\"$PART_ID\",\"open\":true}")
chk "talkback ouvert"               200 "$(code -b "$J" -X POST -H 'Content-Type: application/json' --data-binary "$TB_OPEN" $B/api/sessions/$SESS_ID/talkback)"
chk "talkback sans cible refuse"    400 "$(code -b "$J" -X POST -H 'Content-Type: application/json' --data-binary '{"participantId":null,"open":true}' $B/api/sessions/$SESS_ID/talkback)"
chk "talkback referme"              200 "$(code -b "$J" -X POST -H 'Content-Type: application/json' --data-binary '{"participantId":null,"open":false}' $B/api/sessions/$SESS_ID/talkback)"
chk "mesures a null acceptees (non mesure)" 200 "$(code -b "$J" -X POST -H 'Content-Type: application/json' --data-binary '{"resolution":null,"framerate":null,"videoKbps":null,"audioKbps":null,"packetLossPct":null,"rttMs":null,"jitterMs":null}' $B/api/participants/$PART_ID/metrics)"
chk "mesures mal typees refusees" 400 "$(code -b "$J" -X POST -H 'Content-Type: application/json' --data-binary '{"resolution":123}' $B/api/participants/$PART_ID/metrics)"

echo "── 10. vMix"
PUBHOST=$(curl -s -b "$J" -X POST -H 'Content-Type: application/json' --data-binary '{"label":"Regie distante","host":"203.0.113.10","port":8088,"mode":"DIRECT"}' $B/api/vmix/connections)
chk "mode DIRECT vers adresse publique refuse" "forbidden_host" "$(printf '%s' "$PUBHOST" | j error.code)"
# Le couple hôte/port est unique : si la connexion existe déjà (campagne
# précédente), on vérifie le refus explicite puis on réutilise l'existante.
VM=$(curl -s -w '\n%{http_code}' -b "$J" -X POST -H 'Content-Type: application/json' --data-binary '{"label":"Regie studio A","host":"127.0.0.1","port":8088,"mode":"DIRECT","returnBuses":["A"]}' $B/api/vmix/connections)
VM_CODE=$(printf '%s' "$VM" | tail -1)
VM_BODY=$(printf '%s' "$VM" | head -1)
chk "creation de connexion locale : 201 ou refus explicite 409" ok "$(python3 -c "import sys;print('ok' if sys.argv[1] in ('201','409') else sys.argv[1])" "$VM_CODE")"
if [ "$VM_CODE" = "201" ]; then
  VM_ID=$(printf '%s' "$VM_BODY" | j connection.id)
else
  chk "doublon hote/port signale clairement" "duplicate_host" "$(printf '%s' "$VM_BODY" | j error.code)"
  VM_ID=$(curl -s -b "$J" $B/api/vmix/connections | python3 -c "
import json,sys
for c in json.load(sys.stdin)['connections']:
    if c['host']=='127.0.0.1' and c['port']==8088:
        print(c['id']); break")
fi
chk "connexion locale disponible" ok "$([ -n "$VM_ID" ] && echo ok || echo absente)"
chk "test sans vMix reel -> echec honnete (502)" 502 "$(code -b "$J" -X POST $B/api/vmix/connections/$VM_ID/test)"
chk "le message d'echec nomme la cause" ok "$(curl -s -b "$J" -X POST $B/api/vmix/connections/$VM_ID/test | grep -qiE 'injoignable|refus|répond|repond' && echo ok || echo vague)"
chk "lastStatus consigne l'echec reel" ok "$(psql -tAc "SELECT \"lastStatus\" FROM \"VmixConnection\" WHERE id='$VM_ID'" | grep -qiE 'injoignable|refus|econnrefused|fetch' && echo ok || echo vide)"
chk "l'API ne renvoie jamais agentTokenHash" absent "$(curl -s -b "$J" $B/api/vmix/connections | grep -q agentTokenHash && echo PRESENT || echo absent)"
MAPB=$(body "{\"participantId\":\"$PART_ID\",\"inputKey\":\"abc\"}")
chk "mapping impossible sans vMix joignable" 502 "$(code -b "$J" -X POST -H 'Content-Type: application/json' --data-binary "$MAPB" $B/api/vmix/connections/$VM_ID/map)"

echo "── 11. Flux d'evenements"
SSE=$(curl -s -N --max-time 3 -b "$J" $B/api/sessions/$SESS_ID/stream | head -c 200 || true)
chk "la console recoit le flux SSE" ok "$(printf '%s' "$SSE" | grep -q 'retry:' && echo ok || echo muet)"
chk "le flux SSE refuse un anonyme" 401 "$(code --max-time 3 $B/api/sessions/$SESS_ID/stream)"

echo "── 12. Revocation"
INV2=$(curl -s -b "$J" -X POST -H 'Content-Type: application/json' --data-binary "{\"participantId\":\"$PART_ID\",\"ttlMinutes\":60}" $B/api/sessions/$SESS_ID/invitations)
TOKEN2=$(printf '%s' "$INV2" | j invitation.token)
INV2_ID=$(printf '%s' "$INV2" | j invitation.id)
chk "revocation de l'invitation" 200 "$(code -b "$J" -X DELETE $B/api/invitations/$INV2_ID)"
chk "jeton revoque refuse" "revoked" "$(curl -s -X POST $B/api/invite/$TOKEN2 | j error.code)"
chk "revocation du correspondant" 200 "$(code -b "$J" -X DELETE -H 'Content-Type: application/json' --data-binary '{"reason":"Campagne de test"}' $B/api/participants/$PART_ID)"
chk "le correspondant revoque perd l'acces" 403 "$(code -b "$P" $B/api/participants/me/state)"
chk "sortie vMix : mire 'acces revoque'" ok "$(curl -s $B/output/$OUTKEY | grep -q 'voqu' && echo ok || echo autre)"

echo "── 13. Fin de session"
chk "fin de session" 200 "$(code -b "$J" -X POST -H 'Content-Type: application/json' --data-binary '{"action":"end"}' $B/api/sessions/$SESS_ID/state)"
INVB2=$(body "{\"participantId\":\"$PART_ID\"}")
chk "plus d'invitation apres la fin" 409 "$(code -b "$J" -X POST -H 'Content-Type: application/json' --data-binary "$INVB2" $B/api/sessions/$SESS_ID/invitations)"
chk "toutes les invitations revoquees" "0" "$(psql -tAc "SELECT count(*) FROM \"Invitation\" WHERE \"sessionId\"='$SESS_ID' AND \"revokedAt\" IS NULL" | tr -d ' ')"
chk "tokenEpoch incremente (cookies invalides)" "1" "$(psql -tAc "SELECT \"tokenEpoch\" FROM \"Session\" WHERE id='$SESS_ID'" | tr -d ' ')"
chk "date de purge posee (rétention)" ok "$(psql -tAc "SELECT CASE WHEN \"purgeAfter\" IS NULL THEN 'absente' ELSE 'ok' END FROM \"Session\" WHERE id='$SESS_ID'" | tr -d ' ')"

echo "── 14. Limitation de debit"
psql -qc 'TRUNCATE "RateLimit"' >/dev/null 2>&1
RL=none
for i in $(seq 1 14); do
  C=$(code -X POST -H 'Content-Type: application/json' --data-binary '{"email":"cible@example.org","password":"mot-de-passe-faux-0000"}' $B/api/auth/login)
  if [ "$C" = "429" ]; then RL="429 au $i-eme essai"; break; fi
done
chk "le bourrage de mot de passe est freine" ok "$(python3 -c "import sys;print('ok' if sys.argv[1].startswith('429') else sys.argv[1])" "$RL")"

echo "── 15. Journal d'audit"
chk "les connexions refusees sont journalisees" ok "$(psql -tAc "SELECT count(*) FROM \"AuditLog\" WHERE action='auth.login' AND outcome='denied'" | tr -d ' ' | python3 -c "import sys;print('ok' if int(sys.stdin.read())>0 else 'aucune')")"
chk "les revocations sont journalisees" ok "$(psql -tAc "SELECT count(*) FROM \"AuditLog\" WHERE action LIKE '%revoke%'" | tr -d ' ' | python3 -c "import sys;print('ok' if int(sys.stdin.read())>0 else 'aucune')")"
chk "le journal ne contient aucun jeton en clair" ok "$(psql -tAc "SELECT count(*) FROM \"AuditLog\" WHERE detail::text LIKE '%$TOKEN%'" | tr -d ' ' | sed 's/^0$/ok/')"
chk "les evenements de connexion sont enregistres" ok "$(psql -tAc "SELECT count(*) FROM \"ConnectionEvent\" WHERE \"sessionId\"='$SESS_ID'" | tr -d ' ' | python3 -c "import sys;print('ok' if int(sys.stdin.read())>=3 else 'aucun')")"

echo
printf 'RESULTAT : %s reussis, %s echoues\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
