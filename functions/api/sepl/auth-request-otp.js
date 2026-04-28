import { putJSON, listKeys, json, preflight } from '../_blob.js';
import { sendWhatsAppText, testBridge } from './_whatsapp.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();
  const bucket = env.BLOB_BUCKET;
  const url = new URL(request.url);

  // Diagnostic: GET ?diag=whatsapp
  if (request.method === 'GET' && url.searchParams.get('diag') === 'whatsapp') {
    let bridge = { ok: false, reason: 'not checked' };
    try { bridge = await testBridge(env); } catch (e) { bridge = { ok: false, reason: e.message }; }
    let outboxCount = null;
    try {
      const items = await listKeys(bucket, 'whatsapp-outbox/', 1000);
      outboxCount = items.length;
    } catch (e) { outboxCount = { error: e.message }; }
    return json({
      bridgeReachable: !!bridge.ok,
      bridgeStatus: bridge.status || null,
      latencyMs: bridge.latencyMs ?? null,
      bridgeBody: bridge.body || null,
      bridgeUrlSet: Boolean(env.WHATSAPP_BRIDGE_URL),
      bridgeSecretSet: Boolean(env.WHATSAPP_BRIDGE_SECRET),
      outboxCount,
      at: new Date().toISOString()
    });
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  try {
    const { phone, role } = await request.json().catch(() => ({}));
    if (!phone || !['staff', 'consignor'].includes(role)) {
      return json({ error: 'phone and role (staff|consignor) required' }, { status: 400 });
    }
    const cleanPhone = String(phone).replace(/[^0-9+]/g, '');
    const DEMO = { '+911111111111': 'staff', '+912222222222': 'consignor' };
    if (DEMO[cleanPhone] === role) {
      return json({ ok: true, demo: true, hint: 'Use OTP 123456' });
    }
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const record = {
      phone: cleanPhone, role, otp,
      expiresAt: Date.now() + 5 * 60 * 1000,
      createdAt: new Date().toISOString()
    };
    await putJSON(bucket, `sepl-otp/${cleanPhone}.json`, record);
    const waResult = await sendWhatsAppText(env, cleanPhone, `Your SEPL verification code is ${otp}. Valid for 5 minutes.`);
    const resp = { ok: true };
    if (env.SEPL_DEV_MODE === '1' || waResult.stubbed || !waResult.ok) resp.devOtp = otp;
    return json(resp);
  } catch (e) {
    console.error('auth-request-otp error', e);
    return json({ error: 'Internal error', details: e.message }, { status: 500 });
  }
}
