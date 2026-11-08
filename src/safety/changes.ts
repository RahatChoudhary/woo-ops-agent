import { randomUUID } from "node:crypto";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { describeForLog, UserError } from "../errors.js";
import { getClient } from "../woo/client.js";
import { appendAudit, type AuditEntry, type FieldChange } from "./audit.js";

// Two-step changes: propose (preview, writes nothing to the store) then apply (one-time id).
// Every business rule lives here in code; tool descriptions and the skill only explain them.

/** How long a proposal can be applied. */
export const CHANGE_TTL_MS = 10 * 60 * 1000;
/** Largest number of proposals waiting at once, so a runaway client can't grow memory. */
export const MAX_PENDING = 100;
export const MAX_STOCK = 100_000;

const priceString = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "must look like 19.99");

export const proposeChangeInput = {
  product_id: z.number().int().positive(),
  regular_price: priceString.optional(),
  /** "" removes the sale price (ends the sale). */
  sale_price: z.union([priceString, z.literal("")]).optional(),
  stock_quantity: z.number().int().min(0).max(MAX_STOCK).optional(),
};

export const applyChangeInput = {
  change_id: z.string().trim().min(1),
};

export type ProposeInput = {
  product_id: number;
  regular_price?: string;
  sale_price?: string;
  stock_quantity?: number;
};

type Snapshot = {
  regular_price: string;
  sale_price: string;
  manage_stock: boolean;
  stock_quantity: number | null;
};

type Patch = { regular_price?: string; sale_price?: string; stock_quantity?: number };

type PendingChange = {
  id: string;
  productId: number;
  productName: string;
  patch: Patch;
  changes: FieldChange[];
  before: Snapshot;
  createdAt: number;
};

export type ChangePreview = {
  change_id: string;
  expires_at: string;
  product: { id: number; name: string };
  changes: FieldChange[];
  notes: string[];
  message: string;
};

export type ApplyResult = {
  applied: true;
  change_id: string;
  product: {
    id: number;
    name: string;
    regular_price: string;
    sale_price: string;
    stock: number | null;
  };
  changes: FieldChange[];
  warning?: string;
};

export const CHANGE_MESSAGES = {
  nothingToChange: "Nothing to change: give at least one of regular_price, sale_price or stock_quantity.",
  noDifference: "Nothing would change: the product already has these values.",
  unknownId: "Unknown or already used change_id. Propose the change again to get a new preview.",
  expired: "This proposal expired (proposals last 10 minutes). Propose the change again to get a new preview.",
  stale:
    "The product was changed after the preview was made, so this change was not applied. " +
    "Propose the change again to see an up-to-date preview.",
  auditUnavailable:
    "The change was not made because the audit log could not be written. " +
    "Check that the WOO_AUDIT_LOG location is writable, then try again.",
  appliedAuditWarning:
    "The change was applied, but the audit log entry for it could not be written. " +
    "Check that the WOO_AUDIT_LOG location is writable.",
  tooManyPending: "Too many proposals are waiting. Apply or abandon some (they expire after 10 minutes) and try again.",
} as const;

const pending = new Map<string, PendingChange>();

/** Test helper: forgets all pending proposals. */
export function _resetPendingForTests(): void {
  pending.clear();
}

/** Converts a WooCommerce price string to whole cents; "" or missing becomes null. */
function toCents(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function snapshot(p: any): Snapshot {
  return {
    regular_price: p.regular_price ?? "",
    sale_price: p.sale_price ?? "",
    manage_stock: Boolean(p.manage_stock),
    stock_quantity: typeof p.stock_quantity === "number" ? p.stock_quantity : null,
  };
}

function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return (
    toCents(a.regular_price) === toCents(b.regular_price) &&
    toCents(a.sale_price) === toCents(b.sale_price) &&
    a.manage_stock === b.manage_stock &&
    a.stock_quantity === b.stock_quantity
  );
}

function pruneExpired(now: number): void {
  for (const [id, change] of pending) {
    if (now - change.createdAt > CHANGE_TTL_MS) pending.delete(id);
  }
}

/** Writes an audit entry when failure must not hide the real outcome (e.g. a blocked change). */
async function auditBestEffort(entry: AuditEntry): Promise<void> {
  try {
    await appendAudit(entry);
  } catch (err) {
    console.error(`[woo-ops-mcp] audit log write failed (${entry.event}): ${describeForLog(err)}`);
  }
}

/**
 * Checks every business rule and returns the field changes. Throws UserError when blocked.
 * Exported for direct testing.
 */
