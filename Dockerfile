# syntax=docker/dockerfile:1.7

FROM node:24.13.1-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build

FROM node:24.13.1-bookworm-slim AS api
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/drizzle ./drizzle
USER node
EXPOSE 3001
CMD ["node", "dist-server/server/index.js"]

FROM caddy:2.10.2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 80 443

FROM api AS render
ENV STATIC_ROOT=/app/dist
COPY --from=build /app/dist ./dist
