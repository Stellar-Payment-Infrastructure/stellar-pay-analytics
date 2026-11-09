# Aggregator image. Build from the repository root (the pnpm workspace root):
#   docker build -f aggregator/Dockerfile -t stellar-pay-analytics-aggregator .
# Configuration comes from environment variables (see aggregator/.env.example).

FROM node:22-alpine AS build
WORKDIR /app
RUN npm install --global pnpm@9.15.9
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY aggregator/package.json aggregator/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile --filter stellar-pay-analytics-aggregator
COPY aggregator ./aggregator
RUN pnpm --filter stellar-pay-analytics-aggregator run build

FROM node:22-alpine AS prod-deps
WORKDIR /app
RUN npm install --global pnpm@9.15.9
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY aggregator/package.json aggregator/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile --prod --filter stellar-pay-analytics-aggregator

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/aggregator/node_modules ./aggregator/node_modules
COPY --from=build /app/aggregator/dist ./aggregator/dist
# Migrations run on start (MIGRATE_ON_START=true) from ./drizzle.
COPY --from=build /app/aggregator/drizzle ./aggregator/drizzle
COPY aggregator/package.json ./aggregator/
WORKDIR /app/aggregator
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
