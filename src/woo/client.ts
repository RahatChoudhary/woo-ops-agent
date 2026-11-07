import WooCommerceRestApiPkg from "@woocommerce/woocommerce-rest-api";
import { loadConfig, type Config } from "../config.js";

// CommonJS package: under ESM the class sits on .default
const WooCommerceRestApi = (WooCommerceRestApiPkg as any).default ?? WooCommerceRestApiPkg;

export type WooClient = {
  get(endpoint: string, params?: Record<string, unknown>): Promise<any>;
  put(endpoint: string, data: Record<string, unknown>): Promise<any>;
};

export function createClient(config: Config): WooClient {
  return new WooCommerceRestApi({
    url: config.wcUrl,
    consumerKey: config.wcKey,
    consumerSecret: config.wcSecret,
    version: "wc/v3",
    timeout: config.timeoutMs,
    queryStringAuth: config.queryStringAuth,
  });
}

let client: WooClient | undefined;

/** Lazily creates the client from env config, so importing this module has no side effects. */
export function getClient(): WooClient {
  client ??= createClient(loadConfig());
  return client;
}

export async function getAll(endpoint: string, params: Record<string, unknown> = {}) {
  const all: any[] = [];
  for (let page = 1; page <= 10; page++) { // safety cap: 1,000 records
    const res = await getClient().get(endpoint, { ...params, per_page: 100, page });
    all.push(...res.data);
    const totalPages = Number(res.headers["x-wp-totalpages"] ?? 1);
    if (page >= totalPages) break;
  }
  return all;
}
