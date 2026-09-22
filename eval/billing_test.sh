#!/usr/bin/env bash
# Phase 3 checks for the Stripe webhook: every event credited exactly once,
# refunds taken back in proportion, bad or stale signatures refused.
#
# It doesn't use the Stripe CLI. `stripe trigger` sends events about customers
# this database has never heard of, so nothing would be credited. Instead the
# script writes its own events and signs them with the webhook secret exactly
# the way Stripe does, which exercises the same code path.
#
# The secret is read from worker/.dev.vars (or STRIPE_WEBHOOK_SECRET if set)
# and never printed. It must be the secret the target worker is using.
#
# It runs against the first account in the database and removes its own rows
# when it finishes (pass or fail), leaving the balance where it started. Point
# it at local or dev, never prod.
#   eval/billing_test.sh                                   (local npm run dev)
#   BASE_URL=https://dev.lechuga.ai D1_ENV=dev STRIPE_WEBHOOK_SECRET=... eval/billing_test.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8787}"
D1_ENV="${D1_ENV:-local}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
failures=0

# Every event is built in a variable before it is sent. macOS ships bash 3.2,
# which mangles JSON written inline inside "$(send ... "{...}")".
if [[ "$D1_ENV" != "local" && "$D1_ENV" != "dev" ]]; then echo "D1_ENV must be local or dev"; exit 1; fi
if [[ -z "${STRIPE_WEBHOOK_SECRET:-}" ]]; then
  STRIPE_WEBHOOK_SECRET=$(grep -E '^STRIPE_WEBHOOK_SECRET=' "$SCRIPT_DIR/../worker/.dev.vars" | head -1 | cut -d= -f2- | tr -d '"')
fi
: "${STRIPE_WEBHOOK_SECRET:?no STRIPE_WEBHOOK_SECRET in the environment or worker/.dev.vars}"
export STRIPE_WEBHOOK_SECRET

check() { # check <label> <expected> <actual>
  if [[ "$2" == "$3" ]]; then echo "ok    $1 ($3)"; else echo "FAIL  $1: wanted $2, got $3"; failures=$((failures + 1)); fi
}
d1() {
  if [[ "$D1_ENV" == "local" ]]; then
    (cd "$SCRIPT_DIR/../worker" && npx wrangler d1 execute lechuga-dev --local --json --command "$1" 2>/dev/null)
  else
    (cd "$SCRIPT_DIR/../worker" && npx wrangler d1 execute lechuga-dev --env dev --remote --json --command "$1" 2>/dev/null)
  fi
}
field() { python3 -c "import sys,json; r=json.load(sys.stdin)[0]['results']; print(r[0]['$1'] if r else '')"; }

# send <event type> <object json> [timestamp] -> HTTP status
send() {
  local ts="${3:-$(date +%s)}"
  local body="{\"id\":\"evt_test_$RANDOM\",\"type\":\"$1\",\"data\":{\"object\":$2}}"
  local sig
  sig=$(BODY="$body" TS="$ts" python3 -c "import os,hmac,hashlib; print(hmac.new(os.environ['STRIPE_WEBHOOK_SECRET'].encode(), (os.environ['TS']+'.'+os.environ['BODY']).encode(), hashlib.sha256).hexdigest())")
  curl -sS -m 20 -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/billing/webhook" -H "stripe-signature: t=$ts,v1=$sig" -d "$body"
}

USER_ID=$(d1 "SELECT id FROM user ORDER BY createdAt LIMIT 1" | field id)
[[ -n "$USER_ID" ]] || { echo "no users in the $D1_ENV database; sign in once first"; exit 1; }
balance() { d1 "SELECT balance FROM user WHERE id='$USER_ID'" | field balance; }
sub_status() { d1 "SELECT COALESCE(subscription_status,'none') AS s FROM user WHERE id='$USER_ID'" | field s; }

# invoice.paid finds the account by Stripe customer id. Borrow a made-up one
# for the run and put back whatever was there.
OLD_CUSTOMER=$(d1 "SELECT COALESCE(stripe_customer_id,'') AS c FROM user WHERE id='$USER_ID'" | field c)
OLD_STATUS=$(sub_status)
RUN="$RANDOM$RANDOM"
CUSTOMER="cus_billingtest_$RUN"
d1 "UPDATE user SET stripe_customer_id='$CUSTOMER' WHERE id='$USER_ID'" >/dev/null
restore() {
  local c="NULL" s="NULL"
  [[ -n "$OLD_CUSTOMER" ]] && c="'$OLD_CUSTOMER'"
  [[ "$OLD_STATUS" != "none" ]] && s="'$OLD_STATUS'"
  d1 "UPDATE user SET stripe_customer_id=$c, subscription_status=$s WHERE id='$USER_ID'" >/dev/null
  # Take this run's made-up purchases and refunds back out, so the Credits
  # page and /admin don't fill up with money that never moved. Every ref the
  # script writes carries "_test_" and the run number.
  d1 "DELETE FROM credit_ledger WHERE user_id='$USER_ID' AND ref LIKE '%\_test\_%$RUN%' ESCAPE '\'" >/dev/null
  d1 "UPDATE user SET balance = (SELECT COALESCE(SUM(delta), 0) FROM credit_ledger WHERE user_id='$USER_ID') WHERE id='$USER_ID'" >/dev/null
}
trap restore EXIT

START=$(balance)
echo "account $USER_ID starts at $START credits"

echo "=== signatures ==="
check "unsigned request refused" 400 "$(curl -sS -m 20 -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/billing/webhook" -d '{}')"
check "ten-minute-old signature refused" 400 "$(send invoice.paid '{}' $(( $(date +%s) - 600 )))"

