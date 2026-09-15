#!/usr/bin/env bash
# =====================================================================
# CreditVoice OS — Phase 2A concurrency proofs (real parallel sessions)
#
#  1. Credential lock race: many simultaneous invalid PIN attempts must
#     not exceed the configured attempt allowance.
#  2. Provider event race: the same event submitted simultaneously must
#     be accepted exactly once.
#  3. Session transition race: a simultaneous success and failure must
#     leave one consistent final state.
#
# All test data is removed afterwards.
# =====================================================================
set -euo pipefail
DB="${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
TMP=$(mktemp -d)
fail=0
q() { psql "$DB" -Atc "$1"; }

SEED=$(q "select cv_test.cv_test_voice_setup('pbkdf2\$1\$00\$aa','pbkdf2\$1\$00\$bb')")
jget() { echo "$SEED" | python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
TA=$(jget ta); TB=$(jget tb); TSUS=$(jget tsus)
NUM_A=$(jget num_a); ACCT_A=$(jget acct_a)
NUM_B=$(jget num_b); ACCT_B=$(jget acct_b)

cleanup() { q "select cv_test.cv_test_voice_cleanup(array['$TA','$TB','$TSUS']::uuid[])" >/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

# Drives a fresh session up to the PIN stage and echoes its id.
new_session_at_pin() {
  local from="$1" num="${2:-$NUM_A}" acct="${3:-$ACCT_A}" sid code
  sid=$(q "select public.cv_create_call_session('$from','$num')")
  q "select public.cv_resolve_tenant('$sid')" >/dev/null
  code=$(q "select (public.cv_begin_access_code_attempt('$sid'))->>'code_id'")
  q "select public.cv_finish_access_code_attempt('$sid','$code',true)" >/dev/null
  q "select public.cv_identify_account('$sid','$acct')" >/dev/null
  echo "$sid"
}

echo "1) PIN lock race"
SID=$(new_session_at_pin '+2348700000001')
for _ in $(seq 1 8); do
  psql "$DB" -Atc "select public.cv_begin_pin_attempt('$SID'); select public.cv_finish_pin_attempt('$SID',false)" \
    >> "$TMP/pin.txt" 2>&1 &
done
wait
STATE=$(q "select state from public.call_sessions where id = '$SID'")
ATTEMPTS=$(q "select (cv_test.cv_test_credential_state('PIN','$(jget ca)'))->>'failed_attempts'")
if [ "$STATE" = "LOCKED" ] && [ "$ATTEMPTS" -le 3 ]; then
  echo "   PASS  8 concurrent invalid PINs -> state=$STATE, counted attempts=$ATTEMPTS (allowance 3)"
else
  echo "   FAIL  state=$STATE attempts=$ATTEMPTS"; fail=1
fi

echo "2) provider event race"
SID2=$(q "select public.cv_create_call_session('+2348700000002','$NUM_A')")
EVT="evt-race-$(date +%s%N)"
for _ in $(seq 1 10); do
  psql "$DB" -Atc "select public.cv_claim_session_event('$SID2','NONE','$EVT','CALL_STARTED','{}'::jsonb)" \
    >> "$TMP/evt.txt" 2>/dev/null &
done
wait
ACCEPTED=$(grep -c '^t$' "$TMP/evt.txt" || true)
STORED=$(q "select count(*) from public.call_session_events where provider_event_id = '$EVT'")
if [ "$ACCEPTED" = "1" ] && [ "$STORED" = "1" ]; then
  echo "   PASS  10 simultaneous submissions of one event -> accepted=$ACCEPTED, stored=$STORED"
else
  echo "   FAIL  accepted=$ACCEPTED stored=$STORED"; fail=1
fi

echo "3) session transition race"
# uses a second organization whose credential has not been locked by test 1
SID3=$(new_session_at_pin '+2348700000003' "$NUM_B" "$ACCT_B")
psql "$DB" -Atc "select public.cv_begin_pin_attempt('$SID3'); select public.cv_finish_pin_attempt('$SID3',true)" \
  > "$TMP/ok.txt" 2>&1 &
psql "$DB" -Atc "select public.cv_begin_pin_attempt('$SID3'); select public.cv_finish_pin_attempt('$SID3',false)" \
  > "$TMP/bad.txt" 2>&1 &
wait
FINAL=$(q "select state from public.call_sessions where id = '$SID3'")
AUTHED=$(q "select count(*) from public.audit_logs where entity_id = '$SID3' and event_type = 'CALL_SESSION_AUTHENTICATED'")
if { [ "$FINAL" = "AUTHENTICATED" ] && [ "$AUTHED" = "1" ]; } || { [ "$FINAL" = "ACCOUNT_IDENTIFIED" ] && [ "$AUTHED" = "0" ]; }; then
  echo "   PASS  simultaneous success and failure -> single consistent state=$FINAL (authenticated events=$AUTHED)"
else
  echo "   FAIL  state=$FINAL authenticated events=$AUTHED"; fail=1
fi

exit $fail
