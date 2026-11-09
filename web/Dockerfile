# Dashboard image: static build served by unprivileged nginx on :8080.
# Build from the repository root (the pnpm workspace root):
#   docker build -f web/Dockerfile -t stellar-pay-analytics-web .
FROM node:26-alpine AS build
WORKDIR /app
RUN npm install --global pnpm@9.15.9
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY aggregator/package.json aggregator/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile --filter stellar-pay-analytics-web
COPY web ./web
RUN pnpm --filter stellar-pay-analytics-web run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=build /app/web/dist /usr/share/nginx/html
# Rendered at start by the image's envsubst step. ANALYTICS_TOKEN (the
# aggregator's STATS_BEARER_TOKEN) must be set at runtime; it stays server-side.
COPY web/nginx/default.conf.template /etc/nginx/templates/default.conf.template
ENV AGGREGATOR_URL=http://aggregator:4000
EXPOSE 8080
