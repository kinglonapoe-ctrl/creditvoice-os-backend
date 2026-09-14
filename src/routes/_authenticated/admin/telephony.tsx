import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TELEPHONY_PROVIDERS } from "@/lib/telephony/provider";

export const Route = createFileRoute("/_authenticated/admin/telephony")({
  component: TelephonyProviders,
});

function TelephonyProviders() {
  return (
    <>
      <PageHeader
        title="Telephony providers"
        description="Call handling is not connected in Phase 1. The platform exposes a provider contract so a carrier can be plugged in without touching the credit engine."
      />

      <Card className="mb-6">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Identifier</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {TELEPHONY_PROVIDERS.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="font-mono text-xs">{p.id}</TableCell>
                  <TableCell><StatusBadge status={p.status === "ACTIVE" ? "ACTIVE" : "PENDING"} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-base">Provider contract</CardTitle>
          <CardDescription>Any carrier integration must implement these operations.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {["answerCall", "speak", "gatherDigits", "transferCall", "hangup"].map((method) => (
              <li key={method} className="rounded-md border border-border px-3 py-2 font-mono text-xs">
                {method}()
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted-foreground">
            Inbound flow once connected: organization access code, then account number, then PIN, then the credit
            engine — all of which already exist in this phase.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
