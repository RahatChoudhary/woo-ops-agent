import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SERVER_VERSION } from "../src/mcp/server.js";

describe("SERVER_VERSION", () => {
  it("matches the package.json version", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(SERVER_VERSION).toBe(pkg.version);
  });
});
