# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The package no longer ships source maps (`.js.map`), so the install is smaller. They pointed to source files that are not included in the package.
- The test run now fails if no tests are found, so a misconfigured test setup can never let an untested version be published.

## [1.0.0] - 2026-11-09

First public release.

### Added

- **Read tools:** `search_products`, `get_product`, `get_low_stock_products`, `list_orders`, `get_order` and `get_customer` answer questions from live store data.
- **Safe changes:** `propose_product_change` prepares a regular price, sale price or stock change and returns a before/after preview with a `change_id`. `apply_change` applies it only after the user approves.
- **Business rules enforced in server code:**
  - Regular price changes larger than `WOO_MAX_PRICE_CHANGE_PCT` (default 50%) are blocked.
  - Sale price must be lower than the regular price and no more than `WOO_MAX_PRICE_CHANGE_PCT` below it.
  - Stock must be a whole number from 0 to 100,000.
- **One-time change ids** that expire after 10 minutes.
- **Read-only mode** (`WOO_READ_ONLY=true`) hides all change tools.
- **Audit log:** every proposal and applied change is appended to a local JSONL file (`WOO_AUDIT_LOG`, default `~/.woo-ops-mcp/audit.jsonl`).
- **Resource** `store://summary`: live counts of products, low-stock products and orders by status.
- **Prompts** `daily-store-report` and `restock-plan`.
- **Configuration** through environment variables: `WC_URL`, `WC_KEY`, `WC_SECRET`, `WOO_READ_ONLY`, `WOO_MAX_PRICE_CHANGE_PCT`, `WOO_LOW_STOCK_THRESHOLD`, `WOO_QUERY_STRING_AUTH`, `WOO_TIMEOUT_MS` and `WOO_AUDIT_LOG`.
- **Agent skill** `woo-store-ops` that teaches AI apps to use the tools safely, with a troubleshooting reference.
- Runs with `npx -y woo-ops-mcp` in Claude Desktop, Claude Code, Cursor and other MCP apps.

### Security

- WooCommerce keys stay on the user's machine and are never logged, printed or returned in tool output.
- Customer data is minimized: tools return only the fields needed, never full addresses, phone numbers or payment details.
- Store content (product descriptions, order and customer notes) is treated as data, never as instructions.
- Store API calls time out (`WOO_TIMEOUT_MS`) and return clear error messages.

[Unreleased]: https://github.com/RahatChoudhary/woo-ops-agent/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/RahatChoudhary/woo-ops-agent/releases/tag/v1.0.0
