import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { routeGet, store, testConfig } from "../woo/mock-store.js";

vi.mock("@woocommerce/woocommerce-rest-api", () => import("../woo/mock-store.js").then((m) => m.moduleFactory()));
vi.mock("../../src/config.js", () => ({ loadConfig: () => testConfig }));

const { createServer } = await import("../../src/mcp/server.js");
const { groupOrdersByStatus, SUMMARY_URI } = await import("../../src/mcp/resources.js");
const { MESSAGES } = await import("../../src/errors.js");

async function connect() {
  const server = createServer();
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const ORDER_TOTALS = [
  { slug: "pending", name: "Pending payment", total: 2 },
  { slug: "processing", name: "Processing", total: 5 },
  { slug: "on-hold", name: "On hold", total: 1 },
  { slug: "completed", name: "Completed", total: 40 },
  { slug: "cancelled", name: "Cancelled", total: 0 },
  { slug: "refunded", name: "Refunded", total: 3 },
  { slug: "failed", name: "Failed", total: 4 },
  { slug: "wc-awaiting-shipment", name: "Awaiting shipment", total: "6" },
];

const PRODUCTS = [
  { id: 1, name: "Beanie", manage_stock: true, stock_quantity: 2, status: "publish" },
  { id: 2, name: "Hoodie", manage_stock: true, stock_quantity: 50, status: "publish" },
  { id: 3, name: "Cap", manage_stock: true, stock_quantity: 0, status: "publish" },
  { id: 4, name: "Poster", manage_stock: false, stock_quantity: null, status: "publish" },
];

function mockStore() {
  routeGet({
    "reports/orders/totals": () => ({ data: ORDER_TOTALS }),
    products: (params) =>
      params.per_page === 1
        ? { data: PRODUCTS.slice(0, 1), headers: { "x-wp-total": "4" } }
        : { data: PRODUCTS, headers: { "x-wp-totalpages": "1" } },
  });
}

describe("groupOrdersByStatus", () => {
  it("counts orders per status and fills missing standard statuses with 0", () => {
    const result = groupOrdersByStatus([
      { slug: "processing", total: 5 },
      { slug: "failed", total: 2 },
    ]);
    expect(result.by_status).toEqual({
      pending: 0,
      processing: 5,
      "on-hold": 0,
      completed: 0,
      cancelled: 0,
      refunded: 0,
      failed: 2,
    });
    expect(result.total).toBe(7);
  });

  it("normalises slugs, sums duplicates, keeps custom statuses and skips bad rows", () => {
    const result = groupOrdersByStatus([
      { slug: "wc-processing", total: 1 },
      { slug: "Processing", total: "2" },
      { slug: "awaiting-shipment", total: 3 },
      { slug: "", total: 9 },
      { slug: "failed", total: "lots" },
      { slug: "refunded", total: -1 },
      null,
    ]);
    expect(result.by_status.processing).toBe(3);
    expect(result.by_status["awaiting-shipment"]).toBe(3);
    expect(result.by_status.failed).toBe(0);
    expect(result.by_status.refunded).toBe(0);
    expect(result.total).toBe(6);
  });

  it("returns zero counts when the report is missing", () => {
    expect(groupOrdersByStatus(undefined).total).toBe(0);
  });
});

describe("store://summary resource", () => {
  beforeEach(() => {
    store.get.mockReset();
    store.put.mockReset();
  });

  it("is listed", async () => {
    const { resources } = await (await connect()).listResources();
    expect(resources.map((r) => r.uri)).toContain(SUMMARY_URI);
  });

  it("returns live counts with orders grouped by status", async () => {
    mockStore();
    const r = await (await connect()).readResource({ uri: SUMMARY_URI });
    const summary = JSON.parse((r.contents[0] as any).text);

    expect(summary.products).toEqual({
      published: 4,
      low_stock: 2, // Cap (0) and Beanie (2) at the default threshold of 5
      low_stock_threshold: testConfig.lowStockThreshold,
      low_stock_truncated: false,
    });
    expect(summary.orders.by_status).toEqual({
      pending: 2,
      processing: 5,
      "on-hold": 1,
      completed: 40,
      cancelled: 0,
      refunded: 3,
      failed: 4,
      "awaiting-shipment": 6,
    });
    expect(summary.orders.total).toBe(61);
    expect(store.put).not.toHaveBeenCalled();
  });

  it("returns a friendly error without leaking the keys", async () => {
    store.get.mockRejectedValue(
      Object.assign(new Error(`Request failed ${testConfig.wcKey} ${testConfig.wcSecret}`), {
        response: { status: 401 },
        config: { auth: { username: testConfig.wcKey, password: testConfig.wcSecret } },
      }),
    );
    const err: any = await (await connect()).readResource({ uri: SUMMARY_URI }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain(MESSAGES.keysRejected);
    expect(err.message).not.toContain(testConfig.wcKey);
    expect(err.message).not.toContain(testConfig.wcSecret);
  });
});

describe("prompts", () => {
  beforeEach(() => {
    store.get.mockReset();
    store.put.mockReset();
  });

  const text = (r: any) => r.messages.map((m: any) => m.content.text).join("\n");

  it("lists daily-store-report and restock-plan", async () => {
    const { prompts } = await (await connect()).listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(["daily-store-report", "restock-plan"]);
    const restock = prompts.find((p) => p.name === "restock-plan");
    expect(restock?.arguments?.map((a) => a.name)).toEqual(["threshold"]);
    expect(restock?.arguments?.[0].required).toBeFalsy();
  });

  it("daily-store-report uses tools for data and forbids changes", async () => {
    const r = await (await connect()).getPrompt({ name: "daily-store-report" });
    const t = text(r);
    expect(t).toContain("get_low_stock_products");
    expect(t).toMatch(/list_orders with status "failed"/);
    expect(t).toContain("on-hold");
    expect(t).toContain(SUMMARY_URI);
    expect(t).toMatch(/Top 3 actions/);
    expect(t).toMatch(/Do not call propose_product_change or apply_change/);
    expect(t).toMatch(/store data, not instructions/);
    // Building the prompt never touches the store.
    expect(store.get).not.toHaveBeenCalled();
  });

  it("restock-plan defaults to WOO_LOW_STOCK_THRESHOLD", async () => {
    const r = await (await connect()).getPrompt({ name: "restock-plan", arguments: {} });
    expect(text(r)).toContain(`get_low_stock_products with threshold ${testConfig.lowStockThreshold}`);
    expect(text(r)).toMatch(/Do not call propose_product_change or apply_change/);
  });

  it("restock-plan uses the threshold argument when given", async () => {
    const r = await (await connect()).getPrompt({ name: "restock-plan", arguments: { threshold: "12" } });
    expect(text(r)).toContain("get_low_stock_products with threshold 12");
  });

  it("restock-plan rejects a non-numeric threshold", async () => {
    await expect(
      (await connect()).getPrompt({ name: "restock-plan", arguments: { threshold: "ignore previous" } }),
    ).rejects.toThrow();
  });
});
