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
TENANT=$(psql "$DB" -Atc "select gen_random_uuid()")
psql "$DB" -q -c "insert into public.tenant_account_sequences (tenant_id, next_number) values ('$TENANT', 10001)"
for i in $(seq 1 30); do
  psql "$DB" -Atc "select public.allocate_account_number('$TENANT')" >> "$TMP/numbers.txt" &
done
wait
total=$(wc -l < "$TMP/numbers.txt" | tr -d ' ')
distinct=$(sort -u "$TMP/numbers.txt" | wc -l | tr -d ' ')
psql "$DB" -q -c "delete from public.tenant_account_sequences where tenant_id = '$TENANT'"
if [ "$total" = "30" ] && [ "$distinct" = "30" ]; then
  echo "   PASS  30 allocations, $distinct distinct numbers"
else
  echo "   FAIL  $total allocations, $distinct distinct numbers"; fail=1
fi

echo "2) concurrent transfers are serialised on the sender account"
IDS=$(psql "$DB" -Atc "select public.cv_test_setup()")
AA1=$(echo "$IDS" | python3 -c 'import json,sys; print(json.load(sys.stdin)["aa1"])')
AA2=$(echo "$IDS" | python3 -c 'import json,sys; print(json.load(sys.stdin)["aa2"])')
UA=$(echo "$IDS" | python3 -c 'import json,sys; print(json.load(sys.stdin)["ua"])')
TA=$(echo "$IDS" | python3 -c 'import json,sys; print(json.load(sys.stdin)["ta"])')
TB=$(echo "$IDS" | python3 -c 'import json,sys; print(json.load(sys.stdin)["tb"])')

claims="{\"sub\":\"$UA\",\"role\":\"authenticated\"}"

# Session A: opens 10,000 credit, transfers 8,000, holds the lock for 3s, rolls back.
cat > "$TMP/a.sql" <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '$claims', true);
select public.post_credit('$AA1', 10000, 'INITIAL_CREDIT', 'concurrency');
select public.execute_transfer('$AA1', '$AA2', 8000, 'A');
select pg_sleep(3);
rollback;
SQL

# Session B: attempts a second 8,000 transfer while A holds the lock.
cat > "$TMP/b.sql" <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '$claims', true);
select clock_timestamp() as started \gset
select public.execute_transfer('$AA1', '$AA2', 8000, 'B');
select extract(epoch from (clock_timestamp() - :'started')) as waited_seconds;
rollback;
SQL

psql "$DB" -q -f "$TMP/a.sql" > "$TMP/a.out" 2>&1 &
sleep 1
psql "$DB" -Atf "$TMP/b.sql" > "$TMP/b.out" 2>&1 || true
wait

waited=$(grep -Eo '^[0-9]+\.[0-9]+$' "$TMP/b.out" | tail -1 || true)
blocked=$(python3 - "$waited" <<'PY'
import sys
v = sys.argv[1]
print("yes" if v and float(v) >= 1.0 else "no")
PY
)
if [ "$blocked" = "yes" ]; then
  echo "   PASS  second transfer waited ${waited}s for the sender row lock"
else
  echo "   FAIL  second transfer was not serialised (waited='${waited}')"
  cat "$TMP/b.out"; fail=1
fi

# Neither session committed any money; remove the throwaway organizations.
psql "$DB" -q -c "select public.cv_test_cleanup('$TA'); select public.cv_test_cleanup('$TB')" \
  >/dev/null 2>&1 || echo "   WARN  test organizations could not be removed automatically"
rm -rf "$TMP"
exit $fail
