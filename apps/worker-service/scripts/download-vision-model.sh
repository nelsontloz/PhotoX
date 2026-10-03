#!/usr/bin/env bash
# ponytail: fetches SigLIP2-B/16-224 ONNX weights (Apache-2.0, from google/siglip2-base-patch16-224)
# for transformers.js offline use — int8 vision + text encoders plus config/tokenizer files.
# Weights are never committed (see .gitignore *.onnx / data/).
set -euo pipefail

FORCE=''
if [ "${1:-}" = '--force' ]; then FORCE=1; fi

MODELS_DIR="$(cd "$(dirname "$0")/../../.." && pwd)/data/storage/models"
DEST_DIR="$MODELS_DIR/siglip2-b16-224"
BASE_URL="${SIGLIP_MODEL_URL:-https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX/resolve/main}"

FILES=(
  config.json
  preprocessor_config.json
  tokenizer.json
  tokenizer_config.json
  special_tokens_map.json
  onnx/vision_model_int8.onnx
  onnx/text_model_int8.onnx
)

for FILE in "${FILES[@]}"; do
  DEST="$DEST_DIR/$FILE"
  if [ -z "$FORCE" ] && [ -s "$DEST" ]; then
    echo "Already present: $FILE"
    continue
  fi

  mkdir -p "$(dirname "$DEST")"
  TMP="${DEST}.tmp.XXXXXX"

  echo "Downloading $FILE ..."
  # best-effort: a partial model dir only disables vision search (process-embeddings warns + skips)
  if curl -fSL --retry 3 -o "$TMP" "$BASE_URL/$FILE"; then
    mv -f "$TMP" "$DEST"
  else
    rm -f "$TMP"
    echo "WARNING: failed to download $FILE — vision search stays unavailable until provisioned" >&2
  fi
done

ls -la "$DEST_DIR/onnx" 2>/dev/null || true
