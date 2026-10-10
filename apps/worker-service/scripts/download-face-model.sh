#!/usr/bin/env bash
# ponytail: fetches the official InsightFace buffalo_l recognition weights (w600k_r50.onnx, ~174MB)
# and the SCRFD det_10g detector (det_10g.onnx, ~17MB, from the community mirror below).
# Weights are for non-commercial research use and are never committed (see .gitignore *.onnx).
set -euo pipefail

source "$(dirname "$0")/lib.sh"

MODELS_DIR="$(resolve_storage_dir)/models"

# --- recognition: w600k_r50.onnx (official buffalo_l bundle) ---
WK_URL="${FACE_MODEL_URL:-https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip}"
WK_DEST="${FACE_MODEL_PATH:-$MODELS_DIR/w600k_r50.onnx}"

if [ -n "$FORCE" ] || [ ! -s "$WK_DEST" ]; then
  mkdir -p "$(dirname "$WK_DEST")"
  TMP="$(mktemp -t buffalo_l.XXXXXX.zip)"
  trap 'rm -f "$TMP"' EXIT

  echo "Downloading buffalo_l bundle..."
  fetch_file "$WK_URL" "$TMP"

  echo "Extracting w600k_r50.onnx to $WK_DEST..."
  if command -v unzip >/dev/null 2>&1; then
    unzip -j -o "$TMP" 'w600k_r50.onnx' -d "$(dirname "$WK_DEST")"
  else
    python3 - "$TMP" "$WK_DEST" <<'EOF'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    with z.open('w600k_r50.onnx') as src, open(sys.argv[2], 'wb') as dst:
        dst.write(src.read())
EOF
  fi

  trap - EXIT
  rm -f "$TMP"
else
  echo "Recognition model already present at $WK_DEST (use --force to re-fetch)"
fi

# --- detection: det_10g.onnx (SCRFD; InsightFace publishes it only inside buffalo_l, mirrored here) ---
DET_URL="${FACE_DETECTOR_MODEL_URL:-https://huggingface.co/deepghs/insightface/resolve/main/buffalo_l/det_10g.onnx}"
DET_DEST="${FACE_DETECTOR_MODEL_PATH:-$MODELS_DIR/det_10g.onnx}"

if [ -n "$FORCE" ] || [ ! -s "$DET_DEST" ]; then
  echo "Downloading det_10g.onnx to $DET_DEST..."
  # best-effort: human is the default detector, and the runtime/admin UI cover provisioning
  fetch_file "$DET_URL" "$DET_DEST" ||
    echo "WARNING: det_10g.onnx download failed — SCRFD stays unavailable until provisioned" >&2
else
  echo "Detector model already present at $DET_DEST (use --force to re-fetch)"
fi

ls -la "$WK_DEST" 2>/dev/null || true
ls -la "$DET_DEST" 2>/dev/null || true
