import { z } from "zod";
import { getAll, getClient } from "./client.js";

// Raw zod shape (plain object of fields) so registerTool can use it directly.
export const getCustomerInput = {
  email: z.string().trim().email(),
};

/** Statuses WooCommerce treats as paid (wc_get_is_paid_statuses). */
const PAID_STATUSES = new Set(["processing", "completed"]);

// Rule 7: name, email, city and order stats only. No address, phone or payment details.
export type Customer = {
  id: number;
  name: string;
  email: string;
  city: string;
  created: string;
  orders_count: number;
  total_spent: string;
  /** True when the customer has more than 1,000 orders, so the stats are partial. */
  stats_truncated: boolean;
};

export function toCustomer(
  c: any,
  stats: { orders_count: number; total_spent: string; truncated?: boolean },
): Customer {
  return {
    id: c.id,
    name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
    email: c.email ?? "",
    city: c.billing?.city ?? "",
    created: c.date_created ?? "",
    orders_count: stats.orders_count,
    total_spent: stats.total_spent,
    stats_truncated: stats.truncated ?? false,
  };
}

/**
 * Order count and total spent. The wc/v3 customer response no longer includes these,
 * so use them when present and otherwise derive them from the customer's orders.
 */
async function customerStats(c: any) {
  if (c.orders_count !== undefined && c.total_spent !== undefined) {
    return { orders_count: Number(c.orders_count), total_spent: String(c.total_spent) };
  }
  const { items, truncated } = await getAll("orders", { customer: c.id });
  const spent = items
    .filter((o: any) => PAID_STATUSES.has(o.status))
    .reduce((sum: number, o: any) => sum + (Number(o.total) || 0), 0);
  return { orders_count: items.length, total_spent: spent.toFixed(2), truncated };
}

/** Looks up a registered customer by exact email. Returns null when there is none. */
export async function getCustomerByEmail(email: string): Promise<Customer | null> {
  const res = await getClient().get("customers", { email: email.trim().toLowerCase(), role: "all" });
  const c = (res.data ?? [])[0];
  if (!c) return null;
  return toCustomer(c, await customerStats(c));
}
