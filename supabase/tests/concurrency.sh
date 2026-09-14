#!/usr/bin/env bash
# =====================================================================
# CreditVoice OS — concurrency proofs (real parallel database sessions)
#
#  1. Account-number allocation: 30 concurrent allocations must produce
#     30 distinct numbers.
#  2. Double-spend: two concurrent transfers against the same account
#     must be serialised — the second session may not read the sender's
#     balance until the first has finished.
#
# All test data is removed or rolled back.
# =====================================================================
set -euo pipefail
DB="${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
TMP=$(mktemp -d)
fail=0

echo "1) account number allocation under concurrency"
SEED=$(psql "$DB" -Atc "select public.cv_test_setup()")
TENANT=$(echo "$SEED" | python3 -c 'import json,sys; print(json.load(sys.stdin)["ta"])')
TENANT2=$(echo "$SEED" | python3 -c 'import json,sys; print(json.load(sys.stdin)["tb"])')
for i in $(seq 1 30); do
  psql "$DB" -Atc "select public.allocate_account_number('$TENANT')" >> "$TMP/numbers.txt" &
done
wait
total=$(grep -c . "$TMP/numbers.txt" | tr -d ' ')
distinct=$(sort -u "$TMP/numbers.txt" | grep -c . | tr -d ' ')
psql "$DB" -q -c "select public.cv_test_cleanup('$TENANT'); select public.cv_test_cleanup('$TENANT2')" >/dev/null
if [ "$total" = "30" ] && [ "$distinct" = "30" ]; then
  echo "   PASS  30 concurrent allocations, $distinct distinct numbers"
else
  echo "   FAIL  $total allocations, $distinct distinct numbers"; fail=1
fi

echo "2) double spend: two concurrent 8,000 transfers from a 10,000 balance"
IDS=$(psql "$DB" -Atc "select public.cv_test_setup()")
AA1=$(echo "$IDS" | python3 -c 'import json,sys; print(json.load(sys.stdin)["aa1"])')
AA2=$(echo "$IDS" | python3 -c 'import json,sys; print(json.load(sys.stdin)["aa2"])')
UA=$(echo "$IDS" | python3 -c 'import json,sys; print(json.load(sys.stdin)["ua"])')
TA=$(echo "$IDS" | python3 -c 'import json,sys; print(json.load(sys.stdin)["ta"])')
TB=$(echo "$IDS" | python3 -c 'import json,sys; print(json.load(sys.stdin)["tb"])')

claims="{\"sub\":\"$UA\",\"role\":\"authenticated\"}"

# Fund the sender with 10,000 and commit, so both sessions start from the same balance.
psql "$DB" -q -o /dev/null -c "begin; set local role authenticated;
  select set_config('request.jwt.claims', '$claims', true);
  select public.post_credit('$AA1', 10000, 'INITIAL_CREDIT', 'concurrency fixture'); commit;"

# Session A holds the sender row lock for 3 seconds, then commits its transfer.
cat > "$TMP/a.sql" <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '$claims', true);
select public.execute_transfer('$AA1', '$AA2', 8000, 'A');
select pg_sleep(3);
commit;
SQL

# Session B starts one second later and attempts the same 8,000 transfer.
cat > "$TMP/b.sql" <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '$claims', true);
select public.execute_transfer('$AA1', '$AA2', 8000, 'B');
commit;
SQL

psql "$DB" -q -f "$TMP/a.sql" > "$TMP/a.out" 2>&1 &
sleep 1
started=$(date +%s.%N)
psql "$DB" -q -f "$TMP/b.sql" > "$TMP/b.out" 2>&1 || true
ended=$(date +%s.%N)
wait

waited=$(python3 -c "print(round($ended - $started, 2))")
bal=$(psql "$DB" -Atc "select balance from public.customer_accounts where id = '$AA1'")
rejected=$(grep -c 'Insufficient available credit' "$TMP/b.out" || true)
blocked=$(python3 -c "print('yes' if $waited >= 1.0 else 'no')")

if [ "$rejected" != "0" ] && [ "$blocked" = "yes" ] && [ "$bal" = "2000.0000" ]; then
  echo "   PASS  second transfer blocked ${waited}s then rejected; final balance $bal"
else
  echo "   FAIL  rejected=$rejected waited=${waited}s balance=$bal"
  cat "$TMP/a.out" "$TMP/b.out"; fail=1
fi

psql "$DB" -q -c "select public.cv_test_cleanup('$TA'); select public.cv_test_cleanup('$TB')" \
  >/dev/null 2>&1 || echo "   WARN  test organizations could not be removed automatically"
rm -rf "$TMP"
exit $fail
