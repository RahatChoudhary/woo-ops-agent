import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoPII, page, rawCustomer, rawOrder } from "./fixtures.js";
import { routeGet, store, testConfig } from "./mock-store.js";

vi.mock("@woocommerce/woocommerce-rest-api", () => import("./mock-store.js").then((m) => m.moduleFactory()));
vi.mock("../../src/config.js", () => ({ loadConfig: () => testConfig }));

const { getCustomerByEmail } = await import("../../src/woo/customers.js");

beforeEach(() => {
  store.get.mockReset();
});

describe("getCustomerByEmail", () => {
  it("looks up by normalized email and derives stats from paid orders", async () => {
    routeGet({
      customers: () => page([rawCustomer()]),
      orders: () =>
        page([
          rawOrder({ id: 1, status: "completed", total: "10.50" }),
          rawOrder({ id: 2, status: "processing", total: "20.00" }),
          rawOrder({ id: 3, status: "failed", total: "99.00" }),
          rawOrder({ id: 4, status: "refunded", total: "5.00" }),
        ]),
    });
    const c = await getCustomerByEmail("  Ada@Example.com ");

    expect(store.get).toHaveBeenCalledWith("customers", { email: "ada@example.com", role: "all" });
    expect(store.get).toHaveBeenCalledWith("orders", { customer: 7, per_page: 100, page: 1 });
    expect(c).toEqual({
      id: 7,
      name: "Ada Lovelace",
      email: "ada@example.com",
      city: "London",
      created: "2025-01-15T12:00:00",
      orders_count: 4,
      total_spent: "30.50",
      stats_truncated: false,
    });
  });

  it("uses store-provided stats when present, without fetching orders", async () => {
    routeGet({ customers: () => page([rawCustomer({ orders_count: 3, total_spent: "120.00" })]) });
    const c = await getCustomerByEmail("ada@example.com");
    expect(c).toMatchObject({ orders_count: 3, total_spent: "120.00" });
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it("returns null when no customer matches", async () => {
    routeGet({ customers: () => page([]) });
    expect(await getCustomerByEmail("nobody@example.com")).toBeNull();
  });

  it("never returns phone, full address, username or metadata", async () => {
    routeGet({ customers: () => page([rawCustomer({ orders_count: 1, total_spent: "1.00" })]) });
    const c = await getCustomerByEmail("ada@example.com");
    expectNoPII(c, expect);
    const text = JSON.stringify(c);
    expect(text).not.toContain("username");
    expect(text).not.toContain("VIP");
    expect(text).not.toContain("gravatar");
  });
});
