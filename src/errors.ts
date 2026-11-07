// Turns any error into a short, friendly message for the tool result.
//
// Raw error text is never returned: axios errors from the WooCommerce client carry the
// request config (including the consumer key and secret), and store responses are
// untrusted content. Only messages we wrote ourselves (UserError) pass through.

/** An error whose message is safe and meant for the user, e.g. a business-rule violation. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export const MESSAGES = {
  keysRejected:
    "The store rejected the API keys (401/403). Check that WC_KEY and WC_SECRET are correct, " +
    "belong to a user who can manage WooCommerce, and have Read (or Read/Write) permission. " +
    "If your host strips auth headers, try WOO_QUERY_STRING_AUTH=true.",
  notFound: "The store could not find that item (404). Check the id and try again.",
  timeout:
    "The store took too long to respond. Try again, or raise WOO_TIMEOUT_MS if the store is slow.",
  unreachable:
    "Could not reach the store. Check that WC_URL is correct, the site is online and its SSL certificate is valid.",
  rateLimited: "The store is rate-limiting requests (429). Wait a moment and try again.",
  serverError: "The store had an internal error. Try again shortly; if it keeps happening, check the store's error logs.",
  badRequest: "The store rejected the request as invalid. Check the values and try again.",
  invalidInput: "Invalid input.",
  unknown: "Something went wrong while talking to the store. Try again.",
} as const;

const TIMEOUT_CODES = new Set(["ECONNABORTED", "ETIMEDOUT", "ESOCKETTIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"]);

const UNREACHABLE_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_BAD_URL",
  "ERR_INVALID_URL",
]);

function httpStatus(err: any): number | undefined {
  const s = err?.response?.status ?? err?.status;
  return typeof s === "number" ? s : undefined;
}

function isZodError(err: any): err is { issues: { path: (string | number)[]; message: string }[] } {
  return err?.name === "ZodError" && Array.isArray(err?.issues);
}

export function toFriendlyMessage(err: unknown): string {
  const e = err as any;

  if (err instanceof UserError) return err.message;

  // Zod issue messages are our own schema text; they never include the input values.
  if (isZodError(e)) {
    const details = e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`);
    return `${MESSAGES.invalidInput} ${details.join("; ")}`;
  }

  const status = httpStatus(e);
  if (status === 401 || status === 403) return MESSAGES.keysRejected;
  if (status === 404) return MESSAGES.notFound;
  if (status === 408 || status === 504) return MESSAGES.timeout;
  if (status === 429) return MESSAGES.rateLimited;
  if (status !== undefined && status >= 500) return MESSAGES.serverError;
  if (status !== undefined && status >= 400) return MESSAGES.badRequest;

  const code = typeof e?.code === "string" ? e.code : typeof e?.cause?.code === "string" ? e.cause.code : "";
  if (TIMEOUT_CODES.has(code) || /timeout/i.test(String(e?.message ?? ""))) return MESSAGES.timeout;
  if (UNREACHABLE_CODES.has(code)) return MESSAGES.unreachable;
  // A request that was sent but never answered (no response object) means the store is unreachable.
  if (e?.request && !e?.response) return MESSAGES.unreachable;

  return MESSAGES.unknown;
}

/**
 * A secret-free description of an error for stderr diagnostics.
 * Only the error type, code and HTTP status, never the message or request config.
 */
export function describeForLog(err: unknown): string {
  const e = err as any;
  const parts = [e?.name ?? typeof err];
  if (typeof e?.code === "string") parts.push(`code=${e.code}`);
  const status = httpStatus(e);
  if (status !== undefined) parts.push(`status=${status}`);
  return parts.join(" ");
}
