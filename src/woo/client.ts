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

/** Hard cap on records fetched by getAll, to protect the store and the model's context. */
export const MAX_RECORDS = 1000;
export const PAGE_SIZE = 100;

export type GetAllResult<T = any> = {
  items: T[];
  /** True when the store has more records than MAX_RECORDS and the rest were not fetched. */
  truncated: boolean;
};

/**
 * Fetches every page of a list endpoint, stopping at the x-wp-totalpages header
 * (or an empty page), and never returns more than MAX_RECORDS records.
 */
export async function getAll<T = any>(
  endpoint: string,
  params: Record<string, unknown> = {},
): Promise<GetAllResult<T>> {
  const items: T[] = [];
  const maxPages = Math.ceil(MAX_RECORDS / PAGE_SIZE);
  let truncated = false;

  for (let page = 1; page <= maxPages; page++) {
    const res = await getClient().get(endpoint, { ...params, per_page: PAGE_SIZE, page });
    const data: T[] = Array.isArray(res?.data) ? res.data : [];
    items.push(...data);

    const totalPages = Number(res?.headers?.["x-wp-totalpages"] ?? 1) || 1;
    if (data.length === 0 || page >= totalPages) break;
    if (page === maxPages) truncated = true; // more pages exist beyond the cap
  }

  if (items.length > MAX_RECORDS) {
    items.length = MAX_RECORDS;
    truncated = true;
  }
  return { items, truncated };
}
