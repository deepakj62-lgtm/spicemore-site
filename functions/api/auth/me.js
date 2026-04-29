import { json, preflight } from '../_blob.js';
import { getSession } from './_session.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, { status: 405 });

  const sess = await getSession(request, env);
  if (!sess) return json({ ok: false }, { status: 401 });

  return json({
    ok: true,
    user: {
      mobile: sess.u,
      name: sess.n || '',
      email: sess.e || '',
      role: sess.role || 'staff',
      mustChangePassword: !!sess.mcp,
    },
  });
}
