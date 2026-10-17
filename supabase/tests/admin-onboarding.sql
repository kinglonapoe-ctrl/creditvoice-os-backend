\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE rid uuid; n integer; ok boolean;
BEGIN
 FOR n IN 1..3 LOOP
  IF NOT public.admin_onboarding_rate_limit('onboarding-regression-fixture',3) THEN RAISE EXCEPTION 'early rate limit'; END IF;
 END LOOP;
 IF public.admin_onboarding_rate_limit('onboarding-regression-fixture',3) THEN RAISE EXCEPTION 'rate limit bypass'; END IF;
 INSERT INTO public.admin_onboarding_requests(user_id,purpose,status,session_hash) VALUES('00000000-0000-0000-0000-000000000001','RECOVERY','VERIFIED','fixture-session-hash') RETURNING id INTO rid;
 IF public.admin_onboarding_claim(rid,'wrong-hash','00000000-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'invalid session accepted'; END IF;
 IF public.admin_onboarding_claim(rid,'fixture-session-hash','00000000-0000-0000-0000-000000000002') THEN RAISE EXCEPTION 'wrong user accepted'; END IF;
 IF NOT public.admin_onboarding_claim(rid,'fixture-session-hash','00000000-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'valid session refused'; END IF;
 IF public.admin_onboarding_claim(rid,'fixture-session-hash','00000000-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'reuse accepted'; END IF;
 UPDATE public.admin_onboarding_requests SET status='VERIFIED',expires_at=now()-interval '1 second' WHERE id=rid;
 IF public.admin_onboarding_claim(rid,'fixture-session-hash','00000000-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'expired claim accepted'; END IF;
 IF has_function_privilege('authenticated','public.admin_onboarding_claim(uuid,text,uuid)','EXECUTE') THEN RAISE EXCEPTION 'client claim privilege'; END IF;
 IF has_table_privilege('authenticated','public.admin_onboarding_requests','SELECT') THEN RAISE EXCEPTION 'client request read privilege'; END IF;
 RAISE NOTICE '9 onboarding database checks passed';
END $$;
ROLLBACK;
