#!/usr/bin/env bash
# Starts a run on the deployed service and logs every SSE line with its arrival time.
# Usage: bash scripts/cloud-run-sse.sh <baseUrl> <projectId> <ko|en> <standard|brief> <outFile>
set -euo pipefail
base="${1%/}"
# The runs route refuses a POST without a same-site Origin (src/lib/store/access.ts sameOrigin).
origin="$(printf '%s' "$base" | sed -E 's#^(https?://[^/]+).*#\1#')"
curl -sN --max-time 900 -X POST -H 'Content-Type: application/json' -H "Origin: $origin" \
  -d "{\"language\":\"$3\",\"density\":\"$4\"}" "$base/api/projects/$2/runs" |
  while IFS= read -r line; do
    [ -n "$line" ] && printf '%s\t%s\n' "$(date +%s.%N | cut -c1-14)" "$line"
  done > "$5"
