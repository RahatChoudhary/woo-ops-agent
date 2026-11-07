import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReadTools } from "./tools.js";

export const SERVER_NAME = "woo-ops-mcp";
export const SERVER_VERSION = "1.0.0";

/** Builds the MCP server with all tools registered. Transport is attached by the caller. */
export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerReadTools(server);
  return server;
}
