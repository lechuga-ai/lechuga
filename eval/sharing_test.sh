#!/usr/bin/env bash
# Shared chats: who can see a chat, who can change who's in it, and who pays.
#
# Local only. It makes three throwaway accounts straight in the local database
# (an owner, a friend, a stranger), signs a session cookie for each the way
# Better Auth does, runs the checks, and deletes everything it made when it
# finishes, pass or fail. BETTER_AUTH_SECRET is read from worker/.dev.vars and
# never printed.
#
# One check sends a real message (the friend typing in the owner's chat), so
# it costs us a fraction of a cent at the gateway. The throwaway addresses are
# Resend's test inbox, so the "shared with you" email goes nowhere real.
#   eval/sharing_test.sh                      (needs a local `npm run dev`)
#   BASE_URL=http://localhost:8799 eval/sharing_test.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8787}"
case "$BASE_URL" in http://localhost*) ;; *) echo "local only: BASE_URL must be http://localhost..."; exit 1 ;; esac
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN="$RANDOM$RANDOM"
failures=0

AUTH_SECRET=$(grep -E '^BETTER_AUTH_SECRET=' "$SCRIPT_DIR/../worker/.dev.vars" | head -1 | cut -d= -f2- | tr -d '"')
: "${AUTH_SECRET:?no BETTER_AUTH_SECRET in worker/.dev.vars}"
export AUTH_SECRET

check() { # check <label> <expected> <actual>
  if [[ "$2" == "$3" ]]; then echo "ok    $1 ($3)"; else echo "FAIL  $1: wanted $2, got $3"; failures=$((failures + 1)); fi
}
d1() { (cd "$SCRIPT_DIR/../worker" && npx wrangler d1 execute lechuga-dev --local --json --command "$1" 2>/dev/null); }
field() { python3 -c "import sys,json; r=json.load(sys.stdin)[0]['results']; print(r[0]['$1'] if r else '')"; }
pick() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

# cookie_for <session token>: the signed cookie, as Better Auth would set it.
cookie_for() {
  TOKEN="$1" python3 -c "import os,hmac,hashlib,base64,urllib.parse
t=os.environ['TOKEN']
sig=base64.b64encode(hmac.new(os.environ['AUTH_SECRET'].encode(), t.encode(), hashlib.sha256).digest()).decode()
print('better-auth.session_token='+urllib.parse.quote(t+'.'+sig, safe=''))"
}

iso() { python3 -c "import datetime; print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=$1)).strftime('%Y-%m-%dT%H:%M:%S.000Z'))"; }
NOW_ISO=$(iso 0)
LATER_ISO=$(iso 1)
NOW_MS=$(python3 -c "import time; print(int(time.time()*1000))")

make_user() { # make_user <o|f|s> <balance>
  local id="sharetest-$1-$RUN" token="sharetesttoken$1$RUN"
  d1 "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, username, username_set_at, invites_remaining, balance)
        VALUES ('$id', '', 'delivered+sharetest$1$RUN@resend.dev', 1, '$NOW_ISO', '$NOW_ISO', 'sharetest_$1_$RUN', $NOW_MS, 2, $2);
      INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES ('$id', '$LATER_ISO', '$token', '$NOW_ISO', '$NOW_ISO', '$id');" >/dev/null
  # The ledger has to agree with the balance (db:check:local).
  if [[ "$2" != "0" ]]; then
    d1 "INSERT INTO credit_ledger (id, user_id, delta, reason, note, created_at) VALUES ('$id', '$id', $2, 'manual', 'sharing_test.sh', $NOW_MS)" >/dev/null
  fi
  cookie_for "$token"
}

cleanup() {
  local mine="LIKE 'sharetest-%-$RUN'"
  d1 "DELETE FROM chat_members WHERE user_id $mine OR chat_id IN (SELECT id FROM chats WHERE user_id $mine);
      DELETE FROM chat_pending_shares WHERE chat_id IN (SELECT id FROM chats WHERE user_id $mine);
      DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE user_id $mine);
      DELETE FROM chats WHERE user_id $mine;
      DELETE FROM credit_ledger WHERE user_id $mine;
      DELETE FROM invites WHERE inviter_id $mine;
      DELETE FROM avatars WHERE user_id $mine;
      DELETE FROM session WHERE userId $mine;
      DELETE FROM user WHERE id $mine;" >/dev/null || echo "cleanup failed: look for ids $mine"
}
trap cleanup EXIT

OWNER=$(make_user o 5000)
FRIEND=$(make_user f 0)
STRANGER=$(make_user s 0)
OWNER_ID="sharetest-o-$RUN"; FRIEND_ID="sharetest-f-$RUN"

