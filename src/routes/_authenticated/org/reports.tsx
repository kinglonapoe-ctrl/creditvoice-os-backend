import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/components/app-shell";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, titleCase } from "@/lib/format";
import { useIdentity } from "@/lib/identity";
import { listAccounts, listTransactions, listTransfers } from "@/lib/services/organization";
import { getTenant } from "@/lib/services/platform";

export const Route = createFileRoute("/_authenticated/org/reports")({
  component: Reports,
});

function Reports() {
  const { data: identity } = useIdentity();
  const tenantId = identity?.tenantId ?? "";

  const tenant = useQuery({ queryKey: ["tenant", tenantId], queryFn: () => getTenant(tenantId), enabled: !!tenantId });
  const accounts = useQuery({ queryKey: ["accounts", tenantId], queryFn: () => listAccounts(tenantId), enabled: !!tenantId });
  const transactions = useQuery({ queryKey: ["org-transactions", tenantId], queryFn: () => listTransactions(tenantId), enabled: !!tenantId });
  const transfers = useQuery({ queryKey: ["transfers", tenantId], queryFn: () => listTransfers(tenantId), enabled: !!tenantId });

  const currency = tenant.data?.currency_code ?? "USD";
  const rows = accounts.data ?? [];
  const tx = transactions.data ?? [];

  const byType = tx.reduce<Record<string, { count: number; total: number }>>((acc, t: any) => {
    const entry = acc[t.type] ?? { count: 0, total: 0 };
    entry.count += 1;
    entry.total += Number(t.amount ?? 0);
    acc[t.type] = entry;
    return acc;
  }, {});

  const completedTransfers = (transfers.data ?? []).filter((t: any) => t.status === "COMPLETED");
  const reversedTransfers = (transfers.data ?? []).filter((t: any) => t.status === "REVERSED");

  return (
    <>
      <PageHeader title="Reports" description="A summary of credit exposure and posting activity." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Accounts" value={rows.length} />
        <StatCard
          label="Credit outstanding"
          value={formatMoney(rows.reduce((s: number, a: any) => s + Number(a.balance ?? 0), 0), currency)}
        />
        <StatCard label="Completed transfers" value={completedTransfers.length} />
        <StatCard label="Reversed transfers" value={reversedTransfers.length} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Activity by transaction type</CardTitle>
            <CardDescription>Across the most recent postings.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Count</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(byType).map(([type, v]) => (
                  <TableRow key={type}>
                    <TableCell>{titleCase(type)}</TableCell>
                    <TableCell>{v.count}</TableCell>
                    <TableCell className="text-right font-medium">{formatMoney(v.total, currency)}</TableCell>
                  </TableRow>
                ))}
                {Object.keys(byType).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                      No postings to report on yet.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Largest exposures</CardTitle>
            <CardDescription>Accounts holding the most credit.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...rows]
                  .sort((a: any, b: any) => Number(b.balance) - Number(a.balance))
                  .slice(0, 8)
                  .map((a: any) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono text-xs">{a.account_number}</TableCell>
                      <TableCell>{a.customers?.full_name ?? "—"}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatMoney(a.balance, a.currency_code)}
                      </TableCell>
                    </TableRow>
                  ))}
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                      No accounts yet.
                    </TableCell>
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
