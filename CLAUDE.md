# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deployment

There is no build step. The site is deployed directly to Vercel — push to the repo and Vercel deploys automatically.

To deploy manually or preview locally:
```bash
npm install        # installs backend deps (pdf-lib, resend, @vercel/blob, @vercel/edge-config)
npx vercel dev     # local dev server with serverless functions at localhost:3000
npx vercel --prod  # deploy to production
```

There are no tests and no linter configured.

## Architecture Overview

**Static HTML + Vercel Serverless Functions.** No framework (`"framework": null` in `vercel.json`). Every HTML page is standalone; JS is inline or in `js/main.js`. CSS variables are defined in `css/style.css` — all pages link to this file.

**Storage is entirely Vercel Blob** — there is no database. Every record is a `.json` file written to a blob prefix with `addRandomSuffix: false, cacheControlMaxAge: 0`. Reads list the prefix then fetch each blob URL. Vercel Edge Config (`@vercel/edge-config`) is used only for runtime overrides to SEPL financial settings.

**Vercel Hobby function limit: 12.** Files listed in `.vercelignore` are excluded from deployment to stay under this cap. Before adding a new `api/` file, count existing deployed functions.

## Two Product Areas

### 1. SMTC Corporate Tools (password-gated internal portal)

- Entry: `smtc-portal.html` — password gate checks `sessionStorage.getItem('smtc_auth')` against hash `87afac64` (passphrase: `spice123`).
- Each tool is a **self-contained HTML file in `/tools/`** — client-side JS only, no API calls. Use XLSX.js (`https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js`) for spreadsheet handling.
- Each tool has a **wrapper page at the root** (e.g. `daily-sales-summary.html`) that handles the auth gate and loads the tool in an iframe.
- **When adding a new tool**, add it to: (a) the portal grid cards in `smtc-portal.html`, (b) the `nav-dropdown` menu in **every** HTML page that has the navbar.
- The agent loop spec is in `scripts/smtc-agent-loop.md` — status flow is `submitted → in_review → in_progress → ready_for_testing → live`.

### 2. SEPL — Cardamom Consignment Programme (Spicemore Exim Pvt Ltd)

Lives under `/sepl/` (frontend) and `/api/sepl/` (backend). Two roles: **staff** and **consignor** (called "Client" in all UI copy).

**Auth flow:** OTP sent via WhatsApp → verified → custom HMAC-SHA256 JWT minted by `api/sepl/_session.js` (30-day expiry). Token is stored in `sessionStorage` and sent as `Authorization: Bearer <token>` on every API call. Demo bypass: phone `+911111111111` (staff) or `+912222222222` (consignor) with OTP `123456` skips WhatsApp entirely.

**Staff pages** (`/sepl/staff/`): Intake · Portfolio · Daily price · Settings. Nav order must be preserved. The "Finance Tracker" link goes to an external Vercel deployment.

**Consignor pages** (`/sepl/consignor/`): Login · Dashboard.

## SEPL API Contracts

All endpoints under `/api/sepl/` require `Authorization: Bearer <token>` except the auth endpoints. CORS headers are set on every handler.

| Endpoint | Method | Auth | Notes |
|---|---|---|---|
| `/api/sepl/auth-request-otp` | POST | none | `{phone, role}` → sends OTP via WhatsApp |
| `/api/sepl/auth-verify-otp` | POST | none | `{phone, otp, role}` → returns `{token, role, phone, name}` |
| `/api/sepl/consignors` | GET | staff | list all clients |
| `/api/sepl/consignors` | POST | staff | create client |
| `/api/sepl/transactions` | GET | staff or consignor | consignors see only their own |
| `/api/sepl/transactions` | POST | staff | create intake |
| `/api/sepl/transactions?resource=upload-blob` | POST | staff | base64 image upload → blob URL |
| `/api/sepl/daily-price` | GET/POST | GET public, POST staff | daily cardamom price log |
| `/api/sepl/daily-price?resource=cardamom-rate` | GET | public | auto-scraped Spices Board rate (6h cache) |
| `/api/sepl/daily-price?resource=settings` | GET/POST | GET public, POST staff | runtime overrides for financial settings |
| `/api/sepl/agreement-pdf` | POST | staff | generate PDF + optionally send via WhatsApp |

**WhatsApp bridge:** Vercel calls a cloudflared-tunneled local bridge (`WHATSAPP_BRIDGE_URL`) on Deepak's Mac. If the env var is missing or the call fails, `_whatsapp.js` writes to the `whatsapp-outbox/` blob prefix and returns `{ok:true, stubbed:true}` — the API never crashes. Diagnostic: `GET /api/sepl/auth-request-otp?diag=whatsapp`.

