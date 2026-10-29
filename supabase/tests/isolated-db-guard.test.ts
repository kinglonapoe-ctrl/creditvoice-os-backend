import { describe, expect, test } from "bun:test";
import { assertIsolatedTarget, IsolationError, qaRunPrefix, runCleanupSql } from "./isolated-db-guard";

const ok = {
  CV_E2E_ISOLATED: "1",
  CV_TEST_DB_URL: "postgresql://postgres@127.0.0.1:54322/cv_isolated",
  CV_TEST_SUPABASE_URL: "http://127.0.0.1:54321",
  CV_TEST_SERVICE_ROLE_KEY: "isolated-key",
  SUPABASE_URL: "https://humtwjfntqifsookwkpq.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "live-key",
  PGHOST: "db.live.example",
};

describe("isolated database guard", () => {
  test("refuses without explicit opt-in", () => {
    expect(() => assertIsolatedTarget({ ...ok, CV_E2E_ISOLATED: undefined })).toThrow(IsolationError);
  });
  test("never falls back to the live SUPABASE_DB_URL", () => {
    expect(() =>
      assertIsolatedTarget({ ...ok, CV_TEST_DB_URL: undefined, SUPABASE_DB_URL: "postgresql://x@h/db" }),
    ).toThrow(IsolationError);
  });
  test("refuses a URL naming the live project", () => {
    expect(() =>
      assertIsolatedTarget({ ...ok, CV_TEST_SUPABASE_URL: "https://humtwjfntqifsookwkpq.supabase.co" }),
    ).toThrow(IsolationError);
  });
  test("refuses the live database host", () => {
    expect(() => assertIsolatedTarget({ ...ok, CV_TEST_DB_URL: "postgresql://u@db.live.example/x" })).toThrow(
      IsolationError,
    );
  });
  test("refuses the live service key", () => {
    expect(() => assertIsolatedTarget({ ...ok, CV_TEST_SERVICE_ROLE_KEY: "live-key" })).toThrow(IsolationError);
  });
  test("accepts a distinct isolated target", () => {
    expect(assertIsolatedTarget(ok).apiUrl).toBe("http://127.0.0.1:54321");
  });
  test("cleanup is scoped to the run prefix and rejects wildcards", () => {
    const sql = runCleanupSql("CA-QA-e2e-abcd1234");
    expect(sql).toContain("like 'CA-QA-e2e-abcd1234-%'");
    expect(() => runCleanupSql("CA-%")).toThrow(IsolationError);
    expect(qaRunPrefix("e2e")).toMatch(/^CA-QA-e2e-[a-z0-9]+$/);
  });
});
