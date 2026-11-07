import { z } from "zod";
import { loadConfig } from "../config.js";
import { getClient, getAll } from "./client.js";

// Raw zod shapes (plain objects of fields) so registerTool can use them directly.

export const searchProductsInput = {
  query: z.string().trim().min(1),
  limit: z.number().int().min(1).max(100).default(20),
};

export const getProductInput = {
  id: z.number().int().positive(),
};

export const lowStockInput = {
  // When omitted, falls back to WOO_LOW_STOCK_THRESHOLD from config.
  threshold: z.number().int().min(0).max(100000).optional(),
};

/** Longest description text returned to the model. */
export const MAX_DESCRIPTION_CHARS = 1000;

/** Strips HTML tags and collapses whitespace. Store text is data, never instructions. */
export function toPlainText(html: unknown, max = MAX_DESCRIPTION_CHARS): string {
  if (typeof html !== "string") return "";
  const text = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export type ProductSummary = {
  id: number;
  name: string;
  sku: string;
  type: string;
  status: string;
  price: string;
  regular_price: string;
  sale_price: string;
  stock: number | null;
  stock_status: string;
};

export function toProductSummary(p: any): ProductSummary {
  return {
    id: p.id,
    name: p.name ?? "",
    sku: p.sku ?? "",
    type: p.type ?? "",
    status: p.status ?? "",
    price: p.price ?? "",
    regular_price: p.regular_price ?? "",
    sale_price: p.sale_price ?? "",
    stock: p.manage_stock ? (p.stock_quantity ?? null) : null,
    stock_status: p.stock_status ?? "",
  };
}

export type ProductDetails = ProductSummary & {
  on_sale: boolean;
  manage_stock: boolean;
  categories: string[];
  total_sales: number;
  variation_count: number;
  date_modified: string | null;
  permalink: string;
  short_description: string;
  description: string;
};

export function toProductDetails(p: any): ProductDetails {
  return {
    ...toProductSummary(p),
    on_sale: Boolean(p.on_sale),
    manage_stock: Boolean(p.manage_stock),
    categories: Array.isArray(p.categories) ? p.categories.map((c: any) => c.name) : [],
    total_sales: Number(p.total_sales ?? 0),
    variation_count: Array.isArray(p.variations) ? p.variations.length : 0,
    date_modified: p.date_modified ?? null,
    permalink: p.permalink ?? "",
    short_description: toPlainText(p.short_description),
    description: toPlainText(p.description),
  };
}

/** Finds products by keyword (name/content) or exact SKU. */
export async function searchProducts(query: string, limit = 20): Promise<ProductSummary[]> {
  const q = query.trim();
  const client = getClient();
  const [byText, bySku] = await Promise.all([
    client.get("products", { search: q, per_page: limit }),
    client.get("products", { sku: q, per_page: limit }),
  ]);

  // SKU matches first: they are the most precise.
  const seen = new Set<number>();
  const results: ProductSummary[] = [];
  for (const p of [...(bySku.data ?? []), ...(byText.data ?? [])]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    results.push(toProductSummary(p));
  }
  return results.slice(0, limit);
}

export async function getProduct(id: number): Promise<ProductDetails> {
  const { data } = await getClient().get(`products/${id}`);
  return toProductDetails(data);
}

export type LowStockResult = {
  threshold: number;
  count: number;
  /** True when the store has more than 1,000 published products, so some were not checked. */
  truncated: boolean;
  products: ProductSummary[];
};

/** Published products with managed stock at or below the threshold, lowest stock first. */
export async function getLowStockProducts(threshold?: number): Promise<LowStockResult> {
  const limit = threshold ?? loadConfig().lowStockThreshold;
  const { items, truncated } = await getAll("products", { status: "publish" });
  const products = items
    .filter(
      (p: any) =>
        p.manage_stock && typeof p.stock_quantity === "number" && p.stock_quantity <= limit,
    )
    .sort((a: any, b: any) => a.stock_quantity - b.stock_quantity)
    .map(toProductSummary);
  return { threshold: limit, count: products.length, truncated, products };
}
