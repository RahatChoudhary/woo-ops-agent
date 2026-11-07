import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { describeForLog, toFriendlyMessage } from "../errors.js";
import { getClient } from "../woo/client.js";
import { ORDER_STATUSES } from "../woo/orders.js";
import { getLowStockProducts } from "../woo/products.js";

export const SUMMARY_URI = "store://summary";

export type StoreSummary = {
  generated_at: string;
  products: {
    /** Published products in the store. */
    published: number;
    /** Published products with managed stock at or below the threshold. */
    low_stock: number;
    low_stock_threshold: number;
    /** True when the store has more than 1,000 published products, so some were not checked for low stock. */
    low_stock_truncated: boolean;
  };
  orders: {
    total: number;
    /** Every standard status is present (0 when empty); custom statuses from plugins are included too. */
    by_status: Record<string, number>;
  };
};

/**
 * Turns WooCommerce's order totals report ([{ slug, total }, ...]) into a count per status.
 * Standard statuses always appear, slugs are normalised (lowercase, no "wc-" prefix),
 * duplicates are summed and rows without a usable slug or count are ignored.
 */
export function groupOrdersByStatus(rows: unknown): { total: number; by_status: Record<string, number> } {
  const by_status: Record<string, number> = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));
  for (const row of Array.isArray(rows) ? rows : []) {
    const slug = typeof row?.slug === "string" ? row.slug.trim().toLowerCase().replace(/^wc-/, "") : "";
    const count = Number(row?.total);
    if (!slug || !Number.isFinite(count) || count < 0) continue;
    by_status[slug] = (by_status[slug] ?? 0) + Math.trunc(count);
  }
  const total = Object.values(by_status).reduce((sum, n) => sum + n, 0);
  return { total, by_status };
}

/** Live counts of products, low-stock products and orders by status. Reads only. */
export async function getStoreSummary(): Promise<StoreSummary> {
  const client = getClient();
  const [orderTotals, publishedPage, lowStock] = await Promise.all([
    client.get("reports/orders/totals"),
    // One record per page: we only need the x-wp-total header.
    client.get("products", { status: "publish", per_page: 1 }),
    getLowStockProducts(),
  ]);

  return {
    generated_at: new Date().toISOString(),
    products: {
      published: Number(publishedPage?.headers?.["x-wp-total"] ?? 0) || 0,
      low_stock: lowStock.count,
      low_stock_threshold: lowStock.threshold,
      low_stock_truncated: lowStock.truncated,
    },
    orders: groupOrdersByStatus(orderTotals?.data),
  };
}

export function registerResources(server: McpServer): void {
  server.registerResource(
    "store-summary",
    SUMMARY_URI,
    {
      title: "Store summary",
      description:
        "Live counts for the store: published products, low-stock products (at or below the configured threshold) " +
        "and orders by status. Read this for a quick overview before a report.",
      mimeType: "application/json",
    },
    async (uri): Promise<ReadResourceResult> => {
      try {
        const summary = await getStoreSummary();
        return {
          contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(summary, null, 2) }],
        };
      } catch (err) {
        // Resource errors go back to the client as-is, so never rethrow the raw error:
        // axios errors carry the request config, including the API keys.
        console.error(`[woo-ops-mcp] ${SUMMARY_URI} failed: ${describeForLog(err)}`);
        throw new Error(toFriendlyMessage(err));
      }
    },
  );
}
