// ERPNext server-side proxy. See original api/erp.js for env-var docs.
import { json, corsHeaders, preflight } from './_blob.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();

  const KEY = env.ERPNEXT_API_KEY;
  const SECRET = env.ERPNEXT_API_SECRET;
  const BASE = env.ERPNEXT_URL || 'https://smtc-erpnext.v.frappe.cloud';
  const CLIENT_SECRET = env.ERP_PROXY_SECRET;

  if (!KEY || !SECRET) return json({ error: 'ERPNext credentials not configured' }, { status: 500 });
  if (CLIENT_SECRET) {
    const provided = request.headers.get('x-spicemore-key');
    if (provided !== CLIENT_SECRET) return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams.entries());
    const path = params.path;
    if (!path) return json({ error: 'Missing path' }, { status: 400 });

    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === 'path' || k === 'method') continue;
      qs.append(k, v);
    }
    const qsStr = qs.toString();
    const fullUrl = `${BASE}/api/${path}${qsStr ? '?' + qsStr : ''}`;

    const method = (params.method || request.method || 'GET').toUpperCase();
    const headers = { Authorization: `token ${KEY}:${SECRET}`, Accept: 'application/json' };
    let body;
    if (method !== 'GET' && method !== 'HEAD') {
      try {
        const text = await request.text();
        if (text) { body = text; headers['Content-Type'] = 'application/json'; }
      } catch {}
    }

    const r = await fetch(fullUrl, { method, headers, body });
    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: {
        'content-type': r.headers.get('content-type') || 'application/json',
        ...corsHeaders()
      }
    });
  } catch (err) {
    console.error('ERP proxy error:', err);
    return json({ error: 'Proxy error', details: err.message }, { status: 500 });
  }
}
