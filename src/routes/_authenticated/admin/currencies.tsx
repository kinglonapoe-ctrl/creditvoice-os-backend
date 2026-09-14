import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { setCurrencyActive } from "@/lib/platform.functions";
import { listCurrencies, listTenants } from "@/lib/services/platform";

export const Route = createFileRoute("/_authenticated/admin/currencies")({
  component: Currencies,
});

function Currencies() {
  const queryClient = useQueryClient();
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: listCurrencies });
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: listTenants });

  const toggle = useMutation({
    mutationFn: (input: { code: string; isActive: boolean }) => setCurrencyActive({ data: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["currencies"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const usage = (code: string) => (tenants.data ?? []).filter((t) => t.currency_code === code).length;

  return (
    <>
      <PageHeader
        title="Currencies"
        description="The platform currency registry. Each organization operates in exactly one approved currency."
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Decimals</TableHead>
                <TableHead>Organizations</TableHead>
                <TableHead className="text-right">Available</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(currencies.data ?? []).map((c) => (
                <TableRow key={c.code}>
                  <TableCell className="font-mono font-medium">{c.code}</TableCell>
                  <TableCell>{c.name}</TableCell>
                  <TableCell>{c.symbol}</TableCell>
                  <TableCell>{c.decimal_places}</TableCell>
                  <TableCell>{usage(c.code)}</TableCell>
                  <TableCell className="text-right">
                    <Switch
                      checked={c.is_active}
                      onCheckedChange={(value) => toggle.mutate({ code: c.code, isActive: value })}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
