const { put, list } = require('@vercel/blob');
const { get: edgeGet } = require('@vercel/edge-config');
const { verifyToken } = require('./_session');
const DEFAULTS = require('./_settings');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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

// ---------- cardamom rate scrape (Spices Board daily price page) ----------

const CARDAMOM_URL = 'https://www.indianspices.com/marketing/price/domestic/daily-price-small.html';
const CACHE_PATH = 'sepl-cardamom-rate/latest.json';
const OVERRIDE_PATH = 'sepl-cardamom-rate/override.json';
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

async function readBlobJson(pathname) {
  try {
    const { blobs } = await list({ prefix: pathname });
    const match = blobs.find(b => b.pathname === pathname);
    if (!match) return null;
    const r = await fetch(match.url);
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; }
}

async function writeBlobJson(pathname, data) {
  return put(pathname, JSON.stringify(data), {
    access: 'public', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 0
  });
}

async function scrapeCardamomRate() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  let html;
  try {
    const r = await fetch(CARDAMOM_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SpicemoreCardamomBot/1.0)' },
      signal: ctrl.signal
    });
    if (!r.ok) throw new Error(`fetch failed ${r.status}`);
    html = await r.text();
  } finally { clearTimeout(t); }

  // The page renders Small Cardamom auctions as prose blocks, not table rows:
  //   <b>Spice: Small Cardamom</b>,
  //   Date of Auction: 25-Apr-2026,
  //   Auctioneer: IDUKKI MAHILA ...,
  //   ...
  //   Avg. Price (Rs./Kg): 2702.39
  //
  // Split on the "Spice:" marker, keep blocks where the species line says Small.
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const blocks = text.split(/Spice\s*:\s*/i).slice(1);
  const candidates = [];
  for (const blk of blocks) {
    const head = blk.slice(0, 60).toLowerCase();
    if (!head.includes('small cardamom')) continue;
    // Stop the block at the next "Spice:" marker if we accidentally swallowed multiple
    const segment = blk.split(/Spice\s*:/i)[0];
    const dateMatch = segment.match(/Date(?:\s+of\s+Auction)?\s*:\s*([0-9]{1,2}[-/][A-Za-z]{3,9}[-/][0-9]{4}|[0-9]{2}[-/][0-9]{2}[-/][0-9]{4}|[0-9]{4}[-/][0-9]{2}[-/][0-9]{2})/i);
    const priceMatch = segment.match(/Avg\.?\s*Price[^0-9]{0,40}([0-9]{3,5}(?:\.[0-9]{1,2})?)/i);
    if (!dateMatch || !priceMatch) continue;
    const price = Number(priceMatch[1]);
    if (!(price >= 500 && price <= 15000)) continue;
    candidates.push({ date: dateMatch[1], price });
  }

  if (!candidates.length) throw new Error('parse failed: no Small Cardamom blocks with date+price');

  // Normalise to YYYY-MM-DD for sorting. Handles "25-Apr-2026", "25-04-2026", "2026-04-25".
  const MONTHS = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
  const toKey = (d) => {
    let m;
    if ((m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return d;
    if ((m = d.match(/^(\d{1,2})[-/]([A-Za-z]{3,9})[-/](\d{4})$/))) {
      const mm = MONTHS[m[2].slice(0,3).toLowerCase()];
      return mm ? `${m[3]}-${mm}-${m[1].padStart(2,'0')}` : d;
    }
    if ((m = d.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/))) return `${m[3]}-${m[2]}-${m[1]}`;
    return d;
  };
  candidates.sort((a, b) => toKey(b.date).localeCompare(toKey(a.date)));

  // Take all auctions on the most recent date (typically 2 — IDUKKI MAHILA + SUGANDHAGIRI)
  const latestDate = candidates[0].date;
  const latestKey = toKey(latestDate);
  const sameDay = candidates.filter(c => toKey(c.date) === latestKey);
  const top = sameDay.length >= 2 ? sameDay.slice(0, 2) : candidates.slice(0, 2);
  const avg = top.reduce((s, c) => s + c.price, 0) / top.length;

  return {
    pricePerKg: Number(avg.toFixed(2)),
    date: latestDate,
    source: `Spices Board e-auction (avg of ${top.length} ${latestDate} auctions)`,
    raw: { auctions: top, candidatesParsed: candidates.length }
  };
}

async function handleCardamomRate(req, res) {
  if (req.method === 'GET') {
    const forceRefresh = req.query?.refresh === '1' || req.query?.refresh === 1;
    const cache = await readBlobJson(CACHE_PATH);
    const cacheAge = cache?.scrapedAt ? Date.now() - new Date(cache.scrapedAt).getTime() : Infinity;

    if (cache && cacheAge < CACHE_MAX_AGE_MS && !forceRefresh) {
      return res.status(200).json({ rate: { ...cache, cached: true } });
    }

    try {
      const scraped = await scrapeCardamomRate();
      const record = { ...scraped, scrapedAt: new Date().toISOString() };
      await writeBlobJson(CACHE_PATH, record);
      return res.status(200).json({ rate: { ...record, cached: false } });
    } catch (e) {
      console.error('cardamom scrape failed', e);
      const override = await readBlobJson(OVERRIDE_PATH);
      if (override && typeof override.pricePerKg === 'number') {
        return res.status(200).json({
          rate: {
            pricePerKg: override.pricePerKg,
            date: (override.at || '').slice(0, 10),
            source: 'manual override',
            cached: false,
            scrapedAt: override.at,
            raw: { override }
          },
          error: e.message
        });
      }
      if (cache) {
        return res.status(200).json({
          rate: {
            ...cache,
            source: `${cache.source || 'cached'} (stale)`,
            cached: true
          },
          error: e.message
        });
      }
      return res.status(200).json({ rate: null, error: e.message });
    }
  }

  if (req.method === 'POST') {
    let session;
    try { session = verifyToken(req); } catch (e) { return res.status(401).json({ error: 'Unauthorized', details: e.message }); }
    if (session.role !== 'staff') return res.status(403).json({ error: 'Staff only' });

    const { pricePerKg, note } = req.body || {};
    if (!pricePerKg || isNaN(Number(pricePerKg))) {
      return res.status(400).json({ error: 'pricePerKg (number) required' });
    }
    const override = {
      pricePerKg: Number(pricePerKg),
      note: note || '',
      by: { name: session.name, phone: session.phone },
      at: new Date().toISOString()
    };
    await writeBlobJson(OVERRIDE_PATH, override);
    return res.status(200).json({ override });
  }

  if (req.method === 'DELETE') {
    let session;
    try { session = verifyToken(req); } catch (e) { return res.status(401).json({ error: 'Unauthorized', details: e.message }); }
    if (session.role !== 'staff') return res.status(403).json({ error: 'Staff only' });

    try {
      await writeBlobJson(OVERRIDE_PATH, { cleared: true, at: new Date().toISOString(), by: { name: session.name, phone: session.phone } });
    } catch (_) {}
    return res.status(200).json({ cleared: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ---------- main handler: price by default, settings when ?resource=settings ----------

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.query?.resource === 'settings') return handleSettings(req, res);
    if (req.query?.resource === 'cardamom-rate') return handleCardamomRate(req, res);

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
