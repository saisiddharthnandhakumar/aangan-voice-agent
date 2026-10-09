#!/usr/bin/env bash
# Shared settings for the tool curl scripts. Reads VAANI_TOOL_SECRET from .env.local without printing it.
set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:3000}"
SECRET="$(grep -E '^VAANI_TOOL_SECRET=' "$(dirname "$0")/../../.env.local" | cut -d= -f2-)"
post() { # post <tool> <json>
  curl -sS -X POST "$BASE_URL/api/vaani/tools/$1" -H "Content-Type: application/json" -H "X-Tool-Secret: $SECRET" -d "$2" -w '\n'
}
