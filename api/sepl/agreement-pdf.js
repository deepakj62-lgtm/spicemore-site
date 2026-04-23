const { list } = require('@vercel/blob');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { verifyToken } = require('./_session');
const { sendWhatsAppDocument } = require('./_whatsapp');
const SETTINGS = require('./_settings');

// TODO: replace with verbatim text from the T&C sheet of
// "Stock Advance Programme - 15 April 2026.xlsx". Placeholder summarises
// the programme structure from Edwin's request description.
const TNC_TEXT = `SEPL CARDAMOM CONSIGNMENT PROGRAMME — TERMS & CONDITIONS

1. Programme. Spicemore Exim Pvt Ltd ("SEPL") accepts cardamom stock on
   consignment from the Consignor and issues a cash advance against the
   assessed value of such stock ("Stock Advance").

2. Advance. The standard Stock Advance is 65% of the Gross Stock Value at
   the agreed benchmark price, subject to a hard maximum of 70%. The
   Gross Stock Value is the net weight (kg) x the benchmark price (INR/kg)
   recorded at intake.

3. Holding Charges. The Consignor shall pay daily holding charges at
   21% per annum (calculated on a 365-day basis) on the outstanding
   Stock Advance until exit.

4. Tenure. Standard tenure is 90 days from the intake date, extendable
   to a maximum of 120 days at SEPL's discretion.

5. Storage. Stock shall be held at SEPL-designated depots at Kumily or
   Kollaparachal. Title remains with the Consignor until sale; risk of
   loss insurance is Consignor's responsibility unless otherwise agreed.

6. Loan-to-Value Monitoring. SEPL will monitor the ratio of outstanding
   Stock Advance + accrued charges to current market value of the stock
   ("LTV"). Thresholds:
     - Yellow (LTV > 75%): monitoring, informational notice.
     - Orange (LTV > 80%): margin call; Consignor to top-up or reduce.
     - Red    (LTV > 85%): SEPL may sell stock on 48 hours' notice.
     - Forced (LTV > 90%): SEPL may sell stock immediately.

7. Exit. Stock may exit by (a) buyback by the Consignor at outstanding
   principal + accrued charges + expenses, or (b) sale through Spice More
   Trading Company ("SMTC") auction. Auction commission of 1% plus 18%
   GST applies on the sale value.

8. Settlement. Net sale proceeds (after commission, GST, outstanding
   advance, accrued charges and any depot / handling costs) shall be
   remitted to the Consignor's registered bank account within 7 working
   days of realised sale.

9. Representations. The Consignor warrants that the stock is
   unencumbered, of the quality represented, and that all regulatory
   registrations (PAN, Spices Board) are current and accurate.

10. Governing Law. This agreement is governed by the laws of India.
    Disputes shall be subject to the exclusive jurisdiction of courts at
    Kumily, Idukki District, Kerala.
`;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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
  const inr = n => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let session;
    try { session = verifyToken(req); }
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

    if (req.query?.inline === '1') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="SEPL-Agreement-${txnId}.pdf"`);
      return res.status(200).send(buf);
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
