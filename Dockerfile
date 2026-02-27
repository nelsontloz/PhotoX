### Phase 1: Base runtime
FROM node:22-alpine AS base

# Required tools:
# - git: pact publish scripts use git metadata
# - python3/make/g++/pkgconf: native addon build toolchain (argon2/sharp fallback)
# - ffmpeg: worker media tooling paths
# - ca-certificates: TLS trust for broker and registry access
# - gcompat: provides libcrypt.so.1 compatibility for Pact Ruby runtime on Alpine
RUN apk add --no-cache \
    bash \
    git \
    python3 \
    make \
    g++ \
    pkgconf \
    ffmpeg \
    ca-certificates \
    gcompat

WORKDIR /workspace
COPY . .

RUN bash ./scripts/full-build.sh

# Default command runs the repository master build workflow.
# CMD ["bash", "./scripts/full-build.sh"]
