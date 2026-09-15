DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'GRANT ALL ON public.call_sessions, public.call_session_events, public.call_auth_failures, public.financial_failure_events, public.financial_idempotency, public.tenant_account_sequences TO sandbox_exec';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.cv_test_admin(text, uuid) TO sandbox_exec';
  END IF;
END $$;