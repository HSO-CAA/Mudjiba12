#!/bin/sh
# S5Y container entrypoint: apply pending database migrations, then start the server.
#   SKIP_MIGRATIONS=1      skip the migration step (e.g. when you run several app replicas)
#   MIGRATE_RETRIES=30     how many times to retry while the database is still starting (2 s apart)
set -e

APP_DIR="${APP_DIR:-/app}"

if [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
  echo "[s5y] applying database migrations…"
  tries="${MIGRATE_RETRIES:-30}"
  n=1
  until node "$APP_DIR/node_modules/prisma/build/index.js" migrate deploy --schema "$APP_DIR/apps/api/prisma/schema.prisma"; do
    if [ "$n" -ge "$tries" ]; then
      echo "[s5y] ✖ could not apply migrations after $n attempts — is DATABASE_URL correct and the database running?" >&2
      exit 1
    fi
    echo "[s5y] database not ready yet (attempt $n/$tries), retrying in 2 s…" >&2
    n=$((n + 1))
    sleep 2
  done
fi

exec "$@"
