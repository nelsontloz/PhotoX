#!/usr/bin/env bash
# ponytail: fetches the official InsightFace buffalo_l bundle and extracts only w600k_r50.onnx (~174MB).
# Weights are for non-commercial research use and are never committed (see .gitignore *.onnx).
set -euo pipefail

URL="${FACE_MODEL_URL:-https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip}"
DEST="${FACE_MODEL_PATH:-$(cd "$(dirname "$0")/../../.." && pwd)/data/storage/models/w600k_r50.onnx}"

if [ "${1:-}" != '--force' ] && [ -s "$DEST" ]; then
  echo "Model already present at $DEST (use --force to re-fetch)"
  exit 0
fi

mkdir -p "$(dirname "$DEST")"
TMP="$(mktemp -t buffalo_l.XXXXXX.zip)"
trap 'rm -f "$TMP"' EXIT

echo "Downloading buffalo_l bundle..."
curl -fSL --retry 3 -o "$TMP" "$URL"

echo "Extracting w600k_r50.onnx to $DEST..."
if command -v unzip >/dev/null 2>&1; then
  unzip -j -o "$TMP" 'w600k_r50.onnx' -d "$(dirname "$DEST")"
else
  python3 - "$TMP" "$DEST" <<'EOF'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    with z.open('w600k_r50.onnx') as src, open(sys.argv[2], 'wb') as dst:
        dst.write(src.read())
EOF
fi

ls -la "$DEST"
