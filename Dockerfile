# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────
# S5Y Portfolio — single image: API + 3D site + admin dashboard
# ─────────────────────────────────────────────────────────────

FROM node:22-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ── Install dependencies (cached unless manifests change) ──
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY apps/api/prisma apps/api/prisma
RUN npm ci --no-audit --no-fund

# ── Build web, admin and api ──
FROM deps AS build
COPY . .
RUN npm run build \
 && npm prune --omit=dev --no-audit --no-fund

# ── Runtime ──
FROM base AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    STORAGE_DIR=/data/storage \
    WEB_DIST=/app/apps/web/dist \
    ADMIN_DIST=/app/apps/admin/dist

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/admin/dist ./apps/admin/dist
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /data/storage \
 && chown -R node:node /data

USER node
WORKDIR /app/apps/api
VOLUME ["/data/storage"]
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["tini", "--", "docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
