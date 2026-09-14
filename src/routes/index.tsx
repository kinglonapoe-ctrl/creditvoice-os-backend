import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { listCurrencies, submitApplication } from "@/lib/services/platform";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CreditVoice OS — Credit accounts over the phone" },
      {
        name: "description",
        content:
          "CreditVoice OS gives organizations a dedicated voice line, secure access codes and an auditable credit ledger for their customers.",
      },
      { property: "og:title", content: "CreditVoice OS — Credit accounts over the phone" },
      {
        property: "og:description",
        content: "Multi-tenant credit ledger, organization access codes and voice-number management.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const EMPTY = {
  organization_name: "",
  legal_name: "",
  admin_full_name: "",
  admin_email: "",
  admin_phone: "",
  country: "",
  address: "",
  business_type: "",
  requested_currency: "NGN",
  description: "",
};

function Landing() {
  const [form, setForm] = useState(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: listCurrencies });

  const apply = useMutation({
    mutationFn: () => submitApplication(form),
    onSuccess: () => {
      setSubmitted(true);
      setForm(EMPTY);
      toast.success("Application received. Our platform team will review it shortly.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const set = (key: keyof typeof EMPTY) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="font-display text-lg font-semibold tracking-tight">CreditVoice OS</span>
          <Button asChild variant="outline" size="sm">
            <Link to="/auth">Workspace sign in</Link>
          </Button>
        </div>
      </header>

      <section className="bg-sidebar text-sidebar-foreground">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sidebar-foreground/60">
            Credit infrastructure for voice-first markets
          </p>
          <h1 className="mt-4 max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Run customer credit accounts over a dedicated phone line
          </h1>
          <p className="mt-5 max-w-2xl text-base text-sidebar-foreground/75">
            Each organization gets an isolated workspace, an approved operating currency, its own voice number, a
            secure organization access code and an immutable credit ledger that can never be quietly edited.
          </p>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {[
              ["Strict isolation", "Every record is scoped to one organization and enforced in the database."],
              ["Ledger integrity", "Credit movements post as paired, immutable entries — reversals, never edits."],
              ["Voice ready", "Number inventory and access codes are in place for telephony connection."],
            ].map(([title, copy]) => (
              <div key={title} className="rounded-lg border border-sidebar-border/60 p-5">
                <p className="font-display text-sm font-semibold">{title}</p>
                <p className="mt-2 text-sm text-sidebar-foreground/70">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="apply" className="mx-auto max-w-3xl px-6 py-16">
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Apply for an organization workspace</CardTitle>
            <CardDescription>
              Submit your organization details. The platform team reviews every application, approves your
              operating currency and issues your voice number and access code.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {submitted ? (
              <div className="rounded-md border border-border bg-secondary/50 p-6 text-sm">
                <p className="font-medium">Application submitted</p>
                <p className="mt-1 text-muted-foreground">
                  You will receive sign-in details for your workspace once the application is approved.
                </p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => setSubmitted(false)}>
                  Submit another
                </Button>
              </div>
            ) : (
              <form
                className="grid gap-4 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  apply.mutate();
                }}
              >
                <Text id="organization_name" label="Organization name" value={form.organization_name} onChange={set("organization_name")} required />
                <Text id="legal_name" label="Legal / business name" value={form.legal_name} onChange={set("legal_name")} required />
                <Text id="admin_full_name" label="Administrator name" value={form.admin_full_name} onChange={set("admin_full_name")} required />
                <Text id="admin_email" label="Administrator email" type="email" value={form.admin_email} onChange={set("admin_email")} required />
                <Text id="admin_phone" label="Administrator phone" value={form.admin_phone} onChange={set("admin_phone")} required />
                <Text id="country" label="Country" value={form.country} onChange={set("country")} required />
                <Text id="business_type" label="Business type" value={form.business_type} onChange={set("business_type")} />
                <div className="space-y-2">
                  <Label>Requested currency</Label>
                  <Select value={form.requested_currency} onValueChange={set("requested_currency")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(currencies.data ?? [])
                        .filter((c) => c.is_active)
                        .map((c) => (
                          <SelectItem key={c.code} value={c.code}>
                            {c.code} — {c.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Text id="address" label="Address" value={form.address} onChange={set("address")} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="description">What will you use CreditVoice OS for?</Label>
                  <Textarea
                    id="description"
                    value={form.description}
                    onChange={(e) => set("description")(e.target.value)}
                    rows={4}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={apply.isPending}>
                    {apply.isPending ? "Submitting…" : "Submit application"}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </section>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        CreditVoice OS — Phase 1 foundation. Telephony connection follows in a later phase.
      </footer>
    </div>
  );
}

function Text({
  id,
  label,
  value,
  onChange,
  type = "text",
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} required={required} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
