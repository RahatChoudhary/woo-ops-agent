# WooCommerce Operations Agent

An AI assistant that lets store owners manage a WooCommerce store in plain language,
with human approval before any change is made.

## What it does
- Answers questions from live store data: low stock, orders by status, customer lookups
- Proposes price and stock changes and executes them only after approval
- Validates every tool call and explains API errors instead of failing silently

## Example
> You: Which products are low on stock?
> Assistant: 3 products are at or below 5 units: ...
> You: Set the Beanie's stock to 40.
> Approve change? update_stock {"id": 34, "quantity": 40} (y/n)

## Architecture
MCP server (stdio) that talks only to your WooCommerce store. See `CLAUDE.md` for the layout:
- `src/woo/` WooCommerce client and trimmed read functions (products, orders, customers)
- `src/mcp/`, `src/safety/` MCP tools and propose/apply safety layer (in progress)

## Design decisions
- **Human-in-the-loop for writes:** the model never changes data directly
- **Trimmed tool outputs:** 4-8 fields per record to reduce cost and confusion
- **Errors as data:** failed calls return is_error results the model can explain

## Run it (development)
1. Copy `.env.example` to `.env` and fill in keys
2. `npm install`
3. `npm run build`
4. `npm run test:wc` to smoke-check the read functions against your store

## Roadmap
- MCP server version usable from Claude Desktop and other MCP clients
- Web chat interface
- Knowledge base for store policies (RAG) and an evaluation suite