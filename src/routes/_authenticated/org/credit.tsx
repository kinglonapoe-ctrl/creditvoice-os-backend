import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/format";
import { useIdentity } from "@/lib/identity";
import { listAccounts, postCredit } from "@/lib/services/organization";
import { getTenant } from "@/lib/services/platform";

export const Route = createFileRoute("/_authenticated/org/credit")({
  component: Credit,
});

const TYPES = [
  { value: "INITIAL_CREDIT", label: "Initial credit" },
  { value: "CREDIT_ADJUSTMENT", label: "Credit adjustment" },
  { value: "CREDIT_DEBIT", label: "Credit debit" },
  { value: "CREDIT_REPAYMENT", label: "Credit repayment" },
] as const;

function Credit() {
  const { data: identity } = useIdentity();
  const tenantId = identity?.tenantId ?? "";
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("INITIAL_CREDIT");
  const [description, setDescription] = useState("");

  const tenant = useQuery({ queryKey: ["tenant", tenantId], queryFn: () => getTenant(tenantId), enabled: !!tenantId });
  const accounts = useQuery({ queryKey: ["accounts", tenantId], queryFn: () => listAccounts(tenantId), enabled: !!tenantId });
  const currency = tenant.data?.currency_code ?? "USD";

  const post = useMutation({
    mutationFn: () => postCredit({ accountId, amount: Number(amount), type, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["org-transactions", tenantId] });
      setAmount("");
      setDescription("");
      toast.success("Posting recorded in the ledger.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="Credit"
        description="Every movement is posted as an immutable double-entry. Balances are never edited directly."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="font-display text-base">Post credit movement</CardTitle>
            <CardDescription>Debits and credits both require a positive amount.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {(accounts.data ?? []).map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.account_number} · {a.customers?.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount ({currency})</Label>
              <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <Button
              className="w-full"
              disabled={!accountId || !Number(amount) || post.isPending}
              onClick={() => post.mutate()}
            >
              Post to ledger
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-base">Account positions</CardTitle>
            <CardDescription>Balance, limit, available and used credit.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>Limit</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>Used</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(accounts.data ?? []).map((a: any) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="font-mono font-medium">{a.account_number}</div>
                      <div className="text-xs text-muted-foreground">{a.customers?.full_name}</div>
                    </TableCell>
                    <TableCell>{formatMoney(a.balance, a.currency_code)}</TableCell>
                    <TableCell>{formatMoney(a.credit_limit, a.currency_code)}</TableCell>
                    <TableCell className="font-medium">
                      {formatMoney(Number(a.balance) + Number(a.credit_limit), a.currency_code)}
                    </TableCell>
                    <TableCell>
                      {formatMoney(Math.max(0, Number(a.credit_limit) - Number(a.balance)), a.currency_code)}
                    </TableCell>
                  </TableRow>
                ))}
                {(accounts.data ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      Open an account first.
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
