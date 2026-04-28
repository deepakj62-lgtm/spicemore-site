// Bulk NEFT/RTGS file generator. GET → CSV; POST { batch_id, action:'confirm_sent', bank_reference }
import { listKeys, getJSON, putJSON, putObject, json, corsHeaders, preflight } from './_blob.js';

function safe(s) { return '"' + String(s || '').replace(/"/g, '""') + '"'; }

function generateCsv(rows, format, env) {
  if (format === 'axis') {
    const header = ['Payment Type','Debit Account','Beneficiary Name','Beneficiary Account','IFSC','Amount','Narration','Reference'].join(',');
    const body = rows.map(r => [
      r.mode || 'NEFT', env.AXIS_DEBIT_ACCOUNT || '',
      safe(r.beneficiary_name), r.beneficiary_account, r.beneficiary_ifsc,
      (r.amount || 0).toFixed(2), safe((r.purpose || '').slice(0, 30)), r.id
    ].join(',')).join('\n');
    return header + '\n' + body + '\n';
  }
  if (format === 'sbi') {
    const header = ['TxnType','DebitA/c','BenefName','BenefA/c','IFSC','Amount','Purpose','ClientRef'].join(',');
    const body = rows.map(r => [
      r.mode || 'NEFT', env.SBI_DEBIT_ACCOUNT || '',
      safe(r.beneficiary_name), r.beneficiary_account, r.beneficiary_ifsc,
      (r.amount || 0).toFixed(2), safe((r.purpose || '').slice(0, 30)), r.id
    ].join(',')).join('\n');
    return header + '\n' + body + '\n';
  }
  const header = ['ReferenceId','Mode','BeneficiaryName','BeneficiaryAccount','IFSC','Amount','Narration'].join(',');
  const body = rows.map(r => [
    r.id, r.mode || 'NEFT', safe(r.beneficiary_name), r.beneficiary_account, r.beneficiary_ifsc,
    (r.amount || 0).toFixed(2), safe((r.purpose || '').slice(0, 30))
  ].join(',')).join('\n');
  return header + '\n' + body + '\n';
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();
  const bucket = env.BLOB_BUCKET;
  const url = new URL(request.url);

  try {
    if (request.method === 'GET') {
      const format = (url.searchParams.get('format') || 'generic').toLowerCase();
      const items = await listKeys(bucket, 'payouts/');
      const ready = [];
      for (const it of items) {
        if (!it.key.endsWith('.json')) continue;
        const e = await getJSON(bucket, it.key);
        if (e && e.status === 'ready_for_file') ready.push(e);
      }
      if (!ready.length) {
        return new Response('No payouts ready for file.', { status: 200, headers: { 'content-type': 'text/plain', ...corsHeaders() } });
      }
      const batchId = 'BATCH-' + new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
      const csv = generateCsv(ready, format, env);
      await putObject(bucket, `batches/${batchId}.csv`, csv, 'text/csv');
      for (const e of ready) {
        const updated = { ...e, status: 'filed', batch_id: batchId, filed_at: new Date().toISOString() };
        await putJSON(bucket, `payouts/${e.id}.json`, updated);
      }
      return new Response(csv, {
        status: 200,
        headers: {
          'content-type': 'text/csv',
          'content-disposition': `attachment; filename="${batchId}-${format}.csv"`,
          'x-batch-id': batchId,
          ...corsHeaders()
        }
      });
    }

    if (request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      if (b.action !== 'confirm_sent') return json({ error: 'Unknown action' }, { status: 400 });
      const batchId = b.batch_id;
      if (!batchId) return json({ error: 'Missing batch_id' }, { status: 400 });
      const items = await listKeys(bucket, 'payouts/');
      let count = 0;
      for (const it of items) {
        if (!it.key.endsWith('.json')) continue;
        const e = await getJSON(bucket, it.key);
        if (e && e.batch_id === batchId && e.status === 'filed') {
          const updated = { ...e, status: 'sent', bank_reference: e.bank_reference || (b.bank_reference || batchId), sent_at: new Date().toISOString() };
          await putJSON(bucket, `payouts/${e.id}.json`, updated);
          count++;
        }
      }
      return json({ ok: true, batch_id: batchId, sent: count });
    }

    return json({ error: 'Method not allowed' }, { status: 405 });
  } catch (err) {
    console.error('bank-file error:', err);
    return json({ error: err.message }, { status: 500 });
  }
}
