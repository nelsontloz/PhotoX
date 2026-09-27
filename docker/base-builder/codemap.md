# docker/base-builder/

## Responsibility

Single `Dockerfile` (3 lines) that defines the CI builder image:

```dockerfile
FROM node:22-alpine
RUN apk add --no-cache python3 make g++ libheif
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
```

It is the canonical `node:22-alpine` + native-build-toolchain + pnpm image for the workspace. The Jenkins pipeline references the published artifact (`registry.int.zerg91.com/photox/node-builder:22-alpine`); this Dockerfile is the source that image is built from. It is intentionally not referenced by `docker-compose.yml` or the app Dockerfiles — those build from plain `node:22-alpine` on purpose.

## Design

- `python3`, `make`, `g++` are the build toolchain for native addons compiled from source during `pnpm install` (`argon2` in core, `sharp` in core/worker, `@tensorflow/tfjs-node` in the worker). The image preinstalls them so CI installs never fail on a missing compiler for modules without a musl prebuild.
- `libheif` provides HEIC/HEIF decode support used by image processing (sharp delegates some formats to system libs); it is an OS package rather than an npm dependency.
- `corepack enable && corepack prepare pnpm@9.15.0 --activate` pins the exact pnpm version declared in root `package.json` (`packageManager`), so CI installs match developer lockfiles. This mirrors the `corepack enable` lines in every `apps/*/Dockerfile`.
- No `COPY`/`WORKDIR`/`CMD`: this is a base image only; consumers add their own workspace layers.

## Flow

1. Built out-of-band (manual/CI image build) and pushed to the internal registry as `photox/node-builder:22-alpine`.
2. Jenkins' `node` container pulls it and runs `pnpm install --frozen-lockfile`, shared-package builds, parallel lint/typecheck/test, then `pnpm build`.
3. Tests that need containers run on the sibling `dind` container, not here.

## Integration

- Consumed by `Jenkinsfile` (`container('node')` image), not by compose.
- Keep the Node and pnpm versions in lockstep with `.nvmrc` (Node 22) and root `package.json` (`pnpm@9.15.0`); drift here breaks `--frozen-lockfile` installs.
- Touching this file requires rebuilding/re-pushing the registry image — there is no automated pipeline stage for it in this repo.
