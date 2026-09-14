import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, titleCase } from "@/lib/format";
import { listAuditLogs, listTenants } from "@/lib/services/platform";

export const Route = createFileRoute("/_authenticated/admin/audit-logs")({
  component: AuditLogs,
});

function AuditLogs() {
  const [search, setSearch] = useState("");
  const logs = useQuery({ queryKey: ["audit-logs"], queryFn: () => listAuditLogs() });
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: listTenants });

  const tenantName = (id: string | null) => (tenants.data ?? []).find((t) => t.id === id)?.name ?? "Platform";
  const rows = (logs.data ?? []).filter((l) =>
    search ? `${l.event_type} ${tenantName(l.tenant_id)}`.toLowerCase().includes(search.toLowerCase()) : true,
  );

  return (
    <>
      <PageHeader
        title="Audit logs"
        description="Immutable record of platform and organization events. Secrets are never written to audit metadata."
        action={
          <Input
            className="w-64"
            placeholder="Filter by event or organization"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        }
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Actor role</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{titleCase(l.event_type)}</TableCell>
                  <TableCell>{tenantName(l.tenant_id)}</TableCell>
                  <TableCell>{l.actor_role ? titleCase(l.actor_role) : "System"}</TableCell>
                  <TableCell className="text-muted-foreground">{l.entity_type ?? "—"}</TableCell>
                  <TableCell className="max-w-xs truncate font-mono text-xs text-muted-foreground">
                    {JSON.stringify(l.metadata ?? {})}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(l.created_at)}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No audit events recorded yet.
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
