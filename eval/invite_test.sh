#!/usr/bin/env bash
# Phase 2b checks that can run without a mailbox: invite counting and revoke,
# the public invite lookup, username rules, and that non-admins can't see the
# admin area. The email-driven parts (accepting an invite, approving a request
# from the inbox) are in the browser checklist in eval/results/phase2b.md.
#
# Needs one session cookie for a NON-admin user with at least one invite left
# (see eval/smoke.sh for where to copy it from), and wrangler access to the
# database the target uses, to read the invite token that only goes out by
# email.
#   BASE_URL=https://lechuga-dev... SESSION_COOKIE='...' D1_ENV=dev eval/invite_test.sh
#   (D1_ENV=local for a local `npm run dev`, default)
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8787}"
D1_ENV="${D1_ENV:-local}"
: "${SESSION_COOKIE:?set SESSION_COOKIE (see the comment at the top of this script)}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_EMAIL="invite-test-$RANDOM@example.com"
failures=0

api() { curl -sS -m 20 -H "cookie: $SESSION_COOKIE" -H 'content-type: application/json' "$@"; }
status() { curl -sS -m 20 -o /dev/null -w '%{http_code}' -H "cookie: $SESSION_COOKIE" -H 'content-type: application/json' "$@"; }
check() { # check <label> <expected> <actual>
  if [[ "$2" == "$3" ]]; then echo "ok    $1 ($3)"; else echo "FAIL  $1: wanted $2, got $3"; failures=$((failures + 1)); fi
}
d1() {
  if [[ "$D1_ENV" == "local" ]]; then
    (cd "$SCRIPT_DIR/../worker" && npx wrangler d1 execute lechuga-dev --local --json --command "$1" 2>/dev/null)
  elif [[ "$D1_ENV" == "prod" ]]; then
    (cd "$SCRIPT_DIR/../worker" && npx wrangler d1 execute lechuga-prod --env prod --remote --json --command "$1" 2>/dev/null)
  else
    (cd "$SCRIPT_DIR/../worker" && npx wrangler d1 execute lechuga-dev --env dev --remote --json --command "$1" 2>/dev/null)
  fi
}

echo "=== who am I ==="
ME=$(api "$BASE_URL/api/me")
echo "$ME"
IS_ADMIN=$(echo "$ME" | python3 -c "import sys,json; print(json.load(sys.stdin)['isAdmin'])")
BEFORE=$(api "$BASE_URL/api/invites" | python3 -c "import sys,json; print(json.load(sys.stdin)['remaining'])")
echo "invites remaining before: $BEFORE"

echo "=== username rules ==="
for pair in "abc:at least 4 characters" "Admin:that one's reserved" "1abc:must start with a letter" "alder-j:letters, numbers and underscores only"; do
  u="${pair%%:*}"; want="${pair#*:}"
  got=$(api "$BASE_URL/api/me/username/available?u=$u" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('reason','available'))")
  check "username '$u' -> '$want'" "$want" "$got"
done
got=$(api "$BASE_URL/api/me/username/available?u=alder_j$RANDOM" | python3 -c "import sys,json; print(json.load(sys.stdin)['available'])")
check "a fresh valid username is available" "True" "$got"
check "changing my username is refused" 403 "$(status -X PUT "$BASE_URL/api/me/username" -d '{"username":"newname_x"}')"

echo "=== invite, count, lookup, revoke ==="
check "invite $TEST_EMAIL" 200 "$(status -X POST "$BASE_URL/api/invites" -d "{\"email\":\"$TEST_EMAIL\"}")"
AFTER=$(api "$BASE_URL/api/invites" | python3 -c "import sys,json; print(json.load(sys.stdin)['remaining'])")
check "count dropped by one" "$((BEFORE - 1))" "$AFTER"
check "inviting the same address again is refused" 400 "$(status -X POST "$BASE_URL/api/invites" -d "{\"email\":\"$TEST_EMAIL\"}")"
TOKEN=$(d1 "SELECT token FROM invites WHERE email='$TEST_EMAIL' ORDER BY created_at DESC LIMIT 1" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['results'][0]['token'])")
check "public lookup says pending" "pending" "$(curl -sS -m 20 "$BASE_URL/api/invites/lookup/$TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['state'])")"
INVITE_ID=$(api "$BASE_URL/api/invites" | python3 -c "import sys,json; print([i['id'] for i in json.load(sys.stdin)['invites'] if i['email']=='$TEST_EMAIL'][0])")
check "revoke it" 200 "$(status -X DELETE "$BASE_URL/api/invites/$INVITE_ID")"
RESTORED=$(api "$BASE_URL/api/invites" | python3 -c "import sys,json; print(json.load(sys.stdin)['remaining'])")
check "count came back" "$BEFORE" "$RESTORED"
check "public lookup now says revoked" "revoked" "$(curl -sS -m 20 "$BASE_URL/api/invites/lookup/$TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['state'])")"
check "revoking twice is a 404" 404 "$(status -X DELETE "$BASE_URL/api/invites/$INVITE_ID")"

echo "=== public gate ==="
check "unknown invite token" 404 "$(curl -sS -m 20 -o /dev/null -w '%{http_code}' "$BASE_URL/api/invites/lookup/not-a-token")"
check "request access without a captcha" 400 "$(curl -sS -m 20 -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/requests/access" -H 'content-type: application/json' -d '{"email":"cold@example.com"}')"

echo "=== notes and admin ==="
check "send a feedback note" 200 "$(status -X POST "$BASE_URL/api/notes" -d '{"type":"feedback","body":"invite_test.sh says hi"}')"
if [[ "$IS_ADMIN" == "True" ]]; then
  echo "note: this cookie is an admin, so the non-admin 404 check is skipped"
else
  check "admin inbox is a 404 for non-admins" 404 "$(status "$BASE_URL/api/admin/requests")"
fi

echo
if [[ $failures -eq 0 ]]; then echo "all checks passed"; else echo "$failures check(s) failed"; exit 1; fi
