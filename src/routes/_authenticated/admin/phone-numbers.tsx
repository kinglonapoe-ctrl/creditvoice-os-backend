import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { addPhoneNumber, assignPhoneNumber, releasePhoneNumber } from "@/lib/platform.functions";
import { listPhoneNumbers, listTenants } from "@/lib/services/platform";

export const Route = createFileRoute("/_authenticated/admin/phone-numbers")({
  component: PhoneNumbers,
});

const EMPTY = { country: "", countryCallingCode: "", phoneNumber: "", provider: "TWILIO", voice: true, sms: false };

function PhoneNumbers() {
  const queryClient = useQueryClient();
  const numbers = useQuery({ queryKey: ["phone-numbers"], queryFn: listPhoneNumbers });
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: listTenants });
  const [form, setForm] = useState(EMPTY);
  const [addOpen, setAddOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<string | null>(null);
  const [assignTenant, setAssignTenant] = useState("");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["phone-numbers"] });

  const add = useMutation({
    mutationFn: () => addPhoneNumber({ data: form }),
    onSuccess: () => {
      refresh();
      setForm(EMPTY);
      setAddOpen(false);
      toast.success("Number added to inventory.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assign = useMutation({
    mutationFn: () => assignPhoneNumber({ data: { phoneNumberId: assignTarget!, tenantId: assignTenant } }),
    onSuccess: () => {
      refresh();
      setAssignTarget(null);
      setAssignTenant("");
      toast.success("Number assigned.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const release = useMutation({
    mutationFn: (id: string) => releasePhoneNumber({ data: { phoneNumberId: id } }),
    onSuccess: () => {
      refresh();
      toast.success("Number released back to inventory.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="Phone number inventory"
        description="Voice numbers available to organizations. No carrier provisioning happens in Phase 1."
        action={
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm">Add number</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add number to inventory</DialogTitle>
                <DialogDescription>Record a number your carrier has allocated to the platform.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Country" value={form.country} onChange={(v) => setForm({ ...form, country: v })} />
                <Field
                  label="Calling code"
                  value={form.countryCallingCode}
                  onChange={(v) => setForm({ ...form, countryCallingCode: v })}
                />
                <div className="sm:col-span-2">
                  <Field
                    label="Phone number (E.164)"
                    value={form.phoneNumber}
                    onChange={(v) => setForm({ ...form, phoneNumber: v })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TWILIO">Twilio</SelectItem>
                      <SelectItem value="SIP">SIP trunk</SelectItem>
                      <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end gap-6 pb-1">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.voice} onCheckedChange={(v) => setForm({ ...form, voice: !!v })} /> Voice
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.sms} onCheckedChange={(v) => setForm({ ...form, sms: !!v })} /> SMS
                  </label>
                </div>
              </div>
              <DialogFooter>
                <Button disabled={!form.phoneNumber || add.isPending} onClick={() => add.mutate()}>
                  Add number
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
                <TableHead>Number</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Capabilities</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(numbers.data ?? []).map((n: any) => (
                <TableRow key={n.id}>
                  <TableCell className="font-mono font-medium">{n.phone_number}</TableCell>
                  <TableCell>{n.country}</TableCell>
                  <TableCell>{n.provider}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {[n.voice_capable ? "VOICE" : null, n.sms_capable ? "SMS" : null].filter(Boolean).join(" / ") || "—"}
                  </TableCell>
                  <TableCell><StatusBadge status={n.status} /></TableCell>
                  <TableCell>{n.tenants?.name ?? "—"}</TableCell>
                  <TableCell className="space-x-2 text-right">
                    {n.tenant_id ? (
                      <Button size="sm" variant="outline" onClick={() => release.mutate(n.id)}>
                        Release
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setAssignTarget(n.id)}>
                        Assign
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(numbers.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Inventory is empty. Add the numbers your carrier has allocated.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!assignTarget} onOpenChange={(open) => !open && setAssignTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign number</DialogTitle>
            <DialogDescription>Attach this number to an organization as its primary voice line.</DialogDescription>
          </DialogHeader>
          <Select value={assignTenant} onValueChange={setAssignTenant}>
            <SelectTrigger>
              <SelectValue placeholder="Select organization" />
            </SelectTrigger>
            <SelectContent>
              {(tenants.data ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button disabled={!assignTenant || assign.isPending} onClick={() => assign.mutate()}>
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
