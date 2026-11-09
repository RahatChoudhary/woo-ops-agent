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

Optional settings:

| Variable | Default | What it does |
| --- | --- | --- |
| `WOO_READ_ONLY` | `false` | `true` hides the change tools completely; no changes possible. |
| `WOO_MAX_PRICE_CHANGE_PCT` | `50` | Largest allowed regular price change, and largest allowed sale discount, in percent. |
| `WOO_LOW_STOCK_THRESHOLD` | `5` | Default threshold for low-stock checks. |
| `WOO_QUERY_STRING_AUTH` | `false` | `true` sends keys in the URL, for hosts that strip auth headers. Only allowed with `https://`. |
| `WOO_TIMEOUT_MS` | `15000` | How long to wait for the store, in milliseconds (1000-120000). |
| `WOO_AUDIT_LOG` | `~/.woo-ops-mcp/audit.jsonl` | Where the audit log is written. |

## Common errors

### Connection and store errors

| Message from the tool | Likely cause | Fix |
| --- | --- | --- |
| The store rejected the API keys (401/403) | Wrong key/secret, the key's user can't manage WooCommerce, or the key lacks permission | Check `WC_KEY`/`WC_SECRET` for copy-paste spaces. Applying changes needs a **Read/Write** key; a Read key only works for reading. If keys are correct on shared hosting, set `WOO_QUERY_STRING_AUTH=true` (HTTPS only). |
| Could not reach the store | Wrong `WC_URL`, site down, no internet, or an invalid SSL certificate | Open the URL in a browser; check `https://`, no trailing path, and that the certificate is valid. |
| The store took too long to respond | Slow hosting or a very large result | Try again; ask for fewer results or a narrower date range. The owner can raise `WOO_TIMEOUT_MS`. |
| The store could not find that item (404) | Wrong product or order id | Search first (`search_products`, `list_orders`), then use the `id` from the results. |
| The store could not find that item (404) for every call | WordPress permalinks set to "Plain", so the REST API isn't reachable | WordPress → Settings → Permalinks → "Post name" → Save. |
| The store is rate-limiting requests (429) | Too many requests in a short time | Wait a moment and try again. |
| The store had an internal error | A plugin or server problem on the store | Try again shortly; if it keeps happening, check the store's error logs. |
| The store rejected the request as invalid | The store refused the values sent | Check the values and try again. |
| Invalid input. … | A tool input has the wrong format (the message names the field) | Fix that input, for example a price like `19.99` or a valid email. |
| Invalid date "…" / The 'after' date must be earlier than the 'before' date | Bad date range for `list_orders` | Use dates like `2026-01-31` or `2026-01-31T14:00:00`, with `after` before `before`. |
| Something went wrong while talking to the store | Unexpected error | Try again; check the app's MCP logs if it repeats. |

### Changes blocked by business rules

These come from rules in the server. Explain the reason. Don't work around them; if the change is intended, the owner can make it in WooCommerce admin.

| Message from the tool | Meaning |
| --- | --- |
| Blocked: a regular price change of X% is over the allowed limit of N% | The new regular price differs too much from the current one. The owner can raise `WOO_MAX_PRICE_CHANGE_PCT`. |
| Blocked: a sale price of X is Y% below the regular price … over the allowed limit of N% | The sale discount is larger than the limit. |
| Blocked: the sale price (X) must be lower than the regular price (Y) | A sale price must be below the regular price. |
| Blocked: a sale price needs a regular price | The product has no regular price; set one first. |
| Blocked: the regular price must be greater than 0 | Prices of 0 aren't allowed. |
| Blocked: stock must be a whole number from 0 to 100,000 | Stock out of range. |
| Product N is a variable product … | Prices and stock are per variation; edit the variations in WooCommerce admin. |
| Product N is a … product. Only simple products can be changed here | Grouped, external and other types can't be changed by these tools. |
| Nothing to change: give at least one of regular_price, sale_price or stock_quantity | The proposal had no fields to change. |
| Nothing would change: the product already has these values | The product already has these values; nothing to do. |

### Applying a change

| Message from the tool | Meaning | Fix |
| --- | --- | --- |
| Unknown or already used change_id | Already applied, or the server restarted since the proposal | Propose again and get new approval. |
| This proposal expired (proposals last 10 minutes) | The preview is older than 10 minutes | Propose again and get new approval. |
| The product was changed after the preview was made, so this change was not applied | Someone edited the product since the preview | Propose again, show the up-to-date preview and get new approval. |
| The change was not made because the audit log could not be written | The audit log location isn't writable, so the server refuses to change anything | The owner must make the `WOO_AUDIT_LOG` location writable, then try again. |
| The change was applied, but the audit log entry for it could not be written | The change **was** made; only the log entry is missing | Tell the user the change is live and that the log location needs fixing. |
| Too many proposals are waiting | Over 100 open proposals | Let old ones expire (10 minutes) and try again. |

## Server doesn't start

- **`npx` not found (Mac, Claude Desktop):** use the full path from `which npx` as `command`.
- **Invalid configuration:** the server prints "woo-ops-mcp: invalid configuration" to the app's MCP logs, with one line per problem, for example `WC_URL is required`, `WC_KEY must start with ck_`, `WC_SECRET must start with cs_`, or `WOO_QUERY_STRING_AUTH can only be true when WC_URL uses https://`. Fix those variables in the `env` block.
- **Node too old:** `node --version` must be 20 or newer.
- Logs: Claude Desktop → Settings → Developer, or `~/Library/Logs/Claude/` on Mac. Claude Code: run `/mcp`. When read-only mode is on, the log shows "woo-ops-mcp running over stdio (read-only mode)".

## Audit log

Every proposed, blocked, rejected, applied and failed change is recorded as one JSON line in `~/.woo-ops-mcp/audit.jsonl` (or `WOO_AUDIT_LOG`). Point the user there if they ask what was changed and when. It never contains API keys.
