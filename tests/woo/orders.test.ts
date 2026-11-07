import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoPII, page, rawOrder } from "./fixtures.js";
import { routeGet, store, testConfig } from "./mock-store.js";

vi.mock("@woocommerce/woocommerce-rest-api", () => import("./mock-store.js").then((m) => m.moduleFactory()));
vi.mock("../../src/config.js", () => ({ loadConfig: () => testConfig }));

const { getOrder, listOrders, listOrdersInput, toWooDate } = await import("../../src/woo/orders.js");
const { z } = await import("zod");

beforeEach(() => {
  store.get.mockReset();
});

describe("listOrders", () => {
  it("maps trimmed summaries", async () => {
    routeGet({ orders: () => page([rawOrder()]) });
    expect(await listOrders()).toEqual([
      {
        id: 501,
        number: "501",
        status: "processing",
        total: "38.00",
        currency: "GBP",
        created: "2026-11-07T09:30:00",
        customer: "Ada Lovelace",
        items: ["2 x Beanie"],
      },
    ]);
  });

  it("passes status, date range and limit to the store", async () => {
    routeGet({ orders: () => page([]) });
    await listOrders({ status: "failed", after: "2026-11-01", before: "2026-11-08T12:00:00Z", limit: 5 });
    expect(store.get).toHaveBeenCalledWith("orders", {
      per_page: 5,
      orderby: "date",
      order: "desc",
      status: "failed",
      after: "2026-11-01T00:00:00",
      before: "2026-11-08T12:00:00Z",
    });
  });

  it("omits filters that were not given", async () => {
    routeGet({ orders: () => page([]) });
    await listOrders();
    expect(store.get).toHaveBeenCalledWith("orders", { per_page: 20, orderby: "date", order: "desc" });
  });

  it("rejects an after date that is not before the before date, without calling the store", async () => {
    await expect(listOrders({ after: "2026-11-08", before: "2026-11-01" })).rejects.toThrow(/earlier/);
    expect(store.get).not.toHaveBeenCalled();
  });

  it("contains no personal fields", async () => {
    routeGet({ orders: () => page([rawOrder(), rawOrder({ id: 502 })]) });
    expectNoPII(await listOrders(), expect);
    expect(JSON.stringify(await listOrders())).not.toContain("ada@example.com");
  });
});

describe("date input", () => {
  const schema = z.object(listOrdersInput);
  it("accepts dates and date-times", () => {
    for (const d of ["2026-01-31", "2026-01-31T14:00", "2026-01-31T14:00:00Z", "2026-01-31T14:00:00+05:00"]) {
      expect(schema.safeParse({ after: d }).success).toBe(true);
    }
  });
  it("rejects anything else", () => {
    for (const d of ["yesterday", "31/01/2026", "2026-13-45", ""]) {
      expect(schema.safeParse({ after: d }).success).toBe(false);
    }
    expect(() => toWooDate("last week")).toThrow(/Invalid date/);
  });
});

describe("getOrder", () => {
  it("maps details with only name, email and city for the customer", async () => {
    routeGet({ "orders/501": () => ({ data: rawOrder() }) });
    const o = await getOrder(501);

    expect(o).toMatchObject({
      id: 501,
      status: "processing",
      total: "38.00",
      currency: "GBP",
      discount_total: "2.00",
      shipping_total: "4.00",
      payment_method: "Credit card",
      date_paid: "2026-11-07T09:31:00",
      shipping_methods: ["Flat rate"],
      items: [{ product_id: 10, name: "Beanie", sku: "BEANIE-1", quantity: 2, total: "36.00" }],
      customer_note: "Leave at the door",
    });
    expect(o.customer).toEqual({ id: 7, name: "Ada Lovelace", email: "ada@example.com", city: "London" });
  });

  it("never returns phone, full address, IP, transaction id or metadata", async () => {
    routeGet({ "orders/501": () => ({ data: rawOrder() }) });
    const o = await getOrder(501);
    expectNoPII(o, expect);
    expect(JSON.stringify(o)).not.toContain("cus_SECRET");
  });

  it("handles guest orders and missing billing data", async () => {
    routeGet({ "orders/9": () => ({ data: rawOrder({ id: 9, customer_id: 0, billing: undefined }) }) });
    expect((await getOrder(9)).customer).toEqual({ id: null, name: "", email: "", city: "" });
  });
});
