# -- deps --
FROM node:22-bookworm-slim AS deps
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-config/package.json ./packages/shared-config/
COPY apps/worker-service/package.json ./apps/worker-service/
# face model is provisioned into the runtime storage volume, not baked into the image
RUN FACE_MODEL_SKIP=1 pnpm install --frozen-lockfile

# -- build --
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared-types/ ./packages/shared-types/
COPY packages/shared-config/ ./packages/shared-config/
COPY apps/worker-service/ ./apps/worker-service/
RUN pnpm --filter @photox/shared-types build && \
    pnpm --filter @photox/shared-config build && \
    pnpm --filter @photox/worker-service build
# prod-only deploy so the runtime carries only worker prod deps (onnx/sharp incl.)
RUN FACE_MODEL_SKIP=1 pnpm --filter @photox/worker-service --prod deploy /prod/worker

# -- runtime --
FROM node:22-bookworm-slim AS runtime
RUN corepack enable
# ffprobe-static has no linux/arm64 binary and ffmpeg-static's lacks libsvtav1 — use system ffmpeg.
# Installed before any source COPYs so apt re-runs only when the base image changes, not on code edits.
RUN if [ "$(uname -m)" = "aarch64" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends ffmpeg \
      && rm -rf /var/lib/apt/lists/*; \
    fi
WORKDIR /app
COPY --from=build /prod/worker/package.json ./package.json
COPY --from=build /prod/worker/dist ./dist
COPY --from=build /prod/worker/node_modules ./node_modules
# arm64 shims pointing the static-binary paths at system ffmpeg/ffprobe (cheap, no apt)
RUN if [ "$(uname -m)" = "aarch64" ]; then \
      ffprobe="$(node -p 'require("ffprobe-static").path')" \
      && mkdir -p "$(dirname "$ffprobe")" \
      && ln -sf /usr/bin/ffprobe "$ffprobe" \
      && ffmpeg_bin="$(node -p 'require("ffmpeg-static")')" \
      && ln -sf /usr/bin/ffmpeg "$ffmpeg_bin"; \
    fi
ENV NODE_ENV=production
EXPOSE 3004
CMD ["node", "dist/main.js"]
