import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getJSON, json, corsHeaders, preflight } from '../_blob.js';
import { verifyAny } from './_session.js';
import { sendWhatsAppDocument } from './_whatsapp.js';

const PROGRAMME_TERMS = [
  ['Holding Charge',
    'The daily holding charge accrues without interruption from the date of advance disbursement and continues to accrue on each calendar day, including Sundays and public holidays. Accrued charges are not waivable under any circumstances, whether by passage of time, custom, or any representation by either party.'],
  ['Tenure',
    'The advance facility is granted for a maximum period of ninety (90) calendar days from the date of intake. Any extension beyond the Latest Release Date shall require express prior written approval from the Company and shall be subject to such revised terms as the Company may in its sole discretion determine.'],
  ['Margin Monitoring',
    'The Company shall monitor the ratio of advance disbursed plus accrued holding charges against the prevailing market value of the deposited stock on a continuous basis. Should this ratio approach or breach the Company\'s internal threshold, the Company may issue a margin notice requiring partial repayment of the advance or partial release of deposited stock. In cases of material margin breach, the Company reserves the right to exercise its lien over the deposited stock without further notice to the client.'],
  ['Stock Custody',
    'The deposited stock shall be held at the Company\'s designated depot under standard storage conditions. The Company shall not be liable for natural quality deterioration inherent to the commodity or arising from its characteristics. The Company reserves the right to conduct physical verification of the deposited stock at any time without prior notice to the client.'],
  ['Settlement & Release',
    'Release of the deposited stock or any balance proceeds is strictly conditional upon full and final settlement of all accrued holding charges, applicable commissions, taxes, and any other amounts due to the Company. The Company\'s computation of all amounts due shall be final and binding absent manifest error, and no stock or proceeds shall be released pending such settlement.'],
];

function wrap(text, max) {
  const out = [];
  for (const raw of text.split('\n')) {
    if (raw.length <= max) { out.push(raw); continue; }
    const words = raw.split(' ');
    let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length > max) { out.push(line); line = w; }
      else line = (line ? line + ' ' : '') + w;
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
  const fmtDate = iso => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return `${parseInt(d, 10)} ${months[parseInt(m,10)-1]} ${y}`;
  };
  const W = 595, H = 842, lm = 55, rm = 545;
  const green = rgb(0.12, 0.30, 0.16);
  const gray  = rgb(0.42, 0.42, 0.42);
  const labelCol = rgb(0.32, 0.32, 0.32);

  const page = pdf.addPage([W, H]);
  let y = 790;

  const line = (txt, f = font, sz = 10, col = rgb(0,0,0), x = lm) => {
    page.drawText(String(txt), { x, y, size: sz, font: f, color: col });
    y -= sz + 5;
  };
  const center = (txt, f, sz, col) => {
    const tw = f.widthOfTextAtSize(txt, sz);
    line(txt, f, sz, col, Math.max(lm, (W - tw) / 2));
  };
  const rule = (thickness = 0.5, col = rgb(0.65, 0.65, 0.65)) => {
    page.drawLine({ start: { x: lm, y: y+4 }, end: { x: rm, y: y+4 }, thickness, color: col });
    y -= 9;
  };
  const gap = n => { y -= n; };
  const section = txt => { gap(5); line(txt, bold, 10, green); rule(0.4, rgb(0.7,0.7,0.7)); };

  // Compute value column x from widest label so all values align perfectly
  const kvLabels = [
    'Name', 'Type', 'Phone', 'PAN', 'GST Reg', 'Spices Board Reg',
    'Net Weight', 'Depot', 'Date of Intake', 'Price at Intake', 'Gross Stock Value',
    'Advance Disbursed', 'Daily Holding Charge', 'Latest Release Date',
    'Disbursement Account', 'Disbursement Mode',
  ];
  const vx = lm + Math.max(...kvLabels.map(l => font.widthOfTextAtSize(l + ':', 10))) + 10;

  const kv = (label, value) => {
    page.drawText(label + ':', { x: lm, y, size: 10, font, color: labelCol });
    page.drawText(String(value ?? '—'), { x: vx, y, size: 10, font, color: rgb(0,0,0) });
    y -= 15;
  };

  // ── Header ──
  center('SPICEMORE GROUP', bold, 15, green);
  gap(2);
  center('CARDAMOM STOCK ADVANCE', bold, 11, green);
  center('Acknowledgement Receipt', italic, 10, gray);
  gap(5);
  rule(0.8, rgb(0.3,0.3,0.3));
  gap(2);
  line(`Transaction Reference: ${txn.txnId}   |   Date of Issue: ${fmtDate(txn.intakeDate)}`, font, 9, gray);
  gap(5);

  // ── Client Details ──
  section('CLIENT DETAILS');
  kv('Name', consignor.name);
  kv('Type', consignor.type);
  kv('Phone', consignor.phone);
  if (consignor.type === 'Planter') {
    kv('PAN', consignor.pan || '—');
  } else {
    kv('GST Reg', consignor.gstReg || '—');
  }
  if (consignor.spicesBoardReg) kv('Spices Board Reg', consignor.spicesBoardReg);

  // ── Stock Details ──
  section('STOCK DETAILS');
  kv('Net Weight', Number(txn.netWeightKg).toLocaleString('en-IN') + ' kg');
  kv('Depot', txn.depot);
  kv('Date of Intake', fmtDate(txn.intakeDate));
  kv('Price at Intake', inr(txn.benchmarkPricePerKg) + ' / kg');
  kv('Gross Stock Value', inr(txn.grossStockValue));

  // ── Financial Terms ──
  section('FINANCIAL TERMS');
  kv('Advance Disbursed', inr(txn.advanceAmount));
  kv('Daily Holding Charge', inr(txn.dailyHoldingCharge) + '  (Rs.60 per day per Rs.1,00,000 of advance)');
  kv('Latest Release Date', fmtDate(txn.maxExitDate) + '  (90 days from date of intake)');
  kv('Disbursement Account', (consignor.bankAccount || '—') + '  (IFSC: ' + (consignor.ifsc || '—') + ')');
  kv('Disbursement Mode', 'NEFT / RTGS within 24 hours of intake and documentation.');

  // ── Programme Terms ──
  section('PROGRAMME TERMS');
  for (let i = 0; i < PROGRAMME_TERMS.length; i++) {
    const [title, body] = PROGRAMME_TERMS[i];
    line(`${i + 1}.  ${title}`, bold, 10);
    for (const ln of wrap(body, 85)) line('    ' + ln, font, 10);
    gap(2);
  }

  // ── Footer ──
  gap(4);
  rule(0.8, rgb(0.3,0.3,0.3));
  gap(2);
  for (const fl of wrap(
    'This is a computer-generated acknowledgement receipt issued by SpiceMore Group. It is not a negotiable instrument ' +
    'and does not require a physical signature. The terms above govern the stock advance extended to the client named in ' +
    'this document. All disputes are subject to the jurisdiction of Peerumedu Court. ' +
    'For queries reach us at sales@spicemore.com', 105
  )) line(fl, italic, 8.5, gray);

  return await pdf.save();
}

