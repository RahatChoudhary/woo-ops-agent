#!/usr/bin/env node
// stdio-safe must stay the first import: it redirects console output away from stdout.
import "./stdio-safe.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { describeForLog } from "./errors.js";
import { createServer } from "./mcp/server.js";

async function main(): Promise<void> {
  // Validate env vars up front so a bad config fails fast with a clear message.
  const config = loadConfig();
  const server = createServer();
  await server.connect(new StdioServerTransport());
  console.error(`woo-ops-mcp running over stdio${config.readOnly ? " (read-only mode)" : ""}`);
}

main().catch((err) => {
  console.error(`woo-ops-mcp failed to start: ${describeForLog(err)}`);
  process.exit(1);
});
