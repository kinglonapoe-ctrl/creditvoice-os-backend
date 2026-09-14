import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import { assignPhoneNumber, issueAccessCode, setTenantStatus } from "@/lib/platform.functions";
import { getTenant, listPhoneNumbers } from "@/lib/services/platform";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/tenants/$tenantId")({
  component: TenantSetup,
});

function TenantSetup() {
  const { tenantId } = Route.useParams();
  const queryClient = useQueryClient();
  const [selectedNumber, setSelectedNumber] = useState("");
  const [issuedCode, setIssuedCode] = useState<string | null>(null);

  const tenant = useQuery({ queryKey: ["tenant", tenantId], queryFn: () => getTenant(tenantId) });
  const numbers = useQuery({ queryKey: ["phone-numbers"], queryFn: listPhoneNumbers });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["tenant", tenantId] });
    queryClient.invalidateQueries({ queryKey: ["phone-numbers"] });
    queryClient.invalidateQueries({ queryKey: ["tenants"] });
  };

  const assigned = (numbers.data ?? []).filter((n) => n.tenant_id === tenantId);
  const available = (numbers.data ?? []).filter((n) => n.status === "AVAILABLE" || n.status === "RESERVED");

  const assign = useMutation({
    mutationFn: () => assignPhoneNumber({ data: { phoneNumberId: selectedNumber, tenantId, isPrimary: true } }),
    onSuccess: () => {
      refresh();
      setSelectedNumber("");
      toast.success("Voice number assigned.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const issue = useMutation({
    mutationFn: () => issueAccessCode({ data: { tenantId } }),
    onSuccess: (result) => {
      refresh();
      setIssuedCode(result.code);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const status = useMutation({
    mutationFn: (next: "ACTIVE" | "SUSPENDED" | "CLOSED" | "CONFIGURATION") =>
      setTenantStatus({ data: { tenantId, status: next } }),
    onSuccess: () => {
      refresh();
      toast.success("Organization status updated.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const t = tenant.data;
  if (!t) return <p className="text-sm text-muted-foreground">Loading organization…</p>;

  const steps = [
    { title: "Tenant approved", done: true, detail: t.name },
    { title: "Currency", done: !!t.currency_approved, detail: t.currency_code ?? "Not set" },
    { title: "IVR number", done: assigned.length > 0, detail: assigned[0]?.phone_number ?? "Not assigned" },
    {
      title: "Organization access code",
      done: t.access_code_status === "ACTIVE",
      detail: t.access_code_status === "ACTIVE" ? "Issued" : "Not issued",
    },
    { title: "Activate tenant", done: t.status === "ACTIVE", detail: t.status },
  ];

  return (
    <>
      <PageHeader
        title={t.name}
        description={`${t.legal_name} · ${t.country}`}
        action={
          <div className="flex gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/tenants">Back to tenants</Link>
            </Button>
            {t.status === "ACTIVE" ? (
              <Button size="sm" variant="destructive" onClick={() => status.mutate("SUSPENDED")}>
                Suspend
              </Button>
            ) : t.status === "SUSPENDED" ? (
              <Button size="sm" onClick={() => status.mutate("ACTIVE")}>
                Reactivate
              </Button>
            ) : null}
          </div>
        }
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="font-display text-base">Guided activation</CardTitle>
          <CardDescription>Complete every step before the organization goes live.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {steps.map((step, index) => (
            <div key={step.title} className="flex items-center gap-3 rounded-md border border-border p-3">
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  step.done ? "bg-emerald-500/15 text-emerald-700" : "bg-secondary text-muted-foreground",
                )}
              >
                {step.done ? <Check className="h-4 w-4" /> : index + 1}
              </span>
              <div className="flex-1">
                <p className="text-sm font-medium">{step.title}</p>
                <p className="text-xs text-muted-foreground">{step.detail}</p>
              </div>
              {step.done ? <StatusBadge status="APPROVED" /> : <StatusBadge status="PENDING" />}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Voice number</CardTitle>
            <CardDescription>One primary inbound number in Phase 1.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {assigned.length ? (
              assigned.map((n) => (
                <div key={n.id} className="rounded-md border border-border p-3 text-sm">
                  <p className="font-mono font-medium">{n.phone_number}</p>
                  <p className="text-xs text-muted-foreground">
                    {n.country} · {n.provider} · {n.is_primary ? "Primary" : "Secondary"}
                  </p>
                  <StatusBadge className="mt-2" status={n.status} />
                </div>
              ))
            ) : (
              <>
                <Select value={selectedNumber} onValueChange={setSelectedNumber}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an available number" />
                  </SelectTrigger>
                  <SelectContent>
                    {available.map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        {n.phone_number} · {n.country}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" disabled={!selectedNumber || assign.isPending} onClick={() => assign.mutate()}>
                  Assign number
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Organization access code</CardTitle>
            <CardDescription>Issued once, stored only as a secure hash.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <span className="text-muted-foreground">Status: </span>
              <StatusBadge status={t.access_code_status === "ACTIVE" ? "ACTIVE" : "PENDING"} />
            </p>
            <p className="text-muted-foreground">Last changed: {formatDate(t.access_code_last_changed_at)}</p>
            {t.access_code_status === "ACTIVE" ? (
              <p className="text-xs text-muted-foreground">
                The plaintext code cannot be retrieved. Only the organization administrator can change it.
              </p>
            ) : (
              <Button size="sm" disabled={issue.isPending} onClick={() => issue.mutate()}>
                Issue initial code
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Activation</CardTitle>
            <CardDescription>Currency, number and access code must be in place.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <span className="text-muted-foreground">Current status: </span>
              <StatusBadge status={t.status} />
            </p>
            <Button
              size="sm"
              disabled={t.status === "ACTIVE" || status.isPending}
              onClick={() => status.mutate("ACTIVE")}
            >
              Activate tenant
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!issuedCode} onOpenChange={(open) => !open && setIssuedCode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Secure issuance</DialogTitle>
            <DialogDescription>
              Hand this code to the authorized recipient now. It is stored only as a hash and can never be shown
              again.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md border border-border bg-secondary/50 p-6 text-center font-mono text-3xl tracking-[0.3em]">
            {issuedCode}
          </p>
          <DialogFooter>
            <Button onClick={() => setIssuedCode(null)}>I have recorded it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
