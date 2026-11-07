import { z } from "zod";
import { wc, getAll } from "./client.js";

// Raw zod shapes (plain objects of fields) so registerTool can use them directly.
const price = z.string().regex(/^\d+(\.\d{1,2})?$/, "Price must look like 19.99");

export const searchProductsInput = {
  query: z.string().min(1),
};

export const lowStockInput = {
  threshold: z.number().int().min(0).max(1000).default(5),
};

export const updatePriceInput = {
  id: z.number().int().positive(),
  regular_price: price,
  sale_price: price.optional(),
};

export const updateStockInput = {
  id: z.number().int().positive(),
  quantity: z.number().int().min(0).max(100000),
};

export async function getLowStockProducts(threshold = 5) {
  const products = await getAll("products", { status: "publish" });
  return products
  .filter((p: any) => p.manage_stock && p.stock_quantity !== null && p.stock_quantity <= threshold)
  .map((p: any) => ({ id: p.id, name: p.name, sku: p.sku, stock: p.stock_quantity, price: p.price }));
}

export async function searchProducts(query: string) {
  const res = await wc.get("products", { search: query, per_page: 20 });
  return res.data.map((p: any) => ({
    id: p.id, name: p.name, sku: p.sku, price: p.price,
    regular_price: p.regular_price, sale_price: p.sale_price, stock: p.stock_quantity, status: p.status,
  }));
}

// Internal write helpers. Never expose these as tools directly:
// they are only called by apply_change (T5) after propose/approve.
export async function updateProductPrice(id: number, regularPrice: string, salePrice?: string) {
  const body: Record<string, string> = { regular_price: regularPrice };
  if (salePrice !== undefined) body.sale_price = salePrice;
  const res = await wc.put(`products/${id}`, body);
  const p = res.data;
  return { id: p.id, name: p.name, regular_price: p.regular_price, sale_price: p.sale_price };
}

export async function updateStock(id: number, quantity: number) {
  const res = await wc.put(`products/${id}`, { manage_stock: true, stock_quantity: quantity });
  return { id: res.data.id, name: res.data.name, stock: res.data.stock_quantity };
}
