import { z } from "zod";
import { getClient } from "./client.js";

// Raw zod shape (plain object of fields) so registerTool can use it directly.
export const getCustomerInput = {
  email: z.string().email(),
};

export async function getCustomerByEmail(email: string) {
  const res = await getClient().get("customers", { email });
  return res.data.map((c: any) => ({
    id: c.id, name: `${c.first_name} ${c.last_name}`.trim(), email: c.email,
    city: c.billing?.city, orders_count: c.orders_count, total_spent: c.total_spent,
  }));
}
