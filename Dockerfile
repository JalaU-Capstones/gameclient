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
