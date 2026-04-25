# SEPL — Questions for Edwin (2026-04-23)

All 99 automated test assertions are green. The platform is feature-complete end-to-end. What remains are business-side calls only **Edwin can make**. Grouped by urgency.

---

## 🔴 Before real go-live (blockers)

### Q1. Staff list — who gets access, and at what permission level?
Right now any phone that passes OTP becomes a staff user. We need the real list.

| Question | What we need from Edwin |
|---|---|
| Who should have staff access? | Name + WhatsApp number for each person |
| What roles? Proposed: **Admin** (everything), **Intake** (create consignments + daily price), **Viewer** (read-only) | Confirm or revise |
| Who is **Admin**? (can change advance rates, LTV thresholds, etc.) | Edwin only? Edwin + Deepak? |
| Joshy — Intake role confirmed? | Yes / adjust |

### Q2. Go-live date and first consignor
Who is the first real planter you want to onboard, and when? We need at least one live transaction to validate the WhatsApp agreement-PDF delivery end-to-end with a real phone.

### Q3. WhatsApp channel for production
Today: OTPs + agreement PDFs flow through Deepak's personal WhatsApp account via a local bridge. This works but depends on Deepak's laptop being online.

| Option | Cost | Edwin's preference? |
|---|---|---|
| Keep personal-WhatsApp bridge | ₹0, fragile | |
| Meta WhatsApp Business API (official) | ~₹0.35/msg, rock-solid, needs business verification | |
| Twilio WhatsApp | Similar cost, quicker to set up than Meta | |

### Q4. Remove dev-mode bypass
Right now `SEPL_DEV_MODE=1` lets us read OTPs from the API response (for testing). **Confirm this is removed the day before Edwin onboards the first real planter.**

---

## 🟡 Settings Edwin should confirm (defaults are in place, but he owns them)

These all live in the admin UI (`/sepl/staff/settings.html`) — Edwin can change any of them himself.

| Setting | Current default | Confirm / revise |
|---|---|---|
| Standard advance rate | 65% | |
| Maximum advance cap (hard) | 70% | |
| Annual holding charge | 21% p.a. | |
| Days basis | 365 | |
| Standard tenure | 90 days | |
| Max tenure (with approval) | 120 days | |
| LTV — monitor | 75% | |
| LTV — margin call | 80% | |
| LTV — sell w/ 48h notice | 85% | |
| LTV — forced sale | 90% | |
| Auction commission | 1% | |
| GST on commission | 18% | |
| Min lot size | 250 kg | |
| Sample collected | 100 g | |

### Q5. Should we put a warning on the Settings screen?
**This is the one Claude wants to flag specifically.** When Edwin changes a rate (e.g. drops advance from 65% to 60%), the change now takes effect instantly on the next consignment intake — we just rebuilt the settings layer (Vercel Edge Config) to guarantee that. But:

- A setting change applies **only to new consignments** from that moment onward. Existing active consignments keep the rate they were created at.
- Is that the right behaviour? Or should past consignments be re-priced when rates change?

**Claude's recommendation:** past consignments keep their original rate (standard practice for loans). The Settings screen should show a banner: *"Changes apply to new consignments only. Existing positions keep the rate they were created at."* — confirm?

---

## 🟢 Nice-to-haves (not blocking launch)

### Q6. Subdomain — `sepl.spicemore.com`?
Currently the app is at `spicemore.com/sepl/`. Moving it to `sepl.spicemore.com` is cosmetic — worth the DNS change?

### Q7. Daily Spices Board price — manual or auto?
Joshy enters it manually each morning. Should we build a scraper to pull the previous day's AGEB closing price automatically? (Slightly risky — Spices Board page structure can change.)

### Q8. Staff list seeding
Once Q1 is answered, we seed the staff records so new OTP logins land with the correct role automatically.

### Q9. PAN / Aadhaar / bank doc uploads
Right now we store the numbers (PAN, IFSC, bank A/c, Spices Board reg). Do we also need to store scanned PDFs/images of the actual documents in the platform, or is that handled separately?

### Q10. Report formats Edwin wants
What does Edwin want to see on a weekly/monthly basis? e.g. a Sunday-night PDF summarising all active positions, LTV movements, accrued holding charges, upcoming expiries? We can auto-generate and WhatsApp it.

---

## Status snapshot for Edwin

- ✅ Staff can onboard consignors with full KYC (PAN, Aadhaar, Spices Board reg, bank)
- ✅ Intake creates a consignment with live advance (capped at 70%) and daily holding charge calculation
- ✅ Agreement PDF auto-generates with real T&C (Sections A-H verbatim from Edwin's sheet) and WhatsApps to consignor
- ✅ Consignors can log in and see their positions with a live price calculator (exit-date → expected-balance)
- ✅ Portfolio dashboard shows all active positions with LTV colour bands and 30-day accrual projection
- ✅ Settings admin UI — Edwin changes rates/thresholds without needing a developer
- ✅ Daily Spices Board price entered by Joshy, feeds into LTV math
- ✅ Role isolation: consignors cannot see each other's data; unauth requests blocked on all write endpoints
- ✅ 99/99 automated scenarios passing end-to-end on spicemore.com
