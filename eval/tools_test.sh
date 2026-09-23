#!/usr/bin/env bash
# The model's tools (worker/src/tools.ts): a throwaway local account asks for
# a page to be read, and the reply stream should show a step for it and an
# answer that came from the page. With BRAVE_SEARCH_API_KEY in .dev.vars a
# search is tried too. Each call should also leave a row in tool_calls
# (migration 0010): the host for a read, never the query for a search.
# Costs a few hundred tokens from the shared gateway.
#
#   eval/tools_test.sh                        (needs a local `npm run dev`)
#   BASE_URL=http://localhost:8799 eval/tools_test.sh
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_URL="${BASE_URL:-http://localhost:5173}"
RUN="$RANDOM$RANDOM"
failures=0
AUTH_SECRET=$(grep -E '^BETTER_AUTH_SECRET=' "$SCRIPT_DIR/../worker/.dev.vars" | head -1 | cut -d= -f2- | tr -d '"')
: "${AUTH_SECRET:?no BETTER_AUTH_SECRET in worker/.dev.vars}"
export AUTH_SECRET
if ! curl -s -o /dev/null --max-time 3 "$BASE_URL/api/me"; then
  echo "Nothing is answering at $BASE_URL. Start the app first (npm run dev, from the repo root), then run this again."
  exit 1
fi
HAS_BRAVE=$(grep -cE '^BRAVE_SEARCH_API_KEY=.+' "$SCRIPT_DIR/../worker/.dev.vars" || true)

check() { if [[ "$2" == "$3" ]]; then echo "ok    $1 ($3)"; else echo "FAIL  $1: wanted $2, got $3"; failures=$((failures + 1)); fi; }
d1() { (cd "$SCRIPT_DIR/../worker" && npx wrangler d1 execute lechuga-dev --local --json --command "$1" 2>/dev/null); }
pick() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }
cookie_for() {
  TOKEN="$1" python3 -c "import os,hmac,hashlib,base64,urllib.parse
t=os.environ['TOKEN']
sig=base64.b64encode(hmac.new(os.environ['AUTH_SECRET'].encode(), t.encode(), hashlib.sha256).digest()).decode()
print('better-auth.session_token='+urllib.parse.quote(t+'.'+sig, safe=''))"
}
iso() { python3 -c "import datetime; print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=$1)).strftime('%Y-%m-%dT%H:%M:%S.000Z'))"; }
NOW_ISO=$(iso 0); LATER_ISO=$(iso 1); NOW_MS=$(python3 -c "import time; print(int(time.time()*1000))")
ID="toolstest-$RUN"; TOKEN="toolstesttoken$RUN"
d1 "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, username, username_set_at, invites_remaining, balance)
      VALUES ('$ID', '', 'delivered+toolstest$RUN@resend.dev', 1, '$NOW_ISO', '$NOW_ISO', 'toolstest_$RUN', $NOW_MS, 0, 5000);
    INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES ('$ID', '$LATER_ISO', '$TOKEN', '$NOW_ISO', '$NOW_ISO', '$ID');
    INSERT INTO credit_ledger (id, user_id, delta, reason, note, created_at) VALUES ('$ID', '$ID', 5000, 'manual', 'tools_test.sh', $NOW_MS);" >/dev/null
COOKIE=$(cookie_for "$TOKEN")
cleanup() {
  d1 "DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE user_id = '$ID'); DELETE FROM chats WHERE user_id = '$ID';
      DELETE FROM credit_ledger WHERE user_id = '$ID'; DELETE FROM session WHERE userId = '$ID'; DELETE FROM user WHERE id = '$ID';" >/dev/null
}
trap cleanup EXIT
as() { curl -sS -m 180 -H "cookie: $COOKIE" -H 'content-type: application/json' "$@"; }

# stream <content> -> prints "steps=<n> labels=<...> text=<answer>"
stream() {
  as -X POST "$BASE_URL/api/chats/$CHAT/messages" -d "{\"content\":$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$1"),\"effort\":\"low\"}" \
  | python3 -c "
import sys,json
steps={}; text=''; err=None
for line in sys.stdin:
    line=line.strip()
    if not line.startswith('data:'): continue
    p=line[5:].strip()
    if p=='[DONE]': break
    e=json.loads(p)
    if 'step' in e: steps[e['step']['id']]=e['step']
    if 'retract' in e: text=''
    if 'delta' in e: text+=e['delta']
    if 'error' in e: err=e['error']
done=[s for s in steps.values() if s['done']]
print('steps=%d labels=%s err=%s' % (len(done), ' | '.join(s['label'] for s in done), err))
print('text='+text.replace(chr(10),' ')[:300])"
}

echo "=== read_page ==="
CHAT=$(as -X POST "$BASE_URL/api/chats" -d '{}' | pick "d['id']")
OUT=$(stream "Read https://example.com/ and tell me, in one sentence, what the page says it is for.")
echo "$OUT" | sed 's/^/      /'
check "a read step happened" "yes" "$(echo "$OUT" | grep -q 'labels=.*Read: example.com' && echo yes || echo no)"
check "the answer mentions what the page says" "yes" "$(echo "$OUT" | grep -qi 'illustrative\|examples\|documentation\|domain' && echo yes || echo no)"
check "a private address is refused" "yes" "$(stream 'Read http://127.0.0.1:8080/secret and tell me exactly what the tool said, quoting it.' | grep -qi "can't be read" && echo yes || echo no)"
sleep 2
READS=$(d1 "SELECT COUNT(*) AS n FROM tool_calls WHERE user_id = '$ID' AND tool = 'read_page' AND host = 'example.com'" | pick "d[0]['results'][0]['n']")
check "the read was recorded in tool_calls with the host only" "yes" "$([[ "${READS:-0}" =~ ^[0-9]+$ && "${READS:-0}" -ge 1 ]] && echo yes || echo "no, $READS")"

if [[ "$HAS_BRAVE" != "0" ]]; then
  echo "=== web_search ==="
  OUT=$(stream "Search the web for the current weather forecast in Portland, Oregon, and tell me briefly.")
  echo "$OUT" | sed 's/^/      /'
  check "a search step happened" "yes" "$(echo "$OUT" | grep -q 'labels=.*Searched:' && echo yes || echo no)"
  sleep 3
  CREDITS=$(d1 "SELECT COALESCE(MAX(credits), 0) AS c FROM messages WHERE chat_id = '$CHAT' AND role = 'assistant'" | pick "d[0]['results'][0]['c']")
  check "the search was charged (reply cost over 100 credits)" "yes" "$([[ "${CREDITS:-0}" =~ ^[0-9]+$ && "${CREDITS:-0}" -gt 100 ]] && echo yes || echo "no, $CREDITS")"
  SEARCHES=$(d1 "SELECT COUNT(*) AS n FROM tool_calls WHERE user_id = '$ID' AND tool = 'web_search' AND host IS NULL AND credits = 100" | pick "d[0]['results'][0]['n']")
  check "the search was recorded in tool_calls, costed, with nothing typed kept" "yes" "$([[ "${SEARCHES:-0}" =~ ^[0-9]+$ && "${SEARCHES:-0}" -ge 1 ]] && echo yes || echo "no, $SEARCHES")"
else
  echo "(no BRAVE_SEARCH_API_KEY in .dev.vars: search not tested)"
fi

echo; [[ $failures -eq 0 ]] && echo "all passed" || echo "$failures failed"
exit $failures
