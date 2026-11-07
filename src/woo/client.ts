import WooCommerceRestApiPkg from "@woocommerce/woocommerce-rest-api";

// CommonJS package: under ESM the class sits on .default
const WooCommerceRestApi = (WooCommerceRestApiPkg as any).default ?? WooCommerceRestApiPkg;

// Env is read directly for now; T2 moves this to src/config.ts.
export const wc = new WooCommerceRestApi({
  url: process.env.WC_URL!,
  consumerKey: process.env.WC_KEY!,
  consumerSecret: process.env.WC_SECRET!,
  version: "wc/v3",
});

export async function getAll(endpoint: string, params: Record<string, unknown> = {}) {
  const all: any[] = [];
  for (let page = 1; page <= 10; page++) { // safety cap: 1,000 records
    const res = await wc.get(endpoint, { ...params, per_page: 100, page });
    all.push(...res.data);
    const totalPages = Number(res.headers["x-wp-totalpages"] ?? 1);
    if (page >= totalPages) break;
  }
  return all;
}
