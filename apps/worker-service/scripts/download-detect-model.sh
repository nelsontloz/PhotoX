#!/usr/bin/env bash
# ponytail: fetches the YOLO26n ONNX export (~10MB, AGPL-3.0) of the official Ultralytics
# yolo26n.pt weights — exported with `model.export(format="onnx")`, NMS-free end-to-end output.
# Weights are never committed (see .gitignore *.onnx / data/).
# LICENSE TRIPWIRE: if PhotoX is ever distributed or served to third parties, these AGPL-3.0
# weights make the combined work AGPL — disclose source or swap models.
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

# Pinned to HF commit c526dae7a5a5b4f1d79d704903b4406011da2716 (2026-07-19): resolve/main is
# mutable, and the sha256 below is enforced or the download is refused. A DETECT_MODEL_URL
# override must serve byte-identical weights.
REVISION='c526dae7a5a5b4f1d79d704903b4406011da2716'
EXPECTED_SHA256='00e2d1062178fca312fee35cf5fc9b9c783b3e5c9675d48b84929f69ee391807'
URL="${DETECT_MODEL_URL:-https://huggingface.co/prithivMLmods/YOLO26-ONNX/resolve/$REVISION/yolo26n/yolo26n.onnx}"

if [ -z "$FORCE" ] && [ -s "$DEST" ]; then
  echo "Detection model already present at $DEST (use --force to re-fetch)"
else
  mkdir -p "$DEST_DIR"
  TMP="${DEST}.tmp.XXXXXX"

  CHECKER='sha256sum'
  command -v sha256sum >/dev/null 2>&1 || CHECKER='shasum -a 256'

  echo "Downloading yolo26n.onnx ..."
  # best-effort: a missing model only disables object detection (process-detect warns + skips)
  if curl -fSL --retry 3 -o "$TMP" "$URL" &&
    echo "$EXPECTED_SHA256  $TMP" | $CHECKER -c - >/dev/null 2>&1; then
    mv -f "$TMP" "$DEST"
  else
    rm -f "$TMP"
    echo "WARNING: yolo26n.onnx download or sha256 verification failed — refusing to install; object detection stays unavailable until provisioned" >&2
  fi
fi

ls -la "$DEST" 2>/dev/null || true
