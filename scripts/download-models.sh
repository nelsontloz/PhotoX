#!/usr/bin/env bash
# Postinstall entry (see package.json): provision the worker model bundles.
# Each download-*.sh skips when its model file is already present; FACE_MODEL_SKIP=1 skips all.
# No set -e: one failed download must not block the remaining models.
if [ "${FACE_MODEL_SKIP:-}" = 1 ]; then exit 0; fi
cd "$(dirname "$0")/.."
bash apps/worker-service/scripts/download-face-model.sh
bash apps/worker-service/scripts/download-vision-model.sh
bash apps/worker-service/scripts/download-ocr-model.sh
bash apps/worker-service/scripts/download-detect-model.sh
