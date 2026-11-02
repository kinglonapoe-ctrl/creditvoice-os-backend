import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Tenant = {
  id: string;
  name: string;
  legal_name: string;
  country: string;
  address: string | null;
  business_type: string | null;
  description: string | null;
  contact_email: string | null;
  contact_phone: string | null;
};

const FIELDS = ["name", "legal_name", "contact_email", "contact_phone", "country", "business_type", "address", "description"] as const;
type Field = (typeof FIELDS)[number];
const LABELS: Record<Field, string> = {
  name: "Trading name",
  legal_name: "Legal name",
  contact_email: "Contact email",
  contact_phone: "Contact phone",
  country: "Country",
  business_type: "Business type",
  address: "Address",
  description: "Description",
};

const toForm = (t: Tenant) => Object.fromEntries(FIELDS.map((f) => [f, (t[f] ?? "") as string])) as Record<Field, string>;

/** Edits descriptive organization details only. Currency, status and access codes have their own controlled flows. */
export function OrganizationProfileEditor({ tenant }: { tenant: Tenant }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => toForm(tenant));
  useEffect(() => setForm(toForm(tenant)), [tenant]);

  const save = useMutation({
    mutationFn: async () => {
      const name = form.name.trim();
      const legal = form.legal_name.trim();
      const country = form.country.trim();
      const email = form.contact_email.trim();
      if (!name || !legal || !country) throw new Error("Trading name, legal name and country are required.");
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid contact email.");
      const opt = (v: string) => v.trim() || null;
      const { error } = await supabase
        .from("tenants")
        .update({
          name,
          legal_name: legal,
          country,
          contact_email: email || null,
          contact_phone: opt(form.contact_phone),
          business_type: opt(form.business_type),
          address: opt(form.address),
          description: opt(form.description),
        })
        .eq("id", tenant.id);
      if (error) throw new Error("Could not save organization details.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant", tenant.id] });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      toast.success("Organization details saved.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="font-display text-base">Organization details</CardTitle>
        <CardDescription>Currency, status and access codes are managed separately.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {FIELDS.map((f) => (
            <div key={f} className={f === "description" || f === "address" ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
              <Label htmlFor={`org-${f}`}>{LABELS[f]}</Label>
              {f === "description" ? (
                <Textarea id={`org-${f}`} value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} />
              ) : (
                <Input
                  id={`org-${f}`}
                  type={f === "contact_email" ? "email" : "text"}
                  value={form[f]}
                  onChange={(e) => setForm({ ...form, [f]: e.target.value })}
                />
              )}
            </div>
          ))}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>Save details</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
