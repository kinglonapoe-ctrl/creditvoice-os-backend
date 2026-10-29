/**
 * Fail-closed guard for test suites that drive the real webhook handler.
 *
 * The handler talks to the database through the server admin client, which
 * reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. In the managed environment
 * those point at the LIVE application database, so a suite that only checks
 * its psql URL can still write to production. This guard:
 *   1. requires explicit opt-in (CV_E2E_ISOLATED=1) and dedicated CV_TEST_*
 *      variables — it never falls back to SUPABASE_URL / SUPABASE_DB_URL;
 *   2. refuses any URL that names the live project or the live hosts;
 *   3. requires the database to carry the marker
 *        ALTER DATABASE <db> SET creditvoice.isolated_test = 'on';
 *      which is never set on the live database;
 *   4. refuses if a known live organization exists in the target database;
 *   5. only then overwrites SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY for this
 *      process, so the handler can only reach the isolated stack.
 * It must be called before the handler module is imported.
 */
const LIVE_PROJECT_REF = "humtwjfntqifsookwkpq";
const LIVE_TENANT_IDS = [
  "7965a5cb-1144-4fc1-9150-db68e40dbe4c", // CreditVoice Pilot
  "3f3db4ed-37a1-4c10-befd-08e2b08f04c5", // CreditVoice Test Cooperative
];

export class IsolationError extends Error {}

function refuse(reason: string): never {
  throw new IsolationError(`Refusing to run against a non-isolated database: ${reason}`);
}

function host(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return refuse("a test URL is not a valid URL");
  }
}

export function assertIsolatedTarget(env: Record<string, string | undefined>): {
  dbUrl: string;
  apiUrl: string;
  serviceKey: string;
} {
  if (env["CV_E2E_ISOLATED"] !== "1") refuse("CV_E2E_ISOLATED=1 is not set");
  const dbUrl = env["CV_TEST_DB_URL"];
  const apiUrl = env["CV_TEST_SUPABASE_URL"];
  const serviceKey = env["CV_TEST_SERVICE_ROLE_KEY"];
  if (!dbUrl || !apiUrl || !serviceKey) {
    refuse("CV_TEST_DB_URL, CV_TEST_SUPABASE_URL and CV_TEST_SERVICE_ROLE_KEY are all required");
  }
  const liveHosts = [env["SUPABASE_URL"], env["SUPABASE_DB_URL"]]
    .filter((v): v is string => !!v)
    .map((v) => host(v));
  if (env["PGHOST"]) liveHosts.push(env["PGHOST"].toLowerCase());
  for (const candidate of [dbUrl, apiUrl]) {
    if (candidate.toLowerCase().includes(LIVE_PROJECT_REF)) refuse("a test URL names the live project");
    if (liveHosts.includes(host(candidate))) refuse("a test URL points at the live database host");
  }
  if (env["SUPABASE_SERVICE_ROLE_KEY"] && serviceKey === env["SUPABASE_SERVICE_ROLE_KEY"]) {
    refuse("the test service key is the live service key");
  }
  return { dbUrl, apiUrl, serviceKey };
}

/** Full guard: static checks, then positive database identity, then env pinning. */
export function requireIsolatedDatabase(): string {
  const { dbUrl, apiUrl, serviceKey } = assertIsolatedTarget(process.env);
  const probe = Bun.spawnSync([
    "psql",
    dbUrl,
    "-Atc",
    `select coalesce(current_setting('creditvoice.isolated_test', true), '') || '|' ||
       (select count(*) from public.tenants where id in (${LIVE_TENANT_IDS.map((id) => `'${id}'`).join(",")}))`,
  ]);
  if (probe.exitCode !== 0) refuse("could not verify the database identity");
  const [marker, liveTenants] = probe.stdout.toString().trim().split("|");
  if (marker !== "on") refuse("the database is not marked creditvoice.isolated_test = on");
  if (liveTenants !== "0") refuse("the database contains live organizations");
  process.env["SUPABASE_URL"] = apiUrl;
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = serviceKey;
  delete process.env["SUPABASE_DB_URL"];
  return dbUrl;
}

/** Deterministic, per-run QA call identifier prefix. */
export function qaRunPrefix(suite: string): string {
  const run = process.env["CV_QA_RUN_ID"] ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  if (!/^[a-z0-9]{4,24}$/.test(run)) refuse("CV_QA_RUN_ID must be 4-24 lowercase letters/digits");
  return `CA-QA-${suite}-${run}`;
}

/** Reserved/synthetic numbers (Twilio test-credential magic numbers). */
export const QA_CALLER = "+15005550006";
export const QA_UNKNOWN_DESTINATION = "+15005550001";

/**
 * SQL that removes ONLY the current run's tenant-less call artifacts: sessions
 * whose provider_call_id carries the run prefix, plus their events, auth
 * failures and the audit rows whose entity is one of those sessions.
 * Runs only after requireIsolatedDatabase() has positively verified the target.
 */
export function runCleanupSql(prefix: string): string {
  if (!/^CA-QA-[a-z0-9-]+$/.test(prefix)) refuse("invalid QA run prefix");
  const ids = `select id from public.call_sessions where provider = 'TWILIO' and provider_call_id like '${prefix}-%'`;
  return `begin;
    set local session_replication_role = 'replica';
    delete from public.audit_logs where entity_type = 'call_session' and entity_id in (${ids});
    delete from public.call_auth_failures where session_id in (${ids});
    delete from public.call_session_events where session_id in (${ids});
    delete from public.call_transfer_grants where session_id in (${ids});
    delete from public.financial_failure_events where session_id in (${ids});
    delete from public.call_sessions where id in (${ids});
    commit;`;
}
