const { put } = require('@vercel/blob');
const { sendWhatsAppText } = require('./_whatsapp');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, role } = req.body || {};
    if (!phone || !['staff', 'consignor'].includes(role)) {
      return res.status(400).json({ error: 'phone and role (staff|consignor) required' });
    }
    const cleanPhone = String(phone).replace(/[^0-9+]/g, '');
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const record = {
      phone: cleanPhone,
      role,
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000,
      createdAt: new Date().toISOString()
    };
    await put(`sepl-otp/${cleanPhone}.json`, JSON.stringify(record), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      cacheControlMaxAge: 0
    });

    await sendWhatsAppText(cleanPhone, `Your SEPL verification code is ${otp}. Valid for 5 minutes.`);

    const resp = { ok: true };
    if (process.env.SEPL_DEV_MODE === '1') resp.devOtp = otp;
    return res.status(200).json(resp);
  } catch (e) {
    console.error('auth-request-otp error', e);
    return res.status(500).json({ error: 'Internal error', details: e.message });
  }
};
