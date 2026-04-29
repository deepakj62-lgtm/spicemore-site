# Vercel → Cloudflare Pages migration

## Why
- Vercel Hobby caps at 12 serverless functions; this repo has 25 API files (15 root + 10 sepl) and deploys were silently truncating at "Deploying outputs" — `/api/attend-data` and others were returning 404 in production.
- Cloudflare Pages Functions has no per-function count limit (everything bundles into one Worker).
- R2 replaces `@vercel/blob` (free egress, no per-file URL).

## What changed

### API surface
- All handlers moved from `api/*.js` (Vercel format: `module.exports = async (req, res) => …`) to `functions/api/*.js` (Pages Functions format: `export async function onRequest(context) { return new Response(…) }`).
- `_blob.js`, `_email.js`, `_session.js`, `_settings.js`, `_whatsapp.js`, `_whatsapp-meta-draft.js` are helper modules — Pages Functions ignores files starting with `_` for routing.
- New tiny endpoint `functions/api/r2-get.js` proxies a single R2 object by key. Frontend uploads now get back a `key` plus a `/api/r2-get?key=…` URL instead of the public blob URL `@vercel/blob` used to return. (The old `url` field is preserved for compatibility but it now points at this proxy.)

### Storage
- `@vercel/blob` → R2. Single bucket `spicemore-blob`, bound twice in `wrangler.toml`:
  - `BLOB_BUCKET` (used by everything)
  - `ATTENDANCE_BUCKET` (alias, used by `attend-*` handlers per the brief)
- Keys preserved exactly: `attendance/data.json`, `requests/<id>.json`, `payouts/<id>.json`, `sepl-otp/<phone>.json`, `sepl-consignors/<id>.json`, `sepl-transactions/<id>.json`, `sepl-cardamom-rate/latest.json`, `sepl-daily-price/<date>.json`, `auction-responses/q<NN>/…`, `suggestions/<id>.json`, `whatsapp-outbox/…`, etc.
- R2 has no built-in public URL. Old `await fetch(blob.url)` patterns rewritten to `await bucket.get(key); await obj.json()`. Old code that returned `blob.url` to the frontend now returns `keyToUrl(key)` (which resolves to `/api/r2-get?key=…`).

### Edge Config → R2
- `@vercel/edge-config` (used in `sepl/daily-price.js` for runtime settings overrides) replaced with `sepl-settings/overrides.json` in R2. Same merge semantics.

### Auth
- `sepl/_session.js` rewritten with Web Crypto (`crypto.subtle`) instead of Node `crypto.createHmac`. `verifyToken` is now async — call sites updated.

### Cron — TODO (post-deploy)
- Vercel cron `30 12 * * *` → `/api/sepl/daily-price?resource=cardamom-rate&refresh=1` is **not yet ported**. Pages Functions don't support scheduled events directly.
- After first deploy, create a separate scheduled Worker:
  - `wrangler init spicemore-cron --type=scheduled`
  - In the Worker, `fetch('https://spicemore.com/api/sepl/daily-price?resource=cardamom-rate&refresh=1')`
  - `wrangler.toml`: `[triggers] crons = ["30 12 * * *"]`
  - `wrangler deploy`

## Deploying
1. `cd` into the repo.
2. `wrangler login` (one-time).
3. Create the R2 bucket: `wrangler r2 bucket create spicemore-blob`
4. **Migrate existing blob data → R2**: `@vercel/blob` keys live in Vercel's blob store. They need to be downloaded and re-uploaded to R2 with identical keys. Quick script:
   ```bash
   # On a machine with VERCEL_BLOB_READ_WRITE_TOKEN env set:
   # for each blob in @vercel/blob:list(), fetch & re-upload to R2 via `wrangler r2 object put spicemore-blob/<key> --file=<download>`.
   ```
   Or do it lazily: empty bucket = handlers see `null` and synthesize defaults (attend-data uses `defaultData()`, others return empty lists). Re-seed FY27 attendance via the dashboard's "Seed FY27" button.
