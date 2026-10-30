\set ON_ERROR_STOP on
DO $$ BEGIN IF current_setting('creditvoice.isolated_test',true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'Isolated database required'; END IF; END $$;
BEGIN;
CREATE TEMP TABLE currency_results(name text,passed boolean);
CREATE TEMP TABLE currency_ids AS SELECT cv_test.cv_test_setup() ids;
DO $$ DECLARE u uuid:=gen_random_uuid(); BEGIN
 INSERT INTO auth.users(id,email) VALUES(u,'currency-super@example.invalid');
 INSERT INTO public.user_roles(user_id,role) VALUES(u,'SUPER_ADMIN');
 ALTER TABLE currency_ids ADD COLUMN super_id uuid;
 UPDATE currency_ids SET super_id=u;
END $$;
GRANT ALL ON currency_results TO authenticated;
GRANT SELECT ON currency_ids TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE ids jsonb; u uuid; ta uuid; ua uuid; a uuid; old_count bigint; failed boolean; event public.audit_logs%ROWTYPE;
BEGIN
 SELECT i.ids,i.super_id INTO ids,u FROM currency_ids i;
 ta:=(ids->>'ta')::uuid; ua:=(ids->>'ua')::uuid; a:=(ids->>'aa1')::uuid;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);
 BEGIN PERFORM public.change_organization_currency(ta,'USD','unauthorized'); failed:=false; EXCEPTION WHEN OTHERS THEN failed:=sqlerrm LIKE '%Only Super Admins%'; END;
 INSERT INTO currency_results VALUES('tenant administrator rejected',failed);
 BEGIN UPDATE public.tenants SET currency_code='USD' WHERE id=ta; failed:=false; EXCEPTION WHEN OTHERS THEN failed:=true; END;
 INSERT INTO currency_results VALUES('direct tenant administrator update rejected',failed);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 SELECT count(*) INTO old_count FROM public.audit_logs;
 BEGIN PERFORM public.change_organization_currency(ta,'USD',''); failed:=false; EXCEPTION WHEN OTHERS THEN failed:=sqlerrm LIKE '%reason%'; END;
 INSERT INTO currency_results VALUES('missing reason rejected without changes',failed AND (SELECT currency_code='NGN' FROM public.tenants WHERE id=ta) AND (SELECT count(*)=old_count FROM public.audit_logs));
 PERFORM public.change_organization_currency(ta,'USD','US demonstration');
 INSERT INTO currency_results VALUES('zero-history zero-balance accounts change atomically',(SELECT currency_code='USD' FROM public.tenants WHERE id=ta) AND NOT EXISTS(SELECT 1 FROM public.customer_accounts WHERE tenant_id=ta AND currency_code<>'USD'));
 SELECT * INTO event FROM public.audit_logs WHERE tenant_id=ta AND event_type='CURRENCY_CHANGED';
 INSERT INTO currency_results VALUES('exactly one complete permanent audit',event.actor_id=u AND event.actor_role='SUPER_ADMIN' AND event.metadata->>'old_currency'='NGN' AND event.metadata->>'new_currency'='USD' AND event.metadata->>'reason'='US demonstration' AND event.created_at IS NOT NULL AND (SELECT count(*)=1 FROM public.audit_logs WHERE tenant_id=ta AND event_type='CURRENCY_CHANGED'));
 BEGIN UPDATE public.audit_logs SET metadata='{}' WHERE id=event.id; failed:=false; EXCEPTION WHEN insufficient_privilege THEN failed:=true; END;
 INSERT INTO currency_results VALUES('audit client mutation denied',failed);
 PERFORM public.change_organization_currency(ta,'NGN','restore isolated fixture');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);
 PERFORM public.post_credit(a,10,'INITIAL_CREDIT','isolated');
 PERFORM public.post_credit(a,10,'CREDIT_DEBIT','zero balance retains history');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 SELECT count(*) INTO old_count FROM public.audit_logs;
 BEGIN PERFORM public.change_organization_currency(ta,'USD','history'); failed:=false; EXCEPTION WHEN OTHERS THEN failed:=sqlerrm LIKE '%financial history%'; END;
 INSERT INTO currency_results VALUES('zero balance with financial history rejected',failed AND (SELECT balance=0 FROM public.customer_accounts WHERE id=a));
 INSERT INTO currency_results VALUES('rejection preserves tenant accounts and audit',(SELECT currency_code='NGN' FROM public.tenants WHERE id=ta) AND NOT EXISTS(SELECT 1 FROM public.customer_accounts WHERE tenant_id=ta AND currency_code<>'NGN') AND (SELECT count(*)=old_count FROM public.audit_logs));
