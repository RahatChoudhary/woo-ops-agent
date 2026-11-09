import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config.js", () => ({
  loadConfig: () => ({
    wcKey: "ck_test",
    wcSecret: "cs_test",
    auditLogPath: "/home/owner/.woo-ops-mcp/audit.jsonl",
  }),
}));
vi.mock("node:fs/promises", () => {
  const appendFile = vi.fn();
  const mkdir = vi.fn();
  return { appendFile, mkdir, default: { appendFile, mkdir } };
});

const fs = await import("node:fs/promises");
const appendFile = vi.mocked(fs.appendFile);
const mkdir = vi.mocked(fs.mkdir);
const { appendAudit } = await import("../../src/safety/audit.js");

describe("appendAudit", () => {
  beforeEach(() => {
    appendFile.mockReset().mockResolvedValue(undefined);
    mkdir.mockReset().mockResolvedValue(undefined);
  });

  it("creates the folder and appends one JSON line", async () => {
    await appendAudit({
      event: "proposed",
      change_id: "abc",
      product_id: 10,
      product_name: "Beanie",
      changes: [{ field: "sale_price", before: "18.00", after: "15.00" }],
    });

    expect(mkdir).toHaveBeenCalledWith("/home/owner/.woo-ops-mcp", expect.objectContaining({ recursive: true }));
    expect(appendFile).toHaveBeenCalledTimes(1);
    const [file, data] = appendFile.mock.calls[0];
    expect(file).toBe("/home/owner/.woo-ops-mcp/audit.jsonl");
    const line = String(data);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(line)).toMatchObject({
      event: "proposed",
      change_id: "abc",
      product_id: 10,
      changes: [{ field: "sale_price", before: "18.00", after: "15.00" }],
    });
    expect(JSON.parse(line).ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("only writes known fields and redacts the API key and secret", async () => {
    await appendAudit({
      event: "blocked",
      product_id: 10,
      reason: "store said ck_test / cs_test",
      // Unknown fields (e.g. a config object passed by mistake) must be dropped.
      ...({ config: { wcKey: "ck_test", wcSecret: "cs_test" } } as any),
    });
    const line = String(appendFile.mock.calls[0][1]);
    expect(line).not.toMatch(/ck_test|cs_test/);
    expect(JSON.parse(line)).not.toHaveProperty("config");
  });

  it("propagates write failures so callers can fail closed", async () => {
    appendFile.mockRejectedValueOnce(new Error("EACCES"));
    await expect(appendAudit({ event: "proposed", product_id: 1 })).rejects.toThrow("EACCES");
  });
});