## SEPL Economic Model — Do Not Break

These values are the source of truth in `api/sepl/_settings.js`. Runtime overrides come from Vercel Edge Config via `api/sepl/daily-price?resource=settings`.

- **Advance**: 65% of gross stock value (hard cap 70%)
- **Holding charge**: ₹60 per ₹1,00,000 advance per day = 21.9% p.a. on 365-day basis
- **Standard tenure**: 90 days; max 120 days (by management approval)
- **Minimum lot**: 250 kg (enforced server-side)
- **LTV bands**: yellow 75% (monitor), orange 80% (margin call, 7-day top-up), red 85% (sell with 48h notice), forced 90% (immediate sale)
- **Cardamom benchmark price**: weighted avg of grade fractions — 8mm Bold ×1.15, 7–8mm ×1.05, Rejection ×0.80
- **Auction commission** (exit Option B): 1% + 18% GST
- **Client types**: Planter (PAN required), SBL Dealer (GST required), GST-only Trader (GST required)
- **Grades**: AGEB, AGB, 8mm Bold, 7mm, 6mm, Mixed
- **Depots**: Kumily, Kollaparachal

## Blob Storage Key Patterns

| Prefix | Contents |
|---|---|
| `sepl-consignors/<C001>.json` | Consignor/client records |
| `sepl-transactions/<T001>.json` | Intake/transaction records with audit log |
| `sepl-otp/<phone>.json` | Pending OTPs (5-min TTL, deleted on verify) |
| `sepl-staff/<phone>.json` | Staff records (auto-created on first login) |
| `sepl-daily-price/<YYYY-MM-DD>.json` | Manual daily price entries |
| `sepl-cardamom-rate/latest.json` | Scraped Spices Board rate cache |
| `sepl-cardamom-rate/override.json` | Manual price override |
| `sepl-sample-photos/...` | Cardamom sample photos (1-year cache) |
| `requests/<id>.json` | SMTC feature requests |
| `files/<id>/<name>` | Files attached to SMTC requests |
| `whatsapp-outbox/...` | Failed/stubbed WhatsApp sends (audit trail) |

IDs auto-increment: consignors `C001, C002, …`; transactions `T001, T002, …`.

## Design System

All pages use `css/style.css` for CSS variables and shared components. Never use literal hex — reference variables:

- **Fonts**: `var(--font-heading)` = Syne, `var(--font-body)` = Poppins
- **Key colors**: `--green-primary` (#6B9548), `--green-dark` (#2D5016), `--cream` (#F5F1ED), `--brown` (#3D2817), `--button-dark` (#3D2817)
- **Date format**: `toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })` → "24 April 2026"
- **Currency**: `'₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })`

SEPL pages use `../../css/style.css` (two levels up from `/sepl/staff/` or `/sepl/consignor/`); the SEPL landing page (`/sepl/index.html`) uses `../css/style.css`.

## Environment Variables

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Transactional email (Resend) |
| `SEPL_SESSION_SECRET` | HMAC key for JWT signing |
| `SEPL_DEV_MODE=1` | Returns OTP in API response — **remove before real launch** |
| `WHATSAPP_BRIDGE_URL` | cloudflared tunnel URL (ephemeral, must be re-set on tunnel restart) |
| `WHATSAPP_BRIDGE_SECRET` | Shared secret sent as `X-Bridge-Secret` header |
| `EDGE_CONFIG_ID` | Vercel Edge Config store ID |
| `VERCEL_API_TOKEN` | For write access to Edge Config |
| `VERCEL_TEAM_ID` | Optional, for team-scoped Edge Config writes |
| `BLOB_READ_WRITE_TOKEN` | Auto-injected by Vercel for Blob access |

## Open Work (Phase Tracker)

- **Phase 3**: Portfolio + margin/LTV dashboard — not yet built
- **Phase 4**: Admin settings UI (editable `_settings.js` values via Edge Config UI) — not yet built
- `SEPL_DEV_MODE` must be removed from Vercel env before real-user launch
- WhatsApp bridge depends on Deepak's laptop being online; trycloudflare URL rotates on tunnel restart and must be re-pushed to Vercel env vars (`VERCEL_AUTO_UPDATE=1 /Users/claude/whatsapp-mcp/refresh-tunnel.sh`)
- T&C text in `api/sepl/agreement-pdf.js` (`TNC_TEXT` constant) needs final wording confirmed by Edwin
