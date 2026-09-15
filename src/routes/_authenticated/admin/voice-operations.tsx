import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/components/app-shell";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/voice-operations")({
  component: VoiceOperations,
  head: () => ({
    meta: [
      { title: "Voice Operations | CreditVoice OS" },
      {
        name: "description",
        content: "Live and recent telephone call activity across organizations: authentication outcomes and transfer attempts.",
      },
      { property: "og:title", content: "Voice Operations | CreditVoice OS" },
      {
        property: "og:description",
        content: "Live and recent telephone call activity across organizations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

/** Telephone numbers are sensitive: only the ending is ever shown. */
function maskNumber(value: string | null): string {
  if (!value) return "—";
  return value.length <= 4 ? "••••" : `${value.slice(0, 4)}••••${value.slice(-3)}`;
}

const LIVE_STATES = ["NEW", "TENANT_RESOLVED", "ACCESS_CODE_VERIFIED", "ACCOUNT_IDENTIFIED", "PIN_VERIFIED", "AUTHENTICATED", "PROCESSING"];

function VoiceOperations() {
  const { data, isLoading } = useQuery({
    queryKey: ["voice-operations"],
    refetchInterval: 20000,
    queryFn: async () => {
      const [sessions, tenants] = await Promise.all([
        supabase
          .from("call_sessions")
          .select(
            "id, provider, from_number, to_number, tenant_id, state, authentication_stage, ivr_state, created_at, authenticated_at",
          )
          .order("created_at", { ascending: false })
          .limit(50),
        supabase.from("tenants").select("id, name"),
      ]);
      if (sessions.error) throw sessions.error;
      const names = new Map((tenants.data ?? []).map((t) => [t.id, t.name]));
      return (sessions.data ?? []).map((s) => ({ ...s, tenantName: names.get(s.tenant_id ?? "") ?? "—" }));
    },
  });

  const rows = data ?? [];
  const live = rows.filter((r) => LIVE_STATES.includes(r.state)).length;
  const authenticated = rows.filter((r) => r.authenticated_at).length;
  const failed = rows.filter((r) => ["FAILED", "LOCKED"].includes(r.state)).length;

  return (
    <>
      <PageHeader
        title="Voice operations"
        description="Recent telephone activity. Credentials, PINs and access codes are never stored or shown; caller numbers are masked."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Calls in progress" value={String(live)} />
        <StatCard label="Authenticated (last 50)" value={String(authenticated)} />
        <StatCard label="Failed or locked (last 50)" value={String(failed)} />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Caller</TableHead>
                <TableHead>Dialled</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6}>Loading…</TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No calls recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(r.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>{r.tenantName}</TableCell>
                    <TableCell className="font-mono text-xs">{maskNumber(r.from_number)}</TableCell>
                    <TableCell className="font-mono text-xs">{maskNumber(r.to_number)}</TableCell>
                    <TableCell className="text-xs">{r.ivr_state ?? r.authentication_stage}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.state} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
