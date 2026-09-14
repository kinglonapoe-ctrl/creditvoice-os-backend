import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDay } from "@/lib/format";
import { useIdentity } from "@/lib/identity";
import { getTenantNumbers } from "@/lib/services/organization";
import { getTenant } from "@/lib/services/platform";

export const Route = createFileRoute("/_authenticated/org/settings")({
  component: OrganizationSettings,
});

function OrganizationSettings() {
  const { data: identity } = useIdentity();
  const tenantId = identity?.tenantId ?? "";

  const tenant = useQuery({ queryKey: ["tenant", tenantId], queryFn: () => getTenant(tenantId), enabled: !!tenantId });
  const numbers = useQuery({ queryKey: ["org-numbers", tenantId], queryFn: () => getTenantNumbers(tenantId), enabled: !!tenantId });

  const t = tenant.data;

  return (
    <>
      <PageHeader title="Organization settings" description="Your organization's profile on the platform." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Profile</CardTitle>
            <CardDescription>Contact the platform team to amend registered details.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Trading name" value={t?.name} />
            <Row label="Legal name" value={t?.legal_name} />
            <Row label="Country" value={t?.country} />
            <Row label="Address" value={t?.address ?? "—"} />
            <Row label="Business type" value={t?.business_type ?? "—"} />
            <Row label="Onboarded" value={formatDay(t?.created_at)} />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <StatusBadge status={t?.status} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Operating configuration</CardTitle>
            <CardDescription>Currency is fixed once approved by the platform.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Currency" value={t?.currency_code ?? "Not set"} />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Currency approval</span>
              <StatusBadge status={t?.currency_approved ? "APPROVED" : "PENDING"} />
            </div>
            <Row
              label="Inbound number"
              value={(numbers.data ?? [])[0]?.phone_number ?? "Not assigned"}
            />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Access code</span>
              <StatusBadge status={t?.access_code_status === "ACTIVE" ? "ACTIVE" : "PENDING"} />
            </div>
            <p className="pt-2 text-xs text-muted-foreground">
              Currency, status and telephone assignment can only be changed by the platform team. Account numbers are
              unique inside your organization and may repeat in other organizations.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value?: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value ?? "—"}</span>
    </div>
  );
}
