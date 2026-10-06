# Multi-stage Dockerfile for Sol Bazaar
# Builds both the web app and worker in a single image

# ─── Base ───────────────────────────────────────────────────────────────────
FROM node:26.10-alpine AS base
RUN apk add --no-cache openssl postgresql-client
WORKDIR /app

# ─── Dependencies ───────────────────────────────────────────────────────────
FROM base AS deps
COPY package*.json ./
COPY packages/*/package*.json ./packages/
COPY apps/*/package*.json ./apps/
RUN npm ci --ignore-scripts

# ─── Generate Prisma ────────────────────────────────────────────────────────
FROM deps AS prisma
COPY prisma ./prisma/
RUN npm run db:generate

# ─── Builder ────────────────────────────────────────────────────────────────
FROM prisma AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─── Runner ─────────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/packages ./packages
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

USER nextjs

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Default command runs the web server
CMD ["node", "apps/web/server.js"]