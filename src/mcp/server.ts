import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../config.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { registerReadTools, registerWriteTools } from "./tools.js";

export const SERVER_NAME = "woo-ops-mcp";
export const SERVER_VERSION = "1.0.0";

/**
 * Builds the MCP server with its tools, resources and prompts registered. Transport is attached by the caller.
 * In read-only mode the change tools are never registered, so clients can't see or call them.
 */
export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerReadTools(server);
  if (!loadConfig().readOnly) registerWriteTools(server);
  registerResources(server);
  registerPrompts(server);
  return server;
}
