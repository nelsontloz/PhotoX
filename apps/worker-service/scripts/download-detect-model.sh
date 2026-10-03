#!/usr/bin/env bash
# ponytail: fetches the YOLO26n ONNX export (~10MB, AGPL-3.0) of the official Ultralytics
# yolo26n.pt weights — exported with `model.export(format="onnx")`, NMS-free end-to-end output.
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
DEST_DIR="$STORAGE_DIR/models/yolo26n"
DEST="$DEST_DIR/yolo26n.onnx"
URL="${DETECT_MODEL_URL:-https://huggingface.co/prithivMLmods/YOLO26-ONNX/resolve/main/yolo26n/yolo26n.onnx}"

if [ -z "$FORCE" ] && [ -s "$DEST" ]; then
  echo "Detection model already present at $DEST (use --force to re-fetch)"
else
  mkdir -p "$DEST_DIR"
  TMP="${DEST}.tmp.XXXXXX"

  echo "Downloading yolo26n.onnx ..."
  # best-effort: a missing model only disables object detection (process-detect warns + skips)
  if curl -fSL --retry 3 -o "$TMP" "$URL"; then
    mv -f "$TMP" "$DEST"
  else
    rm -f "$TMP"
    echo "WARNING: yolo26n.onnx download failed — object detection stays unavailable until provisioned" >&2
  fi
fi

ls -la "$DEST" 2>/dev/null || true
