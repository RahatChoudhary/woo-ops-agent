import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { store, testConfig } from "../woo/mock-store.js";

vi.mock("@woocommerce/woocommerce-rest-api", () => import("../woo/mock-store.js").then((m) => m.moduleFactory()));
vi.mock("../../src/config.js", () => ({ loadConfig: () => testConfig }));
vi.mock("node:fs/promises", () => {
  const appendFile = vi.fn(async () => {});
  const mkdir = vi.fn(async () => {});
  return { appendFile, mkdir, default: { appendFile, mkdir } };
});

const { createServer } = await import("../../src/mcp/server.js");
const { MESSAGES } = await import("../../src/errors.js");
const { rawProduct } = await import("../woo/fixtures.js");

const READ_TOOLS = [
  "get_customer",
  "get_low_stock_products",
  "get_order",
  "get_product",
  "list_orders",
  "search_products",
];

async function connect() {
  const server = createServer();
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const text = (r: any) => r.content[0].text as string;

describe("read tools", () => {
  beforeEach(() => {
    store.get.mockReset();
    store.put.mockReset();
  });

  it("registers the six read tools, all read-only", async () => {
    const { tools } = await (await connect()).listTools();
    const readTools = tools.filter((t) => READ_TOOLS.includes(t.name));
    expect(readTools.map((t) => t.name).sort()).toEqual(READ_TOOLS);
    for (const t of readTools) {
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.description).toMatch(/^Use when/);
    }
  });

  it("returns JSON text on success", async () => {
    store.get.mockResolvedValue({ data: { id: 7, name: "Mug", manage_stock: true, stock_quantity: 3 } });
    const r: any = await (await connect()).callTool({ name: "get_product", arguments: { id: 7 } });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(text(r))).toMatchObject({ id: 7, name: "Mug", stock: 3 });
  });

  it("returns a friendly isError result when keys are rejected", async () => {
    const err: any = new Error("Request failed with status code 401");
    err.response = { status: 401 };
    err.config = { auth: { username: "ck_test", password: "cs_test" } };
    store.get.mockRejectedValue(err);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    const r: any = await (await connect()).callTool({ name: "get_order", arguments: { id: 1 } });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe(MESSAGES.keysRejected);
    expect(JSON.stringify(stderr.mock.calls)).not.toMatch(/ck_test|cs_test/);
    stderr.mockRestore();
  });

  it("passes business-rule messages through", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const r: any = await (await connect()).callTool({
      name: "list_orders",
      arguments: { after: "2026-02-01", before: "2026-01-01" },
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe("The 'after' date must be earlier than the 'before' date.");
    expect(store.get).not.toHaveBeenCalled();
    stderr.mockRestore();
  });

  it("get_customer reports a missing customer without an error", async () => {
    store.get.mockResolvedValue({ data: [] });
    const r: any = await (await connect()).callTool({
      name: "get_customer",
      arguments: { email: "nobody@example.com" },
    });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(text(r))).toMatchObject({ found: false });
  });
});

describe("change tools", () => {
  beforeEach(() => {
    store.get.mockReset();
    store.put.mockReset();
    testConfig.readOnly = false;
  });

  it("registers propose_product_change and apply_change when not read-only", async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [...READ_TOOLS, "apply_change", "propose_product_change"].sort(),
    );
    const propose = tools.find((t) => t.name === "propose_product_change")!;
    const apply = tools.find((t) => t.name === "apply_change")!;
    expect(propose.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(apply.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
  });

  it("registers no write tools in read-only mode", async () => {
    testConfig.readOnly = true;
    try {
      const { tools } = await (await connect()).listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(READ_TOOLS);
      expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    } finally {
      testConfig.readOnly = false;
    }
  });

  it("propose -> apply -> apply again is rejected", async () => {
    let product: any = rawProduct();
    store.get.mockImplementation(async () => ({ data: { ...product } }));
    store.put.mockImplementation(async (_e: string, body: any) => {
      product = { ...product, ...body };
      return { data: { ...product } };
    });
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = await connect();

    const proposed: any = await client.callTool({
      name: "propose_product_change",
      arguments: { product_id: 10, sale_price: "15.00" },
    });
    expect(proposed.isError).toBeFalsy();
    const { change_id } = JSON.parse(text(proposed));
    expect(store.put).not.toHaveBeenCalled();

    const applied: any = await client.callTool({ name: "apply_change", arguments: { change_id } });
    expect(applied.isError).toBeFalsy();
    expect(JSON.parse(text(applied))).toMatchObject({ applied: true, product: { sale_price: "15.00" } });

    const again: any = await client.callTool({ name: "apply_change", arguments: { change_id } });
    expect(again.isError).toBe(true);
    expect(text(again)).toMatch(/Unknown or already used change_id/);
    expect(store.put).toHaveBeenCalledTimes(1);
    stderr.mockRestore();
  });

  it("returns a business-rule block as a friendly error", async () => {
    store.get.mockResolvedValue({ data: rawProduct() });
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const r: any = await (await connect()).callTool({
      name: "propose_product_change",
      arguments: { product_id: 10, regular_price: "4.00" },
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/^Blocked: a regular price change of 80\.0%/);
    stderr.mockRestore();
  });
});
