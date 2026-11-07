import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  expandHome,
  formatConfigProblems,
  loadConfig,
  parseConfig,
  resetConfigCache,
} from "../src/config.js";

const KEY = "ck_supersecretkey123";
const SECRET = "cs_supersecretvalue456";
const base = { WC_URL: "https://shop.example.com", WC_KEY: KEY, WC_SECRET: SECRET };

function ok(env: Record<string, string | undefined>) {
  const r = parseConfig(env);
  if (!r.ok) throw new Error(`expected ok, got: ${r.problems.join("; ")}`);
  return r.config;
}

function problems(env: Record<string, string | undefined>) {
  const r = parseConfig(env);
  if (r.ok) throw new Error("expected failure");
  return r.problems;
}

describe("parseConfig", () => {
  it("applies defaults for optional variables", () => {
    expect(ok(base)).toEqual({
      wcUrl: "https://shop.example.com",
      wcKey: KEY,
      wcSecret: SECRET,
      readOnly: false,
      maxPriceChangePct: 50,
      lowStockThreshold: 5,
      queryStringAuth: false,
      timeoutMs: 15000,
      auditLogPath: path.join(os.homedir(), ".woo-ops-mcp", "audit.jsonl"),
    });
  });

  it("reads overrides", () => {
    const c = ok({
      ...base,
      WOO_READ_ONLY: "true",
      WOO_MAX_PRICE_CHANGE_PCT: "20",
      WOO_LOW_STOCK_THRESHOLD: "0",
      WOO_QUERY_STRING_AUTH: "TRUE",
      WOO_TIMEOUT_MS: "30000",
      WOO_AUDIT_LOG: "/var/log/woo/audit.jsonl",
    });
    expect(c).toMatchObject({
      readOnly: true,
      maxPriceChangePct: 20,
      lowStockThreshold: 0,
      queryStringAuth: true,
      timeoutMs: 30000,
      auditLogPath: "/var/log/woo/audit.jsonl",
    });
  });

  it("treats empty optional values as unset", () => {
    const c = ok({ ...base, WOO_READ_ONLY: "", WOO_TIMEOUT_MS: " ", WOO_AUDIT_LOG: "" });
    expect(c.readOnly).toBe(false);
    expect(c.timeoutMs).toBe(15000);
    expect(c.auditLogPath).toBe(path.join(os.homedir(), ".woo-ops-mcp", "audit.jsonl"));
  });

  it("accepts 1/0 for booleans", () => {
    expect(ok({ ...base, WOO_READ_ONLY: "1" }).readOnly).toBe(true);
    expect(ok({ ...base, WOO_READ_ONLY: "0" }).readOnly).toBe(false);
  });

  it("strips a trailing slash from WC_URL", () => {
    expect(ok({ ...base, WC_URL: "https://shop.example.com/" }).wcUrl).toBe("https://shop.example.com");
  });

  it("expands ~ in WOO_AUDIT_LOG", () => {
    expect(ok({ ...base, WOO_AUDIT_LOG: "~/logs/a.jsonl" }).auditLogPath).toBe(
      path.join(os.homedir(), "logs", "a.jsonl"),
    );
  });

  it("reports every missing required variable", () => {
    const p = problems({});
    expect(p).toEqual(
      expect.arrayContaining(["WC_URL is required", "WC_KEY is required", "WC_SECRET is required"]),
    );
  });

  it("rejects invalid values", () => {
    const p = problems({
      WC_URL: "not a url",
      WC_KEY: "abc",
      WC_SECRET: "xyz",
      WOO_READ_ONLY: "yes",
      WOO_TIMEOUT_MS: "fast",
      WOO_MAX_PRICE_CHANGE_PCT: "0",
    });
    expect(p.some((m) => m.startsWith("WC_URL "))).toBe(true);
    expect(p).toContain("WC_KEY must start with ck_");
    expect(p).toContain("WC_SECRET must start with cs_");
    expect(p).toContain("WOO_READ_ONLY must be true or false");
    expect(p.some((m) => m.startsWith("WOO_TIMEOUT_MS "))).toBe(true);
    expect(p).toContain("WOO_MAX_PRICE_CHANGE_PCT must be at least 1");
  });

  it("rejects non-http URLs", () => {
    expect(problems({ ...base, WC_URL: "ftp://shop.example.com" })[0]).toMatch(/^WC_URL /);
  });

  it("requires https for query string auth", () => {
    expect(problems({ ...base, WC_URL: "http://shop.local", WOO_QUERY_STRING_AUTH: "true" })).toEqual([
      "WOO_QUERY_STRING_AUTH can only be true when WC_URL uses https://",
    ]);
  });

  it("never includes secret values in problems", () => {
    const bad = parseConfig({ WC_KEY: "leak_KEY_value", WC_SECRET: "leak_SECRET_value", WC_URL: "x" });
    expect(bad.ok).toBe(false);
    const text = JSON.stringify(bad);
    expect(text).not.toContain("leak_KEY_value");
    expect(text).not.toContain("leak_SECRET_value");
  });
});

describe("expandHome", () => {
  it("expands only a leading ~", () => {
    expect(expandHome("~", "/h")).toBe("/h");
    expect(expandHome("~/a/b", "/h")).toBe(path.join("/h", "a", "b"));
    expect(expandHome("/x/~/y", "/h")).toBe("/x/~/y");
  });
});

describe("loadConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetConfigCache();
  });

  it("prints one message to stderr and exits 1 when invalid, without secrets", () => {
    vi.stubEnv("WC_URL", "");
    vi.stubEnv("WC_KEY", "bad_KEY_value");
    vi.stubEnv("WC_SECRET", "bad_SECRET_value");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);

    expect(() => loadConfig()).toThrow("exit 1");
    expect(exit).toHaveBeenCalledWith(1);
    expect(log).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledTimes(1);
    const msg = String(err.mock.calls[0][0]);
    expect(msg).toContain("WC_URL is required");
    expect(msg).toContain("WC_KEY must start with ck_");
    expect(msg).not.toContain("bad_KEY_value");
    expect(msg).not.toContain("bad_SECRET_value");
  });

  it("returns the parsed config when valid", () => {
    for (const [k, v] of Object.entries(base)) vi.stubEnv(k, v);
    vi.stubEnv("WOO_READ_ONLY", "true");
    expect(loadConfig()).toMatchObject({ wcUrl: base.WC_URL, readOnly: true });
  });

  it("formats problems as a bulleted list", () => {
    expect(formatConfigProblems(["A is required"])).toMatch(/\n  - A is required$/);
  });
});
