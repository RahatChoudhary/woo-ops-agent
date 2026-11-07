import { vi } from "vitest";

// Shared fake for the WooCommerce REST client. Test files wire it in with:
//   vi.mock("@woocommerce/woocommerce-rest-api", () => import("./mock-store.js").then((m) => m.moduleFactory()))
// so the real src/woo/client.ts (getClient, getAll) runs, but never touches the network.
export const store = {
  get: vi.fn(),
  put: vi.fn(),
};

export function moduleFactory() {
  class FakeWooCommerceRestApi {
    get = store.get;
    put = store.put;
  }
  return { default: FakeWooCommerceRestApi };
}

export const testConfig = {
  wcUrl: "https://shop.example.com",
  wcKey: "ck_test",
  wcSecret: "cs_test",
  readOnly: false,
  maxPriceChangePct: 50,
  lowStockThreshold: 5,
  queryStringAuth: false,
  timeoutMs: 15000,
  auditLogPath: "/tmp/never-written.jsonl",
};

/** Routes GET calls by endpoint. Unrouted calls fail loudly. */
export function routeGet(routes: Record<string, (params: any) => unknown>) {
  store.get.mockImplementation(async (endpoint: string, params: any = {}) => {
    const handler = routes[endpoint];
    if (!handler) throw new Error(`Unexpected GET ${endpoint}`);
    return handler(params);
  });
}
