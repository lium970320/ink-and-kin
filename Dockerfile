# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

# Server bundle + client static assets (dist/), dependencies (drizzle-kit kept
# for schema push on boot), and drizzle schema for migrations
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/server/templates/builtin ./server/templates/builtin
COPY --from=build /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build /app/skill-engine ./skill-engine
COPY --from=build /app/LICENSE ./LICENSE
COPY drizzle.config.ts package.json ./
COPY scripts/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
