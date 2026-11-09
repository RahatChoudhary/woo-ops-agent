# Build tasks: woo-ops-agent v1.0

Work through these in order, one task per Claude Code session. For each task:

1. Start Claude Code in the repo root (`claude`).
2. Paste the task's **prompt**. Claude Code reads `CLAUDE.md` automatically.
3. Review the plan it shows. Correct anything before it writes code.
4. Let it implement, then check the **acceptance criteria** yourself.
5. Read the full diff (`git diff`). You must be able to explain every line.
6. Commit with the suggested message. Tick the task.

Estimated total: 10–14 evenings of 2 hours.

---

## Phase 1: Foundation

### [ ] T1. Restructure into the product layout

**Prompt:**

> Read CLAUDE.md and docs/PRODUCT.md. Restructure this repo into the target project structure in CLAUDE.md. Reuse the existing WooCommerce code from src/wc.ts and src/tools.ts by moving and splitting it into src/woo/ (client, products, orders, customers) — don't rewrite logic that works. Switch to NodeNext module resolution with .js import extensions, add a tsc build to dist/, and add the npm scripts listed in CLAUDE.md. Remove the terminal agent files (agent.ts, cli.ts) and the learning/ folder from this repo — they now live in a separate learning repo. Plan first and show me the file moves before doing anything.

**Acceptance:**
- `npm run build` produces `dist/` with no errors
- No `.ts` extensions in relative imports; no references to `agent.ts`, `cli.ts` or `learning/`
- WooCommerce read functions still work (quick manual check with a scratch script)

**Commit:** `refactor: restructure into product layout`

### [ ] T2. Configuration from environment variables

**Prompt:**

> Implement src/config.ts as described in CLAUDE.md and the Configuration table in docs/PRODUCT.md. Validate all variables with zod, apply defaults, and expand ~ in WOO_AUDIT_LOG. If required variables are missing or invalid, print one clear message to stderr listing what's wrong (never print secret values) and exit with code 1. Production code must not load .env files; make `npm run dev` use Node's --env-file=.env. Update src/woo/client.ts to use the config, including timeout and queryStringAuth. Add tests for config parsing and defaults.

**Acceptance:**
- Starting without `WC_URL` prints a clear error to stderr and exits
- Error output never contains `WC_KEY` or `WC_SECRET` values
- `npm test` passes, including new config tests

**Commit:** `feat: validated env configuration`

### [ ] T3. Read layer with pagination and trimmed data

**Prompt:**

> Implement the read functions for the v1 read tools in docs/PRODUCT.md: search products, get product, low-stock products (all pages via getAll, capped at 1,000 records), list orders (status and optional date range via after/before), get order, and get customer by email. Each returns only trimmed fields; follow rule 7 in CLAUDE.md for customer data. Add vitest tests with the WooCommerce client mocked: field mapping, pagination stopping at x-wp-totalpages, the 1,000-record cap, and that personal fields like phone and full address are never returned.

**Acceptance:**
- Tests cover mapping, pagination and data minimization
- No test makes a network request

**Commit:** `feat: read layer with pagination and data minimization`

---

## Phase 2: MCP server

### [ ] T4. Stdio MCP server with read tools

**Prompt:**

> Implement src/stdio-safe.ts, src/errors.ts, src/mcp/server.ts, src/mcp/tools.ts and src/index.ts so the server runs over stdio and exposes the six read tools from docs/PRODUCT.md, with readOnlyHint annotations and descriptions that say when to use each tool. Every handler goes through one shared wrapper that returns JSON text on success and isError with a friendly message from errors.ts on failure (401/403 keys rejected, 404 not found, timeout, unreachable store, business-rule messages passed through). src/index.ts must import stdio-safe first and needs a #!/usr/bin/env node shebang. Add tests for errors.ts.

**Acceptance:**
- `npm run build && npm run inspect` lists exactly the six read tools
- Each tool works against the test store in Inspector
- A wrong key gives the friendly 401 message, not a stack trace
- Nothing is written to stdout except protocol messages

**Commit:** `feat: stdio MCP server with read tools`

### [ ] T5. Safe changes: propose/apply, rules, read-only mode, audit log

**Prompt:**

> Implement src/safety/changes.ts and src/safety/audit.ts and register propose_product_change and apply_change, following rules 1–4 in CLAUDE.md and the business rules in docs/PRODUCT.md. Use WOO_MAX_PRICE_CHANGE_PCT from config. apply_change uses destructiveHint. When WOO_READ_ONLY is true, don't register either tool. The audit log is append-only JSONL at the configured path, creating the folder if needed, and never contains secrets. Add tests with the client and file system mocked: preview doesn't write, the over-limit price is blocked, sale price at or above regular is blocked, apply works once and rejects reuse, expiry after 10 minutes (fake timers), unknown ids rejected, and read-only mode registers no write tools.

