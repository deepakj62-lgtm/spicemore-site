// Bank payout with adapter pattern. See original api/bank-payout.js for full env doc.
import { putJSON, getJSON, listKeys, json, preflight } from './_blob.js';

function pickAdapter(paidFromAccount = '', env) {
  const a = (paidFromAccount || '').toLowerCase();
  if (a.includes('axis')) return { code: 'axis', configured: !!(env.AXIS_CLIENT_ID && env.AXIS_CLIENT_SECRET && env.AXIS_API_BASE) };
  if (a.includes('sbi') || a.includes('state bank')) return { code: 'sbi', configured: !!(env.SBI_CLIENT_ID && env.SBI_CLIENT_SECRET && env.SBI_API_BASE) };
  if (a.includes('south indian') || a.includes('sib')) return { code: 'sib', configured: !!(env.SIB_CLIENT_ID && env.SIB_CLIENT_SECRET && env.SIB_API_BASE) };
  return { code: 'file', configured: true };
}

async function save(bucket, id, entry) { await putJSON(bucket, `payouts/${id}.json`, entry); }
async function load(bucket, id) { return await getJSON(bucket, `payouts/${id}.json`); }

async function sendAxis(p, env) {
  const base = env.AXIS_API_BASE;
  const tokenPath = env.AXIS_TOKEN_PATH || '/oauth2/token';
  const payPath   = env.AXIS_PAYMENT_PATH || '/corporate/payments/v1/payout';
  const tok = await fetch(base + tokenPath, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.AXIS_CLIENT_ID, client_secret: env.AXIS_CLIENT_SECRET }).toString()
  }).then(async r => { if (!r.ok) throw new Error('Axis token: ' + await r.text()); return r.json(); });
  const r = await fetch(base + payPath, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      corpCode: env.AXIS_CORP_CODE, corpUserId: env.AXIS_CORP_USER_ID, debitAccount: env.AXIS_DEBIT_ACCOUNT,
      amount: p.amount, currency: 'INR', transactionType: p.mode,
      beneficiary: { name: p.beneficiary_name, accountNumber: p.beneficiary_account, ifsc: p.beneficiary_ifsc },
      paymentReference: p.id, narration: (p.purpose || '').slice(0, 30)
    })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.error || `Axis HTTP ${r.status}`);
  return { status: 'sent', bank_reference: j.utr || j.transactionId || j.referenceNumber || '', raw: j };
}

async function sendSbi(p, env) {
  const base = env.SBI_API_BASE;
  const tok = await fetch(base + (env.SBI_TOKEN_PATH || '/oauth/token'), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.SBI_CLIENT_ID, client_secret: env.SBI_CLIENT_SECRET }).toString()
  }).then(async r => { if (!r.ok) throw new Error('SBI token: ' + await r.text()); return r.json(); });
  const r = await fetch(base + (env.SBI_PAYMENT_PATH || '/ecorp/payments/initiate'), {
    method: 'POST', headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      corpId: env.SBI_CORP_ID, debitAccount: env.SBI_DEBIT_ACCOUNT,
      amount: p.amount, paymentMode: p.mode,
      beneficiaryName: p.beneficiary_name, beneficiaryAccount: p.beneficiary_account, beneficiaryIfsc: p.beneficiary_ifsc,
      referenceId: p.id, narration: (p.purpose || '').slice(0, 30)
    })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.error || `SBI HTTP ${r.status}`);
  return { status: 'sent', bank_reference: j.utr || j.referenceNumber || '', raw: j };
}

async function sendSib(p, env) {
  const r = await fetch(env.SIB_API_BASE + (env.SIB_PAYMENT_PATH || '/api/v1/payments'), {
    method: 'POST',
    headers: { 'X-Client-Id': env.SIB_CLIENT_ID, 'X-Client-Secret': env.SIB_CLIENT_SECRET, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      corpId: env.SIB_CORP_ID, debitAccount: env.SIB_DEBIT_ACCOUNT,
      amount: p.amount, mode: p.mode,
      beneficiary: { name: p.beneficiary_name, account: p.beneficiary_account, ifsc: p.beneficiary_ifsc },
      reference: p.id, narration: (p.purpose || '').slice(0, 30)
    })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.error || `SIB HTTP ${r.status}`);
  return { status: 'sent', bank_reference: j.utr || j.referenceNumber || '', raw: j };
}

