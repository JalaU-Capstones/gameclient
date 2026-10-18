# syntax=docker/dockerfile:1.7

# -----------------------------------------------------------------------------
# Base: shared layers for the dependency, build, and runtime stages.
# -----------------------------------------------------------------------------
FROM node:22.23-alpine AS base

RUN corepack enable \
 && corepack prepare pnpm@9.15.0 --activate \
 && apk add --no-cache tini

WORKDIR /app

# -----------------------------------------------------------------------------
# Deps: install ALL dependencies (including dev) for the build.
# -----------------------------------------------------------------------------
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Build: run the SvelteKit build with the PUBLIC_* values inlined.
# -----------------------------------------------------------------------------
FROM base AS build

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG PUBLIC_API_BASE
ARG PUBLIC_WS_BASE
ARG PUBLIC_REQUEST_TIMEOUT_MS=15000
ARG PUBLIC_LOG_ADMIN_EMAILS

ENV PUBLIC_API_BASE=${PUBLIC_API_BASE} \
    PUBLIC_WS_BASE=${PUBLIC_WS_BASE} \
    PUBLIC_REQUEST_TIMEOUT_MS=${PUBLIC_REQUEST_TIMEOUT_MS} \
    PUBLIC_LOG_ADMIN_EMAILS=${PUBLIC_LOG_ADMIN_EMAILS} \
    NODE_ENV=production

RUN pnpm build

# -----------------------------------------------------------------------------
# Runtime: minimal image, non-root, init process, healthcheck.
# -----------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

USER node

COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=deps --chown=node:node /app/node_modules ./node_modules

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/ || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "build"]
