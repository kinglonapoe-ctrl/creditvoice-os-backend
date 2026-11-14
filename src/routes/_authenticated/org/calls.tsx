import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, titleCase } from "@/lib/format";
import { loadIdentity, useIdentity } from "@/lib/identity";
import { maskCaller, organizationCallsOptions } from "@/lib/services/organization-calls";

export const Route = createFileRoute("/_authenticated/org/calls")({
  loader: async ({ context }) => {
    const identity = await context.queryClient.ensureQueryData({ queryKey: ["identity"], queryFn: loadIdentity, staleTime: 30000 });
    if (identity?.role === "TENANT_ADMIN" && identity.tenantId) {
      await context.queryClient.ensureQueryData(organizationCallsOptions(identity.tenantId, 0));
    }
  },
  head: () => ({ meta: [
    { title: "Organization Call History | CreditVoice OS" },
    { name: "description", content: "Organization telephone call history, customer identification and authentication outcomes." },
    { property: "og:title", content: "Organization Call History | CreditVoice OS" },
    { property: "og:description", content: "Organization telephone call history and customer authentication outcomes." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: OrganizationCalls,
  errorComponent: ({ error, reset }) => <><PageHeader title="Call history" /><p className="mb-4 text-destructive">Could not load call history: {error.message}</p><Button onClick={reset}>Try again</Button></>,
});

function OrganizationCalls() {
  const { data: identity } = useIdentity();
  const [page, setPage] = useState(0);
  if (identity?.role !== "TENANT_ADMIN" || !identity.tenantId) return null;
  return <Suspense fallback={<p className="text-muted-foreground">Loading call history…</p>}><CallHistory tenantId={identity.tenantId} page={page} setPage={setPage} /></Suspense>;
}

function CallHistory({ tenantId, page, setPage }: { tenantId: string; page: number; setPage: (page: number) => void }) {
  const { data, refetch, isFetching } = useSuspenseQuery(organizationCallsOptions(tenantId, page));
  const pages = Math.max(1, Math.ceil(data.total / 50));
  return <>
    <PageHeader title="Call history" action={<Button variant="outline" size="icon" aria-label="Refresh call history" title="Refresh call history" disabled={isFetching} onClick={() => void refetch()}><RefreshCw className="h-4 w-4" /></Button>} />
    <div className="border-y border-border">
      <Table>
        <TableHeader><TableRow><TableHead>Started</TableHead><TableHead>Customer</TableHead><TableHead>Account</TableHead><TableHead>Caller</TableHead><TableHead>Dialled number</TableHead><TableHead>Authentication</TableHead><TableHead>Call status</TableHead><TableHead>Ended</TableHead></TableRow></TableHeader>
        <TableBody>
          {data.rows.map(call => <TableRow key={call.id}>
            <TableCell className="whitespace-nowrap text-xs">{formatDate(call.created_at)}</TableCell>
            <TableCell className="min-w-36">{call.customer?.full_name ?? "Unidentified caller"}</TableCell>
            <TableCell className="font-mono text-xs">{call.account?.account_number ?? "—"}</TableCell>
            <TableCell className="whitespace-nowrap font-mono text-xs">{maskCaller(call.from_number)}</TableCell>
            <TableCell className="whitespace-nowrap font-mono text-xs">{call.to_number}</TableCell>
            <TableCell>{call.authenticated_at ? "Successful" : `Not completed · ${titleCase(call.authentication_stage)}`}</TableCell>
            <TableCell><StatusBadge status={call.state} /></TableCell>
            <TableCell className="whitespace-nowrap text-xs">{formatDate(call.ended_at)}</TableCell>
          </TableRow>)}
          {data.rows.length === 0 && <TableRow><TableCell colSpan={8} className="py-12 text-center text-muted-foreground">No calls recorded.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
    <div className="mt-4 flex items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{data.total} calls · Page {page + 1} of {pages}</p>
      <div className="flex gap-2">
        <Button variant="outline" size="icon" title="Previous page" aria-label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="outline" size="icon" title="Next page" aria-label="Next page" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  </>;
}