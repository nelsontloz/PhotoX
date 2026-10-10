#!/usr/bin/env bash
# ponytail: fetches the YOLO26n ONNX export (~10MB, AGPL-3.0) of the official Ultralytics
# yolo26n.pt weights — exported with `model.export(format="onnx")`, NMS-free end-to-end output.
# Weights are never committed (see .gitignore *.onnx / data/).
# LICENSE TRIPWIRE: if PhotoX is ever distributed or served to third parties, these AGPL-3.0
# weights make the combined work AGPL — disclose source or swap models.
set -euo pipefail

source "$(dirname "$0")/lib.sh"

STORAGE_DIR="$(resolve_storage_dir)"
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
  echo "Downloading yolo26n.onnx ..."
  # best-effort: a missing model only disables object detection (process-detect warns + skips)
  if ! fetch_file "$URL" "$DEST" "$EXPECTED_SHA256"; then
    echo "WARNING: yolo26n.onnx download or sha256 verification failed — refusing to install; object detection stays unavailable until provisioned" >&2
  fi
fi

ls -la "$DEST" 2>/dev/null || true
