import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { listCurrencies, submitApplication } from "@/lib/services/platform";
import { PublicLayout } from "@/components/public/public-layout";
import { publicHead } from "@/lib/public-head";
export const Route = createFileRoute("/apply")({ head: () => publicHead("Apply for a workspace — CreditVoice", "Apply for an organization workspace to manage customer credit accounts by phone.", "/apply"), component: ApplicationPage });
const EMPTY = {
  organization_name: "",
  legal_name: "",
  admin_full_name: "",
  admin_email: "",
  admin_phone: "",
  country: "",
  address: "",
  business_type: "",
  requested_currency: "USD",
  description: "",
};

function ApplicationPage() {
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

  return <PublicLayout><section className="public-container py-14"><p className="public-eyebrow">Organization onboarding</p><h1 className="public-heading mt-3">Apply for CreditVoice.</h1><p className="mt-4 max-w-xl text-muted-foreground">Bring financial access closer to your community. Tell us about your organization.</p><ol className="mt-10 grid gap-5 border-y border-border py-6 sm:grid-cols-4">{["Submit application", "Organization review", "Workspace configuration", "Voice number provisioning"].map((step,i)=><li key={step} className="text-sm"><span className="mb-2 block font-mono text-xs text-primary">0{i+1}</span>{step}</li>)}</ol></section>      <section className="public-container pb-20">
        <div className="max-w-3xl">
          <div className="mb-8">
            <h2 className="text-xl font-semibold">Organization details</h2>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              Submit your organization details. The platform team reviews every application, approves your
              operating currency and issues your voice number and access code.
            </p>
          </div>
          <div>
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
                  <Label htmlFor="requested-currency">Requested currency</Label>
                  <Select value={form.requested_currency} onValueChange={set("requested_currency")}>
                    <SelectTrigger id="requested-currency">
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
          </div>
        </div>
      </section>

</PublicLayout>;
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
