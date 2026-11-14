import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, titleCase } from "@/lib/format";
import { listPlatformUsers } from "@/lib/services/platform";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({ meta: [{ title: "Users — CreditVoice OS" }] }),
  component: PlatformUsers,
});

function PlatformUsers() {
  const users = useQuery({ queryKey: ["platform-users"], queryFn: listPlatformUsers });
  const [q, setQ] = useState("");
  const rows = (users.data ?? []).filter((u) =>
    `${u.email ?? ""} ${u.full_name ?? ""}`.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <PageHeader title="Users" description="Every registered sign-in account, its role and organization." />
      <Input className="mb-4 max-w-sm" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Registered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.full_name ?? "—"}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    {u.roles.length === 0 ? (
                      <Badge variant="outline">Unassigned</Badge>
                    ) : (
                      u.roles.map((r, i) => <Badge key={i} variant="secondary" className="mr-1">{titleCase(r.role)}</Badge>)
                    )}
                  </TableCell>
                  <TableCell>{u.roles.map((r) => r.tenant).filter(Boolean).join(", ") || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(u.created_at)}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    {users.isLoading ? "Loading…" : users.error ? (users.error as Error).message : "No users found."}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
