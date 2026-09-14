import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { useIdentity } from "@/lib/identity";
import { createAccount, listAccounts, listCustomers, updateAccount } from "@/lib/services/organization";
import { getTenant } from "@/lib/services/platform";

export const Route = createFileRoute("/_authenticated/org/accounts")({
  component: Accounts,
});

function Accounts() {
  const { data: identity } = useIdentity();
  const tenantId = identity?.tenantId ?? "";
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [creditLimit, setCreditLimit] = useState("0");

  const tenant = useQuery({ queryKey: ["tenant", tenantId], queryFn: () => getTenant(tenantId), enabled: !!tenantId });
  const accounts = useQuery({ queryKey: ["accounts", tenantId], queryFn: () => listAccounts(tenantId), enabled: !!tenantId });
  const customers = useQuery({ queryKey: ["customers", tenantId], queryFn: () => listCustomers(tenantId), enabled: !!tenantId });

  const currency = tenant.data?.currency_code ?? "USD";

  const create = useMutation({
    mutationFn: () =>
      createAccount({
        tenant_id: tenantId,
        customer_id: customerId,
        currency_code: currency,
        credit_limit: Number(creditLimit || 0),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts", tenantId] });
      setOpen(false);
      setCustomerId("");
      setCreditLimit("0");
      toast.success("Account opened with a generated account number.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: (input: { id: string; status: string }) => updateAccount(input.id, { status: input.status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts", tenantId] });
      toast.success("Account updated.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="Accounts"
        description={`Credit accounts in ${currency}. Account numbers are unique within your organization.`}
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">Open account</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Open a credit account</DialogTitle>
                <DialogDescription>
                  The account number is generated automatically. Balances can only move through the credit engine.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Customer</Label>
                  <Select value={customerId} onValueChange={setCustomerId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select customer" />
                    </SelectTrigger>
                    <SelectContent>
                      {(customers.data ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.full_name} · {c.phone}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Credit limit ({currency})</Label>
                  <Input
                    type="number"
                    min="0"
                    value={creditLimit}
                    onChange={(e) => setCreditLimit(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button disabled={!customerId || create.isPending} onClick={() => create.mutate()}>
                  Open account
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account number</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Balance</TableHead>
                <TableHead>Credit limit</TableHead>
                <TableHead>Available</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(accounts.data ?? []).map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono font-medium">{a.account_number}</TableCell>
                  <TableCell>
                    <div>{a.customers?.full_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{a.customers?.phone ?? ""}</div>
                  </TableCell>
                  <TableCell>{formatMoney(a.balance, a.currency_code)}</TableCell>
                  <TableCell>{formatMoney(a.credit_limit, a.currency_code)}</TableCell>
                  <TableCell className="font-medium">
                    {formatMoney(Number(a.balance) + Number(a.credit_limit), a.currency_code)}
                  </TableCell>
                  <TableCell><StatusBadge status={a.status} /></TableCell>
                  <TableCell className="text-right">
                    {a.status === "ACTIVE" ? (
                      <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: a.id, status: "SUSPENDED" })}>
                        Suspend
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: a.id, status: "ACTIVE" })}>
                        Activate
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(accounts.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No accounts yet.
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
