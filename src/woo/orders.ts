import { z } from "zod";
import { getClient } from "./client.js";

export const ORDER_STATUSES = [
  "pending",
  "processing",
  "on-hold",
  "completed",
  "cancelled",
  "refunded",
  "failed",
] as const;

// YYYY-MM-DD, or an ISO 8601 date-time with optional seconds, fraction and offset.
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

const isoDate = z
  .string()
  .trim()
  .refine((v) => DATE_RE.test(v) && !Number.isNaN(Date.parse(v)), {
    message: "Date must look like 2026-01-31 or 2026-01-31T14:00:00",
  });

// Raw zod shapes (plain objects of fields) so registerTool can use them directly.
export const listOrdersInput = {
  status: z.enum(ORDER_STATUSES).optional(),
  after: isoDate.optional(),
  before: isoDate.optional(),
  limit: z.number().int().min(1).max(100).default(20),
};

export const getOrderInput = {
  id: z.number().int().positive(),
};

export type ListOrdersOptions = {
  status?: (typeof ORDER_STATUSES)[number];
  after?: string;
  before?: string;
  limit?: number;
};

/** WooCommerce wants a full date-time; a bare date means the start of that day. */
export function toWooDate(value: string): string {
  const v = value.trim();
  if (!DATE_RE.test(v) || Number.isNaN(Date.parse(v))) {
    throw new Error(`Invalid date "${v}". Use a date like 2026-01-31 or 2026-01-31T14:00:00.`);
  }
  return v.length === 10 ? `${v}T00:00:00` : v;
}

function customerName(o: any): string {
  return `${o.billing?.first_name ?? ""} ${o.billing?.last_name ?? ""}`.trim();
}

export type OrderSummary = {
  id: number;
  number: string;
  status: string;
  total: string;
  currency: string;
  created: string;
  customer: string;
  items: string[];
};

export function toOrderSummary(o: any): OrderSummary {
  return {
    id: o.id,
    number: String(o.number ?? o.id),
    status: o.status ?? "",
    total: o.total ?? "",
    currency: o.currency ?? "",
    created: o.date_created ?? "",
    customer: customerName(o),
    items: (o.line_items ?? []).map((i: any) => `${i.quantity} x ${i.name}`),
  };
}

export type OrderDetails = Omit<OrderSummary, "customer" | "items"> & {
  // Rule 7: name, email and city only. No street address, postcode, phone or payment details.
  customer: { id: number | null; name: string; email: string; city: string };
  discount_total: string;
  shipping_total: string;
  total_tax: string;
  payment_method: string;
  date_paid: string | null;
  date_completed: string | null;
  shipping_methods: string[];
  items: { product_id: number; name: string; sku: string; quantity: number; total: string }[];
  customer_note: string;
};

export function toOrderDetails(o: any): OrderDetails {
  const items = (o.line_items ?? []).map((i: any) => ({
    product_id: i.product_id,
    name: i.name ?? "",
    sku: i.sku ?? "",
    quantity: i.quantity,
    total: i.total ?? "",
  }));

  return {
    ...toOrderSummary(o),
    customer: {
      id: o.customer_id ? o.customer_id : null,
      name: customerName(o),
      email: o.billing?.email ?? "",
      city: o.billing?.city ?? "",
    },
    discount_total: o.discount_total ?? "",
    shipping_total: o.shipping_total ?? "",
    total_tax: o.total_tax ?? "",
    payment_method: o.payment_method_title ?? "",
    date_paid: o.date_paid ?? null,
    date_completed: o.date_completed ?? null,
    shipping_methods: (o.shipping_lines ?? []).map((s: any) => s.method_title),
    items,
    customer_note: o.customer_note ?? "",
  };
}

/** Recent orders, newest first, optionally filtered by status and a date range. */
export async function listOrders(options: ListOrdersOptions = {}): Promise<OrderSummary[]> {
  const params: Record<string, unknown> = {
    per_page: options.limit ?? 20,
    orderby: "date",
    order: "desc",
  };
  if (options.status) params.status = options.status;
  if (options.after) params.after = toWooDate(options.after);
  if (options.before) params.before = toWooDate(options.before);
  if (params.after && params.before && Date.parse(String(params.after)) >= Date.parse(String(params.before))) {
    throw new Error("The 'after' date must be earlier than the 'before' date.");
  }

  const res = await getClient().get("orders", params);
  return (res.data ?? []).map(toOrderSummary);
}

export async function getOrder(id: number): Promise<OrderDetails> {
  const { data } = await getClient().get(`orders/${id}`);
  return toOrderDetails(data);
}
