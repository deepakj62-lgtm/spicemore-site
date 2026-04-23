const { put, list } = require('@vercel/blob');
const { verifyToken } = require('./_session');
const SETTINGS = require('./_settings');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function loadAll() {
  const { blobs } = await list({ prefix: 'sepl-consignors/' });
  const out = [];
  for (const b of blobs) {
    if (!b.pathname.endsWith('.json')) continue;
    try {
      const r = await fetch(b.url);
      out.push(await r.json());
    } catch (_) {}
  }
  return out;
}

async function nextId(existing) {
  const max = existing.reduce((m, c) => {
    const n = parseInt((c.consignorId || '').replace('C', ''), 10);
    return isNaN(n) ? m : Math.max(m, n);
  }, 0);
  return 'C' + String(max + 1).padStart(3, '0');
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    let session;
    try { session = verifyToken(req); }
    catch (e) { return res.status(401).json({ error: 'Unauthorized', details: e.message }); }

    if (req.method === 'GET') {
      if (session.role !== 'staff') return res.status(403).json({ error: 'Staff only' });
      const id = req.query?.id;
      const all = await loadAll();
      if (id) {
        const one = all.find(c => c.consignorId === id);
        if (!one) return res.status(404).json({ error: 'Not found' });
        return res.status(200).json({ consignor: one });
      }
      return res.status(200).json({ consignors: all });
    }

    if (req.method === 'POST') {
      if (session.role !== 'staff') return res.status(403).json({ error: 'Staff only' });
      const b = req.body || {};
      if (!b.name || !b.phone) return res.status(400).json({ error: 'name and phone required' });
      const all = await loadAll();
      const consignorId = await nextId(all);
      const record = {
        consignorId,
        name: b.name,
        type: b.type || 'Planter',
        pan: b.pan || '',
        spicesBoardReg: b.spicesBoardReg || '',
        bankAccount: b.bankAccount || '',
        ifsc: b.ifsc || '',
        phone: String(b.phone).replace(/[^0-9+]/g, ''),
        depot: b.depot || SETTINGS.depots[0],
        rateAssigned: typeof b.rateAssigned === 'number' ? b.rateAssigned : SETTINGS.annualHoldingRate,
        maxExposure: b.maxExposure || 0,
        status: 'Active',
        createdBy: { phone: session.phone, name: session.name },
        createdAt: new Date().toISOString()
      };
      await put(`sepl-consignors/${consignorId}.json`, JSON.stringify(record), {
        access: 'public', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 0
      });
      return res.status(201).json({ consignor: record });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('consignors error', e);
    return res.status(500).json({ error: 'Internal error', details: e.message });
  }
};
