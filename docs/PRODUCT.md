# Product brief: woo-ops-agent v1.0

## One-line pitch

Manage your WooCommerce store from Claude, Cursor or any MCP app in plain language, with a preview and your approval before anything changes.

## Who it's for

- **Primary:** small and medium WooCommerce store owners and managers who already use an AI app (Claude Desktop, Claude Code, Cursor).
- **Secondary:** developers and agencies who manage WooCommerce stores for clients.

## The problem

Store owners spend time clicking through WooCommerce admin to answer simple questions ("what's low on stock?", "which orders failed?") and to make routine changes (put a product on sale, update stock). AI apps could do this, but owners don't trust an AI to change their store without control.

## The promise

1. **Ask in plain language,** get answers from live store data.
2. **Nothing changes without your approval.** Every change shows a before/after preview first.
3. **Your keys stay on your machine.** The server runs locally; no third-party server sees your store or keys.
4. **Works in the AI app you already use.**

## v1 features

### Read (always available)

| Tool | What it answers |
| --- | --- |
| `search_products` | Find products by name, keyword or SKU |
| `get_product` | Full details for one product, including stock and prices |
| `get_low_stock_products` | Products at or below a stock threshold |
| `list_orders` | Recent orders, filtered by status and date range |
| `get_order` | Full details of one order |
| `get_customer` | Customer lookup by email, with order count and total spent |

### Change (hidden when `WOO_READ_ONLY=true`)

| Tool | What it does |
| --- | --- |
| `propose_product_change` | Prepares a change to regular price, sale price or stock; returns a before/after preview and a one-time `change_id`. Changes nothing. |
| `apply_change` | Applies a proposed change after the user approves it. |

**Business rules enforced in code:**

- Regular price changes larger than `WOO_MAX_PRICE_CHANGE_PCT` (default 50%) are blocked.
- Sale price must be lower than the regular price.
- Stock must be a whole number from 0 to 100,000.
- Change ids are single-use and expire after 10 minutes.
- Every proposal and applied change is written to an audit log.

### Resources

- `store://summary`: live counts of products, low-stock products and orders by status.

### Prompts

- `daily-store-report`: low stock, failed and on-hold orders, order status counts, top 3 actions.
- `restock-plan` (input: threshold): what to reorder first and why.

## Configuration (environment variables)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `WC_URL` | Yes | | Store URL, `https://...` |
| `WC_KEY` | Yes | | WooCommerce consumer key (`ck_...`) |
| `WC_SECRET` | Yes | | WooCommerce consumer secret (`cs_...`) |
| `WOO_READ_ONLY` | No | `false` | `true` hides all change tools |
| `WOO_MAX_PRICE_CHANGE_PCT` | No | `50` | Largest allowed regular price change |
| `WOO_LOW_STOCK_THRESHOLD` | No | `5` | Default threshold for low stock |
| `WOO_QUERY_STRING_AUTH` | No | `false` | `true` for hosts that strip auth headers (HTTPS only) |
| `WOO_TIMEOUT_MS` | No | `15000` | Store API timeout |
| `WOO_AUDIT_LOG` | No | `~/.woo-ops-mcp/audit.jsonl` | Audit log location |

## Distribution

- **npm package** (working name `woo-ops-mcp`; check availability, fall back to `@rahatchoudhary/woo-ops-mcp`), run with `npx -y`.
- **Agent skill** `skills/woo-store-ops/` that teaches agents when and how to use the tools safely. Listed on Agensi; also installable from the repo.
- **Later:** one-click Claude Desktop extension (MCP bundle).

## Out of scope for v1

Explicitly not included, to keep v1 small and safe:

- Creating or deleting products; editing descriptions, images or categories
- Refunds, order status changes, order editing
- Bulk changes (more than one product per proposal)
- Variable product variations (read-only display at most)
- Remote/hosted server, OAuth, multi-store
- Exporting customer lists or any bulk personal data

## Success criteria for v1

- A new user installs it in Claude Desktop or Claude Code in under 5 minutes using only the README.
- All change paths go through propose/apply; read-only mode hides change tools.
- Test suite passes in CI; no test touches a real store.
- Published on npm; skill submitted to Agensi.
- Demo GIF shows: question → answer, sale change → preview → approval → applied.

## Risks and how v1 handles them

| Risk | Mitigation |
| --- | --- |
| AI makes an unwanted change | Propose/apply, business rules in code, read-only mode |
| Prompt injection via store content | Two-step changes; skill instructs to treat store text as data |
| Leaked API keys | Keys only in the user's local config; never logged or returned |
| Customer data exposure | Trimmed outputs; no bulk exports |
| Slow or unreachable store | Timeouts and clear error messages |
| Support load | Troubleshooting guide in README and skill references |
