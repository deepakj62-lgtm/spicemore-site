import { getJSON, json, preflight } from '../_blob.js';
import {
  normalizeMobile, verifyPassword, signToken,
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

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const mobile = normalizeMobile(body && body.username);
  const password = body && body.password;
  if (!mobile || !password || typeof password !== 'string') {
    return json({ ok: false, error: 'Username (10-digit mobile) and password required' }, { status: 400 });
  }

  const accounts = await getJSON(env.BLOB_BUCKET, ACCOUNTS_KEY, null);
  if (!accounts || typeof accounts !== 'object') {
    return json({ ok: false, error: 'Accounts not provisioned' }, { status: 500 });
  }

  const acct = accounts[mobile];
  if (!acct || !acct.salt || !acct.hash) {
    return json({ ok: false, error: 'Invalid username or password' }, { status: 401 });
  }

  const ok = await verifyPassword(password, acct.salt, acct.hash);
  if (!ok) {
    return json({ ok: false, error: 'Invalid username or password' }, { status: 401 });
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    u: mobile,
    n: acct.name || '',
    e: acct.email || '',
    role: acct.role || 'staff',
    mcp: !!acct.mustChangePassword,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  const token = await signToken(payload, env.AUTH_SECRET);

  return json(
    {
      ok: true,
      user: {
        mobile,
        name: acct.name || '',
        email: acct.email || '',
        role: acct.role || 'staff',
        mustChangePassword: !!acct.mustChangePassword,
      },
    },
    { headers: { 'Set-Cookie': buildSessionCookie(token) } }
  );
}
