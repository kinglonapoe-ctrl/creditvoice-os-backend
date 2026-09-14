import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { titleCase } from "@/lib/format";
import { listCareSettings } from "@/lib/services/platform";

export const Route = createFileRoute("/_authenticated/admin/customer-care")({
  component: PlatformCustomerCare,
});

function PlatformCustomerCare() {
  const care = useQuery({ queryKey: ["platform-care"], queryFn: listCareSettings });

  return (
    <>
      <PageHeader
        title="Customer care"
        description="How each organization has configured its support line. Configuration only — no calls are handled in this phase."
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead>Primary line</TableHead>
                <TableHead>Routing</TableHead>
                <TableHead>Business hours</TableHead>
                <TableHead>After hours</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(care.data ?? []).map((c: any) => (
                <TableRow key={c.tenant_id}>
                  <TableCell className="font-medium">{c.tenants?.name ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={c.enabled ? "ACTIVE" : "CLOSED"} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{c.primary_number ?? "—"}</TableCell>
                  <TableCell>{titleCase(c.routing_mode)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.business_hours_start?.slice(0, 5)} – {c.business_hours_end?.slice(0, 5)} · {c.timezone}
                  </TableCell>
                  <TableCell>{titleCase(c.after_hours_mode)}</TableCell>
                </TableRow>
              ))}
              {(care.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No organizations have configured customer care yet.
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
