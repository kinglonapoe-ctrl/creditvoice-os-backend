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
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDay } from "@/lib/format";
import { useIdentity } from "@/lib/identity";
import { setCustomerPin } from "@/lib/organization.functions";
import { createCustomer, deleteCustomer, listCustomers, updateCustomer } from "@/lib/services/organization";

export const Route = createFileRoute("/_authenticated/org/customers")({
  head: () => ({ meta: [
    { title: "Customers | CreditVoice OS" },
    { name: "description", content: "Manage your organization's customers, contact details and personalized phone messages." },
    { property: "og:title", content: "Customers | CreditVoice OS" },
    { property: "og:description", content: "Manage your organization's customer records and personalized phone messages." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: Customers,
});

const EMPTY = { full_name: "", phone: "", email: "", customer_reference: "", transfer_info: "", welcome_message: "" };

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
    mutationFn: () => {
      if (!pinTarget) throw new Error("Select a customer.");
      return setCustomerPin({ data: { customerId: pinTarget, pin } });
    },
    onSuccess: () => {
      setPinTarget(null);
      setPin("");
      toast.success("PIN set. It is stored as a hash and cannot be viewed again.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(EMPTY);
  const saveEdit = useMutation({
    mutationFn: () => {
      if (!editId) throw new Error("Select a customer.");
      return updateCustomer(editId, {
        full_name: editForm.full_name.trim(),
        phone: editForm.phone.trim(),
        email: editForm.email.trim() || null,
        customer_reference: editForm.customer_reference.trim() || null,
        transfer_info: editForm.transfer_info.trim() || null,
        welcome_message: editForm.welcome_message.trim() || null,
      });
    },
    onSuccess: () => {
      refresh();
      setEditId(null);
      toast.success("Customer details saved.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (v: { id: string; reason: string }) => deleteCustomer(v.id, v.reason),
    onSuccess: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ["accounts", tenantId] });
      toast.success("Customer deleted.");
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

      <Dialog open={!!editId} onOpenChange={(o) => !o && setEditId(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit customer</DialogTitle>
            <DialogDescription>Fix the name or contact details. The name is spoken in the phone greeting.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Full name</Label>
              <Input value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Customer reference</Label>
              <Input
                value={editForm.customer_reference}
                onChange={(e) => setEditForm({ ...editForm, customer_reference: e.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="customer-welcome">Personal welcome message</Label>
              <Textarea
                id="customer-welcome"
                maxLength={300}
                rows={3}
                placeholder="Welcome, William. Thank you for being a valued member."
                value={editForm.welcome_message}
                onChange={(e) => setEditForm({ ...editForm, welcome_message: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">{editForm.welcome_message.length}/300</p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Transfer info (spoken before transfers)</Label>
              <Textarea
                maxLength={300}
                rows={3}
                placeholder="e.g. Transfers above 500 dollars need approval from the office."
                value={editForm.transfer_info}
                onChange={(e) => setEditForm({ ...editForm, transfer_info: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {editForm.transfer_info.length}/300. Read to this customer when they press 3; they must press 1 to continue. Leave empty to skip.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!editForm.full_name.trim() || !editForm.phone.trim() || saveEdit.isPending}
              onClick={() => saveEdit.mutate()}
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                    <div className="font-medium">
                      {c.full_name}
                      {(c as { transfer_info?: string | null }).transfer_info ? (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Transfer info</span>
                      ) : null}
                    </div>
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
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditForm({
                          full_name: c.full_name ?? "",
                          phone: c.phone ?? "",
                          email: c.email ?? "",
                          customer_reference: c.customer_reference ?? "",
                          transfer_info: (c as { transfer_info?: string | null }).transfer_info ?? "",
                          welcome_message: c.welcome_message ?? "",
                        });
                        setEditId(c.id);
                      }}
                    >
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPinTarget(c.id)}>
                      Set PIN
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={remove.isPending}
                      onClick={() => {
                        const reason = window.prompt(
                          `Delete ${c.full_name} and their unused accounts? This cannot be undone.\nCustomers with any transactions or calls cannot be deleted.\n\nReason:`,
                        );
                        if (reason && reason.trim().length >= 3) remove.mutate({ id: c.id, reason: reason.trim() });
                        else if (reason !== null) toast.error("Please give a reason (at least 3 characters).");
                      }}
                    >
                      Delete
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
