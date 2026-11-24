# FINA go — satu image: API (Hono, Node) + FE statis (app/) di domain yang sama.
# Data persisten di volume /data: SQLite (finago.db) + file lampiran (files/).
# Build dari ROOT repo:  docker build -t finago .
FROM node:22-bookworm-slim

WORKDIR /app/backend
# dev deps ikut (tsx buat run TS, drizzle-kit buat migrate saat start) — app kecil, gak perlu build step
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force

COPY backend/ ./
COPY app/ ./public/
# FE di container manggil API di origin yang sama (bukan URL Workers)
RUN sed -i 's|window.FG_API = "[^"]*"|window.FG_API = "same-origin"|' public/index.html \
 && grep -q 'window.FG_API = "same-origin"' public/index.html \
 && mkdir -p /data/files && chown -R node:node /data

ENV NODE_ENV=production \
    PORT=8787 \
    STATIC_DIR=public \
    DATABASE_URL=file:/data/finago.db \
    R2_DIR=/data/files \
    SYNC_PROVIDER=none
VOLUME /data
EXPOSE 8787
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# migrate idempotent (drizzle __drizzle_migrations) lalu start
CMD ["sh", "-c", "npx drizzle-kit migrate && exec npx tsx src/index.ts"]
