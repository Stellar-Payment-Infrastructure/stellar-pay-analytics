# Build context: the repository root (needs the workspace for stellar-pay-sdk).
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter stellar-pay-analytics-web... \
 && pnpm --filter stellar-pay-sdk run build \
 && pnpm --filter stellar-pay-analytics-web run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=build /repo/stellar-pay-analytics/web/dist /usr/share/nginx/html
COPY stellar-pay-analytics/web/nginx/default.conf.template /etc/nginx/templates/default.conf.template
ENV AGGREGATOR_URL=http://aggregator:4000
EXPOSE 8080
