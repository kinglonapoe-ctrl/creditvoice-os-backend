#!/usr/bin/env bash
# CreditVoice OS — concurrent account creation under tenant-controlled numbering.
#  1. 20 parallel AUTOMATIC inserts (with a manual number pre-placed in the
#     sequence path) produce 20 distinct numbers and never reuse the manual one.
#  2. 10 parallel MANUAL inserts of the SAME number: exactly one succeeds.
# All test data is removed afterwards.
set -euo pipefail
DB="${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
TMP=$(mktemp -d); fail=0
SEED=$(psql "$DB" -Atc "select cv_test.cv_test_setup()")
j() { echo "$SEED" | python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
TA=$(j ta); TB=$(j tb); UA=$(j ua); CA=$(j ca)
claims="{\"sub\":\"$UA\",\"role\":\"authenticated\"}"
as_admin() { psql "$DB" -Atq -c "begin; set local role authenticated; select set_config('request.jwt.claims', '$claims', true) is not null; $1; commit;" 2>&1; }

as_admin "select public.set_account_numbering_settings('$TA', 'AUTOMATIC', 5, 8, null)" >/dev/null
NEXT=$(psql "$DB" -Atc "select next_number from public.tenant_account_sequences where tenant_id = '$TA'")
MANUAL=$((NEXT + 3))
as_admin "insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit, account_number) values ('$TA','$CA','NGN',0,'$MANUAL')" >/dev/null

echo "1) 20 concurrent automatic account creations"
for i in $(seq 1 20); do
  as_admin "insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit) values ('$TA','$CA','NGN',0) returning account_number" | grep -E '^[0-9]+$' >> "$TMP/auto.txt" &
done; wait
total=$(grep -c . "$TMP/auto.txt" || true); distinct=$(sort -u "$TMP/auto.txt" | grep -c . || true)
reused=$(grep -cx "$MANUAL" "$TMP/auto.txt" || true)
if [ "$total" = 20 ] && [ "$distinct" = 20 ] && [ "$reused" = 0 ]; then echo "   PASS  20 created, 20 distinct, manual $MANUAL skipped"
else echo "   FAIL  total=$total distinct=$distinct reused=$reused"; fail=1; fi

echo "2) 10 concurrent manual creations of the same number"
for i in $(seq 1 10); do
  ( as_admin "insert into public.customer_accounts (tenant_id, customer_id, currency_code, credit_limit, account_number) values ('$TA','$CA','NGN',0,'77777777') returning account_number" > "$TMP/m$i.txt" ) &
done; wait
ok=$(cat "$TMP"/m*.txt | grep -cx 77777777 || true)
rows=$(psql "$DB" -Atc "select count(*) from public.customer_accounts where tenant_id = '$TA' and account_number = '77777777'")
if [ "$ok" = 1 ] && [ "$rows" = 1 ]; then echo "   PASS  exactly one succeeded, one row stored"
else echo "   FAIL  succeeded=$ok rows=$rows"; fail=1; fi

psql "$DB" -q -c "select cv_test.cv_test_cleanup('$TA'); select cv_test.cv_test_cleanup('$TB')" >/dev/null
rm -rf "$TMP"; exit $fail
