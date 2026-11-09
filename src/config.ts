import os from "node:os";
import path from "node:path";
import { z } from "zod";

// Reads configuration only from environment variables (never from a .env file).
// See the Configuration table in docs/PRODUCT.md.

export interface Config {
  wcUrl: string;
  wcKey: string;
  wcSecret: string;
  readOnly: boolean;
  maxPriceChangePct: number;
  lowStockThreshold: number;
  queryStringAuth: boolean;
  timeoutMs: number;
  auditLogPath: string;
}

export const DEFAULT_AUDIT_LOG = "~/.woo-ops-mcp/audit.jsonl";

// Treat empty strings as "not set" so `WOO_READ_ONLY=` falls back to the default.
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema);

const bool = (fallback: boolean) =>
  optional(
    z
      .string()
      .trim()
      .toLowerCase()
      .refine((v) => ["true", "false", "1", "0"].includes(v), {
        message: "must be true or false",
      })
      .transform((v) => v === "true" || v === "1")
      .optional()
      .default(fallback ? "true" : "false"),
  );

const int = (fallback: number, min: number, max: number) =>
  optional(
    z.coerce
      .number({ invalid_type_error: "must be a number" })
      .int("must be a whole number")
      .min(min, `must be at least ${min}`)
      .max(max, `must be at most ${max}`)
      .optional()
      .default(fallback),
  );

const required = (prefix?: string) => {
  let s = z.string({ required_error: "is required" }).trim().min(1, "is required");
  if (prefix) s = s.startsWith(prefix, `must start with ${prefix}`);
  return optional(s);
};

const schema = z
  .object({
    WC_URL: optional(
      z
        .string({ required_error: "is required" })
        .trim()
        .url("must be a full URL like https://your-store.com")
        .refine((v) => /^https?:\/\//i.test(v), { message: "must start with http:// or https://" })
        .transform((v) => v.replace(/\/+$/, "")),
    ),
    WC_KEY: required("ck_"),
    WC_SECRET: required("cs_"),
    WOO_READ_ONLY: bool(false),
    WOO_MAX_PRICE_CHANGE_PCT: int(50, 1, 1000),
    WOO_LOW_STOCK_THRESHOLD: int(5, 0, 100000),
    WOO_QUERY_STRING_AUTH: bool(false),
    WOO_TIMEOUT_MS: int(15000, 1000, 120000),
    WOO_AUDIT_LOG: optional(z.string().trim().optional().default(DEFAULT_AUDIT_LOG)),
  })
  .superRefine((env, ctx) => {
    if (env.WOO_QUERY_STRING_AUTH && env.WC_URL && !/^https:\/\//i.test(env.WC_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["WOO_QUERY_STRING_AUTH"],
        message: "can only be true when WC_URL uses https://",
      });
    }
  });

export function expandHome(p: string, home: string = os.homedir()): string {
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(home, p.slice(2));
  return p;
}

export type ParseResult = { ok: true; config: Config } | { ok: false; problems: string[] };

/**
 * Validates env vars. Never throws and never includes variable values in
 * problem messages, so secrets cannot leak through errors.
 */
export function parseConfig(env: Record<string, string | undefined>): ParseResult {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".") || "config"} ${i.message}`);
    return { ok: false, problems: [...new Set(problems)] };
  }
  const e = result.data;
  return {
    ok: true,
    config: {
      wcUrl: e.WC_URL,
      wcKey: e.WC_KEY,
      wcSecret: e.WC_SECRET,
      readOnly: e.WOO_READ_ONLY,
      maxPriceChangePct: e.WOO_MAX_PRICE_CHANGE_PCT,
      lowStockThreshold: e.WOO_LOW_STOCK_THRESHOLD,
      queryStringAuth: e.WOO_QUERY_STRING_AUTH,
      timeoutMs: e.WOO_TIMEOUT_MS,
      auditLogPath: path.resolve(expandHome(e.WOO_AUDIT_LOG)),
    },
  };
}

export function formatConfigProblems(problems: string[]): string {
  return [
    "woo-ops-mcp: invalid configuration. Fix these environment variables in your MCP client config:",
    ...problems.map((p) => `  - ${p}`),
  ].join("\n");
}

let cached: Config | undefined;

/** Loads config from process.env. On failure prints to stderr and exits with code 1. */
export function loadConfig(): Config {
  if (cached) return cached;
  const result = parseConfig(process.env);
  if (!result.ok) {
    console.error(formatConfigProblems(result.problems));
    process.exit(1);
  }
  cached = result.config;
  return cached;
}

/** Test helper: clears the cached config. */
export function resetConfigCache(): void {
  cached = undefined;
}