echo "=== a leaf, delivered twice ==="
LEAF="{\"id\":\"cs_test_leaf_$RUN\",\"mode\":\"payment\",\"payment_status\":\"paid\",\"customer\":\"$CUSTOMER\",\"metadata\":{\"user_id\":\"$USER_ID\",\"pack\":\"leaf\"}}"
check "first delivery accepted" 200 "$(send checkout.session.completed "$LEAF")"
check "second delivery accepted" 200 "$(send checkout.session.completed "$LEAF")"
check "credited once" "$((START + 50000))" "$(balance)"

echo "=== unpaid and unknown checkouts credit nothing ==="
UNPAID="{\"id\":\"cs_test_unpaid_$RUN\",\"mode\":\"payment\",\"payment_status\":\"unpaid\",\"customer\":\"$CUSTOMER\",\"metadata\":{\"user_id\":\"$USER_ID\",\"pack\":\"leaf\"}}"
check "unpaid session accepted" 200 "$(send checkout.session.completed "$UNPAID")"
BOGUS="{\"id\":\"cs_test_bogus_$RUN\",\"mode\":\"payment\",\"payment_status\":\"paid\",\"customer\":\"$CUSTOMER\",\"metadata\":{\"user_id\":\"$USER_ID\",\"pack\":\"crate\"}}"
check "made-up pack accepted" 200 "$(send checkout.session.completed "$BOGUS")"
check "balance unchanged" "$((START + 50000))" "$(balance)"

echo "=== full refund of the leaf, delivered twice ==="
LEAF_REFUND="{\"id\":\"ch_test_leaf_$RUN\",\"customer\":\"$CUSTOMER\",\"amount\":500,\"amount_refunded\":500,\"metadata\":{\"user_id\":\"$USER_ID\",\"credits\":\"50000\"}}"
check "first delivery accepted" 200 "$(send charge.refunded "$LEAF_REFUND")"
check "second delivery accepted" 200 "$(send charge.refunded "$LEAF_REFUND")"
check "taken back once" "$START" "$(balance)"

echo "=== a head, refunded in two halves ==="
HEAD="{\"id\":\"cs_test_head_$RUN\",\"mode\":\"payment\",\"payment_status\":\"paid\",\"customer\":\"$CUSTOMER\",\"metadata\":{\"user_id\":\"$USER_ID\",\"pack\":\"head\"}}"
check "head purchase accepted" 200 "$(send checkout.session.completed "$HEAD")"
check "credited 100000" "$((START + 100000))" "$(balance)"
head_refund() { echo "{\"id\":\"ch_test_head_$RUN\",\"customer\":\"$CUSTOMER\",\"amount\":1000,\"amount_refunded\":$1,\"metadata\":{\"user_id\":\"$USER_ID\",\"credits\":\"100000\"}}"; }
check "half refund accepted" 200 "$(send charge.refunded "$(head_refund 500)")"
check "half the credits taken back" "$((START + 50000))" "$(balance)"
check "rest refunded" 200 "$(send charge.refunded "$(head_refund 1000)")"
check "all the credits taken back" "$START" "$(balance)"

echo "=== subscription: first invoice twice, a renewal, then cancel ==="
INVOICE="{\"id\":\"in_test_a_$RUN\",\"customer\":\"$CUSTOMER\",\"amount_paid\":500,\"billing_reason\":\"subscription_create\"}"
check "first delivery accepted" 200 "$(send invoice.paid "$INVOICE")"
check "second delivery accepted" 200 "$(send invoice.paid "$INVOICE")"
check "credited once" "$((START + 50000))" "$(balance)"
check "status is active" "active" "$(sub_status)"
RENEWAL="{\"id\":\"in_test_b_$RUN\",\"customer\":\"$CUSTOMER\",\"amount_paid\":500,\"billing_reason\":\"subscription_cycle\"}"
check "renewal accepted" 200 "$(send invoice.paid "$RENEWAL")"
check "renewal adds to the balance (rollover)" "$((START + 100000))" "$(balance)"
SUB_REFUND="{\"id\":\"ch_test_sub_$RUN\",\"customer\":\"$CUSTOMER\",\"amount\":500,\"amount_refunded\":500,\"metadata\":{}}"
check "renewal's refund accepted" 200 "$(send charge.refunded "$SUB_REFUND")"
check "subscription refund found the account by customer" "$((START + 50000))" "$(balance)"
STRANGER="{\"id\":\"in_test_c_$RUN\",\"customer\":\"cus_nobody\",\"amount_paid\":500,\"billing_reason\":\"subscription_cycle\"}"
check "someone else's invoice accepted" 200 "$(send invoice.paid "$STRANGER")"
check "and credits nobody here" "$((START + 50000))" "$(balance)"
CANCEL="{\"customer\":\"$CUSTOMER\"}"
check "cancel accepted" 200 "$(send customer.subscription.deleted "$CANCEL")"
check "status is cancelled" "cancelled" "$(sub_status)"
check "credits stay after cancelling" "$((START + 50000))" "$(balance)"

echo "=== ledger agrees with balances ==="
DRIFT=$(d1 "SELECT COUNT(*) AS n FROM (SELECT u.id FROM user u LEFT JOIN credit_ledger l ON l.user_id = u.id GROUP BY u.id HAVING u.balance != COALESCE(SUM(l.delta), 0))" | field n)
check "accounts with drift" 0 "$DRIFT"

echo
if [[ $failures -eq 0 ]]; then echo "all passed"; else echo "$failures failed"; exit 1; fi
