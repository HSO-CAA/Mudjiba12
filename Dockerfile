# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────
# S5Y Portfolio — single image: API + 3D site + admin dashboard
#
#   docker build -t s5y-portfolio .
#   (normally you just run: docker compose up -d --build)
#
# Stages:
#   base       Node 22 + openssl (needed by Prisma's engines)
#   deps       all dependencies (to build web, admin and api)
#   prod-deps  only the API's runtime dependencies (keeps the image small:
#              no React/Three.js/Vite/TypeScript in production)
#   build      builds apps/web, apps/admin and apps/api
#   runtime    the final image: node + ffmpeg + built files, runs as non-root
# ─────────────────────────────────────────────────────────────

FROM node:22-bookworm-slim AS base
ENV CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ── Workspace manifests only (dependency layers stay cached until these change) ──
FROM base AS manifests
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
# `prisma generate` runs on install (postinstall) and needs the schema.
COPY apps/api/prisma apps/api/prisma

FROM manifests AS deps
RUN npm ci

# Only what `node dist/index.js` and `prisma migrate deploy` need at runtime.
FROM manifests AS prod-deps
RUN npm ci --omit=dev --workspace=@s5y/api

# ── Build web, admin and api ──
FROM deps AS build
COPY . .
RUN npm run build

# ── Runtime ──
FROM base AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tini \
 && rm -rf /var/lib/apt/lists/* \
 && ffmpeg -hide_banner -version | head -n 1

ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    STORAGE_DIR=/data/storage \
    WEB_DIST=/app/apps/web/dist \
    ADMIN_DIST=/app/apps/admin/dist

COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/admin/dist ./apps/admin/dist
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Strip Windows line endings (in case the file was edited on Windows) and prepare the media volume.
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
 && chmod 755 /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /data/storage \
 && chown -R node:node /data

# Runs as the unprivileged `node` user (uid 1000); only /data/storage is writable.
USER node
WORKDIR /app/apps/api
VOLUME ["/data/storage"]
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["tini", "--", "docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
