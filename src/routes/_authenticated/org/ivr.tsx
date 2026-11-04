import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useIdentity } from "@/lib/identity";
import { IVR_VOICES, findVoice } from "@/lib/voice/voices";
import { authenticatedGreetingScript } from "@/lib/voice/test-call-script";
import { placeIvrTestCall } from "@/lib/ivr-test-call.functions";
import { getIvrSettings, getTenantNumbers, saveIvrSettings } from "@/lib/services/organization";

export const Route = createFileRoute("/_authenticated/org/ivr")({
  component: IvrSettings,
});

function TestCallCard({ voice }: { voice: string }) {
  const [name, setName] = useState("William Smith");
  const [phone, setPhone] = useState("");
  const script = authenticatedGreetingScript(name);
  const call = useMutation({
    mutationFn: () => placeIvrTestCall({ data: { toPhone: phone, name } }),
    onSuccess: () => toast.success("Calling you now. Answer to hear the greeting."),
    onError: (e: Error) => toast.error(e.message),
  });
  const listen = () => {
    if (!("speechSynthesis" in window)) return toast.error("Your browser can't play speech.");
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(script);
    u.lang = findVoice(voice)?.language ?? "en-US";
    window.speechSynthesis.speak(u);
  };
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="font-display text-base">Test greeting and menu</CardTitle>
        <CardDescription>Hear what customers hear after entering a correct PIN. Uses your saved voice.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="test-name">Customer name</Label>
            <Input id="test-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="test-phone">Your phone</Label>
            <Input id="test-phone" placeholder="+15551234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <p className="rounded-md border border-border bg-muted p-3 text-sm">{script}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={listen}>Listen in browser</Button>
          <Button disabled={!phone || call.isPending} onClick={() => call.mutate()}>
            {call.isPending ? "Calling…" : "Call my phone"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Browser preview uses your computer's voice. The phone call uses the real IVR voice and only speaks the greeting; no account is accessed.
        </p>
      </CardContent>
    </Card>
  );
}

const DEFAULTS = {
  welcome_message: "Welcome. Please enter your organization access code.",
  language: "en",
  voice: "Polly.Joanna-Neural",
  max_pin_attempts: 3,
  session_timeout_seconds: 120,
  transfers_enabled: true,
  balance_enquiry_enabled: true,
};

function IvrSettings() {
  const { data: identity } = useIdentity();
  const tenantId = identity?.tenantId ?? "";
  const queryClient = useQueryClient();
  const [form, setForm] = useState(DEFAULTS);

  const settings = useQuery({ queryKey: ["ivr", tenantId], queryFn: () => getIvrSettings(tenantId), enabled: !!tenantId });
  const numbers = useQuery({ queryKey: ["org-numbers", tenantId], queryFn: () => getTenantNumbers(tenantId), enabled: !!tenantId });

  useEffect(() => {
    if (settings.data) {
      setForm({
        welcome_message: settings.data.welcome_message,
        language: settings.data.language,
        voice: (settings.data as { voice?: string }).voice || "alice",
        max_pin_attempts: settings.data.max_pin_attempts,
        session_timeout_seconds: settings.data.session_timeout_seconds,
        transfers_enabled: settings.data.transfers_enabled,
        balance_enquiry_enabled: settings.data.balance_enquiry_enabled,
      });
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => saveIvrSettings(tenantId, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ivr", tenantId] });
      toast.success("IVR settings saved.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="IVR settings"
        description="The rules your telephone service will follow once a carrier is connected."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-base">Call flow configuration</CardTitle>
            <CardDescription>Access code, then account number, then PIN.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>Welcome message</Label>
              <Textarea
                rows={3}
                value={form.welcome_message}
                onChange={(e) => setForm({ ...form, welcome_message: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ivr-voice">Voice</Label>
              <select
                id="ivr-voice"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.voice}
                onChange={(e) => setForm({ ...form, voice: e.target.value })}
              >
                {IVR_VOICES.map((v) => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">The voice callers hear on your phone line.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Language</Label>
                <Input value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Max PIN attempts</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.max_pin_attempts}
                  onChange={(e) => setForm({ ...form, max_pin_attempts: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>Session timeout (s)</Label>
                <Input
                  type="number"
                  min="30"
                  value={form.session_timeout_seconds}
                  onChange={(e) => setForm({ ...form, session_timeout_seconds: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Transfers by phone</p>
                  <p className="text-xs text-muted-foreground">Allow customers to send credit.</p>
                </div>
                <Switch
                  checked={form.transfers_enabled}
                  onCheckedChange={(v) => setForm({ ...form, transfers_enabled: v })}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Balance enquiry</p>
                  <p className="text-xs text-muted-foreground">Read the available credit aloud.</p>
                </div>
                <Switch
                  checked={form.balance_enquiry_enabled}
                  onCheckedChange={(v) => setForm({ ...form, balance_enquiry_enabled: v })}
                />
              </div>
            </div>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              Save IVR settings
            </Button>
          </CardContent>
        </Card>

        <TestCallCard voice={form.voice} />

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Your inbound number</CardTitle>
            <CardDescription>Assigned by the platform team.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {(numbers.data ?? []).length ? (
              (numbers.data ?? []).map((n) => (
                <div key={n.id} className="rounded-md border border-border p-3">
                  <p className="font-mono font-medium">{n.phone_number}</p>
                  <p className="text-xs text-muted-foreground">{n.country} · {n.provider}</p>
                  <StatusBadge className="mt-2" status={n.status} />
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">No number assigned yet.</p>
            )}
            <p className="text-xs text-muted-foreground">
              Call handling is not live. These settings are stored and applied when telephony is connected.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
