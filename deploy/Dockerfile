# ──────────────────────────────────────────────────────────────────────────────
# Broadcast SN Remote Call — image applicative
#
# Trois étapes : dépendances, compilation, exécution. L'image finale ne contient
# ni le code source, ni les outils de compilation, ni les dépendances de
# développement.
# ──────────────────────────────────────────────────────────────────────────────

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# OpenSSL est requis par le moteur Prisma.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── Compilation ───────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `next build` lance `prisma generate` (cf. le script "build").
# Les secrets ne sont PAS nécessaires à la compilation : le client Prisma est
# créé paresseusement et la validation de configuration n'a lieu qu'à l'exécution.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Exécution ─────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs snrc

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Sortie autonome de Next.
COPY --from=builder --chown=snrc:nodejs /app/.next/standalone ./
COPY --from=builder --chown=snrc:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=snrc:nodejs /app/public ./public

# Nécessaires aux migrations exécutées au démarrage (entrypoint).
COPY --from=builder --chown=snrc:nodejs /app/prisma ./prisma
COPY --from=builder --chown=snrc:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=deps --chown=snrc:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=deps --chown=snrc:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=deps --chown=snrc:nodejs /app/node_modules/dotenv ./node_modules/dotenv
COPY --from=deps --chown=snrc:nodejs /app/node_modules/.bin ./node_modules/.bin

COPY --chown=snrc:nodejs deploy/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER snrc
EXPOSE 3000

# La sonde interroge la route qui teste réellement la base : un conteneur dont
# la base est injoignable ne doit pas être déclaré sain.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "server.js"]
