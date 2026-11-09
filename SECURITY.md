# Security policy

Woo Ops MCP connects AI apps to real WooCommerce stores, so security reports are taken seriously.

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | Yes |
| < 1.0 | No |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub: go to the repository's **Security** tab and click **Report a vulnerability**. Include:

- what the problem is and what an attacker could do with it
- steps to reproduce (use a test store, never real customer data)
- the package version and AI app you used

You will get an acknowledgement within 7 days. Once a fix is ready, it is released as a new version and the report is credited unless you prefer to stay anonymous.

## What counts as a security issue

Examples:

- Changing store data without the propose and approve flow, or reusing or extending a `change_id`
- Bypassing a business rule (price change limit, sale price limit, stock range)
- Change tools being usable while `WOO_READ_ONLY=true`
- `WC_KEY` or `WC_SECRET` appearing in output, errors or logs
- Tool output exposing customer data beyond what is documented (full addresses, phone numbers, payment details)
- Store content (product descriptions, notes) being able to trigger changes on its own

Problems with your own store setup, WooCommerce itself, or the AI app should be reported to those projects instead.
