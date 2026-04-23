const { put, list } = require('@vercel/blob');
const { verifyToken } = require('./_session');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
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
