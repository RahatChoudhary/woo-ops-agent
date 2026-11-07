import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { store, testConfig } from "../woo/mock-store.js";

vi.mock("@woocommerce/woocommerce-rest-api", () => import("../woo/mock-store.js").then((m) => m.moduleFactory()));
vi.mock("../../src/config.js", () => ({ loadConfig: () => testConfig }));

const { createServer } = await import("../../src/mcp/server.js");
const { MESSAGES } = await import("../../src/errors.js");

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

  it("registers exactly the six read tools, all read-only", async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_customer",
      "get_low_stock_products",
      "get_order",
      "get_product",
      "list_orders",
      "search_products",
    ]);
    for (const t of tools) {
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