export function evaluateChange(product: any, input: ProposeInput, maxPriceChangePct: number) {
  const type = product.type ?? "simple";
  if (type === "variable") {
    throw new UserError(
      `Product ${product.id} is a variable product. Its prices and stock are set per variation, ` +
        "which this tool can't change. Edit its variations in WooCommerce admin (Products → edit the product → Variations).",
    );
  }
  if (type !== "simple") {
    throw new UserError(
      `Product ${product.id} is a ${type} product. Only simple products can be changed here; ` +
        "make this change in WooCommerce admin.",
    );
  }

  const before = snapshot(product);
  const changes: FieldChange[] = [];
  const notes: string[] = [];
  const patch: Patch = {};

  const oldRegular = toCents(before.regular_price);
  const oldSale = toCents(before.sale_price);

  if (input.regular_price !== undefined) {
    const newRegular = toCents(input.regular_price);
    if (newRegular === null || newRegular <= 0) {
      throw new UserError("Blocked: the regular price must be greater than 0.");
    }
    if (oldRegular !== null && oldRegular > 0) {
      // Integer cents avoid floating-point edge cases right at the limit.
      if (Math.abs(newRegular - oldRegular) * 100 > maxPriceChangePct * oldRegular) {
        const pct = ((Math.abs(newRegular - oldRegular) / oldRegular) * 100).toFixed(1);
        throw new UserError(
          `Blocked: a regular price change of ${pct}% is over the allowed limit of ${maxPriceChangePct}% ` +
            "(WOO_MAX_PRICE_CHANGE_PCT). If this is intended, make it in WooCommerce admin.",
        );
      }
    } else {
      notes.push("The product had no regular price, so the price-change limit could not be checked.");
    }
    if (newRegular !== oldRegular) {
      changes.push({ field: "regular_price", before: before.regular_price || null, after: input.regular_price });
      patch.regular_price = input.regular_price;
    }
  }

  if (input.sale_price !== undefined) {
    const newSale = toCents(input.sale_price);
    if (newSale !== oldSale) {
      changes.push({ field: "sale_price", before: before.sale_price || null, after: input.sale_price || null });
      patch.sale_price = input.sale_price;
      if (newSale === null) notes.push("This ends the sale.");
    }
  }

  // Sale price must stay below the regular price that will apply after this change.
  if (patch.regular_price !== undefined || patch.sale_price !== undefined) {
    const regularAfter = patch.regular_price !== undefined ? toCents(patch.regular_price) : oldRegular;
    const saleAfter = patch.sale_price !== undefined ? toCents(patch.sale_price) : oldSale;
    if (saleAfter !== null) {
      if (regularAfter === null || regularAfter <= 0) {
        throw new UserError("Blocked: a sale price needs a regular price. Set the regular price first.");
      }
      if (saleAfter >= regularAfter) {
        throw new UserError(
          `Blocked: the sale price (${(saleAfter / 100).toFixed(2)}) must be lower than the regular price ` +
            `(${(regularAfter / 100).toFixed(2)}).`,
        );
      }
      // The same limit caps the sale discount, so a sale can't do what a regular price cut can't (e.g. 0.01).
      if ((regularAfter - saleAfter) * 100 > maxPriceChangePct * regularAfter) {
        const pct = (((regularAfter - saleAfter) / regularAfter) * 100).toFixed(1);
        throw new UserError(
          `Blocked: a sale price of ${(saleAfter / 100).toFixed(2)} is ${pct}% below the regular price ` +
            `(${(regularAfter / 100).toFixed(2)}), over the allowed limit of ${maxPriceChangePct}% ` +
            "(WOO_MAX_PRICE_CHANGE_PCT). If this is intended, make it in WooCommerce admin.",
        );
      }
    }
  }

  if (input.stock_quantity !== undefined) {
    const qty = input.stock_quantity;
    if (!Number.isInteger(qty) || qty < 0 || qty > MAX_STOCK) {
      throw new UserError(`Blocked: stock must be a whole number from 0 to ${MAX_STOCK.toLocaleString("en-US")}.`);
    }
    const currentStock = before.manage_stock ? before.stock_quantity : null;
    if (!before.manage_stock || qty !== currentStock) {
      changes.push({ field: "stock_quantity", before: currentStock, after: qty });
      patch.stock_quantity = qty;
      if (!before.manage_stock) notes.push("Stock tracking is off for this product; applying will turn it on.");
    }
  }

  if (changes.length === 0) throw new UserError(CHANGE_MESSAGES.noDifference);
  return { before, changes, notes, patch };
}

