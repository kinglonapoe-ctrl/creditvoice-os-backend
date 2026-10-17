REVOKE ALL ON public.admin_onboarding_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.admin_onboarding_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.admin_onboarding_requests TO service_role;
GRANT ALL ON public.admin_onboarding_rate_limits TO service_role;