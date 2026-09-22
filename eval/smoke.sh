#!/usr/bin/env bash
# Smoke test: for every model in worker/config.json, creates a chat pinned to
# that model, sends 3 messages, prints the streamed reply and the stored token
# counts. Run against a local `npm run dev` (default) or a deployed URL:
#   BASE_URL=https://lechuga-dev... eval/smoke.sh
#
# Since Phase 2 every /api route needs a signed-in user, so pass a session
# cookie. Sign in once in a browser, then copy the request "Cookie" header
# from any /api call in devtools (Network tab) and export it whole:
#   SESSION_COOKIE='__Secure-better-auth.session_token=...' eval/smoke.sh
# (Locally, over http, the cookie is named better-auth.session_token.)
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8787}"
SESSION_COOKIE="${SESSION_COOKIE:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "$SESSION_COOKIE" ]]; then
  echo "SESSION_COOKIE is not set; see the comment at the top of this script." >&2
  exit 1
fi

MODEL_IDS=$(python3 -c "
import json
with open('$SCRIPT_DIR/../worker/config.json') as f:
    for m in json.load(f)['models']:
        print(m['id'])
")

send_message() {
  local chat_id="$1"
  local content="$2"
  echo "--- sending: $content"
  curl -sS -N -X POST "$BASE_URL/api/chats/$chat_id/messages" \
    -H "cookie: $SESSION_COOKIE" \
    -H 'content-type: application/json' \
    -d "{\"content\": $(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$content")}"
  echo
}

while IFS= read -r MODEL; do
  echo "=== model: $MODEL ==="
  CHAT_ID=$(curl -sS -X POST "$BASE_URL/api/chats" \
    -H "cookie: $SESSION_COOKIE" \
    -H 'content-type: application/json' \
    -d "{\"model\": \"$MODEL\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
  echo "chat id: $CHAT_ID"

  send_message "$CHAT_ID" "Hello, who are you?"
  send_message "$CHAT_ID" "What's 2 + 2?"
  send_message "$CHAT_ID" "Repeat the first number I gave you."

  echo "--- stored messages and token counts ---"
  curl -sS "$BASE_URL/api/chats/$CHAT_ID" -H "cookie: $SESSION_COOKIE" | python3 -m json.tool
  echo
done <<< "$MODEL_IDS"
