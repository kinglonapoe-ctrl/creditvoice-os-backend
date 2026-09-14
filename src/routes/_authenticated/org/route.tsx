import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { AppShell, type NavItem } from "@/components/app-shell";
import { useIdentity, homePathForRole } from "@/lib/identity";

const NAV: NavItem[] = [
  { label: "Dashboard", to: "/org" },
  { label: "Customers", to: "/org/customers" },
  { label: "Accounts", to: "/org/accounts" },
  { label: "Credit", to: "/org/credit" },
  { label: "Transfers", to: "/org/transfers" },
  { label: "Transactions", to: "/org/transactions" },
  { label: "Reports", to: "/org/reports" },
  { label: "Customer Care", to: "/org/customer-care" },
  { label: "IVR Settings", to: "/org/ivr" },
  { label: "Security", to: "/org/security" },
  { label: "Organization Settings", to: "/org/settings" },
];

export const Route = createFileRoute("/_authenticated/org")({
  component: OrgLayout,
});

function OrgLayout() {
  const { data: identity, isLoading } = useIdentity();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && identity && (identity.role !== "TENANT_ADMIN" || !identity.tenantId)) {
      navigate({ to: homePathForRole(identity.role), replace: true });
    }
  }, [identity, isLoading, navigate]);

  if (isLoading || !identity || identity.role !== "TENANT_ADMIN" || !identity.tenantId) {
    return <div className="p-10 text-sm text-muted-foreground">Loading organization workspace…</div>;
  }

  return (
    <AppShell workspace="Organization administration" subtitle={identity.email ?? ""} nav={NAV}>
      <Outlet />
    </AppShell>
  );
}
