// Edge Config replaced with R2-backed overrides at sepl-settings/overrides.json.
import { getJSON, putJSON, listKeys, json, preflight } from '../_blob.js';
import { verifyToken } from './_session.js';
import DEFAULTS from './_settings.js';

const EDITABLE = [
  'standardAdvanceRate', 'maxAdvanceRate', 'annualHoldingRate', 'daysBasis',
  'standardTenureDays', 'maxTenureDays',
  'ltv', 'depots', 'auctionCommission', 'gstOnCommission',
  'consignorTypes', 'grades'
];
const SETTINGS_KEY = 'sepl-settings/overrides.json';

async function loadSettingsOverrides(bucket) {
  return await getJSON(bucket, SETTINGS_KEY, {});
}

async function writeSettingsOverrides(bucket, payload) {
  await putJSON(bucket, SETTINGS_KEY, payload);
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

async function handleSettings(request, env, bucket) {
  if (request.method === 'GET') {
    const overrides = await loadSettingsOverrides(bucket);
    return json({
      defaults: DEFAULTS, overrides,
      effective: mergeSettings(DEFAULTS, overrides),
      editable: EDITABLE
    });
  }
  if (request.method === 'POST') {
    let session;
    try { session = await verifyToken(request, env); } catch (e) { return json({ error: 'Unauthorized', details: e.message }, { status: 401 }); }
    if (session.role !== 'staff') return json({ error: 'Staff only' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const clean = {};
    for (const k of EDITABLE) if (body[k] !== undefined) clean[k] = body[k];
    clean._lastUpdatedBy = { phone: session.phone, name: session.name };
    clean._lastUpdatedAt = new Date().toISOString();
    await writeSettingsOverrides(bucket, clean);
    return json({ saved: true, overrides: clean, effective: mergeSettings(DEFAULTS, clean) });
  }
  return json({ error: 'Method not allowed' }, { status: 405 });
}

// ---------- cardamom rate scrape ----------
const CARDAMOM_URL = 'https://www.indianspices.com/marketing/price/domestic/daily-price-small.html';
const CACHE_PATH = 'sepl-cardamom-rate/latest.json';
const OVERRIDE_PATH = 'sepl-cardamom-rate/override.json';
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

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

  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const blocks = text.split(/Spice\s*:\s*/i).slice(1);
  const candidates = [];
  for (const blk of blocks) {
    const head = blk.slice(0, 60).toLowerCase();
    if (!head.includes('small cardamom')) continue;
    const segment = blk.split(/Spice\s*:/i)[0];
    const dateMatch = segment.match(/Date(?:\s+of\s+Auction)?\s*:\s*([0-9]{1,2}[-/][A-Za-z]{3,9}[-/][0-9]{4}|[0-9]{2}[-/][0-9]{2}[-/][0-9]{4}|[0-9]{4}[-/][0-9]{2}[-/][0-9]{2})/i);
    const priceMatch = segment.match(/Avg\.?\s*Price[^0-9]{0,40}([0-9]{3,5}(?:\.[0-9]{1,2})?)/i);
    if (!dateMatch || !priceMatch) continue;
    const price = Number(priceMatch[1]);
    if (!(price >= 500 && price <= 15000)) continue;
    candidates.push({ date: dateMatch[1], price });
  }
  if (!candidates.length) throw new Error('parse failed: no Small Cardamom blocks with date+price');

  const MONTHS = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
  const toKey = (d) => {
    let m;
    if ((m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return d;
    if ((m = d.match(/^(\d{1,2})[-/]([A-Za-z]{3,9})[-/](\d{4})$/))) {
      const mm = MONTHS[m[2].slice(0, 3).toLowerCase()];
      return mm ? `${m[3]}-${mm}-${m[1].padStart(2, '0')}` : d;
    }
    if ((m = d.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/))) return `${m[3]}-${m[2]}-${m[1]}`;
    return d;
  };
  candidates.sort((a, b) => toKey(b.date).localeCompare(toKey(a.date)));
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

async function handleCardamomRate(request, env, bucket) {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const forceRefresh = url.searchParams.get('refresh') === '1';
    const cache = await getJSON(bucket, CACHE_PATH);
    const cacheAge = cache?.scrapedAt ? Date.now() - new Date(cache.scrapedAt).getTime() : Infinity;
    if (cache && cacheAge < CACHE_MAX_AGE_MS && !forceRefresh) {
      return json({ rate: { ...cache, cached: true } });
    }
    try {
      const scraped = await scrapeCardamomRate();
      const record = { ...scraped, scrapedAt: new Date().toISOString() };
      await putJSON(bucket, CACHE_PATH, record);
      return json({ rate: { ...record, cached: false } });
    } catch (e) {
      console.error('cardamom scrape failed', e);
      const override = await getJSON(bucket, OVERRIDE_PATH);
      if (override && typeof override.pricePerKg === 'number') {
        return json({
          rate: {
            pricePerKg: override.pricePerKg,
            date: (override.at || '').slice(0, 10),
            source: 'manual override',
            cached: false, scrapedAt: override.at, raw: { override }
          },
          error: e.message
        });
      }
      if (cache) return json({ rate: { ...cache, source: `${cache.source || 'cached'} (stale)`, cached: true }, error: e.message });
      return json({ rate: null, error: e.message });
    }
  }

  if (request.method === 'POST') {
    let session;
    try { session = await verifyToken(request, env); } catch (e) { return json({ error: 'Unauthorized', details: e.message }, { status: 401 }); }
    if (session.role !== 'staff') return json({ error: 'Staff only' }, { status: 403 });
    const { pricePerKg, note } = await request.json().catch(() => ({}));
    if (!pricePerKg || isNaN(Number(pricePerKg))) return json({ error: 'pricePerKg (number) required' }, { status: 400 });
    const override = {
      pricePerKg: Number(pricePerKg),
      note: note || '',
      by: { name: session.name, phone: session.phone },
      at: new Date().toISOString()
    };
    await putJSON(bucket, OVERRIDE_PATH, override);
    return json({ override });
  }

  if (request.method === 'DELETE') {
    let session;
    try { session = await verifyToken(request, env); } catch (e) { return json({ error: 'Unauthorized', details: e.message }, { status: 401 }); }
    if (session.role !== 'staff') return json({ error: 'Staff only' }, { status: 403 });
    try { await putJSON(bucket, OVERRIDE_PATH, { cleared: true, at: new Date().toISOString(), by: { name: session.name, phone: session.phone } }); } catch {}
    return json({ cleared: true });
  }

  return json({ error: 'Method not allowed' }, { status: 405 });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();
  const bucket = env.BLOB_BUCKET;
  const url = new URL(request.url);
  const resource = url.searchParams.get('resource');

  try {
    if (resource === 'settings') return handleSettings(request, env, bucket);
    if (resource === 'cardamom-rate') return handleCardamomRate(request, env, bucket);

    if (request.method === 'POST') {
      let session;
      try { session = await verifyToken(request, env); }
      catch (e) { return json({ error: 'Unauthorized', details: e.message }, { status: 401 }); }
      if (session.role !== 'staff') return json({ error: 'Staff only' }, { status: 403 });

      const { pricePerKg, grade, source } = await request.json().catch(() => ({}));
      if (!pricePerKg || !grade) return json({ error: 'pricePerKg and grade required' }, { status: 400 });
      const date = new Date().toISOString().slice(0, 10);
      const record = {
        date, grade, pricePerKg: Number(pricePerKg), source: source || 'Spices Board',
        enteredBy: { phone: session.phone, name: session.name },
        at: new Date().toISOString()
      };
      await putJSON(bucket, `sepl-daily-price/${date}.json`, record);
      return json({ price: record }, { status: 201 });
    }

    if (request.method === 'GET') {
      const items = await listKeys(bucket, 'sepl-daily-price/');
      const out = [];
      for (const it of items) {
        if (!it.key.endsWith('.json')) continue;
        const r = await getJSON(bucket, it.key);
        if (r) out.push(r);
      }
      out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      return json({ latest: out[0] || null, history: out.slice(0, 30) });
    }

    return json({ error: 'Method not allowed' }, { status: 405 });
  } catch (e) {
    console.error('daily-price error', e);
    return json({ error: 'Internal error', details: e.message }, { status: 500 });
  }
}
