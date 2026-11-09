import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config.js";

// Append-only JSONL audit log of every proposal and change.
//
// Entries are built from a fixed list of fields, never from config objects or raw errors,
// so secrets cannot end up in the file. As a last line of defence the consumer key and
// secret are also redacted from the serialized line.

export type AuditEvent = "proposed" | "blocked" | "rejected" | "apply_started" | "applied" | "apply_failed";

export type FieldChange = {
  field: "regular_price" | "sale_price" | "stock_quantity";
  before: string | number | null;
  after: string | number | null;
};

export interface AuditEntry {
  event: AuditEvent;
  product_id: number;
  change_id?: string;
  product_name?: string;
  changes?: FieldChange[];
  reason?: string;
}

/** Appends one JSON line to the audit log, creating its folder if needed. Throws if the write fails. */
export async function appendAudit(entry: AuditEntry): Promise<void> {
  const config = loadConfig();
  const record = {
    ts: new Date().toISOString(),
    event: entry.event,
    change_id: entry.change_id,
    product_id: entry.product_id,
    product_name: entry.product_name,
    changes: entry.changes?.map(({ field, before, after }) => ({ field, before, after })),
    reason: entry.reason,
  };

  let line = JSON.stringify(record);
  for (const secret of [config.wcKey, config.wcSecret]) {
    if (secret) line = line.split(secret).join("[redacted]");
  }

  const logPath = config.auditLogPath;
  await mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
  await appendFile(logPath, `${line}\n`, { encoding: "utf8", mode: 0o600 });
}
