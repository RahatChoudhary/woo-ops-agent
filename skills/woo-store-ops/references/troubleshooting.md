# Troubleshooting woo-ops-agent

Use this when the store tools are missing or return errors. Explain the fix to the user in plain language.

## Setup (tools are missing)

The woo-ops-agent MCP server must be added to the user's AI app. They need their store URL and a WooCommerce API key (WooCommerce → Settings → Advanced → REST API → Add key; permission **Read/Write**, or **Read** for read-only use).

**Claude Code:**

```bash
claude mcp add woo-store -e WC_URL=https://your-store.com -e WC_KEY=ck_... -e WC_SECRET=cs_... -- npx -y woo-ops-mcp
```

**Claude Desktop or Cursor** (MCP config file):

```json
{
  "mcpServers": {
    "woo-store": {
      "command": "npx",
      "args": ["-y", "woo-ops-mcp"],
      "env": {
        "WC_URL": "https://your-store.com",
        "WC_KEY": "ck_...",
        "WC_SECRET": "cs_..."
      }
    }
  }
}
```

After editing, fully restart the app. Requires Node.js 20 or newer.

Optional settings: `WOO_READ_ONLY=true` (no changes possible), `WOO_MAX_PRICE_CHANGE_PCT` (default 50), `WOO_LOW_STOCK_THRESHOLD` (default 5), `WOO_QUERY_STRING_AUTH=true` (for hosts that block auth headers).

## Common errors

| Message from the tool | Likely cause | Fix |
| --- | --- | --- |
| Store rejected the API keys | Wrong key/secret, or key lacks permission | Recreate the key with Read/Write; check for copy-paste spaces. If keys are correct on shared hosting, set `WOO_QUERY_STRING_AUTH=true` (HTTPS only). |
| Can't reach the store | Wrong `WC_URL`, site down, or no internet | Open the URL in a browser; check `https://` and no trailing path. |
| Store took too long to respond | Slow hosting or very large result | Try again; ask for fewer results or a narrower date range. |
| Not found | Wrong product or order id | Search first, then use the id from the results. |
| Blocked: price change over N% | Business rule in the server | Intended? Make the change in WooCommerce admin, or the store owner can raise `WOO_MAX_PRICE_CHANGE_PCT`. Don't work around it. |
| Unknown or already used change_id / proposal expired | Change applied already, or older than 10 minutes | Create a new proposal. |
| REST API returns 404 for everything | WordPress permalinks set to "Plain" | WordPress → Settings → Permalinks → "Post name" → Save. |

## Server doesn't start

- **`npx` not found (Mac, Claude Desktop):** use the full path from `which npx` as `command`.
- **Missing configuration:** the server lists missing variables in the app's MCP logs. Add them to the `env` block.
- **Node too old:** `node --version` must be 20 or newer.
- Logs: Claude Desktop → Settings → Developer, or `~/Library/Logs/Claude/` on Mac. Claude Code: run `/mcp`.

## Audit log

Every proposed and applied change is recorded at `~/.woo-ops-mcp/audit.jsonl` (or `WOO_AUDIT_LOG`). Point the user there if they ask what was changed and when.
