#!/usr/bin/env bash
# ponytail: fetches the PP-OCRv6 small ONNX det+rec models and the shared dictionary
# (from snowfluke/ppu-paddle-ocr-models, ~31MB total) for ppu-paddle-ocr offline use.
# Weights are never committed (see .gitignore *.onnx / data/).
set -euo pipefail

FORCE=''
if [ "${1:-}" = '--force' ]; then FORCE=1; fi

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
# shared-config anchors a relative STORAGE_DIR at the workspace root (core/worker run with
# different cwds) — mirror that so custom dirs and compose/e2e (STORAGE_DIR=/data/storage) work
STORAGE_DIR="${STORAGE_DIR:-data/storage}"
case "$STORAGE_DIR" in
  /*) ;;
  *) STORAGE_DIR="$ROOT_DIR/$STORAGE_DIR" ;;
esac
DEST_DIR="$STORAGE_DIR/models/pp-ocrv6-small"
BASE_URL="${OCR_MODEL_URL:-https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main}"

# "remote path" -> "local file name" (service reads exactly these names from DEST_DIR)
FILES=(
  "detection/PP-OCRv6_small_det.onnx det.onnx"
  "recognition/PP-OCRv6_small_rec.onnx rec.onnx"
  "recognition/ppocrv6_dict.txt dict.txt"
)

for ENTRY in "${FILES[@]}"; do
  SRC="${ENTRY%% *}"
  NAME="${ENTRY##* }"
  DEST="$DEST_DIR/$NAME"
  if [ -z "$FORCE" ] && [ -s "$DEST" ]; then
    echo "Already present: $NAME"
    continue
  fi

  mkdir -p "$DEST_DIR"
  TMP="${DEST}.tmp.XXXXXX"

  echo "Downloading $SRC ..."
  # best-effort: a partial model dir only disables OCR (process-ocr warns + skips)
  if curl -fSL --retry 3 -o "$TMP" "$BASE_URL/$SRC"; then
    mv -f "$TMP" "$DEST"
  else
    rm -f "$TMP"
    echo "WARNING: failed to download $NAME — OCR stays unavailable until provisioned" >&2
  fi
done

ls -la "$DEST_DIR" 2>/dev/null || true