function bytesToBase64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();
  const bucket = env.BLOB_BUCKET;
  const url = new URL(request.url);

  if (request.method === 'GET') {
    try {
      await verifyAny(request, env);
      const txnId = url.searchParams.get('txnId');
      if (!txnId) return json({ error: 'txnId required' }, { status: 400 });
      const txn = await getJSON(bucket, `sepl-transactions/${txnId}.json`);
      if (!txn) return json({ error: 'Transaction not found' }, { status: 404 });
      const consignor = await getJSON(bucket, `sepl-consignors/${txn.consignorId}.json`);
      if (!consignor) return json({ error: 'Consignor not found' }, { status: 404 });
      const buf = await buildPdf(txn, consignor);
      return new Response(buf, {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `inline; filename="SpiceMore-StockAdvance-${txnId}.pdf"`,
          ...corsHeaders()
        }
      });
    } catch (e) {
      const status = (e.message || '').toLowerCase().includes('token') ? 401 : 500;
      return json({ error: e.message }, { status });
    }
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  try {
    let session;
    try { session = await verifyAny(request, env); }
    catch (e) { return json({ error: 'Unauthorized', details: e.message }, { status: 401 }); }

    const { txnId, sendWhatsApp } = await request.json().catch(() => ({}));
    if (!txnId) return json({ error: 'txnId required' }, { status: 400 });

    const txn = await getJSON(bucket, `sepl-transactions/${txnId}.json`);
    if (!txn) return json({ error: 'Transaction not found' }, { status: 404 });
    const consignor = await getJSON(bucket, `sepl-consignors/${txn.consignorId}.json`);
    if (!consignor) return json({ error: 'Consignor not found' }, { status: 404 });

    const buf = await buildPdf(txn, consignor);

    let whatsappResult = null;
    if (sendWhatsApp !== false) {
      whatsappResult = await sendWhatsAppDocument(env,
        consignor.phone, buf,
        `SpiceMore-StockAdvance-${txnId}.pdf`,
        'Your SpiceMore stock advance acknowledgement'
      );
    }

    return json({
      ok: true, txnId,
      bytes: buf.length,
      whatsapp: whatsappResult,
      base64: bytesToBase64(buf)
    });
  } catch (e) {
    console.error('agreement-pdf error', e);
    return json({ error: 'Internal error', details: e.message }, { status: 500 });
  }
}
