#!/bin/sh
# Point d'entrée du conteneur applicatif.
#
# Applique les migrations avant de démarrer : un conteneur qui démarre sur un
# schéma périmé échouerait de façon diffuse, à la première requête, et pendant
# une émission.
set -eu

echo "[entrypoint] application des migrations de base de données…"
if ! npx prisma migrate deploy; then
  echo "[entrypoint] ÉCHEC des migrations. Le service ne démarre pas." >&2
  echo "[entrypoint] Vérifiez DATABASE_URL et l'accessibilité de PostgreSQL." >&2
  exit 1
fi
echo "[entrypoint] migrations à jour."

exec "$@"
