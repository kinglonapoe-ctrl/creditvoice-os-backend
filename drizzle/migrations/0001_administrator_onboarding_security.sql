CREATE TABLE public.admin_onboarding_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid REFERENCES public.tenants(id),
 user_id uuid,
 purpose text NOT NULL CHECK (purpose IN ('SETUP','RECOVERY')),
 status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VERIFIED','PROCESSING','COMPLETED','FAILED','EXPIRED')),
 session_hash text,
 attempts integer NOT NULL DEFAULT 0,
 expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.admin_onboarding_requests TO service_role;
ALTER TABLE public.admin_onboarding_requests ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.admin_onboarding_rate_limits (
 key_hash text PRIMARY KEY,
 window_started_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0
);
GRANT ALL ON public.admin_onboarding_rate_limits TO service_role;
ALTER TABLE public.admin_onboarding_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.admin_onboarding_rate_limit(_key text, _limit integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer;
BEGIN
 INSERT INTO public.admin_onboarding_rate_limits(key_hash,attempts) VALUES (_key,1)
 ON CONFLICT (key_hash) DO UPDATE SET attempts=CASE WHEN admin_onboarding_rate_limits.window_started_at < now()-interval '1 hour' THEN 1 ELSE admin_onboarding_rate_limits.attempts+1 END,
 window_started_at=CASE WHEN admin_onboarding_rate_limits.window_started_at < now()-interval '1 hour' THEN now() ELSE admin_onboarding_rate_limits.window_started_at END RETURNING attempts INTO n;
 RETURN n <= _limit;
END $$;
REVOKE ALL ON FUNCTION public.admin_onboarding_rate_limit(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_onboarding_rate_limit(text,integer) TO service_role;
CREATE FUNCTION public.admin_onboarding_claim(_id uuid,_session_hash text,_user_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.admin_onboarding_requests SET status='PROCESSING' WHERE id=_id AND user_id=_user_id AND session_hash=_session_hash AND status='VERIFIED' AND expires_at > now();
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.admin_onboarding_claim(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_onboarding_claim(uuid,text,uuid) TO service_role;