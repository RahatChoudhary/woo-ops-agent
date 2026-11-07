import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { store, testConfig } from "../woo/mock-store.js";
import { rawProduct } from "../woo/fixtures.js";

vi.mock("@woocommerce/woocommerce-rest-api", () => import("../woo/mock-store.js").then((m) => m.moduleFactory()));
vi.mock("../../src/config.js", () => import("../woo/mock-store.js").then((m) => ({ loadConfig: () => m.testConfig })));
vi.mock("node:fs/promises", () => {
  const appendFile = vi.fn();
  const mkdir = vi.fn();
  return { appendFile, mkdir, default: { appendFile, mkdir } };
});

const fs = await import("node:fs/promises");
const appendFile = vi.mocked(fs.appendFile);
const mkdir = vi.mocked(fs.mkdir);
const {
  proposeProductChange,
  applyChange,
  evaluateChange,
  _resetPendingForTests,
  CHANGE_MESSAGES,
  CHANGE_TTL_MS,
} = await import("../../src/safety/changes.js");

// A live in-memory product: GET returns it, PUT merges the body into it.
let product: any;

function auditEvents(): string[] {
  return appendFile.mock.calls.map((c) => JSON.parse(String(c[1])).event);
}

beforeEach(() => {
  _resetPendingForTests();
  product = rawProduct(); // simple, regular 20.00, sale 18.00, stock 3
  store.get.mockReset().mockImplementation(async (endpoint: string) => {
    if (endpoint === `products/${product.id}`) return { data: { ...product } };
    throw new Error(`Unexpected GET ${endpoint}`);
  });
  store.put.mockReset().mockImplementation(async (_endpoint: string, body: any) => {
    product = { ...product, ...body };
    return { data: { ...product } };
  });
  appendFile.mockReset().mockResolvedValue(undefined);
  mkdir.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("propose_product_change", () => {
  it("returns a preview and never writes to the store", async () => {
    const preview = await proposeProductChange({ product_id: 10, sale_price: "15.00" });

    expect(preview.change_id).toMatch(/[0-9a-f-]{36}/);
    expect(preview.product).toEqual({ id: 10, name: "Beanie" });
    expect(preview.changes).toEqual([{ field: "sale_price", before: "18.00", after: "15.00" }]);
    expect(store.put).not.toHaveBeenCalled();
    expect(product.sale_price).toBe("18.00");
    expect(auditEvents()).toEqual(["proposed"]);
  });

  it("blocks a regular price change over the configured limit", async () => {
    await expect(proposeProductChange({ product_id: 10, regular_price: "4.00" })).rejects.toThrow(
      /80\.0% is over the allowed limit of 50%/,
    );
    expect(store.put).not.toHaveBeenCalled();
    expect(auditEvents()).toEqual(["blocked"]);
  });

  it("allows a change exactly at the limit", async () => {
    const preview = await proposeProductChange({ product_id: 10, regular_price: "30.00" });
    expect(preview.changes).toEqual([{ field: "regular_price", before: "20.00", after: "30.00" }]);
  });

  it("uses WOO_MAX_PRICE_CHANGE_PCT from config", async () => {
    const original = testConfig.maxPriceChangePct;
    testConfig.maxPriceChangePct = 10;
    try {
      await expect(proposeProductChange({ product_id: 10, regular_price: "23.00" })).rejects.toThrow(
        /allowed limit of 10%/,
      );
    } finally {
      testConfig.maxPriceChangePct = original;
    }
  });

  it("blocks a sale price equal to the regular price", async () => {
    await expect(proposeProductChange({ product_id: 10, sale_price: "20.00" })).rejects.toThrow(
      /sale price \(20\.00\) must be lower than the regular price \(20\.00\)/,
    );
  });

  it("blocks a sale price above the regular price", async () => {
    await expect(proposeProductChange({ product_id: 10, sale_price: "25" })).rejects.toThrow(/must be lower/);
  });

  it("blocks lowering the regular price below the existing sale price", async () => {
    await expect(proposeProductChange({ product_id: 10, regular_price: "17.00" })).rejects.toThrow(
      /sale price \(18\.00\) must be lower than the regular price \(17\.00\)/,
    );
  });

  it("allows ending a sale with an empty sale price", async () => {
    const preview = await proposeProductChange({ product_id: 10, sale_price: "" });
    expect(preview.changes).toEqual([{ field: "sale_price", before: "18.00", after: null }]);
  });

  it("blocks stock outside 0–100,000 even when schema validation is bypassed", () => {
    expect(() => evaluateChange(rawProduct(), { product_id: 10, stock_quantity: 100_001 }, 50)).toThrow(
      /whole number from 0 to 100,000/,
    );
    expect(() => evaluateChange(rawProduct(), { product_id: 10, stock_quantity: 2.5 }, 50)).toThrow(/whole number/);
    expect(() => evaluateChange(rawProduct(), { product_id: 10, stock_quantity: -1 }, 50)).toThrow(/whole number/);
  });

  it("rejects variable products and points to variations in WooCommerce admin", async () => {
    product = rawProduct({ type: "variable" });
    await expect(proposeProductChange({ product_id: 10, stock_quantity: 5 })).rejects.toThrow(
      /Edit its variations in WooCommerce admin/,
    );
  });

  it("rejects a proposal that changes nothing", async () => {
    await expect(proposeProductChange({ product_id: 10, stock_quantity: 3 })).rejects.toThrow(
      CHANGE_MESSAGES.noDifference,
    );
    await expect(proposeProductChange({ product_id: 10 })).rejects.toThrow(CHANGE_MESSAGES.nothingToChange);
  });

  it("refuses the proposal when the audit log can't be written", async () => {
    appendFile.mockRejectedValueOnce(Object.assign(new Error("EACCES"), { code: "EACCES" }));
    await expect(proposeProductChange({ product_id: 10, sale_price: "15.00" })).rejects.toThrow(
      CHANGE_MESSAGES.auditUnavailable,
    );
  });
});

describe("apply_change", () => {
  it("applies once and rejects reuse of the same change_id", async () => {
    const { change_id } = await proposeProductChange({ product_id: 10, sale_price: "15.00", stock_quantity: 40 });

    const result = await applyChange(change_id);
    expect(result.applied).toBe(true);
    expect(result.product).toMatchObject({ id: 10, sale_price: "15.00", stock: 40 });
    expect(result.warning).toBeUndefined();
    expect(store.put).toHaveBeenCalledTimes(1);
    expect(store.put).toHaveBeenCalledWith("products/10", {
      sale_price: "15.00",
      manage_stock: true,
      stock_quantity: 40,
    });
    expect(auditEvents()).toEqual(["proposed", "apply_started", "applied"]);

    await expect(applyChange(change_id)).rejects.toThrow(CHANGE_MESSAGES.unknownId);
    expect(store.put).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown change ids without touching the store", async () => {
    await expect(applyChange("not-a-real-id")).rejects.toThrow(CHANGE_MESSAGES.unknownId);
    expect(store.get).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
  });

  it("still works just before 10 minutes", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-08T12:00:00Z") });
    const { change_id } = await proposeProductChange({ product_id: 10, sale_price: "15.00" });
    vi.advanceTimersByTime(CHANGE_TTL_MS);
    await expect(applyChange(change_id)).resolves.toMatchObject({ applied: true });
  });

  it("rejects a change_id after 10 minutes", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-08T12:00:00Z") });
    const { change_id, expires_at } = await proposeProductChange({ product_id: 10, sale_price: "15.00" });
    expect(expires_at).toBe("2026-11-08T12:10:00.000Z");

    vi.advanceTimersByTime(CHANGE_TTL_MS + 1);
    await expect(applyChange(change_id)).rejects.toThrow(CHANGE_MESSAGES.expired);
    expect(store.put).not.toHaveBeenCalled();
    // Expired ids are gone for good.
    await expect(applyChange(change_id)).rejects.toThrow(CHANGE_MESSAGES.unknownId);
  });

  it("rejects when the product changed after the preview", async () => {
    const { change_id } = await proposeProductChange({ product_id: 10, sale_price: "15.00" });
    product.regular_price = "16.00"; // someone edited it in WooCommerce admin
    await expect(applyChange(change_id)).rejects.toThrow(CHANGE_MESSAGES.stale);
    expect(store.put).not.toHaveBeenCalled();
  });

  it("refuses to apply when the apply_started audit entry can't be written", async () => {
    const { change_id } = await proposeProductChange({ product_id: 10, sale_price: "15.00" });
    appendFile.mockRejectedValueOnce(Object.assign(new Error("ENOSPC"), { code: "ENOSPC" }));

    await expect(applyChange(change_id)).rejects.toThrow(CHANGE_MESSAGES.auditUnavailable);
    expect(store.put).not.toHaveBeenCalled();
    expect(product.sale_price).toBe("18.00");
  });

  it("returns success with a warning when the applied audit entry can't be written", async () => {
    const { change_id } = await proposeProductChange({ product_id: 10, sale_price: "15.00" });
    appendFile
      .mockResolvedValueOnce(undefined) // apply_started
      .mockRejectedValueOnce(Object.assign(new Error("ENOSPC"), { code: "ENOSPC" })); // applied

    const result = await applyChange(change_id);
    expect(result.applied).toBe(true);
    expect(result.warning).toBe(CHANGE_MESSAGES.appliedAuditWarning);
    expect(store.put).toHaveBeenCalledTimes(1);
    expect(product.sale_price).toBe("15.00");
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/audit log write failed \(applied\).*ENOSPC/));
  });

  it("records apply_failed when the store rejects the update", async () => {
    const { change_id } = await proposeProductChange({ product_id: 10, sale_price: "15.00" });
    store.put.mockRejectedValueOnce(Object.assign(new Error("boom"), { response: { status: 500 } }));
    await expect(applyChange(change_id)).rejects.toThrow();
    expect(auditEvents()).toEqual(["proposed", "apply_started", "apply_failed"]);
  });

  it("never writes secrets to the audit log", async () => {
    product = rawProduct({ name: "Beanie ck_test cs_test" });
    const { change_id } = await proposeProductChange({ product_id: 10, sale_price: "15.00" });
    await applyChange(change_id);
    const written = appendFile.mock.calls.map((c) => String(c[1])).join("");
    expect(written).not.toMatch(/ck_test|cs_test/);
  });
});
