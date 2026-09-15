#!/usr/bin/env bash
# =====================================================================
# CreditVoice OS — Phase 2B concurrency proofs (real parallel sessions)
#
#  1. Duplicate webhook race: 20 identical provider callbacks must be
#     accepted exactly once.
#  2. Duplicate transfer race: simultaneous retries of one transfer must
#     move money exactly once.
#  3. Multiple callers: simultaneous authenticated calls stay isolated.
#
# All test data is removed afterwards.
# =====================================================================
set -euo pipefail
DB="${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
TMP=$(mktemp -d)
fail=0
q() { psql "$DB" -Atc "$1"; }

SEED=$(q "select public.cv_test_voice_setup('pbkdf2\$1\$00\$aa','pbkdf2\$1\$00\$bb')")
jget() { echo "$SEED" | python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
TA=$(jget ta); TB=$(jget tb); TSUS=$(jget tsus)
NUM_A=$(jget num_a); ACCT_A=$(jget acct_a); AA1=$(jget aa1)
NUM_B=$(jget num_b); ACCT_B=$(jget acct_b)

EXTRA=$(q "select public.cv_test_add_account('$TA','QA Conc Recipient')")
REC=$(echo "$EXTRA" | python3 -c "import json,sys; print(json.load(sys.stdin)['account_number'])")
q "select public.cv_test_fund_account('$AA1', 100000)" >/dev/null

cleanup() { q "select public.cv_test_voice_cleanup(array['$TA','$TB','$TSUS']::uuid[])" >/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

authenticate() {  # $1 caller number, $2 dialled number, $3 account number, $4 call sid
  local sid code
  sid=$(q "select public.cv_create_call_session('$1','$2','TWILIO','$4',null)")
  q "select public.cv_resolve_tenant('$sid')" >/dev/null
  code=$(q "select (public.cv_begin_access_code_attempt('$sid'))->>'code_id'")
  q "select public.cv_finish_access_code_attempt('$sid','$code',true)" >/dev/null
  q "select public.cv_identify_account('$sid','$3')" >/dev/null
  q "select public.cv_begin_pin_attempt('$sid')" >/dev/null
  q "select public.cv_finish_pin_attempt('$sid',true)" >/dev/null
  echo "$sid"
}

echo "1) duplicate webhook race"
SID=$(q "select public.cv_create_call_session('+2348700000011','$NUM_A','TWILIO','CA-CONC-1',null)")
EVT="twilio-evt-$(date +%s%N)"
for _ in $(seq 1 20); do
  psql "$DB" -Atc "select public.cv_claim_session_event('$SID','TWILIO','$EVT','IVR_MENU','{}'::jsonb)" \
    >> "$TMP/evt.txt" 2>/dev/null &
done
wait
ACCEPTED=$(grep -c '^t$' "$TMP/evt.txt" || true)
STORED=$(q "select count(*) from public.call_session_events where provider_event_id = '$EVT'")
if [ "$ACCEPTED" = "1" ] && [ "$STORED" = "1" ]; then
  echo "   PASS  20 identical callbacks -> accepted=$ACCEPTED stored=$STORED"
else
  echo "   FAIL  accepted=$ACCEPTED stored=$STORED"; fail=1
fi

echo "2) duplicate transfer race"
SID2=$(authenticate '+2348700000012' "$NUM_A" "$ACCT_A" 'CA-CONC-2')
q "select public.cv_prepare_transfer('$SID2','$REC',2500)" >/dev/null
KEY="voice-conc-$(date +%s%N)"
for _ in $(seq 1 6); do
  psql "$DB" -Atc "select public.cv_execute_voice_transfer('$SID2','$KEY')" >> "$TMP/trf.txt" 2>/dev/null &
done
wait
COUNT=$(q "select count(*) from public.transfers where tenant_id = '$TA'")
BAL=$(q "select balance from public.customer_accounts where id = '$AA1'")
if [ "$COUNT" = "1" ] && [ "$BAL" = "99975.0000" ]; then
  echo "   PASS  6 simultaneous retries -> transfers=$COUNT balance=$BAL"
else
  echo "   FAIL  transfers=$COUNT balance=$BAL"; fail=1
fi

echo "3) simultaneous callers stay isolated"
EXTRA2=$(q "select public.cv_test_add_account('$TA','QA Conc Caller 2')")
ACCT2=$(echo "$EXTRA2" | python3 -c "import json,sys; print(json.load(sys.stdin)['account_number'])")
CUST2=$(echo "$EXTRA2" | python3 -c "import json,sys; print(json.load(sys.stdin)['customer_id'])")
q "insert into public.customer_pins (customer_id, tenant_id, pin_hash) values ('$CUST2','$TA','pbkdf2\$1\$00\$bb')" >/dev/null
(authenticate '+2348700000013' "$NUM_A" "$ACCT_A" 'CA-CONC-3' > "$TMP/s3.txt") &
(authenticate '+2348700000014' "$NUM_A" "$ACCT2"  'CA-CONC-4' > "$TMP/s4.txt") &
wait
S3=$(cat "$TMP/s3.txt"); S4=$(cat "$TMP/s4.txt")
A3=$(q "select account_id from public.call_sessions where id = '$S3'")
A4=$(q "select account_id from public.call_sessions where id = '$S4'")
OK3=$(q "select (public.cv_authorize_action('$S3','CHECK_BALANCE','$A4'))->>'allowed'")
if [ "$A3" != "$A4" ] && [ "$OK3" = "false" ]; then
  echo "   PASS  two live calls resolved different accounts and cannot cross over"
else
  echo "   FAIL  a3=$A3 a4=$A4 cross=$OK3"; fail=1
fi

echo
if [ "$fail" = "0" ]; then echo "All Phase 2B concurrency proofs passed."; else echo "Phase 2B concurrency proofs FAILED."; exit 1; fi
