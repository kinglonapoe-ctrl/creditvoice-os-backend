import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { AppShell, type NavItem } from "@/components/app-shell";
import { useIdentity, homePathForRole } from "@/lib/identity";

const NAV: NavItem[] = [
  { label: "Dashboard", to: "/admin" },
  { label: "Tenant Applications", to: "/admin/applications" },
  { label: "Tenants", to: "/admin/tenants" },
  { label: "Currencies", to: "/admin/currencies" },
  { label: "Phone Numbers", to: "/admin/phone-numbers" },
  { label: "Telephony Providers", to: "/admin/telephony" },
  { label: "Voice Operations", to: "/admin/voice-operations" },
  { label: "Transactions", to: "/admin/transactions" },
  { label: "Customer Care", to: "/admin/customer-care" },
  { label: "Audit Logs", to: "/admin/audit-logs" },
  { label: "Platform Settings", to: "/admin/settings" },
];

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const { data: identity, isLoading } = useIdentity();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && identity && identity.role !== "SUPER_ADMIN") {
      navigate({ to: homePathForRole(identity.role), replace: true });
    }
  }, [identity, isLoading, navigate]);

  if (isLoading || !identity || identity.role !== "SUPER_ADMIN") {
    return <div className="p-10 text-sm text-muted-foreground">Loading platform workspace…</div>;
  }

  return (
    <AppShell workspace="Platform administration" subtitle={identity.email ?? ""} nav={NAV}>
      <Outlet />
    </AppShell>
  );
}
