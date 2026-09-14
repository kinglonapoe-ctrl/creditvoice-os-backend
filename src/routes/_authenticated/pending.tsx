import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/pending")({
  component: PendingAccess,
});

function PendingAccess() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-display">No workspace assigned yet</CardTitle>
          <CardDescription>
            Your account is not linked to the platform or to an organization. Once an administrator grants you
            access, your workspace will appear here.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button variant="outline" onClick={() => window.location.reload()}>
            Check again
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/auth", replace: true });
            }}
          >
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
