import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, titleCase } from "@/lib/format";
import { listPlatformSettings } from "@/lib/services/platform";

export const Route = createFileRoute("/_authenticated/admin/settings")({
  component: PlatformSettings,
});

function PlatformSettings() {
  const settings = useQuery({ queryKey: ["platform-settings"], queryFn: listPlatformSettings });

  return (
    <>
      <PageHeader title="Platform settings" description="Global configuration shared by every organization." />

      <Card className="mb-6">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Setting</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(settings.data ?? []).map((s) => (
                <TableRow key={s.key}>
                  <TableCell className="font-medium">{titleCase(s.key)}</TableCell>
                  <TableCell className="font-mono text-xs">{JSON.stringify(s.value)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(s.updated_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-base">Platform guarantees</CardTitle>
          <CardDescription>Enforced in the database, not in the interface.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>Organization access codes and customer PINs are stored only as salted hashes.</li>
            <li>Account balances change only through ledger postings; direct edits are rejected.</li>
            <li>Posted transactions and ledger entries cannot be edited or deleted — only reversed.</li>
            <li>Every record is scoped to one organization and isolated by row-level security.</li>
            <li>Account numbers are unique within an organization, not across the platform.</li>
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
