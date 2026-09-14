import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatMoney } from "@/lib/format";
import { useIdentity } from "@/lib/identity";
import { executeTransfer, listAccounts, listTransfers, reverseTransfer } from "@/lib/services/organization";
import { getTenant } from "@/lib/services/platform";

export const Route = createFileRoute("/_authenticated/org/transfers")({
  component: Transfers,
});

function Transfers() {
  const { data: identity } = useIdentity();
  const tenantId = identity?.tenantId ?? "";
  const queryClient = useQueryClient();
  const [sender, setSender] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  const tenant = useQuery({ queryKey: ["tenant", tenantId], queryFn: () => getTenant(tenantId), enabled: !!tenantId });
  const accounts = useQuery({ queryKey: ["accounts", tenantId], queryFn: () => listAccounts(tenantId), enabled: !!tenantId });
  const transfers = useQuery({ queryKey: ["transfers", tenantId], queryFn: () => listTransfers(tenantId), enabled: !!tenantId });
  const currency = tenant.data?.currency_code ?? "USD";

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["transfers", tenantId] });
    queryClient.invalidateQueries({ queryKey: ["accounts", tenantId] });
  };

  const send = useMutation({
    mutationFn: () =>
      executeTransfer({
        senderAccountId: sender,
        recipientAccountId: recipient,
        amount: Number(amount),
        description,
      }),
    onSuccess: () => {
      refresh();
      setAmount("");
      setDescription("");
      toast.success("Transfer completed.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reverse = useMutation({
    mutationFn: (id: string) => reverseTransfer(id, "Reversed by organization administrator"),
    onSuccess: () => {
      refresh();
      toast.success("Transfer reversed with a compensating posting.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="Transfers"
        description="Customer-to-customer credit transfers within your organization only."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">New transfer</CardTitle>
            <CardDescription>Both accounts must be active and in {currency}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <AccountSelect label="From" value={sender} onChange={setSender} accounts={accounts.data ?? []} />
            <AccountSelect label="To" value={recipient} onChange={setRecipient} accounts={accounts.data ?? []} />
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
              disabled={!sender || !recipient || sender === recipient || !Number(amount) || send.isPending}
              onClick={() => send.mutate()}
            >
              Send transfer
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-base">Transfer history</CardTitle>
            <CardDescription>Completed transfers can only be corrected by a reversal.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Initiated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(transfers.data ?? []).map((t: any) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.reference}</TableCell>
                    <TableCell className="font-mono text-xs">{t.sender?.account_number}</TableCell>
                    <TableCell className="font-mono text-xs">{t.recipient?.account_number}</TableCell>
                    <TableCell>{formatMoney(t.amount, t.currency_code)}</TableCell>
                    <TableCell><StatusBadge status={t.status} /></TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(t.initiated_at)}</TableCell>
                    <TableCell className="text-right">
                      {t.status === "COMPLETED" ? (
                        <Button size="sm" variant="outline" onClick={() => reverse.mutate(t.id)}>
                          Reverse
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
                {(transfers.data ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      No transfers yet.
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

function AccountSelect({
  label,
  value,
  onChange,
  accounts,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  accounts: any[];
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select account" />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.account_number} · {a.customers?.full_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
