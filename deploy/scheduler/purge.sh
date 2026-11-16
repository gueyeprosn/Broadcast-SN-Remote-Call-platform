#!/bin/sh
# ──────────────────────────────────────────────────────────────────────────────
# Broadcast SN Remote Call — planificateur de purge
#
# Appelle une fois par jour la route de rétention de l'application. Le secret
# voyage dans un en-tête, jamais dans l'URL, qui finirait dans les journaux
# d'accès.
#
# Pourquoi une boucle qui recalcule l'heure plutôt qu'un `sleep 86400` :
# un simple `sleep 86400` dérive à chaque redémarrage du conteneur et finit par
# tourner en pleine émission. Ici l'heure de passage est recalculée depuis
# l'horloge à chaque tour, donc elle reste fixe.
#
# Variables :
#   RETENTION_URL  URL de la route (défaut : http://app:3000/api/admin/retention)
#   CRON_SECRET    secret partagé. **Sans lui, le planificateur ne démarre pas.**
#   PURGE_AT       heure de passage, HH:MM (défaut : 04:17)
#   MAX_TRIES      tentatives si l'application ne répond pas (défaut : 5)
# ──────────────────────────────────────────────────────────────────────────────
set -eu

URL=${RETENTION_URL:-http://app:3000/api/admin/retention}
AT=${PURGE_AT:-04:17}
MAX_TRIES=${MAX_TRIES:-5}

log() { echo "[purge] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }

if [ -z "${CRON_SECRET:-}" ]; then
  log "CRON_SECRET est absent : la purge planifiée est indisponible."
  log "Renseignez-le dans deploy/.env (24 caractères minimum), ou retirez ce service."
  exit 2
fi

case "$AT" in
  [0-2][0-9]:[0-5][0-9]) : ;;
  *) log "PURGE_AT=\"$AT\" invalide, attendu HH:MM."; exit 2 ;;
esac

TARGET_H=${AT%%:*}
TARGET_M=${AT##*:}
if [ "$TARGET_H" -gt 23 ]; then
  log "PURGE_AT=\"$AT\" invalide : heure > 23."
  exit 2
fi

seconds_until_target() {
  now_h=$(date -u +%H)
  now_m=$(date -u +%M)
  now_s=$(date -u +%S)
  # Les zéros de tête feraient interpréter la valeur en octal par certains shells.
  target=$(( ${TARGET_H#0} * 3600 + ${TARGET_M#0} * 60 ))
  current=$(( ${now_h#0} * 3600 + ${now_m#0} * 60 + ${now_s#0} ))
  delta=$(( (target - current + 86400) % 86400 ))
  [ "$delta" -eq 0 ] && delta=86400
  echo "$delta"
}

run_purge() {
  try=1
  while [ "$try" -le "$MAX_TRIES" ]; do
    body=$(mktemp)
    status=$(curl -s -o "$body" -w '%{http_code}' --max-time 120 \
      -X POST -H "X-SNRC-Cron-Token: $CRON_SECRET" "$URL" || echo 000)
    if [ "$status" = "200" ]; then
      log "ok $(tr -d '\n' < "$body")"
      rm -f "$body"
      return 0
    fi
    log "echec HTTP $status (essai $try/$MAX_TRIES) $(tr -d '\n' < "$body" | head -c 300)"
    rm -f "$body"
    # Un 401 ne se résoudra pas en réessayant : le secret est faux ou absent.
    [ "$status" = "401" ] && return 1
    try=$(( try + 1 ))
    sleep 60
  done
  return 1
}

log "planificateur demarre — passage quotidien a ${AT} UTC, cible ${URL}"

while true; do
  delay=$(seconds_until_target)
  log "prochain passage dans ${delay}s"
  sleep "$delay"
  run_purge || log "la purge n'a pas abouti ; nouvelle tentative au prochain passage"
done
