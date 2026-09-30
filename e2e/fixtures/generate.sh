#!/usr/bin/env bash
# Regenerates the tiny media fixtures used by the e2e suite. Idempotent: overwrites in place.
set -euo pipefail
cd "$(dirname "$0")"

ROOT="$(cd ../../../.. && pwd)"
FFMPEG="$ROOT/apps/worker-service/node_modules/ffmpeg-static/ffmpeg"

"$FFMPEG" -y -hide_banner -f lavfi -i "testsrc2=size=800x600:rate=1" -frames:v 1 -q:v 3 photo.jpg
"$FFMPEG" -y -hide_banner -f lavfi -i "testsrc2=size=320x240:rate=10" -f lavfi -i "sine=frequency=440:sample_rate=44100" -t 2 -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 64k -shortest video-h264.mp4
"$FFMPEG" -y -hide_banner -f lavfi -i "testsrc2=size=320x240:rate=10" -f lavfi -i "sine=frequency=440:sample_rate=44100" -t 2 -c:v libvpx -deadline realtime -cpu-used 8 -b:v 200k -c:a libopus -b:a 64k -shortest video-vp8.webm