END $$;
RESET ROLE;
-- Privileged fixture corruption and audit-failure simulation are isolated and rolled back.
DO $$
DECLARE ids jsonb; u uuid; t uuid; a uuid; failed boolean; before_count bigint;
BEGIN
 SELECT i.ids,i.super_id INTO ids,u FROM currency_ids i;
 t:=(ids->>'tb')::uuid; a:=(ids->>'ab1')::uuid;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 PERFORM set_config('app.ledger_posting','on',true);
 UPDATE public.customer_accounts SET currency_code='USD' WHERE id=a;
 PERFORM set_config('app.ledger_posting','off',true);
 BEGIN PERFORM public.change_organization_currency(t,'USD','mixed'); failed:=false; EXCEPTION WHEN OTHERS THEN failed:=sqlerrm LIKE '%consistent%'; END;
 INSERT INTO currency_results VALUES('existing mixed-currency account rejected',failed AND (SELECT currency_code='NGN' FROM public.tenants WHERE id=t));
 PERFORM set_config('app.ledger_posting','on',true);
 UPDATE public.customer_accounts SET currency_code='NGN',credit_limit=1 WHERE id=a;
 PERFORM set_config('app.ledger_posting','off',true);
 BEGIN PERFORM public.change_organization_currency(t,'USD','limit'); failed:=false; EXCEPTION WHEN OTHERS THEN failed:=sqlerrm LIKE '%zero balances and credit limits%'; END;
 INSERT INTO currency_results VALUES('nonzero credit limit rejected',failed);
 UPDATE public.customer_accounts SET credit_limit=0 WHERE id=a;
 SELECT count(*) INTO before_count FROM public.audit_logs;
 EXECUTE 'CREATE FUNCTION pg_temp.fail_currency_audit() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF new.event_type=''CURRENCY_CHANGED'' THEN RAISE EXCEPTION ''Simulated audit storage failure''; END IF; RETURN new; END $f$';
 EXECUTE 'CREATE TRIGGER z_test_audit_failure BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_currency_audit()';
 BEGIN PERFORM public.change_organization_currency(t,'USD','audit failure'); failed:=false; EXCEPTION WHEN OTHERS THEN failed:=sqlerrm LIKE '%Simulated audit storage failure%'; END;
 INSERT INTO currency_results VALUES('audit failure rolls back tenant and account changes',failed AND (SELECT currency_code='NGN' FROM public.tenants WHERE id=t) AND (SELECT currency_code='NGN' FROM public.customer_accounts WHERE id=a) AND (SELECT count(*)=before_count FROM public.audit_logs));
 EXECUTE 'DROP TRIGGER z_test_audit_failure ON public.audit_logs';
 INSERT INTO public.financial_failure_events(tenant_id,operation,reason_category,channel) VALUES(t,'isolated','isolated','TEST');
 BEGIN PERFORM public.change_organization_currency(t,'USD','failed financial posting history'); failed:=false; EXCEPTION WHEN OTHERS THEN failed:=sqlerrm LIKE '%financial history%'; END;
 INSERT INTO currency_results VALUES('financial failure history blocks changes',failed);
END $$;
TABLE currency_results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM currency_results WHERE NOT passed) THEN RAISE EXCEPTION 'Currency regression failed'; END IF; END $$;
ROLLBACK;