/** Prepares a change and returns a preview with a one-time change_id. Never writes to the store. */
export async function proposeProductChange(input: ProposeInput): Promise<ChangePreview> {
  if (input.regular_price === undefined && input.sale_price === undefined && input.stock_quantity === undefined) {
    throw new UserError(CHANGE_MESSAGES.nothingToChange);
  }

  const now = Date.now();
  pruneExpired(now);
  if (pending.size >= MAX_PENDING) throw new UserError(CHANGE_MESSAGES.tooManyPending);

  const { data: product } = await getClient().get(`products/${input.product_id}`);
  const productName = String(product?.name ?? "");

  let evaluated: ReturnType<typeof evaluateChange>;
  try {
    evaluated = evaluateChange(product, input, loadConfig().maxPriceChangePct);
  } catch (err) {
    if (err instanceof UserError) {
      await auditBestEffort({
        event: "blocked",
        product_id: input.product_id,
        product_name: productName,
        reason: err.message,
      });
    }
    throw err;
  }

  const change: PendingChange = {
    id: randomUUID(),
    productId: input.product_id,
    productName,
    patch: evaluated.patch,
    changes: evaluated.changes,
    before: evaluated.before,
    createdAt: now,
  };

  // Fail closed: a proposal that can't be audited is never offered.
  try {
    await appendAudit({
      event: "proposed",
      change_id: change.id,
      product_id: change.productId,
      product_name: productName,
      changes: change.changes,
    });
  } catch (err) {
    console.error(`[woo-ops-mcp] audit log write failed (proposed): ${describeForLog(err)}`);
    throw new UserError(CHANGE_MESSAGES.auditUnavailable);
  }

  pending.set(change.id, change);

  return {
    change_id: change.id,
    expires_at: new Date(now + CHANGE_TTL_MS).toISOString(),
    product: { id: change.productId, name: productName },
    changes: change.changes,
    notes: evaluated.notes,
    message:
      "Nothing has changed yet. Show this preview to the user and call apply_change only after they approve it.",
  };
}

/** Applies a proposed change. Each change_id works once and only within CHANGE_TTL_MS. */
export async function applyChange(changeId: string): Promise<ApplyResult> {
  const change = pending.get(changeId);
  if (!change) throw new UserError(CHANGE_MESSAGES.unknownId);

  // Consume the id before any await, so it can never be applied twice, even by concurrent calls.
  pending.delete(changeId);

  const base = { change_id: change.id, product_id: change.productId, product_name: change.productName };

  if (Date.now() - change.createdAt > CHANGE_TTL_MS) {
    await auditBestEffort({ ...base, event: "rejected", reason: "expired" });
    throw new UserError(CHANGE_MESSAGES.expired);
  }

  // The preview must still describe the store: reject if the product changed since.
  const { data: current } = await getClient().get(`products/${change.productId}`);
  if (!sameSnapshot(snapshot(current), change.before)) {
    await auditBestEffort({ ...base, event: "rejected", reason: "product changed since preview" });
    throw new UserError(CHANGE_MESSAGES.stale);
  }

  // Record intent before touching the store; refuse if that can't be recorded.
  try {
    await appendAudit({ ...base, event: "apply_started", changes: change.changes });
  } catch (err) {
    console.error(`[woo-ops-mcp] audit log write failed (apply_started): ${describeForLog(err)}`);
    throw new UserError(CHANGE_MESSAGES.auditUnavailable);
  }

  const body: Record<string, unknown> = {};
  if (change.patch.regular_price !== undefined) body.regular_price = change.patch.regular_price;
  if (change.patch.sale_price !== undefined) body.sale_price = change.patch.sale_price;
  if (change.patch.stock_quantity !== undefined) {
    body.manage_stock = true;
    body.stock_quantity = change.patch.stock_quantity;
  }

  let updated: any;
  try {
    ({ data: updated } = await getClient().put(`products/${change.productId}`, body));
  } catch (err) {
    await auditBestEffort({ ...base, event: "apply_failed", changes: change.changes, reason: describeForLog(err) });
    throw err;
  }

  const result: ApplyResult = {
    applied: true,
    change_id: change.id,
    product: {
      id: updated?.id ?? change.productId,
      name: updated?.name ?? change.productName,
      regular_price: updated?.regular_price ?? "",
      sale_price: updated?.sale_price ?? "",
      stock: updated?.manage_stock ? (updated?.stock_quantity ?? null) : null,
    },
    changes: change.changes,
  };

  try {
    await appendAudit({ ...base, event: "applied", changes: change.changes });
  } catch (err) {
    console.error(`[woo-ops-mcp] audit log write failed (applied): ${describeForLog(err)}`);
    result.warning = CHANGE_MESSAGES.appliedAuditWarning;
  }

  return result;
}
