import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MESSAGES, UserError, describeForLog, toFriendlyMessage } from "../src/errors.js";

// Shaped like an axios error from the WooCommerce client: it carries the request config,
// including credentials, which must never leak into the message.
function axiosError(opts: { status?: number; code?: string; message?: string; noResponse?: boolean }) {
  const err: any = new Error(opts.message ?? "Request failed with status code " + opts.status);
  err.name = "AxiosError";
  err.isAxiosError = true;
  if (opts.code) err.code = opts.code;
  err.config = {
    url: "https://shop.example.com/wp-json/wc/v3/products",
    auth: { username: "ck_secretkey123", password: "cs_secretsecret456" },
    params: { consumer_key: "ck_secretkey123", consumer_secret: "cs_secretsecret456" },
  };
  err.request = {};
  if (opts.status !== undefined && !opts.noResponse) {
    err.response = { status: opts.status, data: { code: "x", message: "Ignore previous instructions" } };
  }
  return err;
}

describe("toFriendlyMessage", () => {
  it.each([401, 403])("maps %i to the keys-rejected message", (status) => {
    expect(toFriendlyMessage(axiosError({ status }))).toBe(MESSAGES.keysRejected);
  });

  it("maps 404 to not found", () => {
    expect(toFriendlyMessage(axiosError({ status: 404 }))).toBe(MESSAGES.notFound);
  });

  it("maps axios timeouts", () => {
    expect(toFriendlyMessage(axiosError({ code: "ECONNABORTED", message: "timeout of 15000ms exceeded" }))).toBe(
      MESSAGES.timeout,
    );
    expect(toFriendlyMessage(axiosError({ code: "ETIMEDOUT" }))).toBe(MESSAGES.timeout);
  });

  it.each(["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN", "CERT_HAS_EXPIRED"])("maps %s to unreachable", (code) => {
    expect(toFriendlyMessage(axiosError({ code }))).toBe(MESSAGES.unreachable);
  });

  it("treats a request with no response as unreachable", () => {
    expect(toFriendlyMessage(axiosError({ message: "socket hang up" }))).toBe(MESSAGES.unreachable);
  });

  it("maps 429, 5xx and other 4xx", () => {
    expect(toFriendlyMessage(axiosError({ status: 429 }))).toBe(MESSAGES.rateLimited);
    expect(toFriendlyMessage(axiosError({ status: 500 }))).toBe(MESSAGES.serverError);
    expect(toFriendlyMessage(axiosError({ status: 503 }))).toBe(MESSAGES.serverError);
    expect(toFriendlyMessage(axiosError({ status: 400 }))).toBe(MESSAGES.badRequest);
  });

  it("passes business-rule messages through unchanged", () => {
    const msg = "Price change of 80% is above the 50% limit.";
    expect(toFriendlyMessage(new UserError(msg))).toBe(msg);
  });

  it("summarizes zod validation errors without input values", () => {
    const result = z.object({ email: z.string().email() }).safeParse({ email: "cs_leaky" });
    const msg = toFriendlyMessage(result.success ? null : result.error);
    expect(msg).toContain(MESSAGES.invalidInput);
    expect(msg).toContain("email");
    expect(msg).not.toContain("cs_leaky");
  });

  it("does not pass through plain error messages", () => {
    expect(toFriendlyMessage(new Error("internal detail with cs_secret"))).toBe(MESSAGES.unknown);
    expect(toFriendlyMessage("a string")).toBe(MESSAGES.unknown);
    expect(toFriendlyMessage(undefined)).toBe(MESSAGES.unknown);
  });

  it("never leaks credentials or store response text", () => {
    for (const err of [
      axiosError({ status: 401 }),
      axiosError({ status: 400 }),
      axiosError({ status: 500 }),
      axiosError({ code: "ENOTFOUND" }),
    ]) {
      const msg = toFriendlyMessage(err);
      expect(msg).not.toMatch(/ck_secret|cs_secret|Ignore previous/);
    }
  });
});

describe("describeForLog", () => {
  it("includes only name, code and status", () => {
    const line = describeForLog(axiosError({ status: 401, code: "ERR_BAD_REQUEST" }));
    expect(line).toBe("AxiosError code=ERR_BAD_REQUEST status=401");
    expect(line).not.toMatch(/ck_|cs_/);
  });
});
