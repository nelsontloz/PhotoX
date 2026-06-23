# -- deps --
FROM node:20-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-config/package.json ./packages/shared-config/
COPY apps/worker-service/package.json ./apps/worker-service/
RUN pnpm install --frozen-lockfile || pnpm install

# -- build --
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/worker-service/ ./apps/worker-service/
RUN pnpm --filter @photox/shared-config build && \
    pnpm --filter @photox/shared-types build && \
    pnpm --filter @photox/worker-service build

# -- runtime --
FROM node:20-alpine AS runtime
RUN corepack enable
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build /app/packages/shared-types/package.json ./packages/shared-types/
COPY --from=build /app/packages/shared-config/dist ./packages/shared-config/dist
COPY --from=build /app/packages/shared-config/package.json ./packages/shared-config/
COPY --from=build /app/apps/worker-service/dist ./apps/worker-service/dist
COPY --from=build /app/apps/worker-service/package.json ./apps/worker-service/
ENV NODE_ENV=production
EXPOSE 3004
CMD ["node", "apps/worker-service/dist/main.js"]
