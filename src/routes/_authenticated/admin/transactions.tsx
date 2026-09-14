import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney, titleCase } from "@/lib/format";
import { listAllTransactions } from "@/lib/services/platform";

export const Route = createFileRoute("/_authenticated/admin/transactions")({
  component: PlatformTransactions,
});

function PlatformTransactions() {
  const transactions = useQuery({ queryKey: ["platform-transactions"], queryFn: listAllTransactions });

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Read-only platform view. Posted entries are immutable and can only be corrected by a reversal."
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Posted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(transactions.data ?? []).map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">{t.reference}</TableCell>
                  <TableCell>{t.tenants?.name ?? "—"}</TableCell>
                  <TableCell>{titleCase(t.type)}</TableCell>
                  <TableCell className="font-medium">{formatMoney(t.amount, t.currency_code)}</TableCell>
                  <TableCell><StatusBadge status={t.status} /></TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(t.created_at)}</TableCell>
                </TableRow>
              ))}
              {(transactions.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No transactions posted yet.
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
