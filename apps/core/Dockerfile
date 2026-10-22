# -- deps --
FROM node:24-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-config/package.json ./packages/shared-config/
COPY apps/core/package.json ./apps/core/
# face model is provisioned into the runtime storage volume, not baked into the image
RUN FACE_MODEL_SKIP=1 pnpm install --frozen-lockfile

# -- build --
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared-types/ ./packages/shared-types/
COPY packages/shared-config/ ./packages/shared-config/
COPY apps/core/ ./apps/core/
RUN pnpm --filter @photox/shared-types build && \
    pnpm --filter @photox/shared-config build && \
    pnpm --filter @photox/core build
# prod-only deploy: drops devDeps and unrelated workspace packages (worker/web heavies)
# so the runtime carries only what core's dist imports (incl. argon2/sharp natives)
RUN FACE_MODEL_SKIP=1 pnpm --filter @photox/core --prod deploy /prod/core

# -- runtime --
FROM node:24-alpine AS runtime
RUN corepack enable
WORKDIR /app
COPY --from=build /prod/core/package.json ./package.json
COPY --from=build /prod/core/dist ./dist
COPY --from=build /prod/core/node_modules ./node_modules
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/main.js"]
