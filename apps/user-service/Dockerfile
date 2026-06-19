# -- deps --
FROM node:20-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-events/package.json ./packages/shared-events/
COPY packages/shared-redis/package.json ./packages/shared-redis/
COPY packages/shared-config/package.json ./packages/shared-config/
COPY apps/user-service/package.json ./apps/user-service/
RUN pnpm install --frozen-lockfile || pnpm install

# -- build --
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/user-service/ ./apps/user-service/
RUN pnpm --filter @photox/shared-config build && \
    pnpm --filter @photox/shared-types build && \
    pnpm --filter @photox/shared-events build && \
    pnpm --filter @photox/shared-redis build && \
    pnpm --filter @photox/user-service build

# -- runtime --
FROM node:20-alpine AS runtime
RUN corepack enable
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build /app/packages/shared-types/package.json ./packages/shared-types/
COPY --from=build /app/packages/shared-events/dist ./packages/shared-events/dist
COPY --from=build /app/packages/shared-events/package.json ./packages/shared-events/
COPY --from=build /app/packages/shared-redis/dist ./packages/shared-redis/dist
COPY --from=build /app/packages/shared-redis/package.json ./packages/shared-redis/
COPY --from=build /app/packages/shared-config/dist ./packages/shared-config/dist
COPY --from=build /app/packages/shared-config/package.json ./packages/shared-config/
COPY --from=build /app/apps/user-service/dist ./apps/user-service/dist
COPY --from=build /app/apps/user-service/package.json ./apps/user-service/
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "apps/user-service/dist/main.js"]
