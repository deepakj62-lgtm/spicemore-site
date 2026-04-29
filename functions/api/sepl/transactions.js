import { getJSON, putJSON, putObject, listKeys, json, preflight, keyToUrl } from '../_blob.js';
import { verifyToken } from './_session.js';
import DEFAULTS from './_settings.js';

// Edge-config overrides removed (Vercel-only). Settings overrides now live in
// blob: `sepl-settings/overrides.json`. See ../sepl/daily-price.js for handler.
async function effectiveSettings(bucket) {
  try {
    const ov = await getJSON(bucket, 'sepl-settings/overrides.json');
    if (!ov || typeof ov !== 'object') return DEFAULTS;
    const out = { ...DEFAULTS };
    for (const k of Object.keys(ov)) {
      if (k.startsWith('_')) continue;
      if (ov[k] && typeof ov[k] === 'object' && !Array.isArray(ov[k])) out[k] = { ...(DEFAULTS[k] || {}), ...ov[k] };
      else if (ov[k] !== undefined && ov[k] !== null && ov[k] !== '') out[k] = ov[k];
    }
    return out;
  } catch { return DEFAULTS; }
}

async function loadAll(bucket) {
  const items = await listKeys(bucket, 'sepl-transactions/');
  const out = [];
  for (const it of items) {
    if (!it.key.endsWith('.json')) continue;
    const t = await getJSON(bucket, it.key);
    if (t) out.push(t);
  }
  return out;
}