5. `wrangler pages project create spicemore-site --production-branch=main`
6. `wrangler pages deploy . --project-name=spicemore-site`
7. Set secrets (see list below).
8. Smoke-test: `/api/attend-data`, `/api/requests`, `/api/sepl/daily-price?resource=cardamom-rate`.
9. Deploy the cron Worker (see above).
10. Cut DNS over.

## Required secrets
Found by scanning the codebase. Set each via `wrangler pages secret put <NAME> --project-name=spicemore-site`.

| Secret | Used by |
|---|---|
| `RESEND_API_KEY` | `requests`, `request-update`, `attend-apply`, `send-email`, `_email.js` |
| `ANTHROPIC_API_KEY` | `auction-clean`, `transcribe-clean` |
| `GROQ_API_KEY` | `transcribe-audio` |
| `SEPL_SESSION_SECRET` | `sepl/_session.js` (HMAC signing key — pick a long random string) |
| `SEPL_DEV_MODE` | `sepl/auth-request-otp` (set to `1` to return OTP in response while WhatsApp bridge is offline) |
| `ERPNEXT_URL` / `ERPNEXT_API_KEY` / `ERPNEXT_API_SECRET` / `ERP_PROXY_SECRET` | `erp.js` |
| `WHATSAPP_BRIDGE_URL` / `WHATSAPP_BRIDGE_SECRET` | `sepl/_whatsapp.js`, `sepl/auth-request-otp.js`, `sepl/agreement-pdf.js` |
| `META_WHATSAPP_TOKEN` / `META_WHATSAPP_PHONE_NUMBER_ID` / `META_WHATSAPP_BUSINESS_ACCOUNT_ID` | `sepl/_whatsapp-meta-draft.js` (only when promoted) |
| `AXIS_API_BASE` / `AXIS_CLIENT_ID` / `AXIS_CLIENT_SECRET` / `AXIS_CORP_CODE` / `AXIS_CORP_USER_ID` / `AXIS_DEBIT_ACCOUNT` / `AXIS_TOKEN_PATH` / `AXIS_PAYMENT_PATH` | `bank-payout.js`, `bank-file.js` |
| `SBI_API_BASE` / `SBI_CLIENT_ID` / `SBI_CLIENT_SECRET` / `SBI_CORP_ID` / `SBI_DEBIT_ACCOUNT` / `SBI_TOKEN_PATH` / `SBI_PAYMENT_PATH` | `bank-payout.js`, `bank-file.js` |
| `SIB_API_BASE` / `SIB_CLIENT_ID` / `SIB_CLIENT_SECRET` / `SIB_CORP_ID` / `SIB_DEBIT_ACCOUNT` / `SIB_PAYMENT_PATH` | `bank-payout.js` |

The following are removed (Vercel-specific, no longer needed): `EDGE_CONFIG_ID`, `VERCEL_API_TOKEN`, `VERCEL_TEAM_ID`.

## DNS switch
After Cloudflare Pages deploy succeeds and `*.pages.dev` smoke-tests green:

1. In the Cloudflare Pages project → **Custom domains** → add `spicemore.com` and `www.spicemore.com`. Cloudflare will give you the target CNAME / A records.
2. At the DNS provider:
   - Replace the existing `A`/`CNAME` for `spicemore.com` → Cloudflare Pages target.
   - Replace `CNAME www` → Cloudflare Pages target.
   - **Do not touch `MX`, `TXT` (SPF/DKIM/DMARC), or any mail-related records.** Email keeps flowing through whoever's hosting it today.
3. TTL during cutover: drop to 300s an hour ahead, raise back after.
4. Once DNS propagates and the site loads, delete the Vercel project (or pause it) so it stops receiving traffic.

## Frontend impact
No HTML/CSS/JS frontend files were touched in this migration. One subtle behavior change: file uploads (in `requests`, `auction-response`, `request-update`, `suggestions`, `sepl/transactions` upload-blob) used to return a public Vercel blob URL. They now return both a `key` and a relative `url` like `/api/r2-get?key=…`. Frontend code that just renders `file.url` in an `<a href>` keeps working. Frontend code that POSTed the URL elsewhere expecting it to be world-readable will break — search for the few HTML files that store these URLs and confirm.

