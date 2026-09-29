# -- deps --
FROM node:22-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-config/package.json ./packages/shared-config/
COPY apps/worker-service/package.json ./apps/worker-service/
# tfjs-node ships no linux-arm64 prebuilt (x64-only tarball) — rebuild its binding from source on arm64
# face model is provisioned into the runtime storage volume, not baked into the image
RUN FACE_MODEL_SKIP=1 pnpm install --frozen-lockfile || FACE_MODEL_SKIP=1 pnpm install
RUN if [ "$(uname -m)" = "aarch64" ]; then npm_config_build_from_source=true pnpm --filter @photox/worker-service rebuild @tensorflow/tfjs-node; fi

# -- build --
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared-types/ ./packages/shared-types/
COPY packages/shared-config/ ./packages/shared-config/
COPY apps/worker-service/ ./apps/worker-service/
RUN pnpm --filter @photox/shared-config build && \
    pnpm --filter @photox/shared-types build && \
    pnpm --filter @photox/worker-service build

# -- runtime --
FROM node:22-bookworm-slim AS runtime
RUN corepack enable
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared-types ./packages/shared-types
COPY --from=build /app/packages/shared-config ./packages/shared-config
COPY --from=build /app/apps/worker-service ./apps/worker-service
ENV NODE_ENV=production
EXPOSE 3004
CMD ["node", "apps/worker-service/dist/main.js"]
