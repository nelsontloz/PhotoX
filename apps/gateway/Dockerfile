# -- deps --
FROM node:20-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-config/package.json ./packages/shared-config/
COPY packages/shared-auth/package.json ./packages/shared-auth/
COPY apps/gateway/package.json ./apps/gateway/
RUN pnpm install --frozen-lockfile || pnpm install

# -- build --
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared-types/ ./packages/shared-types/
COPY packages/shared-config/ ./packages/shared-config/
COPY packages/shared-auth/ ./packages/shared-auth/
COPY apps/gateway/ ./apps/gateway/
RUN pnpm --filter @photox/shared-config build && \
    pnpm --filter @photox/shared-types build && \
    pnpm --filter @photox/shared-auth build && \
    pnpm --filter @photox/gateway build

# -- runtime --
FROM node:20-alpine AS runtime
RUN corepack enable
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build /app/packages/shared-types/package.json ./packages/shared-types/
COPY --from=build /app/packages/shared-config/dist ./packages/shared-config/dist
COPY --from=build /app/packages/shared-config/package.json ./packages/shared-config/
COPY --from=build /app/packages/shared-auth/dist ./packages/shared-auth/dist
COPY --from=build /app/packages/shared-auth/package.json ./packages/shared-auth/
COPY --from=build /app/apps/gateway/dist ./apps/gateway/dist
COPY --from=build /app/apps/gateway/package.json ./apps/gateway/
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "apps/gateway/dist/main.js"]
