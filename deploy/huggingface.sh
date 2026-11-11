#!/usr/bin/env bash
# Deploy (or update) VoltIQ on a Hugging Face Docker Space.
#   ./deploy/huggingface.sh <hf-username>/<space-name> [path/to/seed.csv]
# Requires: `hf auth login` once. Uploads the committed code (git HEAD), a Space README header,
# and optionally a seed CSV that the app loads automatically when its database is empty.
set -euo pipefail
cd "$(dirname "$0")/.."

SPACE="${1:?usage: deploy/huggingface.sh <user>/<space> [seed.csv]}"
SEED="${2:-seed/ev_charging.csv}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

git archive HEAD | tar -x -C "$STAGE"
{
  cat <<'YAML'
---
title: VoltIQ
emoji: ⚡
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 8000
pinned: false
short_description: EV charging energy demand forecasting dashboard
---

YAML
  cat README.md
} > "$STAGE/README.md"

if [ -f "$SEED" ]; then
  cp "$SEED" "$STAGE/seed/ev_charging.csv"
  echo "› Including seed dataset: $SEED"
fi

hf repo create "$SPACE" --repo-type space --space_sdk docker --exist-ok >/dev/null
hf upload "$SPACE" "$STAGE" . --repo-type space --commit-message "Deploy VoltIQ $(git rev-parse --short HEAD)"
echo "› Deployed. Build logs: https://huggingface.co/spaces/$SPACE  ·  App: https://${SPACE/\//-}.hf.space"
