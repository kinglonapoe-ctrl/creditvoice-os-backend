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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDay } from "@/lib/format";
import { useIdentity } from "@/lib/identity";
import { setCustomerPin } from "@/lib/organization.functions";
import { createCustomer, listCustomers, updateCustomer } from "@/lib/services/organization";

export const Route = createFileRoute("/_authenticated/org/customers")({
  component: Customers,
});

const EMPTY = { full_name: "", phone: "", email: "", customer_reference: "" };

function Customers() {
  const { data: identity } = useIdentity();
  const tenantId = identity?.tenantId ?? "";
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pinTarget, setPinTarget] = useState<string | null>(null);
  const [pin, setPin] = useState("");

  const customers = useQuery({
    queryKey: ["customers", tenantId],
    queryFn: () => listCustomers(tenantId),
    enabled: !!tenantId,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["customers", tenantId] });

  const create = useMutation({
    mutationFn: () =>
      createCustomer({
        tenant_id: tenantId,
        full_name: form.full_name,
        phone: form.phone,
        email: form.email || null,
        customer_reference: form.customer_reference || null,
      }),
    onSuccess: () => {
      refresh();
      setForm(EMPTY);
      setOpen(false);
      toast.success("Customer created.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: (input: { id: string; status: string }) => updateCustomer(input.id, { status: input.status }),
    onSuccess: () => {
      refresh();
      toast.success("Customer updated.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const savePin = useMutation({
    mutationFn: () => setCustomerPin({ data: { customerId: pinTarget!, pin } }),
    onSuccess: () => {
      setPinTarget(null);
      setPin("");
      toast.success("PIN set. It is stored as a hash and cannot be viewed again.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (customers.data ?? []).filter((c) =>
    search ? `${c.full_name} ${c.phone} ${c.customer_reference ?? ""}`.toLowerCase().includes(search.toLowerCase()) : true,
  );

  return (
    <>
      <PageHeader
        title="Customers"
        description="People who hold credit accounts with your organization."
        action={
          <div className="flex gap-2">
            <Input
              className="w-56"
              placeholder="Search name, phone, reference"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm">New customer</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New customer</DialogTitle>
                  <DialogDescription>The customer starts as pending until you activate them.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Full name</Label>
                    <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Customer reference</Label>
                    <Input
                      value={form.customer_reference}
                      onChange={(e) => setForm({ ...form, customer_reference: e.target.value })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button disabled={!form.full_name || !form.phone || create.isPending} onClick={() => create.mutate()}>
                    Create customer
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="font-medium">{c.full_name}</div>
                    <div className="text-xs text-muted-foreground">{c.email ?? "—"}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{c.phone}</TableCell>
                  <TableCell>{c.customer_reference ?? "—"}</TableCell>
                  <TableCell><StatusBadge status={c.status} /></TableCell>
                  <TableCell className="text-muted-foreground">{formatDay(c.created_at)}</TableCell>
                  <TableCell className="space-x-2 text-right">
                    {c.status === "ACTIVE" ? (
                      <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: c.id, status: "SUSPENDED" })}>
                        Suspend
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: c.id, status: "ACTIVE" })}>
                        Activate
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setPinTarget(c.id)}>
                      Set PIN
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No customers yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!pinTarget} onOpenChange={(o) => !o && setPinTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set telephone PIN</DialogTitle>
            <DialogDescription>
              4 to 6 digits. The PIN is hashed immediately and can never be read back — only replaced.
            </DialogDescription>
          </DialogHeader>
          <Input inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" />
          <DialogFooter>
            <Button disabled={pin.length < 4 || savePin.isPending} onClick={() => savePin.mutate()}>
              Save PIN
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
