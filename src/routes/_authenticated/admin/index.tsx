import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, ClipboardList, CreditCard, PhoneCall, Users, Wallet } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDay, formatMoney } from "@/lib/format";
import { listApplications, listTenants, platformStats } from "@/lib/services/platform";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminDashboard,
});

function AdminDashboard() {
  const stats = useQuery({ queryKey: ["platform-stats"], queryFn: platformStats });
  const applications = useQuery({ queryKey: ["applications"], queryFn: listApplications });
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: listTenants });

  const s = stats.data;

  return (
    <>
      <PageHeader title="Platform overview" description="Live position across every organization on CreditVoice OS." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active tenants" value={s?.activeTenants ?? "—"} hint={`${s?.totalTenants ?? 0} total`} icon={<Building2 className="h-4 w-4" />} />
        <StatCard label="Pending applications" value={s?.pendingApplications ?? "—"} icon={<ClipboardList className="h-4 w-4" />} />
        <StatCard label="Active customers" value={s?.activeCustomers ?? "—"} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Total accounts" value={s?.totalAccounts ?? "—"} icon={<CreditCard className="h-4 w-4" />} />
        <StatCard label="Credit volume" value={s ? formatMoney(s.creditVolume, "") : "—"} hint="Across all currencies" icon={<Wallet className="h-4 w-4" />} />
        <StatCard label="Transfer volume" value={s ? formatMoney(s.transferVolume, "") : "—"} hint="Completed transfers" icon={<Wallet className="h-4 w-4" />} />
        <StatCard label="Active IVR numbers" value={s?.activeNumbers ?? "—"} icon={<PhoneCall className="h-4 w-4" />} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="font-display text-base">Latest applications</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/applications">View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(applications.data ?? []).slice(0, 5).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.organization_name}</TableCell>
                    <TableCell>{a.requested_currency}</TableCell>
                    <TableCell><StatusBadge status={a.status} /></TableCell>
                    <TableCell className="text-muted-foreground">{formatDay(a.created_at)}</TableCell>
                  </TableRow>
                ))}
                {(applications.data ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">No applications yet.</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="font-display text-base">Organizations</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/tenants">View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(tenants.data ?? []).slice(0, 5).map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>{t.currency_code ?? "—"}</TableCell>
                    <TableCell><StatusBadge status={t.status} /></TableCell>
                  </TableRow>
                ))}
                {(tenants.data ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground">No organizations yet.</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
