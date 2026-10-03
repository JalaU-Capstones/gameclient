# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG PUBLIC_API_BASE=""
ARG PUBLIC_WS_BASE=""
ARG PUBLIC_REQUEST_TIMEOUT_MS="15000"
ENV PUBLIC_API_BASE=$PUBLIC_API_BASE
ENV PUBLIC_WS_BASE=$PUBLIC_WS_BASE
ENV PUBLIC_REQUEST_TIMEOUT_MS=$PUBLIC_REQUEST_TIMEOUT_MS

RUN pnpm build
RUN pnpm prune --prod --ignore-scripts

FROM node:22-alpine AS runtime
RUN corepack enable && addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
COPY --from=build --chown=app:app /app/build ./build
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/package.json ./package.json
USER app
EXPOSE 3000
CMD ["node", "build"]
