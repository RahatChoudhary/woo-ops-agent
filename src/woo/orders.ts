import { z } from "zod";
import { getClient } from "./client.js";

// Raw zod shape (plain object of fields) so registerTool can use it directly.
export const listOrdersInput = {
  status: z.enum(["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"]).optional(),
  limit: z.number().int().min(1).max(100).default(20),
};

export async function listOrders(status?: string, limit = 20) {
  const params: Record<string, unknown> = { per_page: limit };
  if (status) params.status = status;
  const res = await getClient().get("orders", params);
  return res.data.map((o: any) => ({
    id: o.id,
    status: o.status,
    total: `${o.total} ${o.currency}`,
    customer: `${o.billing.first_name} ${o.billing.last_name}`.trim(),
    created: o.date_created,
    items: o.line_items.map((i: any) => `${i.quantity} x ${i.name}`),
  }));
}

export async function getOrder(id: number) {
  const { data: o } = await getClient().get(`orders/${id}`);
  return {
    id: o.id,
    status: o.status,
    total: `${o.total} ${o.currency}`,
    customer: `${o.billing.first_name} ${o.billing.last_name}`.trim(),
    email: o.billing.email,
    created: o.date_created,
    payment: o.payment_method_title,
    items: o.line_items.map((i: any) => ({ name: i.name, qty: i.quantity, total: i.total })),
    customer_note: o.customer_note,
  };
}
