const { put, list } = require('@vercel/blob');
const { get: edgeGet } = require('@vercel/edge-config');
const { verifyToken } = require('./_session');
const DEFAULTS = require('./_settings');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ---------- settings (folded in to stay under Vercel Hobby 12-function cap) ----------

const EDGE_KEY = 'overrides';
const EDITABLE = [
  'standardAdvanceRate', 'maxAdvanceRate', 'annualHoldingRate', 'daysBasis',
  'standardTenureDays', 'maxTenureDays',
  'ltv', 'depots', 'auctionCommission', 'gstOnCommission',
  'consignorTypes', 'grades'
];

async function loadSettingsOverrides() {
  try {
    const v = await edgeGet(EDGE_KEY);
    return v && typeof v === 'object' ? v : {};
  } catch (_) { return {}; }
}

async function writeSettingsOverrides(payload) {
  const ecId = process.env.EDGE_CONFIG_ID;
  const token = process.env.VERCEL_API_TOKEN;
  const team = process.env.VERCEL_TEAM_ID;
  const qs = team ? `?teamId=${team}` : '';
  const r = await fetch(`https://api.vercel.com/v1/edge-config/${ecId}/items${qs}`, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ operation: 'upsert', key: EDGE_KEY, value: payload }] })
  });
  if (!r.ok) throw new Error(`edge-config write failed ${r.status}: ${await r.text()}`);
  const result = await r.json();
  // Wait for edge propagation — poll SDK until new payload is visible.
  const marker = payload._lastUpdatedAt;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const v = await edgeGet(EDGE_KEY);
      if (v && v._lastUpdatedAt === marker) return result;
    } catch (_) {}
  }
  return result;
}

function mergeSettings(defaults, overrides) {
  const out = { ...defaults };
  for (const k of Object.keys(overrides || {})) {
    if (k.startsWith('_')) continue;
    if (overrides[k] && typeof overrides[k] === 'object' && !Array.isArray(overrides[k])) {
      out[k] = { ...(defaults[k] || {}), ...overrides[k] };
    } else if (overrides[k] !== undefined && overrides[k] !== null && overrides[k] !== '') {
      out[k] = overrides[k];
    }
  }
  return out;
}

async function handleSettings(req, res) {
  if (req.method === 'GET') {
    const overrides = await loadSettingsOverrides();
    return res.status(200).json({
      defaults: DEFAULTS, overrides,
      effective: mergeSettings(DEFAULTS, overrides),
      editable: EDITABLE
    });
  }
  if (req.method === 'POST') {
    let session;
    try { session = verifyToken(req); } catch (e) { return res.status(401).json({ error: 'Unauthorized', details: e.message }); }
    if (session.role !== 'staff') return res.status(403).json({ error: 'Staff only' });

    const body = req.body || {};
    const clean = {};
    for (const k of EDITABLE) if (body[k] !== undefined) clean[k] = body[k];
    clean._lastUpdatedBy = { phone: session.phone, name: session.name };
    clean._lastUpdatedAt = new Date().toISOString();

    await writeSettingsOverrides(clean);
    return res.status(200).json({ saved: true, overrides: clean, effective: mergeSettings(DEFAULTS, clean) });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

// ---------- main handler: price by default, settings when ?resource=settings ----------

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.query?.resource === 'settings') return handleSettings(req, res);

    if (req.method === 'POST') {
      let session;
      try { session = verifyToken(req); }
      catch (e) { return res.status(401).json({ error: 'Unauthorized', details: e.message }); }
      if (session.role !== 'staff') return res.status(403).json({ error: 'Staff only' });

      const { pricePerKg, grade, source } = req.body || {};
      if (!pricePerKg || !grade) return res.status(400).json({ error: 'pricePerKg and grade required' });
      const date = new Date().toISOString().slice(0, 10);
      const record = {
        date, grade, pricePerKg: Number(pricePerKg), source: source || 'Spices Board',
        enteredBy: { phone: session.phone, name: session.name },
        at: new Date().toISOString()
      };
      await put(`sepl-daily-price/${date}.json`, JSON.stringify(record), {
        access: 'public', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 0
      });
      return res.status(201).json({ price: record });
    }

    if (req.method === 'GET') {
      const { blobs } = await list({ prefix: 'sepl-daily-price/' });
      const out = [];
      for (const b of blobs) {
        if (!b.pathname.endsWith('.json')) continue;
        try { const r = await fetch(b.url); out.push(await r.json()); } catch (_) {}
      }
      out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      return res.status(200).json({ latest: out[0] || null, history: out.slice(0, 30) });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('daily-price error', e);
    return res.status(500).json({ error: 'Internal error', details: e.message });
  }
};
