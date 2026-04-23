const { put, list, del } = require('@vercel/blob');
const { mintToken } = require('./_session');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function readBlobJson(prefix, key) {
  const { blobs } = await list({ prefix });
  const match = blobs.find(b => b.pathname === `${prefix}${key}.json`);
  if (!match) return null;
  const r = await fetch(match.url);
  if (!r.ok) return null;
  return { data: await r.json(), url: match.url };
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, otp, role } = req.body || {};
    if (!phone || !otp || !['staff', 'consignor'].includes(role)) {
      return res.status(400).json({ error: 'phone, otp, role required' });
    }
    const cleanPhone = String(phone).replace(/[^0-9+]/g, '');

    const otpRec = await readBlobJson('sepl-otp/', cleanPhone);
    if (!otpRec) return res.status(401).json({ error: 'No OTP requested' });
    const { data } = otpRec;
    if (Date.now() > data.expiresAt) return res.status(401).json({ error: 'OTP expired' });
    if (data.otp !== String(otp)) return res.status(401).json({ error: 'Wrong OTP' });
    if (data.role !== role) return res.status(401).json({ error: 'Role mismatch' });

    // delete OTP blob
    try { await del(otpRec.url); } catch (_) {}

    let name = '';
    if (role === 'staff') {
      const staff = await readBlobJson('sepl-staff/', cleanPhone);
      if (staff) {
        name = staff.data.name || '';
      } else {
        // Phase-1 shortcut: auto-create staff entry
        name = `Staff ${cleanPhone.slice(-4)}`;
        await put(`sepl-staff/${cleanPhone}.json`, JSON.stringify({
          phone: cleanPhone, name, role: 'staff', createdAt: new Date().toISOString()
        }), { access: 'public', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 0 });
      }
    } else {
      // consignor lookup by phone
      const { blobs } = await list({ prefix: 'sepl-consignors/' });
      for (const b of blobs) {
        try {
          const r = await fetch(b.url);
          const c = await r.json();
          if (c.phone === cleanPhone) { name = c.name; break; }
        } catch (_) {}
      }
      if (!name) name = `Consignor ${cleanPhone.slice(-4)}`;
    }

    const token = mintToken({ phone: cleanPhone, role, name });
    return res.status(200).json({ token, role, phone: cleanPhone, name });
  } catch (e) {
    console.error('auth-verify-otp error', e);
    return res.status(500).json({ error: 'Internal error', details: e.message });
  }
};
