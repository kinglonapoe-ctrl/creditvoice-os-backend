import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useIdentity } from "@/lib/identity";
import { getCareSettings, saveCareSettings } from "@/lib/services/organization";

export const Route = createFileRoute("/_authenticated/org/customer-care")({
  component: CustomerCare,
});

const MODES = ["LIVE_AGENT", "SEQUENTIAL", "SIMULTANEOUS", "QUEUE", "VOICEMAIL"];

const DEFAULTS = {
  enabled: false,
  primary_number: "",
  backup_number: "",
  routing_mode: "LIVE_AGENT",
  business_hours_start: "09:00",
  business_hours_end: "17:00",
  timezone: "UTC",
  after_hours_mode: "VOICEMAIL",
  voicemail_enabled: true,
};

function CustomerCare() {
  const { data: identity } = useIdentity();
  const tenantId = identity?.tenantId ?? "";
  const queryClient = useQueryClient();
  const [form, setForm] = useState(DEFAULTS);

  const settings = useQuery({
    queryKey: ["care", tenantId],
    queryFn: () => getCareSettings(tenantId),
    enabled: !!tenantId,
  });

  useEffect(() => {
    if (settings.data) {
      setForm({
        enabled: settings.data.enabled,
        primary_number: settings.data.primary_number ?? "",
        backup_number: settings.data.backup_number ?? "",
        routing_mode: settings.data.routing_mode,
        business_hours_start: (settings.data.business_hours_start ?? "09:00").slice(0, 5),
        business_hours_end: (settings.data.business_hours_end ?? "17:00").slice(0, 5),
        timezone: settings.data.timezone,
        after_hours_mode: settings.data.after_hours_mode,
        voicemail_enabled: settings.data.voicemail_enabled,
      });
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      saveCareSettings(tenantId, {
        ...form,
        primary_number: form.primary_number || null,
        backup_number: form.backup_number || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["care", tenantId] });
      toast.success("Customer care configuration saved.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="Customer care"
        description="Configure how support calls should be routed. Nothing is dialled in this phase."
      />

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="font-display text-base">Support line configuration</CardTitle>
          <CardDescription>Applied once telephony is connected.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium">Customer care enabled</p>
              <p className="text-xs text-muted-foreground">Offer callers the option to reach a human.</p>
            </div>
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Primary number</Label>
              <Input value={form.primary_number} onChange={(e) => setForm({ ...form, primary_number: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Backup number</Label>
              <Input value={form.backup_number} onChange={(e) => setForm({ ...form, backup_number: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Routing mode</Label>
              <Select value={form.routing_mode} onValueChange={(v) => setForm({ ...form, routing_mode: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODES.map((m) => (
                    <SelectItem key={m} value={m}>{m.replace("_", " ").toLowerCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>After-hours mode</Label>
              <Select value={form.after_hours_mode} onValueChange={(v) => setForm({ ...form, after_hours_mode: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODES.map((m) => (
                    <SelectItem key={m} value={m}>{m.replace("_", " ").toLowerCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Business hours start</Label>
              <Input
                type="time"
                value={form.business_hours_start}
                onChange={(e) => setForm({ ...form, business_hours_start: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Business hours end</Label>
              <Input
                type="time"
                value={form.business_hours_end}
                onChange={(e) => setForm({ ...form, business_hours_end: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
            </div>
            <div className="flex items-end justify-between rounded-md border border-border p-3">
              <p className="text-sm font-medium">Voicemail</p>
              <Switch
                checked={form.voicemail_enabled}
                onCheckedChange={(v) => setForm({ ...form, voicemail_enabled: v })}
              />
            </div>
          </div>

          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Save configuration
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
