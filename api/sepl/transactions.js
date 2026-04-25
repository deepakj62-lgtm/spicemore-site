const { put, list } = require('@vercel/blob');
const { verifyToken } = require('./_session');
const DEFAULTS = require('./_settings');

async function readOverridesStrong() {
  const ecId = process.env.EDGE_CONFIG_ID;
  const token = process.env.VERCEL_API_TOKEN;
  const team = process.env.VERCEL_TEAM_ID;
  if (!ecId || !token) return null;
  const qs = team ? `?teamId=${team}` : '';
  const r = await fetch(`https://api.vercel.com/v1/edge-config/${ecId}/item/overrides${qs}`, {
    headers: { 'Authorization': 'Bearer ' + token }, cache: 'no-store'
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j && j.value ? j.value : null;
}

async function effectiveSettings() {
  try {
    const ov = await readOverridesStrong();
    if (!ov || typeof ov !== 'object') return DEFAULTS;
    const out = { ...DEFAULTS };
    for (const k of Object.keys(ov)) {
      if (k.startsWith('_')) continue;
      if (ov[k] && typeof ov[k] === 'object' && !Array.isArray(ov[k])) out[k] = { ...(DEFAULTS[k] || {}), ...ov[k] };
      else if (ov[k] !== undefined && ov[k] !== null && ov[k] !== '') out[k] = ov[k];
    }
    return out;
  } catch (_) { return DEFAULTS; }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function loadAll() {
  const { blobs } = await list({ prefix: 'sepl-transactions/' });
  const out = [];
  for (const b of blobs) {
    if (!b.pathname.endsWith('.json')) continue;
    try { const r = await fetch(b.url); out.push(await r.json()); } catch (_) {}
  }
  return out;
}

async function loadConsignor(id) {
  const { blobs } = await list({ prefix: 'sepl-consignors/' });
  const m = blobs.find(b => b.pathname === `sepl-consignors/${id}.json`);
  if (!m) return null;
  const r = await fetch(m.url);
  return await r.json();
}

function nextTxnId(existing) {
  const max = existing.reduce((m, t) => {
    const n = parseInt((t.txnId || '').replace('T', ''), 10);
    return isNaN(n) ? m : Math.max(m, n);
  }, 0);
  return 'T' + String(max + 1).padStart(3, '0');
}

function addDays(d, n) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    let session;
    try { session = verifyToken(req); }
    catch (e) { return res.status(401).json({ error: 'Unauthorized', details: e.message }); }

    if (req.method === 'GET') {
      const id = req.query?.id;
      const filter = req.query?.status;
      const consignorPhone = req.query?.consignorPhone;
      const all = await loadAll();

      if (id) {
        const one = all.find(t => t.txnId === id);
        if (!one) return res.status(404).json({ error: 'Not found' });
        if (session.role === 'consignor' && one.consignorPhone !== session.phone) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        return res.status(200).json({ transaction: one });
      }

      let list = all;
      if (session.role === 'consignor') {
        list = list.filter(t => t.consignorPhone === session.phone);
      } else if (consignorPhone && consignorPhone !== 'me') {
        list = list.filter(t => t.consignorPhone === consignorPhone);
      }
      if (filter === 'active') list = list.filter(t => t.status === 'Active');
      return res.status(200).json({ transactions: list });
    }

    if (req.method === 'POST') {
      if (session.role !== 'staff') return res.status(403).json({ error: 'Staff only' });
      const b = req.body || {};
      const required = ['consignorId', 'netWeightKg', 'benchmarkPricePerKg', 'depot'];
      for (const k of required) if (b[k] === undefined || b[k] === null || b[k] === '') {
        return res.status(400).json({ error: `Missing ${k}` });
      }
      if (Number(b.netWeightKg) < 250) {
        return res.status(400).json({ error: 'Minimum lot is 250 kg' });
      }
      const consignor = await loadConsignor(b.consignorId);
      if (!consignor) return res.status(404).json({ error: 'Consignor not found' });

      const SETTINGS = await effectiveSettings();
      const netWeightKg = Number(b.netWeightKg);
      const benchmarkPricePerKg = Number(b.benchmarkPricePerKg);
      const grossStockValue = netWeightKg * benchmarkPricePerKg;
      const uncapped = grossStockValue * SETTINGS.standardAdvanceRate;
      const maxAdvance = grossStockValue * SETTINGS.maxAdvanceRate;
      const advanceAmount = Math.min(uncapped, maxAdvance);
      const rate = consignor.rateAssigned || SETTINGS.annualHoldingRate;
      const dailyHoldingCharge = advanceAmount * rate / SETTINGS.daysBasis;
      const intakeDate = new Date().toISOString().slice(0, 10);
      const expectedExitDate = addDays(intakeDate, SETTINGS.standardTenureDays);
      const maxExitDate = addDays(intakeDate, SETTINGS.maxTenureDays);

      const all = await loadAll();
      const txnId = nextTxnId(all);

      const record = {
        txnId,
        consignorId: consignor.consignorId,
        consignorName: consignor.name,
        consignorPhone: consignor.phone,
        depot: b.depot,
        netWeightKg,
        benchmarkPricePerKg,
        gradeNotes: b.gradeNotes || '',
        sampleGrams: Number(b.sampleGrams) || 100,
        grossStockValue,
        advanceRateUsed: SETTINGS.standardAdvanceRate,
        advanceAmount,
        annualRateUsed: rate,
        dailyHoldingCharge,
        intakeDate,
        expectedExitDate,
        maxExitDate,
        status: 'Active',
        staffPhone: session.phone,
        staffName: session.name,
        auditLog: [{
          action: 'intake-created',
          byStaff: session.name,
          byPhone: session.phone,
          at: new Date().toISOString()
        }],
        createdAt: new Date().toISOString()
      };

      await put(`sepl-transactions/${txnId}.json`, JSON.stringify(record), {
        access: 'public', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 0
      });
      return res.status(201).json({ transaction: record });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('transactions error', e);
    return res.status(500).json({ error: 'Internal error', details: e.message });
  }
};
