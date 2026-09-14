import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDay } from "@/lib/format";
import { listTenants } from "@/lib/services/platform";

export const Route = createFileRoute("/_authenticated/admin/tenants/")({
  component: Tenants,
});

function Tenants() {
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: listTenants });

  return (
    <>
      <PageHeader title="Tenants" description="Every organization provisioned on the platform." />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Access code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(tenants.data ?? []).map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground">{t.legal_name}</div>
                  </TableCell>
                  <TableCell>{t.country}</TableCell>
                  <TableCell>
                    {t.currency_code ?? "—"}
                    {t.currency_approved ? <span className="ml-2 text-xs text-emerald-600">approved</span> : null}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={t.access_code_status === "ACTIVE" ? "ACTIVE" : "PENDING"} />
                  </TableCell>
                  <TableCell><StatusBadge status={t.status} /></TableCell>
                  <TableCell className="text-muted-foreground">{formatDay(t.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/admin/tenants/$tenantId" params={{ tenantId: t.id }}>
                        Manage
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {(tenants.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No organizations yet. Approve an application to provision one.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
