import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, rawProduct } from "./fixtures.js";
import { routeGet, store, testConfig } from "./mock-store.js";

vi.mock("@woocommerce/woocommerce-rest-api", () => import("./mock-store.js").then((m) => m.moduleFactory()));
vi.mock("../../src/config.js", () => ({ loadConfig: () => testConfig }));

const { getLowStockProducts, getProduct, searchProducts, toPlainText } = await import(
  "../../src/woo/products.js"
);

beforeEach(() => {
  store.get.mockReset();
});

describe("searchProducts", () => {
  it("returns trimmed summaries and searches by keyword and SKU", async () => {
    routeGet({
      products: (p) =>
        p.sku ? page([rawProduct({ id: 11, name: "Hoodie", sku: p.sku })]) : page([rawProduct()]),
    });
    const result = await searchProducts("  HOOD-1 ", 5);

    expect(store.get).toHaveBeenCalledWith("products", { search: "HOOD-1", per_page: 5 });
    expect(store.get).toHaveBeenCalledWith("products", { sku: "HOOD-1", per_page: 5 });
    expect(result.map((p) => p.id)).toEqual([11, 10]); // SKU match first
    expect(result[1]).toEqual({
      id: 10,
      name: "Beanie",
      sku: "BEANIE-1",
      type: "simple",
      status: "publish",
      price: "18.00",
      regular_price: "20.00",
      sale_price: "18.00",
      stock: 3,
      stock_status: "instock",
    });
  });

  it("de-duplicates a product found by both keyword and SKU", async () => {
    routeGet({ products: () => page([rawProduct()]) });
    expect(await searchProducts("BEANIE-1")).toHaveLength(1);
  });

  it("reports stock as null when stock is not managed", async () => {
    routeGet({ products: (p) => page(p.sku ? [] : [rawProduct({ manage_stock: false, stock_quantity: 99 })]) });
    expect((await searchProducts("beanie"))[0].stock).toBeNull();
  });
});

describe("getProduct", () => {
  it("maps details, plain-text descriptions and drops internal fields", async () => {
    routeGet({ "products/10": () => ({ data: rawProduct() }) });
    const p = await getProduct(10);

    expect(p).toMatchObject({
      id: 10,
      on_sale: true,
      manage_stock: true,
      categories: ["Accessories"],
      total_sales: 42,
      variation_count: 0,
      short_description: "Wool beanie",
      description: "Warm & cosy beanie.",
    });
    const text = JSON.stringify(p);
    expect(text).not.toContain("meta_data");
    expect(text).not.toContain("_supplier_cost");
    expect(text).not.toContain("<script>");
  });

  it("caps long descriptions", () => {
    expect(toPlainText("x".repeat(5000))).toHaveLength(1001);
  });
});

describe("getLowStockProducts", () => {
  it("filters managed stock at or below the threshold, lowest first", async () => {
    routeGet({
      products: () =>
        page([
          rawProduct({ id: 1, stock_quantity: 5 }),
          rawProduct({ id: 2, stock_quantity: 6 }),
          rawProduct({ id: 3, stock_quantity: 0 }),
          rawProduct({ id: 4, manage_stock: false, stock_quantity: null }),
          rawProduct({ id: 5, stock_quantity: null }),
          rawProduct({ id: 6, stock_quantity: -2 }),
        ]),
    });
    const r = await getLowStockProducts(5);

    expect(r.products.map((p) => p.id)).toEqual([6, 3, 1]);
    expect(r).toMatchObject({ threshold: 5, count: 3, truncated: false });
    expect(store.get).toHaveBeenCalledWith("products", { status: "publish", per_page: 100, page: 1 });
  });

  it("defaults to WOO_LOW_STOCK_THRESHOLD from config", async () => {
    routeGet({ products: () => page([rawProduct({ stock_quantity: 5 }), rawProduct({ id: 2, stock_quantity: 6 })]) });
    const r = await getLowStockProducts();
    expect(r.threshold).toBe(testConfig.lowStockThreshold);
    expect(r.count).toBe(1);
  });

  it("reads every page and flags when the 1,000-record cap is hit", async () => {
    routeGet({
      products: (p) =>
        page(
          Array.from({ length: 100 }, (_, i) => rawProduct({ id: (p.page - 1) * 100 + i + 1, stock_quantity: 1 })),
          12,
        ),
    });
    const r = await getLowStockProducts(5);
    expect(store.get).toHaveBeenCalledTimes(10);
    expect(r.count).toBe(1000);
    expect(r.truncated).toBe(true);
  });
});
