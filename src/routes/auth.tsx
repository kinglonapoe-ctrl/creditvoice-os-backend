import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { loadIdentity, homePathForRole } from "@/lib/identity";
import { claimPlatformOwnership } from "@/lib/platform.functions";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — CreditVoice OS" },
      {
        name: "description",
        content: "Sign in to the CreditVoice OS platform or organization workspace to manage credit accounts.",
      },
      { property: "og:title", content: "Sign in — CreditVoice OS" },
      { property: "og:description", content: "Secure access to the CreditVoice OS credit and voice platform." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  useEffect(() => {
    loadIdentity().then((identity) => {
      if (identity) navigate({ to: homePathForRole(identity.role), replace: true });
    });
  }, [navigate]);

  async function routeAfterAuth() {
    try {
      await claimPlatformOwnership();
    } catch {
      /* ownership already claimed — ignore */
    }
    const identity = await loadIdentity();
    navigate({ to: homePathForRole(identity?.role ?? null), replace: true });
  }

  const signIn = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    onSuccess: routeAfterAuth,
    onError: (error: Error) => toast.error(error.message),
  });

  const signUp = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName }, emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        await routeAfterAuth();
      } else {
        toast.success("Check your inbox to confirm your email address, then sign in.");
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar px-4 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 block text-center font-display text-xl font-semibold text-sidebar-foreground">
          CreditVoice OS
        </Link>
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Workspace access</CardTitle>
            <CardDescription>Platform and organization administrators sign in here.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin">
              <TabsList className="mb-4 grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Create account</TabsTrigger>
              </TabsList>

              <TabsContent value="signin" className="space-y-4">
                <Field id="email" label="Work email" value={email} onChange={setEmail} type="email" />
                <Field id="password" label="Password" value={password} onChange={setPassword} type="password" />
                <Button className="w-full" disabled={signIn.isPending} onClick={() => signIn.mutate()}>
                  {signIn.isPending ? "Signing in…" : "Sign in"}
                </Button>
              </TabsContent>

              <TabsContent value="signup" className="space-y-4">
                <Field id="name" label="Full name" value={fullName} onChange={setFullName} />
                <Field id="email2" label="Work email" value={email} onChange={setEmail} type="email" />
                <Field id="password2" label="Password" value={password} onChange={setPassword} type="password" />
                <Button className="w-full" disabled={signUp.isPending} onClick={() => signUp.mutate()}>
                  {signUp.isPending ? "Creating account…" : "Create account"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  The first account created on a new deployment becomes the platform administrator.
                </p>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
