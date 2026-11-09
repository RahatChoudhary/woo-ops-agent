#!/usr/bin/env bash
# Convert a screen recording (.mov) into docs/demo.gif for the README.
# Usage: scripts/make-demo-gif.sh ~/Desktop/recording.mov
# Needs gifski (brew install gifski). Keeps the GIF under ~5 MB.
set -euo pipefail

input="${1:?Usage: scripts/make-demo-gif.sh <recording.mov>}"
output="docs/demo.gif"

if ! command -v gifski >/dev/null 2>&1; then
  echo "gifski not found. Install it with: brew install gifski" >&2
  exit 1
fi

# Full quality avoids ghosting on dark backgrounds; 1.3x speed keeps it near 30-60 s.
for width in 960 860 760; do
  gifski --quiet --fps 10 --width "$width" --quality 100 --motion-quality 100 \
    --lossy-quality 100 --fast-forward 1.3 -o "$output" "$input" 2>/dev/null
  size=$(stat -f%z "$output")
  echo "width ${width}px -> $((size / 1024)) KB" >&2
  if [ "$size" -le $((5 * 1024 * 1024)) ]; then
    echo "Saved $output" >&2
    exit 0
  fi
done

echo "Still over 5 MB. Record a shorter clip or a smaller window." >&2
exit 1
