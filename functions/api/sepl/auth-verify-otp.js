import { getJSON, putJSON, deleteObject, listKeys, json, preflight } from '../_blob.js';
import { mintToken } from './_session.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });
  const bucket = env.BLOB_BUCKET;

  try {
    const { phone, otp, role } = await request.json().catch(() => ({}));
    if (!phone || !otp || !['staff', 'consignor'].includes(role)) {
      return json({ error: 'phone, otp, role required' }, { status: 400 });
    }
    const cleanPhone = String(phone).replace(/[^0-9+]/g, '');
    const DEMO = { '+911111111111': 'staff', '+912222222222': 'consignor' };
    const isDemo = DEMO[cleanPhone] === role && String(otp) === '123456';

    if (!isDemo) {
      const otpKey = `sepl-otp/${cleanPhone}.json`;
      const data = await getJSON(bucket, otpKey);
      if (!data) return json({ error: 'No OTP requested' }, { status: 401 });
      if (Date.now() > data.expiresAt) return json({ error: 'OTP expired' }, { status: 401 });
      if (data.otp !== String(otp)) return json({ error: 'Wrong OTP' }, { status: 401 });
      if (data.role !== role) return json({ error: 'Role mismatch' }, { status: 401 });
      try { await deleteObject(bucket, otpKey); } catch {}
    }

    let name = '';
    if (role === 'staff') {
      const staffKey = `sepl-staff/${cleanPhone}.json`;
      const staff = await getJSON(bucket, staffKey);
      if (staff) {
        name = staff.name || '';
      } else {
        name = `Staff ${cleanPhone.slice(-4)}`;
        await putJSON(bucket, staffKey, { phone: cleanPhone, name, role: 'staff', createdAt: new Date().toISOString() });
      }
    } else {
      const items = await listKeys(bucket, 'sepl-consignors/');
      for (const it of items) {
        try {
          const c = await getJSON(bucket, it.key);
          if (c && c.phone === cleanPhone) { name = c.name; break; }
        } catch {}
      }
      if (!name) name = `Consignor ${cleanPhone.slice(-4)}`;
    }

    const token = await mintToken(env, { phone: cleanPhone, role, name });
    return json({ token, role, phone: cleanPhone, name });
  } catch (e) {
    console.error('auth-verify-otp error', e);
    return json({ error: 'Internal error', details: e.message }, { status: 500 });
  }
}
