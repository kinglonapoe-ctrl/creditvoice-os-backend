/**
 * Phase 2B — public Twilio voice webhook route.
 *
 * Deliberately thin: it only wires HTTP to the server-only handler, which
 * verifies the Twilio signature before any other work. POST only.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/voice/twilio")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleTwilioWebhook } = await import("@/lib/voice/webhook.server");
        return handleTwilioWebhook(request);
      },
      GET: async () => new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } }),
    },
  },
});
