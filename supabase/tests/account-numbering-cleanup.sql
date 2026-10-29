-- Settings-only regression: no customer accounts, activation or financial writes.
-- Run with sandbox_exec; all fixture changes roll back even after successful cleanup.
\set ON_ERROR_STOP on
begin;
create temporary table cleanup_before as
  select tenant_id, to_jsonb(s) as row_data from public.tenant_account_number_settings s;
do $test$
declare ta uuid := gen_random_uuid(); tb uuid := gen_random_uuid(); control uuid := gen_random_uuid(); rejected boolean := false;
begin
  insert into public.tenants(id, name, legal_name, country)
  values (ta, 'QA Numbering Cleanup', 'QA Numbering Cleanup', 'NG'),
         (tb, 'QA Voice Numbering Cleanup', 'QA Voice Numbering Cleanup', 'NG'),
         (control, 'Cleanup Guard Control', 'Cleanup Guard Control', 'NG');
  if (select count(*) from public.tenant_account_number_settings where tenant_id in (ta,tb,control)) <> 3 then
    raise exception 'FAIL: default settings were not created for each temporary organization';
  end if;
  perform cv_test.cv_test_cleanup(ta);
  if exists(select 1 from public.tenants where id=ta) or exists(select 1 from public.tenant_account_number_settings where tenant_id=ta) then
    raise exception 'FAIL: normal QA cleanup left tenant or numbering settings';
  end if;
  raise notice 'PASS: normal QA cleanup removes temporary tenant and numbering settings';
  perform cv_test.cv_test_voice_cleanup(array[tb]);
  if exists(select 1 from public.tenants where id=tb) or exists(select 1 from public.tenant_account_number_settings where tenant_id=tb) then
    raise exception 'FAIL: voice QA cleanup left tenant or numbering settings';
  end if;
  raise notice 'PASS: voice QA cleanup removes temporary tenant and numbering settings';
  begin
    perform cv_test.cv_test_cleanup(control);
  exception when others then
    if sqlerrm <> 'Refusing to remove a non-test organization' then raise; end if;
    rejected := true;
  end;
  if not rejected or not exists(select 1 from public.tenants where id=control) or not exists(select 1 from public.tenant_account_number_settings where tenant_id=control) then
    raise exception 'FAIL: non-QA organization guard did not preserve parent and settings';
  end if;
  rejected := false;
  begin
    perform cv_test.cv_test_voice_cleanup(array[control]);
  exception when others then
    if sqlerrm <> 'Refusing to remove a non-test organization' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'FAIL: voice cleanup accepted non-QA organization'; end if;
  raise notice 'PASS: both helpers refuse non-QA organizations';
  perform cv_test.cv_test_cleanup(ta);
  perform cv_test.cv_test_voice_cleanup(array[tb]);
  if exists(select 1 from cleanup_before b left join public.tenant_account_number_settings s using(tenant_id) where s.tenant_id is null or to_jsonb(s) <> b.row_data) then
    raise exception 'FAIL: pre-existing numbering settings changed';
  end if;
  raise notice 'PASS: repeated cleanup is safe and pre-existing settings are unchanged';
end;
$test$;
rollback;