**Acceptance:**
- All safety tests pass
- In Inspector: propose → store unchanged; apply → store changed; apply again → rejected
- With `WOO_READ_ONLY=true`, Inspector shows only read tools
- Audit log entries appear at `~/.woo-ops-mcp/audit.jsonl`

**Commit:** `feat: propose/apply changes with business rules and audit log`

### [ ] T6. Resource and prompts

**Prompt:**

> Implement src/mcp/resources.ts with store://summary and src/mcp/prompts.ts with daily-store-report and restock-plan as described in docs/PRODUCT.md. Use WOO_LOW_STOCK_THRESHOLD as the default threshold. The prompts must instruct the model to use tools for real data and must not ask it to change anything. Add a test that the summary groups orders by status correctly.

**Acceptance:**
- Inspector shows the resource and both prompts and they return sensible content
- Tests pass

**Commit:** `feat: store summary resource and report prompts`

---

## Phase 3: Real clients and packaging

### [ ] T7. Test in Claude Desktop and Claude Code (manual, no prompt)

Do this yourself:

- Configure Claude Desktop with `node` and the absolute path to `dist/index.js`, passing env vars in the config's `env` block.
- Add it to Claude Code with `claude mcp add ... -- node /absolute/path/dist/index.js`.
- Run the demo script: low stock question; failed orders with customers; "put the Beanie on sale for 20%" → preview → approve → applied; cancel a change; blocked 80% price cut; prompt-injection test (instruction text in a product description).
- Write down every problem. Turn each into a small fix task for Claude Code.

**Commit:** fixes as separate commits

### [ ] T8. npm packaging

**Prompt:**

> Prepare the package for npm. Set name (first check availability with `npm view woo-ops-mcp`; if taken, use @rahatchoudhary/woo-ops-mcp), version 0.9.0, description, keywords (mcp, woocommerce, model-context-protocol, claude, ai-agent), license MIT, repository, engines node >=20, a bin entry pointing to dist/index.js, a files whitelist (dist, README.md, LICENSE), and a prepublishOnly script that builds and tests. Make sure the compiled entry is executable. Then run `npm pack` and show me the tarball's file list.

**Acceptance:**
- Tarball contains only `dist/`, `README.md`, `LICENSE`, `package.json`
- `npx -y ./woo-ops-mcp-0.9.0.tgz` starts the server with env vars set
- Claude Desktop works when configured with the tarball path through `npx`

**Commit:** `chore: npm packaging`

---

## Phase 4: Skill, docs and quality

### [ ] T9. Finalize the agent skill

**Prompt:**

> Review skills/woo-store-ops/SKILL.md and references/troubleshooting.md against the actual tool names, inputs and error messages in src/. Fix anything that doesn't match. Don't weaken any safety instruction. Keep SKILL.md under 300 lines.

Then test manually: copy `skills/woo-store-ops` to `~/.claude/skills/`, start a new Claude Code session, and try: "how's my store doing today?", "what should I restock?", "put the hoodie on sale". The skill should load and the agent should follow the preview-then-approve flow.

**Commit:** `docs: finalize woo-store-ops skill`

### [ ] T10. README for buyers

**Prompt:**

> Rewrite README.md for buyers, not developers. Sections: one-line pitch, what you can ask (examples), safety design (preview and approval, business rules, read-only mode, audit log, keys stay local), install for Claude Desktop, Claude Code and Cursor (copy-paste snippets with npx), how to create WooCommerce API keys (Read/Write, or Read for read-only mode), configuration table, installing the skill, troubleshooting (link to the skill's troubleshooting reference), privacy, license. Leave a placeholder for a demo GIF near the top.

**Acceptance:**
- Someone unfamiliar could install it in under 5 minutes from the README alone (ask a friend to try)

**Commit:** `docs: buyer-focused README`

### [ ] T11. CI and release

**Prompt:**

> Add a GitHub Actions workflow that runs npm ci, build and test on pushes and pull requests using Node 20 and 22. Add a CHANGELOG.md with a 1.0.0 entry summarizing features from docs/PRODUCT.md. Bump the version to 1.0.0.

Then yourself:
- Record a 30–60 second demo GIF (question → answer → sale preview → approval → applied) and add it to the README.
- `npm login`, then `npm publish` (add `--access public` for a scoped name).
- Test the published package: `npx -y woo-ops-mcp` in a fresh Claude Desktop config.
- Create a GitHub release `v1.0.0`.

**Commit:** `chore: CI and v1.0.0 release`

---

## Phase 5: Launch

### [ ] T12. Agensi listing (manual)

- Read Agensi's current submission requirements on their sell page; adjust the skill's frontmatter if they need extra fields.
- Zip the `skills/woo-store-ops/` folder.
- Listing text: use the pitch and safety section from the README. State clearly that it needs the free npm package and WooCommerce API keys.
- Decide free or paid after checking similar listings.
- Add the listing link to the README.

### [ ] T13. Later: one-click Claude Desktop extension (optional)

Package the server as an MCP bundle so Claude Desktop users install it from a single file with a settings form for the store URL and keys. Do this after v1 has real users.
