const { list } = require('@vercel/blob');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { verifyToken } = require('./_session');
const { sendWhatsAppDocument } = require('./_whatsapp');

const PROGRAMME_TERMS = [
  ['Holding Charge',
    'The daily holding charge accrues from the date of advance disbursement on every calendar day, ' +
    'including Sundays and public holidays. No charge is waived once accrued.'],
  ['Tenure',
    'The advance is extended for a maximum of 90 days from the date of intake. Extensions beyond the ' +
    'Latest Release Date require prior written approval from the Company.'],
  ['Margin Monitoring',
    'The Company monitors the ratio of advance plus accrued charges against the prevailing market value ' +
    'of the stock on a daily basis. Should this ratio approach or exceed the Company\'s internal ' +
    'thresholds, the Company may issue a margin notice and require partial repayment or stock release. ' +
    'In cases of significant margin breach, the Company reserves the right to act to protect its ' +
    'interest with reasonable notice to the client.'],
  ['Stock Custody',
    'Stock is held at the Company\'s designated depot. The Company is not liable for natural quality ' +
    'deterioration beyond normal storage conditions. Periodic physical verification of stock may be ' +
    'conducted at any time.'],
  ['Settlement',
    'All accrued charges and applicable costs are settled before any balance is remitted or stock is ' +
    'released to the client.'],
  ['Governing Law',
    'All disputes are subject to the jurisdiction of Peerumedu Courts.'],
];

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
  const pdf    = await PDFDocument.create();
  const font   = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold   = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const inr = n => 'Rs.' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

  const W = 595, H = 842, lm = 60, rm = 535;
  const green = rgb(0.12, 0.30, 0.16);
  const gray  = rgb(0.42, 0.42, 0.42);

  const addPage = () => pdf.addPage([W, H]);
  let page = addPage();
  let y = 790;

  const line = (txt, f = font, size = 10, color = rgb(0, 0, 0), x = lm) => {
    if (y < 70) { page = addPage(); y = 790; }
    page.drawText(String(txt), { x, y, size, font: f, color });
    y -= size + 5;
  };

  const center = (txt, f, size, color) => {
    const tw = f.widthOfTextAtSize(txt, size);
    line(txt, f, size, color, Math.max(lm, (W - tw) / 2));
  };

  const rule = (thickness = 0.5, col = rgb(0.65, 0.65, 0.65)) => {
    if (y < 70) { page = addPage(); y = 790; }
    page.drawLine({ start: { x: lm, y: y + 4 }, end: { x: rm, y: y + 4 }, thickness, color: col });
    y -= 9;
  };

  const gap = n => { y -= n; };

  const section = (txt) => {
    gap(8);
    line(txt, bold, 10, green);
    rule(0.4, rgb(0.7, 0.7, 0.7));
  };

  // ── Header ────────────────────────────────────────────────────────────────
  center('SPICEMORE GROUP', bold, 15, green);
  gap(2);
  center('CARDAMOM STOCK ADVANCE', bold, 11, green);
  center('Programme Acknowledgement', italic, 10, gray);
  gap(5);
  rule(0.8, rgb(0.3, 0.3, 0.3));
  gap(2);
  line(`Document Ref: ${txn.txnId}   |   Date of Issue: ${txn.intakeDate}`, font, 9, gray);
  gap(6);

  // ── Parties ───────────────────────────────────────────────────────────────
  section('PARTIES');
  line('Company:   SpiceMore Group', font, 10);
  line(`Client:    ${consignor.name} (${consignor.consignorId}) — ${consignor.type}`, font, 10);
  line(`Phone:     ${consignor.phone}   PAN: ${consignor.pan || '—'}`, font, 10);
  if (consignor.spicesBoardReg) line(`Spices Board Reg:   ${consignor.spicesBoardReg}`, font, 10);

  // ── Stock Details ─────────────────────────────────────────────────────────
  section('STOCK DETAILS');
  line(`Net Weight:               ${Number(txn.netWeightKg).toLocaleString('en-IN')} kg`, font, 10);
  if (txn.gradeNotes) line(`Grade / Notes:            ${txn.gradeNotes}`, font, 10);
  line(`Depot:                    ${txn.depot}`, font, 10);
  line(`Date of Intake:           ${txn.intakeDate}`, font, 10);
  line(`Benchmark Price at Intake:  ${inr(txn.benchmarkPricePerKg)} / kg`, font, 10);
  line(`Gross Stock Value:          ${inr(txn.grossStockValue)}`, font, 10);
  if (txn.samplePct) line(`Sample Collected:         ${txn.samplePct}%`, font, 10);

  // ── Financial Terms ───────────────────────────────────────────────────────
  section('FINANCIAL TERMS');
  line(`Advance Disbursed:        ${inr(txn.advanceAmount)}`, font, 10);
  line(`Daily Holding Charge:     ${inr(txn.dailyHoldingCharge)}  (Rs.60 per day per Rs.1,00,000 of advance)`, font, 10);
  line(`Latest Release Date:      ${txn.maxExitDate}  (90 days from date of intake)`, font, 10);
  line(`Disbursement Account:     ${consignor.bankAccount || '—'}  (IFSC: ${consignor.ifsc || '—'})`, font, 10);
  line('Disbursement Mode:        NEFT / RTGS within 24 hours of intake and documentation.', font, 10);

  // ── Programme Terms ───────────────────────────────────────────────────────
  section('PROGRAMME TERMS');
  for (let i = 0; i < PROGRAMME_TERMS.length; i++) {
    const [title, body] = PROGRAMME_TERMS[i];
    line(`${i + 1}.  ${title}`, bold, 10);
    for (const ln of wrap(body, 84)) {
      line('    ' + ln, font, 10);
    }
    gap(3);
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  gap(6);
  rule(0.8, rgb(0.3, 0.3, 0.3));
  gap(2);
  for (const ln of [
    'This is a computer-generated programme acknowledgement issued by SpiceMore Group. It is not a',
    'negotiable instrument and does not require a physical signature. The terms above govern the stock',
    'advance extended to the client named in this document.',
    '',
    'For queries: Joshy Joseph  —  62824 89418  |  joshy.joseph@spicemore.com',
  ]) {
    line(ln, italic, 9, gray);
  }

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
      res.setHeader('Content-Disposition', `inline; filename="SpiceMore-StockAdvance-${txnId}.pdf"`);
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
        `SpiceMore-StockAdvance-${txnId}.pdf`,
        'Your SpiceMore stock advance acknowledgement'
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