async function loadConsignor(bucket, id) {
  return await getJSON(bucket, `sepl-consignors/${id}.json`);
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

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();
  const bucket = env.BLOB_BUCKET;
  const url = new URL(request.url);
  const resource = url.searchParams.get('resource');

  if (resource === 'upload-url' && request.method === 'POST') {
    let session;
    try { session = await verifyToken(request, env); }
    catch (e) { return json({ error: 'Unauthorized', details: e.message }, { status: 401 }); }
    if (session.role !== 'staff') return json({ error: 'Staff only' }, { status: 403 });

    const { filename, contentType } = await request.json().catch(() => ({}));
    if (!filename || !contentType) return json({ error: 'filename and contentType required' }, { status: 400 });
    if (!String(contentType).startsWith('image/')) return json({ error: 'Only image/* content-types accepted' }, { status: 400 });
    return json({
      method: 'POST',
      uploadEndpoint: '/api/sepl/transactions?resource=upload-blob',
      expectsJsonBody: { filename, contentType, base64: '<base64-encoded-bytes>' },
      maxBytesHint: 4_000_000
    });
  }

  if (resource === 'upload-blob' && request.method === 'POST') {
    let session;
    try { session = await verifyToken(request, env); }
    catch (e) { return json({ error: 'Unauthorized', details: e.message }, { status: 401 }); }
    if (session.role !== 'staff') return json({ error: 'Staff only' }, { status: 403 });

    const { filename, contentType, base64, consignorId, depot } = await request.json().catch(() => ({}));
    if (!filename || !contentType || !base64) return json({ error: 'filename, contentType, base64 required' }, { status: 400 });
    try {
      const buf = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      if (buf.length === 0) return json({ error: 'Empty payload' }, { status: 400 });
      if (buf.length > 6_000_000) return json({ error: 'Photo too large (max 6 MB)' }, { status: 413 });

      const ext = (() => {
        const m = String(filename).match(/\.([a-zA-Z0-9]{1,6})$/);
        if (m) return m[1].toLowerCase();
        if (contentType === 'image/jpeg') return 'jpg';
        if (contentType === 'image/png') return 'png';
        return 'jpg';
      })();
      const safe = (s) => String(s || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'unknown';
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

      let key;
      if (consignorId && depot) {
        const consignor = await loadConsignor(bucket, consignorId);
        const clientName = safe(consignor?.name) || safe(consignorId);
        const depotSafe = safe(depot);
        key = `sepl-sample-photos/${depotSafe}/${clientName}-${stamp}.${ext}`;
      } else {
        const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
        key = `sepl-sample-photos/${Date.now()}-${safeName}`;
      }
      await putObject(bucket, key, buf, contentType);
      return json({ url: keyToUrl(key), key });
    } catch (e) {
      console.error('upload-blob error', e);
      return json({ error: 'Upload failed', details: e.message }, { status: 500 });
    }
  }

  if (request.method === 'PATCH') {
    let session;
    try { session = await verifyToken(request, env); }
    catch (e) { return json({ error: 'Unauthorized', details: e.message }, { status: 401 }); }
    if (session.role !== 'staff') return json({ error: 'Staff only' }, { status: 403 });

    const { txnId, status } = await request.json().catch(() => ({}));
    if (!txnId) return json({ error: 'txnId required' }, { status: 400 });
    const ALLOWED_STATUSES = ['Active', 'Closed'];
    if (!ALLOWED_STATUSES.includes(status)) {
      return json({ error: `status must be one of ${ALLOWED_STATUSES.join(', ')}` }, { status: 400 });
    }
    const all = await loadAll(bucket);
    const existing = all.find(t => t.txnId === txnId);
    if (!existing) return json({ error: 'Transaction not found' }, { status: 404 });
    if (existing.status === status) return json({ transaction: existing, noop: true });
    const updated = {
      ...existing, status,
      auditLog: [
        ...(existing.auditLog || []),
        { action: 'status-change', from: existing.status, to: status, byStaff: session.name, byPhone: session.phone, at: new Date().toISOString() }
      ],
      updatedAt: new Date().toISOString()
    };
    if (status === 'Closed' && !existing.closedAt) updated.closedAt = new Date().toISOString();
    await putJSON(bucket, `sepl-transactions/${txnId}.json`, updated);
    return json({ transaction: updated });
  }

  try {
    let session;
    try { session = await verifyToken(request, env); }
    catch (e) { return json({ error: 'Unauthorized', details: e.message }, { status: 401 }); }

    if (request.method === 'GET') {
      const id = url.searchParams.get('id');
      const filter = url.searchParams.get('status');
      const consignorPhone = url.searchParams.get('consignorPhone');
      const all = await loadAll(bucket);

      const norm = (p) => String(p || '').replace(/[^0-9]/g, '').slice(-10);
      const sessPhone10 = norm(session.phone);
      if (id) {
        const one = all.find(t => t.txnId === id);
        if (!one) return json({ error: 'Not found' }, { status: 404 });
        if (session.role === 'consignor' && norm(one.consignorPhone) !== sessPhone10) {
          return json({ error: 'Forbidden' }, { status: 403 });
        }
        return json({ transaction: one });
      }
      let list = all;
      if (session.role === 'consignor') list = list.filter(t => norm(t.consignorPhone) === sessPhone10);
      else if (consignorPhone && consignorPhone !== 'me') list = list.filter(t => t.consignorPhone === consignorPhone);
      if (filter === 'active') list = list.filter(t => t.status === 'Active');
      return json({ transactions: list });
    }

    if (request.method === 'POST') {
      if (session.role !== 'staff') return json({ error: 'Staff only' }, { status: 403 });
      const b = await request.json().catch(() => ({}));
      const required = ['consignorId', 'netWeightKg', 'benchmarkPricePerKg', 'depot'];
      for (const k of required) if (b[k] === undefined || b[k] === null || b[k] === '') {
        return json({ error: `Missing ${k}` }, { status: 400 });
      }
      if (Number(b.netWeightKg) < 250) return json({ error: 'Minimum lot is 250 kg' }, { status: 400 });

      if (b.sample && typeof b.sample === 'object') {
        const totalG = Number(b.sample.totalG) || 0;
        const boldG = Number(b.sample.bold8mmG) || 0;
        const midG = Number(b.sample.mid7to8G) || 0;
        const rejG = Number(b.sample.rejectionG) || 0;
        if (Math.abs((boldG + midG + rejG) - totalG) > 1) {
          return json({ error: 'Sample grades do not sum to total' }, { status: 400 });
        }
        const cardamomRateNum = Number(b.cardamomRate) || 0;
        if (cardamomRateNum > 0 && totalG > 0) {
          const pf = b.priceFactors || {};
          const pf_bold = Number(pf.bold) || 1.15;
          const pf_mid = Number(pf.mid) || 1.05;
          const pf_rej = Number(pf.rej) || 0.80;
          const pctBold = boldG / totalG, pctMid = midG / totalG, pctRej = rejG / totalG;
          const recomputed = cardamomRateNum * (pctBold * pf_bold + pctMid * pf_mid + pctRej * pf_rej);
          const submitted = Number(b.benchmarkPricePerKg) || 0;
          if (recomputed > 0 && Math.abs(submitted - recomputed) / recomputed > 0.05) {
            return json({ error: 'Sample/rate inconsistent with submitted benchmark price' }, { status: 400 });
          }
        }
      }

      const consignor = await loadConsignor(bucket, b.consignorId);
      if (!consignor) return json({ error: 'Consignor not found' }, { status: 404 });

      const SETTINGS = await effectiveSettings(bucket);
      const netWeightKg = Number(b.netWeightKg);
      const benchmarkPricePerKg = Number(b.benchmarkPricePerKg);
      const grossStockValue = netWeightKg * benchmarkPricePerKg;
      const standardAdvance = grossStockValue * SETTINGS.standardAdvanceRate;
      const maxAdvance = grossStockValue * SETTINGS.maxAdvanceRate;
      const requestedAdvance = (b.requestedAdvance != null && Number(b.requestedAdvance) > 0)
        ? Number(b.requestedAdvance) : standardAdvance;
      const advanceAmount = Math.min(requestedAdvance, maxAdvance);
      const rate = consignor.rateAssigned || SETTINGS.annualHoldingRate;
      const dailyHoldingCharge = advanceAmount * rate / SETTINGS.daysBasis;
      const intakeDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const expectedExitDate = addDays(intakeDate, SETTINGS.standardTenureDays);
      const maxExitDate = addDays(intakeDate, SETTINGS.maxTenureDays);

      const all = await loadAll(bucket);
      const txnId = nextTxnId(all);
      const record = {
        txnId,
        consignorId: consignor.consignorId,
        consignorName: consignor.name,
        consignorPhone: consignor.phone,
        depot: b.depot, netWeightKg, benchmarkPricePerKg,
        gradeNotes: b.gradeNotes || '',
        sampleGrams: Number(b.sampleGrams) || (b.sample && Number(b.sample.totalG)) || 100,
        sample: b.sample || null,
        priceFactors: b.priceFactors || null,
        cardamomRate: Number(b.cardamomRate) || null,
        samplePhotoUrl: b.samplePhotoUrl || null,
        grossStockValue,
        advanceRateUsed: grossStockValue > 0 ? advanceAmount / grossStockValue : SETTINGS.standardAdvanceRate,
        advanceAmount,
        annualRateUsed: rate,
        dailyHoldingCharge,
        intakeDate, expectedExitDate, maxExitDate,
        status: 'Active',
        staffPhone: session.phone, staffName: session.name,
        auditLog: [{ action: 'intake-created', byStaff: session.name, byPhone: session.phone, at: new Date().toISOString() }],
        createdAt: new Date().toISOString()
      };
      await putJSON(bucket, `sepl-transactions/${txnId}.json`, record);
      return json({ transaction: record }, { status: 201 });
    }

    return json({ error: 'Method not allowed' }, { status: 405 });
  } catch (e) {
    console.error('transactions error', e);
    return json({ error: 'Internal error', details: e.message }, { status: 500 });
  }
}
