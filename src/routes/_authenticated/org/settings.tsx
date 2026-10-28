import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDay } from "@/lib/format";
import { useIdentity } from "@/lib/identity";
import { validateRules } from "@/lib/account-numbering";
import { getNumberingSettings, getTenantNumbers, setNumberingSettings } from "@/lib/services/organization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getTenant } from "@/lib/services/platform";

export const Route = createFileRoute("/_authenticated/org/settings")({
  component: OrganizationSettings,
});

function OrganizationSettings() {
  const { data: identity } = useIdentity();
  const tenantId = identity?.tenantId ?? "";

  const tenant = useQuery({ queryKey: ["tenant", tenantId], queryFn: () => getTenant(tenantId), enabled: !!tenantId });
  const numbers = useQuery({ queryKey: ["org-numbers", tenantId], queryFn: () => getTenantNumbers(tenantId), enabled: !!tenantId });

  const t = tenant.data;

  return (
    <>
      <PageHeader title="Organization settings" description="Your organization's profile on the platform." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Profile</CardTitle>
            <CardDescription>Contact the platform team to amend registered details.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Trading name" value={t?.name} />
            <Row label="Legal name" value={t?.legal_name} />
            <Row label="Country" value={t?.country} />
            <Row label="Address" value={t?.address ?? "—"} />
            <Row label="Business type" value={t?.business_type ?? "—"} />
            <Row label="Onboarded" value={formatDay(t?.created_at)} />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <StatusBadge status={t?.status} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Operating configuration</CardTitle>
            <CardDescription>Currency is fixed once approved by the platform.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Currency" value={t?.currency_code ?? "Not set"} />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Currency approval</span>
              <StatusBadge status={t?.currency_approved ? "APPROVED" : "PENDING"} />
            </div>
            <Row
              label="Inbound number"
              value={(numbers.data ?? [])[0]?.phone_number ?? "Not assigned"}
            />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Access code</span>
              <StatusBadge status={t?.access_code_status === "ACTIVE" ? "ACTIVE" : "PENDING"} />
            </div>
            <p className="pt-2 text-xs text-muted-foreground">
              Currency, status and telephone assignment can only be changed by the platform team. Account numbers are
              unique inside your organization and may repeat in other organizations.
            </p>
          </CardContent>
        </Card>

        {tenantId ? <NumberingCard tenantId={tenantId} /> : null}
      </div>
    </>
  );
}

function NumberingCard({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["numbering", tenantId], queryFn: () => getNumberingSettings(tenantId) });
  const [draft, setDraft] = useState<{ mode: "MANUAL" | "AUTOMATIC"; min: string; max: string; pad: string } | null>(null);

  useEffect(() => {
    if (settings.data && !draft) {
      setDraft({
        mode: settings.data.mode as "MANUAL" | "AUTOMATIC",
        min: String(settings.data.min_length),
        max: String(settings.data.max_length),
        pad: settings.data.pad_length ? String(settings.data.pad_length) : "",
      });
    }
  }, [settings.data, draft]);

  const parsed = draft
    ? { mode: draft.mode, min_length: Number(draft.min), max_length: Number(draft.max), pad_length: draft.pad ? Number(draft.pad) : null }
    : null;
  const error = parsed ? validateRules(parsed) : null;

  const save = useMutation({
    mutationFn: () =>
      setNumberingSettings({
        tenantId,
        mode: parsed!.mode,
        minLength: parsed!.min_length,
        maxLength: parsed!.max_length,
        padLength: parsed!.pad_length,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["numbering", tenantId] });
      toast.success("Account numbering updated.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="font-display text-base">Account numbering</CardTitle>
        <CardDescription>
          How new account numbers are assigned. Existing numbers never change. Digits only; leading zeros are kept.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!draft ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-2">
              <Label>Assignment</Label>
              <Select value={draft.mode} onValueChange={(v) => setDraft({ ...draft, mode: v as "MANUAL" | "AUTOMATIC" })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MANUAL">Manual — staff enter each number</SelectItem>
                  <SelectItem value="AUTOMATIC">Automatic — generated if left blank</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="num-min">Minimum digits</Label>
              <Input id="num-min" inputMode="numeric" value={draft.min} onChange={(e) => setDraft({ ...draft, min: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="num-max">Maximum digits</Label>
              <Input id="num-max" inputMode="numeric" value={draft.max} onChange={(e) => setDraft({ ...draft, max: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="num-pad">Zero-pad generated to</Label>
              <Input
                id="num-pad"
                inputMode="numeric"
                placeholder="Off"
                value={draft.pad}
                onChange={(e) => setDraft({ ...draft, pad: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 sm:col-span-4">
              <p className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                {error ?? "Callers enter account numbers on the phone using these lengths."}
              </p>
              <Button size="sm" disabled={!!error || save.isPending} onClick={() => save.mutate()}>
                Save numbering
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


function Row({ label, value }: { label: string; value?: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value ?? "—"}</span>
    </div>
  );
}
