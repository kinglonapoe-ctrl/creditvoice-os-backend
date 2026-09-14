import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type AppRole = "SUPER_ADMIN" | "TENANT_ADMIN" | "CUSTOMER";

export interface Identity {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: AppRole | null;
  tenantId: string | null;
}

export async function loadIdentity(): Promise<Identity | null> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;

  const [{ data: roles }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("role, tenant_id").eq("user_id", user.id),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);

  const ranked = (roles ?? []).sort((a, b) => rank(a.role) - rank(b.role));
  const primary = ranked[0];

  return {
    userId: user.id,
    email: user.email ?? null,
    fullName: profile?.full_name ?? (user.user_metadata?.["full_name"] as string) ?? null,
    role: (primary?.role as AppRole) ?? null,
    tenantId: primary?.tenant_id ?? null,
  };
}

function rank(role: string) {
  return role === "SUPER_ADMIN" ? 1 : role === "TENANT_ADMIN" ? 2 : 3;
}

export function useIdentity() {
  return useQuery({
    queryKey: ["identity"],
    queryFn: loadIdentity,
    staleTime: 30_000,
  });
}

export function homePathForRole(role: AppRole | null | undefined) {
  if (role === "SUPER_ADMIN") return "/admin";
  if (role === "TENANT_ADMIN") return "/org";
  return "/pending";
}
