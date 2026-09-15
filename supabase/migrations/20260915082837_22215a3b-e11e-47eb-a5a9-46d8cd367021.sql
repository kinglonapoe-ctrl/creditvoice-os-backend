-- Least privilege: RLS does not restrict TRUNCATE, so blanket table grants to
-- `authenticated` left call/session/audit/idempotency tables destructible.
REVOKE ALL ON public.call_sessions FROM authenticated;
REVOKE ALL ON public.call_session_events FROM authenticated;
REVOKE ALL ON public.call_auth_failures FROM authenticated;
REVOKE ALL ON public.financial_failure_events FROM authenticated;
REVOKE ALL ON public.financial_idempotency FROM authenticated;
REVOKE ALL ON public.tenant_account_sequences FROM authenticated;

REVOKE ALL ON public.call_sessions FROM anon;
REVOKE ALL ON public.call_session_events FROM anon;
REVOKE ALL ON public.call_auth_failures FROM anon;
REVOKE ALL ON public.financial_failure_events FROM anon;
REVOKE ALL ON public.financial_idempotency FROM anon;
REVOKE ALL ON public.tenant_account_sequences FROM anon;

-- Read-only access where a SELECT policy already exists; nothing else.
GRANT SELECT ON public.call_sessions TO authenticated;
GRANT SELECT ON public.call_session_events TO authenticated;
GRANT SELECT ON public.call_auth_failures TO authenticated;
GRANT SELECT ON public.financial_failure_events TO authenticated;

GRANT ALL ON public.call_sessions TO service_role;
GRANT ALL ON public.call_session_events TO service_role;
GRANT ALL ON public.call_auth_failures TO service_role;
GRANT ALL ON public.financial_failure_events TO service_role;
GRANT ALL ON public.financial_idempotency TO service_role;
GRANT ALL ON public.tenant_account_sequences TO service_role;