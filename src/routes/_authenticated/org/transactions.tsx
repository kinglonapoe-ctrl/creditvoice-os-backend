import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { PageHeader } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney, titleCase } from "@/lib/format";
import { useIdentity } from "@/lib/identity";
import { listTransactions } from "@/lib/services/organization";

export const Route = createFileRoute("/_authenticated/org/transactions")({
  component: OrgTransactions,
});

function OrgTransactions() {
  const { data: identity } = useIdentity();
  const tenantId = identity?.tenantId ?? "";
  const [search, setSearch] = useState("");

  const transactions = useQuery({
    queryKey: ["org-transactions", tenantId],
    queryFn: () => listTransactions(tenantId),
    enabled: !!tenantId,
  });

  const rows = (transactions.data ?? []).filter((t: any) =>
    search
      ? `${t.reference} ${t.type} ${t.account?.account_number ?? ""}`.toLowerCase().includes(search.toLowerCase())
      : true,
  );

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Full posting history. Entries are immutable once written."
        action={
          <Input
            className="w-64"
            placeholder="Search reference, type, account"
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
                <TableHead>Reference</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Counterparty</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Posted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">{t.reference}</TableCell>
                  <TableCell>{titleCase(t.type)}</TableCell>
                  <TableCell className="font-mono text-xs">{t.account?.account_number ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{t.counterparty?.account_number ?? "—"}</TableCell>
                  <TableCell className="font-medium">{formatMoney(t.amount, t.currency_code)}</TableCell>
                  <TableCell><StatusBadge status={t.status} /></TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(t.created_at)}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No transactions yet.
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
