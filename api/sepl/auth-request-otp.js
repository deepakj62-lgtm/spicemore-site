const { put, list } = require('@vercel/blob');
const { sendWhatsAppText, testBridge } = require('./_whatsapp');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Diagnostic: GET /api/sepl/auth-request-otp?diag=whatsapp
  // (Consolidated here to stay under the Vercel Hobby 12-function limit.)
  if (req.method === 'GET' && req.query && req.query.diag === 'whatsapp') {
    let bridge = { ok: false, reason: 'not checked' };
    try { bridge = await testBridge(); } catch (e) { bridge = { ok: false, reason: e.message }; }
    let outboxCount = null;
    try {
      const { blobs } = await list({ prefix: 'whatsapp-outbox/', limit: 1000 });
      outboxCount = blobs.length;
    } catch (e) { outboxCount = { error: e.message }; }
    return res.status(200).json({
      bridgeReachable: !!bridge.ok,
      bridgeStatus: bridge.status || null,
      latencyMs: bridge.latencyMs ?? null,
      bridgeBody: bridge.body || null,
      bridgeUrlSet: Boolean(process.env.WHATSAPP_BRIDGE_URL),
      bridgeSecretSet: Boolean(process.env.WHATSAPP_BRIDGE_SECRET),
      outboxCount,
      at: new Date().toISOString()
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, role } = req.body || {};
    if (!phone || !['staff', 'consignor'].includes(role)) {
      return res.status(400).json({ error: 'phone and role (staff|consignor) required' });
    }
    const cleanPhone = String(phone).replace(/[^0-9+]/g, '');
    // Demo bypass — fixed phones skip WhatsApp entirely; UI just uses 123456.
    const DEMO = { '+911111111111': 'staff', '+912222222222': 'consignor' };
    if (DEMO[cleanPhone] === role) {
      return res.status(200).json({ ok: true, demo: true, hint: 'Use OTP 123456' });
    }
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

    const waResult = await sendWhatsAppText(cleanPhone, `Your SEPL verification code is ${otp}. Valid for 5 minutes.`);

    const resp = { ok: true };
    // Return OTP in response when WhatsApp delivery failed (bridge offline) so staff can relay it verbally
    if (process.env.SEPL_DEV_MODE === '1' || waResult.stubbed || !waResult.ok) resp.devOtp = otp;
    return res.status(200).json(resp);
  } catch (e) {
    console.error('auth-request-otp error', e);
    return res.status(500).json({ error: 'Internal error', details: e.message });
  }
};
