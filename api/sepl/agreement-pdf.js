const { list } = require('@vercel/blob');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { verifyToken } = require('./_session');
const { sendWhatsAppDocument } = require('./_whatsapp');
const SETTINGS = require('./_settings');

// Verbatim from Edwin's "Stock Advance Programme - 15 April 2026" (Google Sheet, T&C-relevant tabs), v1.0 April 2026.
const TNC_TEXT = `SEPL CARDAMOM CONSIGNMENT PROGRAMME — TERMS & CONDITIONS
Spicemore Exim Private Limited (SEPL) | Version 1.0 | April 2026 | Confidential

A. DOCUMENTS REQUIRED FROM CONSIGNOR
   1. PAN card + Aadhaar.
   2. Bank account details (for NEFT/RTGS remittance).
   3. Spices Board registration certificate (if any).
   4. GST registration (if dealer).

B. STOCK INTAKE & ADVANCE
   1. Advance up to 70% of net stock value on date of intake.
   2. Stock valuation based on previous day's Spices Board average auction
      closing price for the relevant grade.
   3. Disbursement via NEFT/RTGS only — within 24 hours of stock receipt
      and documentation.
   4. Minimum stock quantity per lot: 250 kg.
   5. A free sample of 100 g will be collected for record keeping and
      verification purpose.

C. TENURE
   1. Standard tenure: maximum of 90 days from date of intake.
   2. Extension up to 120 days by prior written approval from management.
   3. Management reserves the right to call for exit at any time if margin
      conditions are breached.

D. HOLDING CHARGE
   1. Interest equivalent to Rs60 per day per Rs1,00,000 advance (21.9% p.a.).
   2. Calculated on a 365-day basis from date of advance disbursement.
   3. Accrues every calendar day including Sundays and public holidays.
   4. No holding charge is waived for any reason once accrued.

E. MARGIN & FORCED SALE
   1. If advance plus accrued charges exceed 75% of current stock value —
      consignor will be notified to monitor.
   2. If advance plus accrued charges exceed 80% of current stock value —
      formal margin call issued, consignor must top up or partially exit
      within 7 days.
   3. If advance plus accrued charges exceed 85% of current stock value —
      Management reserves the right to sell stock with 48 hours notice.
   4. If advance plus accrued charges exceed 90% of current stock value —
      Management may sell stock immediately without further notice.
   5. Stock value for margin purposes is assessed daily based on prevailing
      Spices Board auction rates.

F. STORAGE & CUSTODY
   1. All stock physically deposited at Management designated depot —
      Kumily or Kollaparachal.
   2. Stock weighed on certified weighbridge and graded on intake — Goods
      Receipt Note (GRN) issued.
   3. Management not liable for natural quality deterioration of stock
      beyond normal storage conditions.
   4. Periodic physical stock verification may be conducted by Management
      at any time.

G. EXIT OPTIONS
   1. Option A — Buyback: Consignor repays advance + all accrued charges.
      Stock released same day upon clearance of funds.
   2. Option B — Auction via SMTC: Stock auctioned on consignor's behalf at
      next available auction. Sale proceeds applied against all dues.
      Balance after the auction commission (1% + 18% GST) is remitted to
      consignor as per the normal auction settlement terms.

H. GENERAL
   1. All disputes subject to jurisdiction of Peerumedu Courts.
   2. Management reserves the right to amend terms with 7 days notice to
      active consignors.
   3. These terms are subject to change. Current terms prevail over any
      previously communicated terms.
   4. For queries contact: Joshy Joseph — 62824 89418 |
      joshy.joseph@spicemore.com
`;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Accept token from ?t= query param (browser GET link) or Authorization header
function verifyAny(req) {
  const qt = req.query && req.query.t;
  if (qt) return verifyToken({ headers: { authorization: 'Bearer ' + qt } });
  return verifyToken(req);
}

async function loadByKey(prefix, key) {
  const { blobs } = await list({ prefix });
  const m = blobs.find(b => b.pathname === `${prefix}${key}.json`);
  if (!m) return null;
  const r = await fetch(m.url);
  return await r.json();
}