as() { # as <cookie> <curl args...> -> body
  local cookie="$1"; shift
  curl -sS -m 30 -H "cookie: $cookie" -H 'content-type: application/json' "$@"
}
status() { # status <cookie> <curl args...> -> HTTP status
  local cookie="$1"; shift
  curl -sS -m 120 -o /dev/null -w '%{http_code}' -H "cookie: $cookie" -H 'content-type: application/json' "$@"
}
balance() { d1 "SELECT balance FROM user WHERE id='$1'" | field balance; }

echo "=== the accounts work ==="
check "owner is signed in" "sharetest_o_$RUN" "$(as "$OWNER" "$BASE_URL/api/me" | pick "d['username']")"

echo "=== a private chat is private ==="
CHAT=$(as "$OWNER" -X POST "$BASE_URL/api/chats" -d '{}' | pick "d['id']")
check "owner opens it" 200 "$(status "$OWNER" "$BASE_URL/api/chats/$CHAT")"
check "friend can't, before it's shared" 404 "$(status "$FRIEND" "$BASE_URL/api/chats/$CHAT")"
check "stranger can't" 404 "$(status "$STRANGER" "$BASE_URL/api/chats/$CHAT")"
check "stranger can't type in it" 404 "$(status "$STRANGER" -X POST "$BASE_URL/api/chats/$CHAT/messages" -d '{"content":"hi"}')"

echo "=== sharing ==="
SHARE="{\"who\":\"@sharetest_f_$RUN\"}"
check "stranger can't share someone else's chat" 404 "$(status "$STRANGER" -X POST "$BASE_URL/api/chats/$CHAT/members" -d "$SHARE")"
check "owner shares by username" 200 "$(status "$OWNER" -X POST "$BASE_URL/api/chats/$CHAT/members" -d "$SHARE")"
check "sharing twice is refused" 400 "$(status "$OWNER" -X POST "$BASE_URL/api/chats/$CHAT/members" -d "$SHARE")"
SELF="{\"who\":\"sharetest_o_$RUN\"}"
check "sharing with yourself is refused" 400 "$(status "$OWNER" -X POST "$BASE_URL/api/chats/$CHAT/members" -d "$SELF")"
check "an unknown username is a 404" 404 "$(status "$OWNER" -X POST "$BASE_URL/api/chats/$CHAT/members" -d '{"who":"@nobody_by_this_name_x"}')"
NEW="{\"who\":\"delivered+sharetestnew$RUN@resend.dev\"}"
check "an address with no account asks about an invite first" 409 "$(status "$OWNER" -X POST "$BASE_URL/api/chats/$CHAT/members" -d "$NEW")"
check "and says so in its code" "needs_invite 2" "$(as "$OWNER" -X POST "$BASE_URL/api/chats/$CHAT/members" -d "$NEW" | pick "d['code']+' '+str(d['invitesRemaining'])")"
# An invite the owner sent that address before, which ran out unanswered:
# sharing renews it rather than asking for, or spending, another.
LAPSED_EMAIL="delivered+sharetestlapsed$RUN@resend.dev"
d1 "INSERT INTO invites (id, token, email, inviter_id, status, created_at, expires_at) VALUES ('sharetest_inv_$RUN', 'sharetest_tok_$RUN', '$LAPSED_EMAIL', '$OWNER_ID', 'pending', 1000, 2000)" >/dev/null
check "an address the owner invited before isn't asked about" 200 "$(status "$OWNER" -X POST "$BASE_URL/api/chats/$CHAT/members" -d "{\"who\":\"$LAPSED_EMAIL\"}")"
check "the old invite is good again, and it's still the only one" "1 live" "$(d1 "SELECT COUNT(*) || CASE WHEN MIN(expires_at) > $NOW_MS THEN ' live' ELSE ' lapsed' END AS v FROM invites WHERE email = '$LAPSED_EMAIL'" | pick "d[0]['results'][0]['v']")"
check "and none of the owner's invites were spent" 2 "$(d1 "SELECT invites_remaining AS v FROM user WHERE id = '$OWNER_ID'" | pick "d[0]['results'][0]['v']")"
check "a member can't share it on" 403 "$(status "$FRIEND" -X POST "$BASE_URL/api/chats/$CHAT/members" -d "{\"who\":\"@sharetest_s_$RUN\"}")"

echo "=== what the friend sees ==="
check "friend opens it, as a member" "member" "$(as "$FRIEND" "$BASE_URL/api/chats/$CHAT" | pick "d['role']")"
check "it's in the friend's list, owner first" "$OWNER_ID,$FRIEND_ID" "$(as "$FRIEND" "$BASE_URL/api/chats" | pick "','.join(p['id'] for p in [c for c in d if c['id']=='$CHAT'][0]['people'])")"
check "nobody's email is in the roster" "False" "$(as "$FRIEND" "$BASE_URL/api/chats/$CHAT" | pick "'resend.dev' in json.dumps(d['roster'])")"
check "stranger still can't" 404 "$(status "$STRANGER" "$BASE_URL/api/chats/$CHAT")"
check "a member can't delete it" 403 "$(status "$FRIEND" -X DELETE "$BASE_URL/api/chats/$CHAT")"
check "a member can't compact it" 403 "$(status "$FRIEND" -X POST "$BASE_URL/api/chats/$CHAT/compact")"
check "a member can't remove the owner's other people" 403 "$(status "$FRIEND" -X DELETE "$BASE_URL/api/chats/$CHAT/members/$OWNER_ID")"

