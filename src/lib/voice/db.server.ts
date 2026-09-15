/**
 * Phase 2B — narrow RPC helper for the voice layer (server only).
 *
 * Deliberately not a generic admin query abstraction: it can only call a
 * database function by name with named arguments, and every function it is
 * used with is a hardened, service-role-only `cv_*` routine.
 */
export async function voiceRpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin as never as { rpc: Function }).rpc(fn, args);
  if (error) throw new Error((error as { message: string }).message);
  return data as T;
}
