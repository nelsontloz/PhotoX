#!/usr/bin/env bash
# Regenerates the tiny media fixtures used by the e2e suite. Idempotent: overwrites in place.
# face.jpg is the one exception — it is committed, not generated, because face detection needs a
# real face. Source: the official White House portrait of Barack Obama by Pete Souza, public
# domain (work of the U.S. federal government), fetched once from Wikimedia Commons:
#   https://upload.wikimedia.org/wikipedia/commons/8/8d/President_Barack_Obama.jpg
# Downscaled once with: ffmpeg -i <source> -vf scale=512:-1 -q:v 4 face.jpg
# Never substitute personal photos from data/storage/originals.
set -euo pipefail
cd "$(dirname "$0")"

ROOT="$(cd ../.. && pwd)"
FFMPEG="$ROOT/apps/worker-service/node_modules/ffmpeg-static/ffmpeg"

"$FFMPEG" -y -hide_banner -f lavfi -i "testsrc2=size=800x600:rate=1" -frames:v 1 -q:v 3 photo.jpg
"$FFMPEG" -y -hide_banner -f lavfi -i "testsrc2=size=320x240:rate=10" -f lavfi -i "sine=frequency=440:sample_rate=44100" -t 2 -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 64k -shortest video-h264.mp4
"$FFMPEG" -y -hide_banner -f lavfi -i "testsrc2=size=320x240:rate=10" -f lavfi -i "sine=frequency=440:sample_rate=44100" -t 2 -c:v libvpx -deadline realtime -cpu-used 8 -b:v 200k -c:a libopus -b:a 64k -shortest video-vp8.webm

# OCR target: rendered with sharp (a worker dep) instead of ffmpeg drawtext — PP-OCRv6 misreads
# drawtext's rasterization of the trailing digits ("PHOTOX-OCR-123" -> "PHOTOX-OCR-12" + CJK
# noise); this SVG text path reads back exactly (same approach as the worker's OCR smoke test).
FIXTURE_ROOT="$ROOT" node - <<'EOF'
const { createRequire } = require('node:module')
const workerRequire = createRequire(process.env.FIXTURE_ROOT + '/apps/worker-service/package.json')
const sharp = workerRequire('sharp')
const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="260">' +
    '<rect width="1000" height="260" fill="white"/>' +
    '<text x="500" y="160" font-family="sans-serif" font-size="110" font-weight="bold" ' +
    'text-anchor="middle" fill="black">PHOTOX-OCR-123</text></svg>',
)
sharp(svg)
  .jpeg({ quality: 90 })
  .toFile('photo-text.jpg')
  .then(() => console.log('photo-text.jpg'))
EOF
