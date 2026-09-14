import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/format";
import { approveApplication, rejectApplication, reviewApplication } from "@/lib/platform.functions";
import { listApplications } from "@/lib/services/platform";

export const Route = createFileRoute("/_authenticated/admin/applications")({
  component: Applications,
});

function Applications() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const applications = useQuery({ queryKey: ["applications"], queryFn: listApplications });
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [issued, setIssued] = useState<{ email: string; password: string | null } | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["applications"] });
    queryClient.invalidateQueries({ queryKey: ["tenants"] });
    queryClient.invalidateQueries({ queryKey: ["platform-stats"] });
  };

  const review = useMutation({
    mutationFn: (id: string) => reviewApplication({ data: { applicationId: id } }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const approve = useMutation({
    mutationFn: (id: string) => approveApplication({ data: { applicationId: id } }),
    onSuccess: (result) => {
      refresh();
      setIssued({ email: result.adminEmail, password: result.temporaryPassword });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: (id: string) => rejectApplication({ data: { applicationId: id, reason } }),
    onSuccess: () => {
      refresh();
      setRejecting(null);
      setReason("");
      toast.success("Application rejected.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="Tenant applications"
        description="Review organizations requesting a CreditVoice OS workspace."
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Requested currency</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(applications.data ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="font-medium">{a.organization_name}</div>
                    <div className="text-xs text-muted-foreground">{a.legal_name}</div>
                  </TableCell>
                  <TableCell>
                    <div>{a.admin_full_name}</div>
                    <div className="text-xs text-muted-foreground">{a.admin_email}</div>
                  </TableCell>
                  <TableCell>{a.country}</TableCell>
                  <TableCell>{a.requested_currency}</TableCell>
                  <TableCell><StatusBadge status={a.status} /></TableCell>
                  <TableCell className="text-muted-foreground">{formatDay(a.created_at)}</TableCell>
                  <TableCell className="space-x-2 text-right">
                    {a.status === "PENDING" ? (
                      <Button size="sm" variant="outline" onClick={() => review.mutate(a.id)}>
                        Review
                      </Button>
                    ) : null}
                    {a.status === "PENDING" || a.status === "UNDER_REVIEW" ? (
                      <>
                        <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(a.id)}>
                          Approve
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setRejecting(a.id)}>
                          Reject
                        </Button>
                      </>
                    ) : null}
                    {a.status === "APPROVED" && a.tenant_id ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate({ to: "/admin/tenants/$tenantId", params: { tenantId: a.tenant_id! } })}
                      >
                        Open setup
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
              {(applications.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No applications submitted yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!rejecting} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject application</DialogTitle>
            <DialogDescription>Record why this organization was not approved.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reason">Reason</Label>
            <Textarea id="reason" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!reason || reject.isPending}
              onClick={() => rejecting && reject.mutate(rejecting)}
            >
              Reject application
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!issued} onOpenChange={(open) => !open && setIssued(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Organization approved</DialogTitle>
            <DialogDescription>
              The workspace, administrator login and approved currency are in place. Continue the guided setup to
              assign a voice number and issue the access code.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded-md border border-border bg-secondary/50 p-4 text-sm">
            <p>
              <span className="text-muted-foreground">Administrator email: </span>
              <span className="font-medium">{issued?.email}</span>
            </p>
            {issued?.password ? (
              <p>
                <span className="text-muted-foreground">Temporary password: </span>
                <span className="font-mono font-medium">{issued.password}</span>
              </p>
            ) : (
              <p className="text-muted-foreground">This administrator already had a CreditVoice OS login.</p>
            )}
            <p className="text-xs text-muted-foreground">
              Share this once through a secure channel. It is not stored and cannot be shown again.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setIssued(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