## Files affected
- **Created**: `functions/api/_blob.js`, `functions/api/_email.js`, `functions/api/r2-get.js`, plus 14 root handlers + 9 sepl handlers + 4 sepl helpers.
- **Modified**: `package.json` (drop `@vercel/blob`, `@vercel/edge-config`; add `"type": "module"`), `.gitignore` (add `.wrangler`, `.dev.vars`).
- **Created at repo root**: `wrangler.toml`, this file.
- **Deleted**: `vercel.json`, `api/` directory.

## Watchpoints / human-review items
1. **Data migration is not automated.** First deploy starts with an empty bucket. The attendance dashboard, request board, payout queue, etc. will all look empty until either old blob data is copy-up'd or new data is entered. The attendance page has a "Seed FY27" button that will repopulate it.
2. **`sepl/_session.js` is now async.** All call sites in this branch were updated, but if anything outside this migration imports it, double-check.
3. **`agreement-pdf.js`** — PDF buffer is a `Uint8Array` now (used to be a Node `Buffer`). `bytesToBase64` does the safe conversion. `pdf-lib` works fine in Workers under `nodejs_compat`.
4. **`bank-file.js` / `bank-payout.js`** were not on the explicit migration scope but were converted because they share the blob backend; smoke-test these adapters specifically.
5. **WhatsApp bridge** is at `localhost:8080` on Deepak's Mac — it must be reachable via the cloudflared tunnel `WHATSAPP_BRIDGE_URL` for OTP delivery from Cloudflare's edge.
6. **Crons are TODO** — see above. Until the scheduled Worker is deployed, the cardamom rate will refresh on first GET each day (cache TTL 6h) instead of at 12:30 UTC.

## Username/password auth (added)

Replaced every hardcoded gate (`123456`, `spice123`, tools' `simpleHash` check) with cookie-based real auth backed by R2.

### One-time setup (must run before deploy is useful)

1. Generate a session secret and set it as a Pages secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" >> .env.prod
   wrangler pages secret put AUTH_SECRET --project-name=spicemore-site
   # paste the value from .env.prod when prompted
   ```
2. Seed the staff accounts:
   ```bash
   node scripts/seed-staff.mjs
   wrangler r2 object put spicemore-attendance/auth/accounts.json --file=/tmp/accounts.json --remote
   ```
3. Deploy:
   ```bash
   wrangler pages deploy . --project-name=spicemore-site --commit-dirty=true --branch=main
   ```

### Endpoints
- `POST /api/auth/login` — body `{username, password}`. Username = 10-digit mobile (auto-strips +91, leading 0, spaces). Sets HttpOnly cookie `sm_session` (Domain=spicemore.com, 7-day Max-Age) and returns `{ok, user}`.
- `GET /api/auth/me` — returns the current user or 401.
- `POST /api/auth/change-password` — `{currentPassword, newPassword}`. Min 6 chars, can't equal mobile.
- `POST /api/auth/logout` — clears the cookie.

### Frontend
- `assets/auth.js` is included on every gated page (`<script src="/assets/auth.js" defer></script>`). It blocks the page until `/api/auth/me` returns 200, forces password change on first login, and adds a "Sign out" pill. It also writes `sessionStorage.smtc_auth='true'` and `sessionStorage.smtc_attend_auth='true'` so existing per-page redirect logic still works.

### Watchpoints
- `auth/accounts.json` lives in R2 — back it up before each manual edit.
- Mary George (#011) and Rajamanickam (#012) share mobile `9544089380`. The seeder keeps Mary and skips Rajamanickam with a `console.warn`. Edwin to assign Rajamanickam a unique mobile, then re-seed (or hand-edit `auth/accounts.json`).
- API endpoints (`/api/attend-data`, `/api/auction-clean`, etc.) are still open at the API layer; auth is enforced at page-load via the overlay. Layer in API-level enforcement in a follow-up.
- SEPL OTP flow (`functions/api/sepl/auth-*-otp.js`) keeps its own session; the demo `123456` shortcut was removed. Converge with `/api/auth` in a follow-up.
