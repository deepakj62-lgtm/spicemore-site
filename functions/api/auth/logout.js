import { json, preflight } from '../_blob.js';
import { clearSessionCookie } from './_session.js';

export async function onRequest(context) {
  const { request } = context;
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
  return json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie() } });
}
