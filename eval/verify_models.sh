#!/usr/bin/env bash
# Fast per-model sanity check: for every model in worker/config.json, creates
# a chat, sends one message, and confirms the stream produced a non-empty
# reply with non-zero prompt/completion token counts. Meant to catch a wrong
# or deprecated model id quickly, separate from the fuller eval/smoke.sh.
# Run against a local `npm run dev` (default) or a deployed URL:
# BASE_URL=https://lechuga-dev... eval/verify_models.sh
#
# Every /api route needs a signed-in user, so pass a session cookie (see the
# comment at the top of eval/smoke.sh for where to copy it from):
#   SESSION_COOKIE='...' eval/verify_models.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8787}"
SESSION_COOKIE="${SESSION_COOKIE:-}"
if [[ -z "$SESSION_COOKIE" ]]; then
  echo "SESSION_COOKIE is not set; see the comment at the top of this script." >&2
  exit 1
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODEL_IDS=$(python3 -c "
import json
with open('$SCRIPT_DIR/../worker/config.json') as f:
    for m in json.load(f)['models']:
        print(m['id'])
")

FAILED=0

while IFS= read -r MODEL; do
  CHAT_ID=$(curl -sS -X POST "$BASE_URL/api/chats" -H "cookie: $SESSION_COOKIE" \
    -H 'content-type: application/json' \
    -d "{\"model\": \"$MODEL\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

  curl -sS -N -X POST "$BASE_URL/api/chats/$CHAT_ID/messages" -H "cookie: $SESSION_COOKIE" \
    -H 'content-type: application/json' \
    -d '{"content": "Reply with the single word: lettuce"}' > /dev/null

  RESULT=$(curl -sS "$BASE_URL/api/chats/$CHAT_ID" -H "cookie: $SESSION_COOKIE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
assistant = [m for m in data['messages'] if m['role'] == 'assistant']
if not assistant:
    print('FAIL no assistant reply')
    sys.exit(0)
m = assistant[-1]
ok = bool(m['content'].strip()) and (m['prompt_tokens'] or 0) > 0 and (m['completion_tokens'] or 0) > 0
status = 'PASS' if ok else 'FAIL'
print(f\"{status} prompt_tokens={m['prompt_tokens']} completion_tokens={m['completion_tokens']} reply={m['content'][:40]!r}\")
")

  echo "$MODEL: $RESULT"
  [[ "$RESULT" == PASS* ]] || FAILED=1
done <<< "$MODEL_IDS"

exit $FAILED