function wrap(text, max) {
  const out = [];
  for (const raw of text.split('\n')) {
    if (raw.length <= max) { out.push(raw); continue; }
    const words = raw.split(' ');
    let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length > max) {
        out.push(line);
        line = w;
      } else {
        line = (line ? line + ' ' : '') + w;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

async function buildPdf(txn, consignor) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const inr = n => 'Rs' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

  const addPage = () => pdf.addPage([595, 842]); // A4
  let page = addPage();
  let y = 800;
  const left = 50;
  const write = (txt, f = font, size = 10, color = rgb(0, 0, 0)) => {
    if (y < 60) { page = addPage(); y = 800; }
    page.drawText(String(txt), { x: left, y, size, font: f, color });
    y -= size + 4;
  };

  write('SEPL CARDAMOM CONSIGNMENT AGREEMENT', bold, 14, rgb(0.17, 0.31, 0.09));
  y -= 6;
  write(`Agreement Ref: ${txn.txnId}`, font, 10);
  write(`Intake Date: ${txn.intakeDate}`, font, 10);
  write(`Depot: ${txn.depot}`, font, 10);
  y -= 6;
  write('PARTIES', bold, 11);
  write(`SEPL: ${SETTINGS.issuer}`, font, 10);
  write(`Consignor: ${consignor.name} (${consignor.consignorId}) — ${consignor.type}`, font, 10);
  write(`Phone: ${consignor.phone}  PAN: ${consignor.pan || '-'}`, font, 10);
  write(`Spices Board: ${consignor.spicesBoardReg || '-'}`, font, 10);
  write(`Bank: ${consignor.bankAccount || '-'} (IFSC: ${consignor.ifsc || '-'})`, font, 10);
  y -= 6;
  write('STOCK & FINANCIAL TERMS', bold, 11);
  write(`Net Weight: ${txn.netWeightKg} kg`, font, 10);
  write(`Benchmark Price: ${inr(txn.benchmarkPricePerKg)} / kg`, font, 10);
  write(`Gross Stock Value: ${inr(txn.grossStockValue)}`, font, 10);
  write(`Advance Rate: ${(txn.advanceRateUsed * 100).toFixed(0)}%  Advance Amount: ${inr(txn.advanceAmount)}`, font, 10);
  write(`Holding Rate: ${(txn.annualRateUsed * 100).toFixed(1)}% p.a.  Daily Charge: ${inr(txn.dailyHoldingCharge)}`, font, 10);
  write(`Expected Exit: ${txn.expectedExitDate}  Max Exit: ${txn.maxExitDate}`, font, 10);
  write(`Grade / Notes: ${txn.gradeNotes || '-'}  Sample %: ${txn.samplePct || 0}`, font, 10);
  y -= 10;
  write('TERMS & CONDITIONS', bold, 11);
  for (const line of wrap(TNC_TEXT, 95)) {
    write(line, font, 9);
  }
  y -= 16;
  write('Signed for SEPL: ____________________    Consignor: ____________________', font, 10);

  return Buffer.from(await pdf.save());
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET ?txnId=&inline=1&t=<token> — browser link view
  if (req.method === 'GET') {
    try {
      verifyAny(req);
      const txnId = req.query && req.query.txnId;
      if (!txnId) return res.status(400).json({ error: 'txnId required' });
      const txn = await loadByKey('sepl-transactions/', txnId);
      if (!txn) return res.status(404).json({ error: 'Transaction not found' });
      const consignor = await loadByKey('sepl-consignors/', txn.consignorId);
      if (!consignor) return res.status(404).json({ error: 'Consignor not found' });
      const buf = await buildPdf(txn, consignor);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="SEPL-Agreement-${txnId}.pdf"`);
      return res.status(200).send(buf);
    } catch (e) {
      return res.status(e.message.includes('token') || e.message.includes('Token') ? 401 : 500)
        .json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let session;
    try { session = verifyAny(req); }
    catch (e) { return res.status(401).json({ error: 'Unauthorized', details: e.message }); }

    const { txnId, sendWhatsApp } = req.body || {};
    if (!txnId) return res.status(400).json({ error: 'txnId required' });

    const txn = await loadByKey('sepl-transactions/', txnId);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    const consignor = await loadByKey('sepl-consignors/', txn.consignorId);
    if (!consignor) return res.status(404).json({ error: 'Consignor not found' });

    const buf = await buildPdf(txn, consignor);

    let whatsappResult = null;
    if (sendWhatsApp !== false) {
      whatsappResult = await sendWhatsAppDocument(
        consignor.phone,
        buf,
        `SEPL-Agreement-${txnId}.pdf`,
        'Your SEPL consignment agreement'
      );
    }

    return res.status(200).json({
      ok: true,
      txnId,
      bytes: buf.length,
      whatsapp: whatsappResult,
      base64: buf.toString('base64')
    });
  } catch (e) {
    console.error('agreement-pdf error', e);
    return res.status(500).json({ error: 'Internal error', details: e.message });
  }
};
