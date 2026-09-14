import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/components/app-shell";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney, titleCase } from "@/lib/format";
import { useIdentity } from "@/lib/identity";
import { getTenantNumbers, listTransactions, organizationStats } from "@/lib/services/organization";
import { getTenant } from "@/lib/services/platform";

export const Route = createFileRoute("/_authenticated/org/")({
  component: OrgDashboard,
});

function OrgDashboard() {
  const { data: identity } = useIdentity();
  const tenantId = identity?.tenantId ?? "";

  const tenant = useQuery({ queryKey: ["tenant", tenantId], queryFn: () => getTenant(tenantId), enabled: !!tenantId });
  const stats = useQuery({ queryKey: ["org-stats", tenantId], queryFn: () => organizationStats(tenantId), enabled: !!tenantId });
  const numbers = useQuery({ queryKey: ["org-numbers", tenantId], queryFn: () => getTenantNumbers(tenantId), enabled: !!tenantId });
  const recent = useQuery({ queryKey: ["org-transactions", tenantId], queryFn: () => listTransactions(tenantId), enabled: !!tenantId });

  const currency = tenant.data?.currency_code ?? "USD";
  const s = stats.data;

  return (
    <>
      <PageHeader
        title={tenant.data?.name ?? "Organization"}
        description={`Operating in ${currency} · ${titleCase(tenant.data?.status)}`}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Customers" value={s?.customers ?? 0} />
        <StatCard label="Active accounts" value={s?.activeAccounts ?? 0} />
        <StatCard label="Total credit" value={formatMoney(s?.totalCredit, currency)} />
        <StatCard label="Available credit" value={formatMoney(s?.availableCredit, currency)} hint="Balance plus credit limit" />
        <StatCard label="Transfers today" value={s?.transfersToday ?? 0} />
        <StatCard
          label="Customer care calls"
          value="—"
          hint="Call handling arrives with the telephony phase"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-base">Recent activity</CardTitle>
            <CardDescription>The latest postings against your organization's accounts.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Posted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(recent.data ?? []).slice(0, 8).map((t: any) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.reference}</TableCell>
                    <TableCell>{titleCase(t.type)}</TableCell>
                    <TableCell>{formatMoney(t.amount, t.currency_code)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(t.created_at)}</TableCell>
                  </TableRow>
                ))}
                {(recent.data ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                      Nothing posted yet.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Voice line</CardTitle>
            <CardDescription>Assigned by the platform.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {(numbers.data ?? []).length ? (
              (numbers.data ?? []).map((n) => (
                <div key={n.id} className="rounded-md border border-border p-3">
                  <p className="font-mono font-medium">{n.phone_number}</p>
                  <p className="text-xs text-muted-foreground">{n.country} · {n.provider}</p>
                  <StatusBadge className="mt-2" status={n.status} />
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">No number assigned yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
