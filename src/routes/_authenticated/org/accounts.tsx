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
import { accountNumberMatches, LEGACY_RULES } from "@/lib/account-numbering";
import { closeAccount, createAccount, deleteAccount, getNumberingSettings, listAccounts, listCustomers, updateAccount } from "@/lib/services/organization";
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
  const [accountNumber, setAccountNumber] = useState("");

  const tenant = useQuery({ queryKey: ["tenant", tenantId], queryFn: () => getTenant(tenantId), enabled: !!tenantId });
  const accounts = useQuery({ queryKey: ["accounts", tenantId], queryFn: () => listAccounts(tenantId), enabled: !!tenantId });
  const customers = useQuery({ queryKey: ["customers", tenantId], queryFn: () => listCustomers(tenantId), enabled: !!tenantId });

  const numbering = useQuery({ queryKey: ["numbering", tenantId], queryFn: () => getNumberingSettings(tenantId), enabled: !!tenantId });

  const currency = tenant.data?.currency_code ?? "USD";
  const rules = numbering.data ?? LEGACY_RULES;
  const manual = rules.mode === "MANUAL";
  const trimmed = accountNumber.trim();
  const numberError =
    trimmed === ""
      ? manual
        ? "An account number is required."
        : null
      : accountNumberMatches(trimmed, rules)
        ? null
        : rules.min_length === rules.max_length
          ? `Use exactly ${rules.min_length} digits.`
          : `Use ${rules.min_length} to ${rules.max_length} digits.`;

  const close = useMutation({
    mutationFn: (v: { id: string; reason: string }) => closeAccount(v.id, v.reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts", tenantId] });
      toast.success("Account closed.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (v: { id: string; reason: string }) => deleteAccount(v.id, v.reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts", tenantId] });
      toast.success("Account deleted.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const create = useMutation({
    mutationFn: () =>
      createAccount({
        tenant_id: tenantId,
        customer_id: customerId,
        currency_code: currency,
        credit_limit: Number(creditLimit || 0),
        account_number: trimmed || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts", tenantId] });
      setOpen(false);
      setCustomerId("");
      setCreditLimit("0");
      setAccountNumber("");
      toast.success(trimmed ? "Account opened." : "Account opened with a generated account number.");
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
                  {manual
                    ? "Enter the account number your organization assigns."
                    : "Enter a number, or leave it blank to generate one."}{" "}
                  Balances can only move through the credit engine.
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
                  <Label htmlFor="account-number">Account number{manual ? "" : " (optional)"}</Label>
                  <Input
                    id="account-number"
                    inputMode="numeric"
                    autoComplete="off"
                    className="font-mono"
                    value={accountNumber}
                    maxLength={rules.max_length}
                    placeholder={manual ? `${rules.min_length}–${rules.max_length} digits` : "Generated if blank"}
                    onChange={(e) => setAccountNumber(e.target.value)}
                  />
                  {accountNumber && numberError ? (
                    <p className="text-xs text-destructive">{numberError}</p>
                  ) : null}
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
                <Button disabled={!customerId || !!numberError || create.isPending} onClick={() => create.mutate()}>
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
                    {a.status === "CLOSED" ? (
                      <span className="text-xs text-muted-foreground">Closed</span>
                    ) : (
                      <>
                        {a.status === "ACTIVE" ? (
                          <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: a.id, status: "SUSPENDED" })}>
                            Suspend
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: a.id, status: "ACTIVE" })}>
                            Activate
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-2"
                          disabled={close.isPending}
                          onClick={() => {
                            const reason = window.prompt(
                              `Close account ${a.account_number}? It will no longer be usable by phone or for transfers, and it cannot be reopened. Its history is kept.\n\nReason:`,
                            );
                            if (reason && reason.trim().length >= 3) close.mutate({ id: a.id, reason: reason.trim() });
                            else if (reason !== null) toast.error("Please give a reason (at least 3 characters).");
                          }}
                        >
                          Close
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-2 text-destructive"
                          disabled={remove.isPending}
                          onClick={() => {
                            const reason = window.prompt(
                              `Delete account ${a.account_number}? This cannot be undone.\nAccounts with any balance, transactions or calls cannot be deleted.\n\nReason:`,
                            );
                            if (reason && reason.trim().length >= 3) remove.mutate({ id: a.id, reason: reason.trim() });
                            else if (reason !== null) toast.error("Please give a reason (at least 3 characters).");
                          }}
                        >
                          Delete
                        </Button>
                      </>
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
