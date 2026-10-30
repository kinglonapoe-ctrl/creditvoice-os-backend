"""Real parallel sessions; exclusively a positively marked localhost test DB."""
import os, subprocess, concurrent.futures, time, json
from urllib.parse import urlparse, parse_qs
DB=os.environ.get('CV_CURRENCY_TEST_DB_URL','')
target=urlparse(DB)
if target.hostname!='localhost' or target.port!=55437 or target.username!='nobody' or parse_qs(target.query).get('host')!=['/tmp/cv-currency-test/socket']:
    raise SystemExit('Dedicated localhost currency test database required')
def sql(q, ok=True):
    p=subprocess.run(['psql',DB,'-X','-At','-v','ON_ERROR_STOP=1','-c',q],capture_output=True,text=True)
    if ok and p.returncode: raise RuntimeError(p.stderr)
    return p
assert sql("select current_setting('creditvoice.isolated_test',true)").stdout.strip()=='on'
assert sql("select count(*) from public.tenants where id in ('7965a5cb-1144-4fc1-9150-db68e40dbe4c','3f3db4ed-37a1-4c10-befd-08e2b08f04c5','b2678d71-d392-4f29-b9e7-21365d307a12')").stdout.strip()=='0'
ids=json.loads(sql('select cv_test.cv_test_setup()').stdout)
ta=ids['ta']; ua=ids['ua']; a=ids['aa1']; ca=ids['ca']; super_id='00000000-0000-0000-0000-000000000111'
sql(f"insert into auth.users(id,email) values('{super_id}','concurrency@example.invalid') on conflict do nothing; insert into public.user_roles(user_id,role) select '{super_id}','SUPER_ADMIN' where not exists(select 1 from public.user_roles where user_id='{super_id}');")
def admin(q, uid=super_id):
    return f"begin; set local role authenticated; select set_config('request.jwt.claims','{{\"sub\":\"{uid}\",\"role\":\"authenticated\"}}',true); {q}; commit;"
with concurrent.futures.ThreadPoolExecutor() as pool:
    # Hold currency mutex until a second session is verifiably waiting on it.
    first=subprocess.Popen(['psql',DB,'-X','-At','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    first.stdin.write(f"begin; select public.lock_tenant_currency('{ta}'); select pg_sleep(1);\n"); first.stdin.flush()
    time.sleep(.15)
    create=pool.submit(sql,admin(f"insert into public.customer_accounts(tenant_id,customer_id,currency_code,account_number) values('{ta}','{ca}','NGN','88888')",ua),False)
    for _ in range(30):
        if sql("select count(*) from pg_stat_activity where wait_event='advisory'").stdout.strip()!='0': break
        time.sleep(.05)
    else: raise AssertionError('Account creation did not wait on currency mutex')
    first.stdin.write(f"select set_config('request.jwt.claims','{{\"sub\":\"{super_id}\",\"role\":\"authenticated\"}}',true); select public.change_organization_currency('{ta}','USD','concurrency'); commit;\n"); first.stdin.close(); first.wait(timeout=10)
    if first.returncode: raise RuntimeError(first.stderr.read())
    assert create.result().returncode!=0
    assert sql(f"select count(*) from public.customer_accounts where tenant_id='{ta}' and currency_code<>'USD'").stdout.strip()=='0'
    print('PASS account creation waits and stale currency is rejected')
    sql(admin(f"select public.change_organization_currency('{ta}','NGN','restore')"))
    posting=pool.submit(sql,admin(f"select public.post_credit('{a}',10,'INITIAL_CREDIT','isolated'); select pg_sleep(1)",ua))
    for _ in range(30):
        if sql("select count(*) from pg_stat_activity where query like '%post_credit%' and wait_event='PgSleep'").stdout.strip()!='0': break
        time.sleep(.05)
    else: raise AssertionError('Posting did not hold test transaction')
    change=sql(admin(f"select public.change_organization_currency('{ta}','USD','racing posting')"),False)
    posting.result()
    assert change.returncode!=0 and 'financial history' in change.stderr
    assert sql(f"select currency_code||':'||balance from public.customer_accounts where id='{a}'").stdout.strip()=='NGN:10.0000'
    print('PASS posting wins lock; racing currency change rejects committed history')
# Local cluster is disposable: no live cleanup path is reachable.
