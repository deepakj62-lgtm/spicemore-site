import { getJSON, putJSON, json, preflight } from '../_blob.js';
import {
  getSession, hashPassword, verifyPassword, signToken,
  buildSessionCookie, SESSION_TTL_SECONDS,
} from './_session.js';

const ACCOUNTS_KEY = 'auth/accounts.json';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405 });

  if (!env.AUTH_SECRET) {
    return json({ ok: false, error: 'Server not configured (AUTH_SECRET missing)' }, { status: 500 });
  }

  const sess = await getSession(request, env);
  if (!sess) return json({ ok: false, error: 'Not signed in' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const currentPassword = body && body.currentPassword;
  const newPassword = body && body.newPassword;
  if (!currentPassword || !newPassword || typeof newPassword !== 'string') {
    return json({ ok: false, error: 'currentPassword and newPassword required' }, { status: 400 });
  }
  if (newPassword.length < 6) {
    return json({ ok: false, error: 'New password must be at least 6 characters' }, { status: 400 });
  }
  if (newPassword === sess.u) {
    return json({ ok: false, error: 'New password cannot equal your mobile number' }, { status: 400 });
  }

  const accounts = await getJSON(env.BLOB_BUCKET, ACCOUNTS_KEY, null);
  if (!accounts || !accounts[sess.u]) {
    return json({ ok: false, error: 'Account not found' }, { status: 404 });
  }
  const acct = accounts[sess.u];

  const ok = await verifyPassword(currentPassword, acct.salt, acct.hash);
  if (!ok) return json({ ok: false, error: 'Current password is incorrect' }, { status: 401 });

  const fresh = await hashPassword(newPassword);
  acct.salt = fresh.salt;
  acct.hash = fresh.hash;
  acct.mustChangePassword = false;
  acct.passwordUpdatedAt = new Date().toISOString();
  accounts[sess.u] = acct;
  await putJSON(env.BLOB_BUCKET, ACCOUNTS_KEY, accounts);

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    u: sess.u, n: acct.name || '', e: acct.email || '',
    role: acct.role || 'staff', mcp: false,
    iat: now, exp: now + SESSION_TTL_SECONDS,
  };
  const token = await signToken(payload, env.AUTH_SECRET);

  return json(
    {
      ok: true,
      user: {
        mobile: sess.u, name: acct.name || '', email: acct.email || '',
        role: acct.role || 'staff', mustChangePassword: false,
      },
    },
    { headers: { 'Set-Cookie': buildSessionCookie(token) } }
  );
}
