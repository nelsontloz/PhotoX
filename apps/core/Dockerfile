# -- deps --
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-config/package.json ./packages/shared-config/
COPY packages/shared-auth/package.json ./packages/shared-auth/
COPY packages/data-access/package.json ./packages/data-access/
COPY apps/core/package.json ./apps/core/
RUN pnpm install --frozen-lockfile

# -- build --
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared-types/ ./packages/shared-types/
COPY packages/shared-config/ ./packages/shared-config/
COPY packages/shared-auth/ ./packages/shared-auth/
COPY packages/data-access/ ./packages/data-access/
COPY apps/core/ ./apps/core/
RUN pnpm --filter @photox/shared-config build && \
    pnpm --filter @photox/shared-types build && \
    pnpm --filter @photox/shared-auth build && \
    pnpm --filter @photox/data-access build && \
    pnpm --filter @photox/core build

# -- runtime --
FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/core ./apps/core
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "apps/core/dist/main.js"]
