import { getJSON, putJSON, listKeys, json, preflight } from '../_blob.js';
import { verifyToken } from './_session.js';
import SETTINGS from './_settings.js';

async function loadAll(bucket) {
  const items = await listKeys(bucket, 'sepl-consignors/');
  const out = [];
  for (const it of items) {
    if (!it.key.endsWith('.json')) continue;
    const c = await getJSON(bucket, it.key);
    if (c) out.push(c);
  }
  return out;
}

function nextId(existing) {
  const max = existing.reduce((m, c) => {
    const n = parseInt((c.consignorId || '').replace('C', ''), 10);
    return isNaN(n) ? m : Math.max(m, n);
  }, 0);
  return 'C' + String(max + 1).padStart(3, '0');
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();
  const bucket = env.BLOB_BUCKET;

  try {
    let session;
    try { session = await verifyToken(request, env); }
    catch (e) { return json({ error: 'Unauthorized', details: e.message }, { status: 401 }); }

    if (request.method === 'GET') {
      if (session.role !== 'staff') return json({ error: 'Staff only' }, { status: 403 });
      const url = new URL(request.url);
      const id = url.searchParams.get('id');
      const all = await loadAll(bucket);
      if (id) {
        const one = all.find(c => c.consignorId === id);
        if (!one) return json({ error: 'Not found' }, { status: 404 });
        return json({ consignor: one });
      }
      return json({ consignors: all });
    }

    if (request.method === 'POST') {
      if (session.role !== 'staff') return json({ error: 'Staff only' }, { status: 403 });
      const b = await request.json().catch(() => ({}));
      const ALLOWED_TYPES = ['Planter', 'SBL Dealer', 'GST-only Trader'];
      let type = b.type;
      if (type === 'Trader') type = 'GST-only Trader';
      if (!ALLOWED_TYPES.includes(type)) type = 'Planter';
      const requiredFields = { name: 'Name', phone: 'Phone', bankAccount: 'Bank A/C', ifsc: 'IFSC', depot: 'Depot' };
      for (const [k, label] of Object.entries(requiredFields)) {
        if (!b[k] || !String(b[k]).trim()) return json({ error: `${label} is required` }, { status: 400 });
      }
      if (type === 'Planter') {
        if (!b.pan || !String(b.pan).trim()) return json({ error: 'PAN is required for Planter' }, { status: 400 });
      } else {
        if (!b.gstReg || !String(b.gstReg).trim()) return json({ error: `GST is required for ${type}` }, { status: 400 });
      }
      const allowedRates = [0.18, 0.21, 0.24];
      const rateRaw = typeof b.rateAssigned === 'number' ? b.rateAssigned : 0.21;
      const rateAssigned = allowedRates.includes(rateRaw) ? rateRaw : 0.21;
      const all = await loadAll(bucket);
      const consignorId = nextId(all);
      const record = {
        consignorId, name: b.name, type,
        pan: b.pan || '',
        aadhaar: b.aadhaar ? String(b.aadhaar).replace(/[^0-9]/g, '') : '',
        spicesBoardReg: b.spicesBoardReg || '',
        gstReg: b.gstReg || '',
        bankAccount: b.bankAccount || '',
        ifsc: b.ifsc || '',
        phone: String(b.phone).replace(/[^0-9+]/g, ''),
        depot: b.depot || SETTINGS.depots[0],
        rateAssigned,
        maxExposure: b.maxExposure || 0,
        status: 'Active',
        createdBy: { phone: session.phone, name: session.name },
        createdAt: new Date().toISOString()
      };
      await putJSON(bucket, `sepl-consignors/${consignorId}.json`, record);
      return json({ consignor: record }, { status: 201 });
    }

    return json({ error: 'Method not allowed' }, { status: 405 });
  } catch (e) {
    console.error('consignors error', e);
    return json({ error: 'Internal error', details: e.message }, { status: 500 });
  }
}
