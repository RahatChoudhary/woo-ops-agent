import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "./fixtures.js";
import { store, testConfig } from "./mock-store.js";

vi.mock("@woocommerce/woocommerce-rest-api", () => import("./mock-store.js").then((m) => m.moduleFactory()));
vi.mock("../../src/config.js", () => ({ loadConfig: () => testConfig }));

const { getAll, MAX_RECORDS } = await import("../../src/woo/client.js");

const records = (n: number, start = 0) => Array.from({ length: n }, (_, i) => ({ id: start + i + 1 }));

describe("getAll", () => {
  beforeEach(() => {
    store.get.mockReset();
  });

  it("stops at x-wp-totalpages", async () => {
    store.get.mockImplementation(async (_e: string, p: any) => page(records(100, (p.page - 1) * 100), 3));
    const { items, truncated } = await getAll("products", { status: "publish" });

    expect(store.get).toHaveBeenCalledTimes(3);
    expect(items).toHaveLength(300);
    expect(truncated).toBe(false);
    expect(store.get.mock.calls.map((c) => c[1])).toEqual([
      { status: "publish", per_page: 100, page: 1 },
      { status: "publish", per_page: 100, page: 2 },
      { status: "publish", per_page: 100, page: 3 },
    ]);
  });

  it("makes one request when everything fits on one page", async () => {
    store.get.mockResolvedValue(page(records(7), 1));
    const { items } = await getAll("orders");
    expect(store.get).toHaveBeenCalledTimes(1);
    expect(items).toHaveLength(7);
  });

  it("treats a missing header as a single page", async () => {
    store.get.mockResolvedValue({ data: records(5), headers: {} });
    await getAll("orders");
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it("stops on an empty page even if the header says more", async () => {
    store.get
      .mockResolvedValueOnce(page(records(100), 5))
      .mockResolvedValueOnce(page([], 5));
    const { items } = await getAll("orders");
    expect(store.get).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(100);
  });

  it(`caps results at ${MAX_RECORDS} records and flags truncation`, async () => {
    store.get.mockImplementation(async (_e: string, p: any) => page(records(100, (p.page - 1) * 100), 25, 2500));
    const { items, truncated } = await getAll("products");

    expect(MAX_RECORDS).toBe(1000);
    expect(store.get).toHaveBeenCalledTimes(10);
    expect(items).toHaveLength(1000);
    expect(truncated).toBe(true);
  });

  it("is not truncated when the store has exactly 1,000 records", async () => {
    store.get.mockImplementation(async (_e: string, p: any) => page(records(100, (p.page - 1) * 100), 10));
    const { items, truncated } = await getAll("products");
    expect(items).toHaveLength(1000);
    expect(truncated).toBe(false);
  });

  it("never returns more than the cap even if a page is oversized", async () => {
    store.get.mockImplementation(async (_e: string, p: any) => page(records(150, (p.page - 1) * 150), 10));
    const { items, truncated } = await getAll("products");
    expect(items).toHaveLength(1000);
    expect(truncated).toBe(true);
  });
});