async function queueForFile() { return { status: 'ready_for_file', bank_reference: '', error: '' }; }

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();
  const bucket = env.BLOB_BUCKET;

  try {
    if (request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const id = 'PAY-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5).toUpperCase();
      const picked = pickAdapter(b.paid_from, env);
      const entry = {
        id, createdAt: new Date().toISOString(),
        submitter: b.submitter || '', paid_from: b.paid_from || '',
        beneficiary_name: b.beneficiary_name || '',
        beneficiary_account: b.beneficiary_account || '',
        beneficiary_ifsc: b.beneficiary_ifsc || '',
        amount: Number(b.amount) || 0, purpose: b.purpose || '',
        mode: b.mode || 'NEFT',
        linked_erpnext_voucher: b.linked_erpnext_voucher || '',
        adapter: picked.code, adapter_configured: picked.configured,
        status: 'pending_approval',
        approver: '', approved_at: '', bank_reference: '', batch_id: '', error: ''
      };
      await save(bucket, id, entry);
      return json({ ok: true, id, entry }, { status: 201 });
    }

    if (request.method === 'PATCH') {
      const b = await request.json().catch(() => ({}));
      const id = b.id;
      if (!id) return json({ error: 'Missing id' }, { status: 400 });
      const cur = await load(bucket, id);
      if (!cur) return json({ error: 'Not found' }, { status: 404 });

      if (b.action === 'reject') {
        const updated = { ...cur, status: 'rejected', approver: b.approver || '', approved_at: new Date().toISOString(), notes: b.notes || '' };
        await save(bucket, id, updated);
        return json({ ok: true, entry: updated });
      }

      if (b.action === 'approve') {
        if (cur.status !== 'pending_approval') return json({ error: `Already ${cur.status}` }, { status: 400 });
        const picked = pickAdapter(cur.paid_from, env);
        const stamp = { approver: b.approver || '', approved_at: new Date().toISOString(), adapter: picked.code, adapter_configured: picked.configured };
        try {
          let result;
          if (picked.code === 'axis' && picked.configured) result = await sendAxis(cur, env);
          else if (picked.code === 'sbi' && picked.configured) result = await sendSbi(cur, env);
          else if (picked.code === 'sib' && picked.configured) result = await sendSib(cur, env);
          else result = await queueForFile();
          const updated = { ...cur, ...stamp, ...result };
          await save(bucket, id, updated);
          return json({ ok: true, entry: updated });
        } catch (e) {
          const updated = { ...cur, ...stamp, status: 'failed', error: e.message };
          await save(bucket, id, updated);
          return json({ ok: false, entry: updated }, { status: 500 });
        }
      }

      if (b.action === 'mark_file_sent') {
        const updated = { ...cur, status: 'sent', approver: b.approver || cur.approver, bank_reference: b.bank_reference || cur.batch_id, notes: b.notes || cur.notes };
        await save(bucket, id, updated);
        return json({ ok: true, entry: updated });
      }
      return json({ error: 'Unknown action' }, { status: 400 });
    }

    // GET list
    const items = await listKeys(bucket, 'payouts/');
    const entries = [];
    for (const it of items) {
      if (!it.key.endsWith('.json')) continue;
      const e = await getJSON(bucket, it.key);
      if (e) entries.push(e);
    }
    entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return json({
      entries,
      adapters: {
        axis: !!(env.AXIS_CLIENT_ID && env.AXIS_CLIENT_SECRET && env.AXIS_API_BASE),
        sbi:  !!(env.SBI_CLIENT_ID  && env.SBI_CLIENT_SECRET  && env.SBI_API_BASE),
        sib:  !!(env.SIB_CLIENT_ID  && env.SIB_CLIENT_SECRET  && env.SIB_API_BASE),
        file: true
      }
    });
  } catch (err) {
    console.error('payout error:', err);
    return json({ error: err.message }, { status: 500 });
  }
}
