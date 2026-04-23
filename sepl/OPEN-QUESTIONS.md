# SEPL Phase 1 — Open Questions

## Q1: WhatsApp channel — SOLVED-FOR-TESTING
Tunneled local bridge active. Meta Cloud API migration pending account approval — see `META-WABA-SETUP.md`.

**Live path:** Vercel → `cloudflared` Try-Cloudflare tunnel → `whatsapp-mcp` bridge at `localhost:8080` on Deepak's Mac → Deepak's own WhatsApp account.
- Env vars: `WHATSAPP_BRIDGE_URL`, `WHATSAPP_BRIDGE_SECRET` (production + development set)
- Bridge auth: `X-Bridge-Secret` header; secret also at `/Users/claude/whatsapp-mcp/.bridge-secret` (chmod 600)
- LaunchAgents: `com.whatsapp.bridge` (bridge) + `com.sepl.whatsapp-tunnel` (cloudflared)
- Tunnel URL file: `/Users/claude/whatsapp-mcp/tunnel-url.txt` (ephemeral trycloudflare — rotates on tunnel restart)
- Rotate + push-to-vercel: `VERCEL_AUTO_UPDATE=1 /Users/claude/whatsapp-mcp/refresh-tunnel.sh`
- Diagnostic: `GET https://spicemore.com/api/sepl/auth-request-otp?diag=whatsapp`
- Fallback: if `WHATSAPP_BRIDGE_URL` is unset or the POST fails, `_whatsapp.js` still writes to the `whatsapp-outbox/` blob and returns `{ok:true, stubbed:true}` so the app never crashes.

**Caveats:** depends on Deepak's laptop being online; trycloudflare URL is ephemeral (re-register in Vercel env on rotation, or move to a named tunnel under a Cloudflare-controlled domain).

## Q2: Subdomain DNS
**File to edit:** `vercel.json` + DNS record at registrar
**Current:** live at `/sepl/*` on spicemore.com
**To enable `sepl.spicemore.com`:** add domain in Vercel dashboard → add CNAME record pointing to `cname.vercel-dns.com`, then decide whether to rewrite `sepl.spicemore.com/*` → `/sepl/*` or rehouse the routes
**Blocks:** nothing — cosmetic

## Q3: Staff permissions matrix
**File to edit:** `api/sepl/_session.js` (add `permissions` check), each endpoint's role gate
**Current:** all authenticated staff can do everything
**Needed:** role list — e.g. `intake-only` / `approve-advance` / `admin` / `view-only` — and mapping to API actions

## Q4: Initial staff list
**File to edit:** seed `sepl-staff/<phone>.json` blob entries (schema: `{phone, name, role}`)
**Current:** any phone that completes OTP becomes staff, auto-assigned name "Staff <last4>"
**Needed:** Deepak to supply real list (phone, name, role) — Joshy is confirmed for daily-price entry

## Q5: Daily price auto-feed
**File to edit:** add a scheduled Vercel function pulling from Spices Board e-auction page
**Current:** manual entry by Joshy via `/sepl/staff/daily-price.html`
**Needed:** decide if/when to automate; Spices Board scraping vs. paid data feed

## Q6: Admin UI for settings
**File to edit:** new `sepl/staff/settings.html` + expose `api/sepl/_settings.js` via an editable blob
**Current:** settings are a JS constant — editing rates/thresholds/tenure requires a code deploy
**Needed:** Phase 4 — admin screen for Edwin / Deepak

## Q7: T&C verbatim text
**File to edit:** `api/sepl/agreement-pdf.js` — `TNC_TEXT` constant at top
**Current:** 10-clause placeholder synthesised from the programme description
**Needed:** paste the exact T&C sheet from `Stock Advance Programme - 15 April 2026.xlsx` once Edwin confirms final wording

## Q8: SEPL_DEV_MODE must be removed before real launch
**File to edit:** Vercel dashboard → Environment Variables
**Current:** `SEPL_DEV_MODE=1` returns OTP in API response so we can test without WhatsApp delivery
**Before launch:** remove this env var (or flip to 0) — once WhatsApp wire-up (Q1) is done, OTPs flow through WhatsApp only
