# -- deps --
FROM node:20-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-config/package.json ./packages/shared-config/
COPY apps/file-storage-service/package.json ./apps/file-storage-service/
RUN pnpm install --frozen-lockfile || pnpm install

# -- build --
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/file-storage-service/ ./apps/file-storage-service/
RUN pnpm --filter @photox/shared-config build && \
    pnpm --filter @photox/shared-types build && \
    pnpm --filter @photox/file-storage-service build

# -- runtime --
FROM node:20-alpine AS runtime
RUN corepack enable
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build /app/packages/shared-types/package.json ./packages/shared-types/
COPY --from=build /app/packages/shared-config/dist ./packages/shared-config/dist
COPY --from=build /app/packages/shared-config/package.json ./packages/shared-config/
COPY --from=build /app/apps/file-storage-service/dist ./apps/file-storage-service/dist
COPY --from=build /app/apps/file-storage-service/package.json ./apps/file-storage-service/
ENV NODE_ENV=production
EXPOSE 3003
CMD ["node", "apps/file-storage-service/dist/main.js"]