echo "=== the friend types, the owner pays ==="
check "friend sends a message" 200 "$(status "$FRIEND" -X POST "$BASE_URL/api/chats/$CHAT/messages" -d '{"content":"Reply with the single word: lettuce","effort":"low"}')"
for _ in 1 2 3 4 5 6 7 8 9 10; do [[ "$(balance "$OWNER_ID")" != "5000" ]] && break; sleep 2; done
OWNER_NOW=$(balance "$OWNER_ID")
check "owner was charged" "yes" "$([[ "$OWNER_NOW" -lt 5000 ]] && echo yes || echo "no, still $OWNER_NOW")"
check "friend wasn't" 0 "$(balance "$FRIEND_ID")"
check "the turn is the friend's" "$FRIEND_ID" "$(as "$OWNER" "$BASE_URL/api/chats/$CHAT" | pick "[m for m in d['messages'] if m['role']=='user'][0]['user_id']")"

echo "=== removing someone ==="
check "owner removes the friend" 200 "$(status "$OWNER" -X DELETE "$BASE_URL/api/chats/$CHAT/members/$FRIEND_ID")"
check "friend can no longer open it" 404 "$(status "$FRIEND" "$BASE_URL/api/chats/$CHAT")"
check "or type in it" 404 "$(status "$FRIEND" -X POST "$BASE_URL/api/chats/$CHAT/messages" -d '{"content":"still here?"}')"
check "it's gone from the friend's list" 0 "$(as "$FRIEND" "$BASE_URL/api/chats" | pick "len([c for c in d if c['id']=='$CHAT'])")"
check "owner still sees what the friend wrote, with their name on it" "$FRIEND_ID True" "$(as "$OWNER" "$BASE_URL/api/chats/$CHAT" | pick "[m for m in d['messages'] if m['role']=='user'][0]['user_id']+' '+str(d['roster']['members'][0]['removed'])")"
check "owner's list no longer shows it as shared" "False" "$(as "$OWNER" "$BASE_URL/api/chats" | pick "'people' in [c for c in d if c['id']=='$CHAT'][0]")"

echo "=== coming back, and leaving ==="
check "owner adds the friend again" 200 "$(status "$OWNER" -X POST "$BASE_URL/api/chats/$CHAT/members" -d "$SHARE")"
check "friend is back in" 200 "$(status "$FRIEND" "$BASE_URL/api/chats/$CHAT")"
check "friend leaves" 200 "$(status "$FRIEND" -X DELETE "$BASE_URL/api/chats/$CHAT/members/$FRIEND_ID")"
check "and is out" 404 "$(status "$FRIEND" "$BASE_URL/api/chats/$CHAT")"

echo "=== profile ==="
PHOTO="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="
PROFILE="{\"name\":\"  Share   Tester \",\"photo\":\"$PHOTO\"}"
check "name and photo saved, name tidied" "Share Tester" "$(as "$OWNER" -X PUT "$BASE_URL/api/me/profile" -d "$PROFILE" | pick "d['name']")"
check "the photo is served as a picture" "200 image/jpeg" "$(curl -sS -m 20 -o /dev/null -w '%{http_code} %{content_type}' -H "cookie: $FRIEND" "$BASE_URL/api/avatars/$OWNER_ID")"
check "not without signing in" 401 "$(curl -sS -m 20 -o /dev/null -w '%{http_code}' "$BASE_URL/api/avatars/$OWNER_ID")"
check "something that isn't a JPEG is refused" 400 "$(status "$OWNER" -X PUT "$BASE_URL/api/me/profile" -d '{"name":"x","photo":"data:text/html;base64,PGI+"}')"
check "an empty name is fine: people see the username" 200 "$(status "$OWNER" -X PUT "$BASE_URL/api/me/profile" -d '{"name":"  "}')"
check "removing the photo" "None" "$(as "$OWNER" -X PUT "$BASE_URL/api/me/profile" -d '{"name":"Share Tester","photo":null}' | pick "d['photo']")"

echo "=== deleting a shared chat ==="
check "owner deletes it" 200 "$(status "$OWNER" -X DELETE "$BASE_URL/api/chats/$CHAT")"
check "nothing of it is left" 0 "$(d1 "SELECT (SELECT COUNT(*) FROM chat_members WHERE chat_id='$CHAT') + (SELECT COUNT(*) FROM messages WHERE chat_id='$CHAT') AS n" | field n)"

echo
if [[ $failures -eq 0 ]]; then echo "all passed"; else echo "$failures failed"; exit 1; fi
