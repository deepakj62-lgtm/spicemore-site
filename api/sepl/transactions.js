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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
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

  if (req.query?.resource === 'upload-url' && req.method === 'POST') {
    // verify session as staff
    let session;
    try { session = verifyToken(req); }
    catch (e) { return res.status(401).json({ error: 'Unauthorized', details: e.message }); }
    if (session.role !== 'staff') return res.status(403).json({ error: 'Staff only' });

    const { filename, contentType } = req.body || {};
    if (!filename || !contentType) return res.status(400).json({ error: 'filename and contentType required' });
    if (!String(contentType).startsWith('image/')) return res.status(400).json({ error: 'Only image/* content-types accepted' });

    // Vercel Blob has no public "signed PUT URL" pattern in the standard SDK.
    // Instead: caller will POST the file body to this same endpoint with ?resource=upload-blob (multipart-style).
    // For simplicity, we instead accept a base64 payload via a single round-trip endpoint at ?resource=upload-blob.
    // Return an instruction object pointing the client at the upload-blob endpoint.
    return res.status(200).json({
      method: 'POST',
      uploadEndpoint: '/api/sepl/transactions?resource=upload-blob',
      expectsJsonBody: { filename, contentType, base64: '<base64-encoded-bytes>' },
      maxBytesHint: 4_000_000
    });
  }

  if (req.query?.resource === 'upload-blob' && req.method === 'POST') {
    let session;
    try { session = verifyToken(req); }
    catch (e) { return res.status(401).json({ error: 'Unauthorized', details: e.message }); }
    if (session.role !== 'staff') return res.status(403).json({ error: 'Staff only' });

    const { filename, contentType, base64, consignorId, depot } = req.body || {};
    if (!filename || !contentType || !base64) return res.status(400).json({ error: 'filename, contentType, base64 required' });
    try {
      const buf = Buffer.from(base64, 'base64');
      if (buf.length === 0) return res.status(400).json({ error: 'Empty payload' });
      if (buf.length > 6_000_000) return res.status(413).json({ error: 'Photo too large (max 6 MB)' });

      // Build path per Edwin's spec: <depot>/<client-name>-<YYYY-MM-DD-HHMM>.<ext>
      // Falls back to legacy <Date.now()>-<filename> when consignorId/depot missing.
      const ext = (() => {
        const m = String(filename).match(/\.([a-zA-Z0-9]{1,6})$/);
        if (m) return m[1].toLowerCase();
        if (contentType === 'image/jpeg') return 'jpg';
        if (contentType === 'image/png') return 'png';
        return 'jpg';
      })();
      const safe = (s) => String(s || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'unknown';
      const now = new Date();
      const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, '-'); // YYYY-MM-DD-HH-MM

      let key;
      if (consignorId && depot) {
        const consignor = await loadConsignor(consignorId);
        const clientName = safe(consignor?.name) || safe(consignorId);
        const depotSafe = safe(depot);
        key = `sepl-sample-photos/${depotSafe}/${clientName}-${stamp}.${ext}`;
      } else {
        const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
        key = `sepl-sample-photos/${Date.now()}-${safeName}`;
      }
      const blob = await put(key, buf, {
        access: 'public', contentType, addRandomSuffix: false, cacheControlMaxAge: 31536000
      });
      return res.status(200).json({ url: blob.url, key });
    } catch (e) {
      console.error('upload-blob error', e);
      return res.status(500).json({ error: 'Upload failed', details: e.message });
    }
  }

  // PATCH /api/sepl/transactions — update status (close a position).
  // Body: { txnId, status }   status ∈ ['Active','Closed']
  if (req.method === 'PATCH') {
    let session;
    try { session = verifyToken(req); }
    catch (e) { return res.status(401).json({ error: 'Unauthorized', details: e.message }); }
    if (session.role !== 'staff') return res.status(403).json({ error: 'Staff only' });

    const { txnId, status } = req.body || {};
    if (!txnId) return res.status(400).json({ error: 'txnId required' });
    const ALLOWED_STATUSES = ['Active', 'Closed'];
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${ALLOWED_STATUSES.join(', ')}` });
    }

    const all = await loadAll();
    const existing = all.find(t => t.txnId === txnId);
    if (!existing) return res.status(404).json({ error: 'Transaction not found' });
    if (existing.status === status) {
      return res.status(200).json({ transaction: existing, noop: true });
    }

    const updated = {
      ...existing,
      status,
      auditLog: [
        ...(existing.auditLog || []),
        {
          action: 'status-change',
          from: existing.status,
          to: status,
          byStaff: session.name,
          byPhone: session.phone,
          at: new Date().toISOString()
        }
      ],
      updatedAt: new Date().toISOString()
    };
    if (status === 'Closed' && !existing.closedAt) updated.closedAt = new Date().toISOString();

    await put(`sepl-transactions/${txnId}.json`, JSON.stringify(updated), {
      access: 'public', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 0
    });
    return res.status(200).json({ transaction: updated });
  }

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

      // Sample sanity checks
      if (b.sample && typeof b.sample === 'object') {
        const totalG = Number(b.sample.totalG) || 0;
        const boldG = Number(b.sample.bold8mmG) || 0;
        const midG = Number(b.sample.mid7to8G) || 0;
        const rejG = Number(b.sample.rejectionG) || 0;
        if (Math.abs((boldG + midG + rejG) - totalG) > 1) {
          return res.status(400).json({ error: 'Sample grades do not sum to total' });
        }
        const cardamomRateNum = Number(b.cardamomRate) || 0;
        if (cardamomRateNum > 0 && totalG > 0) {
          const pf = b.priceFactors || {};
          const pf_bold = Number(pf.bold) || 1.15;
          const pf_mid = Number(pf.mid) || 1.05;
          const pf_rej = Number(pf.rej) || 0.80;
          const pctBold = boldG / totalG;
          const pctMid = midG / totalG;
          const pctRej = rejG / totalG;
          const recomputed = cardamomRateNum * (pctBold * pf_bold + pctMid * pf_mid + pctRej * pf_rej);
          const submitted = Number(b.benchmarkPricePerKg) || 0;
          if (recomputed > 0 && Math.abs(submitted - recomputed) / recomputed > 0.05) {
            return res.status(400).json({ error: 'Sample/rate inconsistent with submitted benchmark price' });
          }
        }
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
        sampleGrams: Number(b.sampleGrams) || (b.sample && Number(b.sample.totalG)) || 100,
        sample: b.sample || null,
        priceFactors: b.priceFactors || null,
        cardamomRate: Number(b.cardamomRate) || null,
        samplePhotoUrl: b.samplePhotoUrl || null,
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
