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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, titleCase } from "@/lib/format";
import { useIdentity } from "@/lib/identity";
import { changeAccessCode } from "@/lib/organization.functions";
import { getTenant, listAuditLogs } from "@/lib/services/platform";

export const Route = createFileRoute("/_authenticated/org/security")({
  component: Security,
});

function Security() {
  const { data: identity } = useIdentity();
  const tenantId = identity?.tenantId ?? "";
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");

  const tenant = useQuery({ queryKey: ["tenant", tenantId], queryFn: () => getTenant(tenantId), enabled: !!tenantId });
  const logs = useQuery({ queryKey: ["org-audit", tenantId], queryFn: () => listAuditLogs(tenantId), enabled: !!tenantId });

  const change = useMutation({
    mutationFn: () => changeAccessCode({ data: { newCode: code } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["org-audit", tenantId] });
      setCode("");
      setConfirm("");
      toast.success("Access code changed. Share it only with authorised staff.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mismatch = !!confirm && code !== confirm;

  return (
    <>
      <PageHeader title="Security" description="Organization access code and the audit trail for your organization." />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Organization access code</CardTitle>
            <CardDescription>Callers enter this before reaching your account menu.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Status:</span>
              <StatusBadge status={tenant.data?.access_code_status === "ACTIVE" ? "ACTIVE" : "PENDING"} />
            </div>
            <p className="text-xs text-muted-foreground">
              Last changed: {formatDate(tenant.data?.access_code_last_changed_at)}
            </p>
            <div className="space-y-2">
              <Label>New code (6–12 digits)</Label>
              <Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Confirm code</Label>
              <Input inputMode="numeric" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              {mismatch ? <p className="text-xs text-destructive">The codes do not match.</p> : null}
            </div>
            <Button
              className="w-full"
              disabled={code.length < 6 || mismatch || code !== confirm || change.isPending}
              onClick={() => change.mutate()}
            >
              Change access code
            </Button>
            <p className="text-xs text-muted-foreground">
              The code is stored only as a secure hash. Nobody — including platform staff — can read it back.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-base">Audit trail</CardTitle>
            <CardDescription>Immutable events recorded for your organization.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Actor role</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(logs.data ?? []).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{titleCase(l.event_type)}</TableCell>
                    <TableCell>{l.actor_role ? titleCase(l.actor_role) : "System"}</TableCell>
                    <TableCell className="text-muted-foreground">{l.entity_type ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(l.created_at)}</TableCell>
                  </TableRow>
                ))}
                {(logs.data ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                      No events recorded yet.
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
