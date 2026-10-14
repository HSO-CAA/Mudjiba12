#!/bin/sh
set -e
# Apply pending database migrations, then start the server.
echo "[s5y] applying database migrations…"
node /app/node_modules/prisma/build/index.js migrate deploy --schema /app/apps/api/prisma/schema.prisma
exec "$@"
