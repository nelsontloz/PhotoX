FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-config/package.json ./packages/shared-config/
COPY apps/web/package.json ./apps/web/
# face model is provisioned into the runtime storage volume, not baked into the image
RUN FACE_MODEL_SKIP=1 pnpm install --frozen-lockfile || FACE_MODEL_SKIP=1 pnpm install
COPY tsconfig.base.json ./
COPY apps/web/ ./apps/web/
WORKDIR /app/apps/web
EXPOSE 5173
CMD ["pnpm", "dev", "--host", "0.0.0.0"]
