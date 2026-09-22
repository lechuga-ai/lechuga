#!/usr/bin/env bash
# Phase 2 access test (plan v3): user A cannot read or delete user B's chat
# by id, and nobody gets anything from /api without a session.
#
# Needs two session cookies from two different accounts (sign in twice, one
# in a private window; see eval/smoke.sh for where to copy them from):
#   USER_A_COOKIE='...' USER_B_COOKIE='...' BASE_URL=https://... eval/auth_test.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8787}"
: "${USER_A_COOKIE:?set USER_A_COOKIE (see the comment at the top of this script)}"
: "${USER_B_COOKIE:?set USER_B_COOKIE (see the comment at the top of this script)}"

failures=0

expect() {
  # expect <label> <expected status> <curl args...>
  local label="$1" want="$2"
  shift 2
  local got
  got=$(curl -sS -o /dev/null -w '%{http_code}' "$@")
  if [[ "$got" == "$want" ]]; then
    echo "ok    $label ($got)"
  else
    echo "FAIL  $label: wanted $want, got $got"
    failures=$((failures + 1))
  fi
}

echo "=== unauthenticated ==="
expect "GET /api/chats without a cookie"      401 "$BASE_URL/api/chats"
expect "POST /api/chats without a cookie"     401 -X POST "$BASE_URL/api/chats" -H 'content-type: application/json' -d '{}'
expect "GET /api/config is public"            200 "$BASE_URL/api/config"

echo "=== user A creates a chat ==="
CHAT_ID=$(curl -sS -X POST "$BASE_URL/api/chats" \
  -H "cookie: $USER_A_COOKIE" -H 'content-type: application/json' -d '{}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "chat id: $CHAT_ID"
expect "A reads own chat"                     200 "$BASE_URL/api/chats/$CHAT_ID" -H "cookie: $USER_A_COOKIE"

echo "=== user B tries A's chat by id ==="
expect "B reads A's chat"                     404 "$BASE_URL/api/chats/$CHAT_ID" -H "cookie: $USER_B_COOKIE"
expect "B posts into A's chat"                404 -X POST "$BASE_URL/api/chats/$CHAT_ID/messages" -H "cookie: $USER_B_COOKIE" -H 'content-type: application/json' -d '{"content":"hi"}'
expect "B deletes A's chat"                   404 -X DELETE "$BASE_URL/api/chats/$CHAT_ID" -H "cookie: $USER_B_COOKIE"
expect "A's chat still there afterwards"      200 "$BASE_URL/api/chats/$CHAT_ID" -H "cookie: $USER_A_COOKIE"
B_LIST=$(curl -sS "$BASE_URL/api/chats" -H "cookie: $USER_B_COOKIE")
if echo "$B_LIST" | grep -q "$CHAT_ID"; then
  echo "FAIL  A's chat appears in B's list"; failures=$((failures + 1))
else
  echo "ok    A's chat is not in B's list"
fi

echo "=== cleanup ==="
expect "A deletes own chat"                   200 -X DELETE "$BASE_URL/api/chats/$CHAT_ID" -H "cookie: $USER_A_COOKIE"

echo
if [[ $failures -eq 0 ]]; then echo "all checks passed"; else echo "$failures check(s) failed"; exit 1; fi
