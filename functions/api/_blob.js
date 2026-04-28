// R2 helpers — replaces @vercel/blob usage.
// All Pages Functions get a `context.env.BLOB_BUCKET` (R2 binding).
// Keys are the same paths used previously with @vercel/blob (e.g. "attendance/data.json").

export async function getJSON(bucket, key, fallback = null) {
  const obj = await bucket.get(key);
  if (!obj) return fallback;
  try { return await obj.json(); } catch { return fallback; }
}

export async function putJSON(bucket, key, data) {
  return bucket.put(key, JSON.stringify(data), {
    httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' }
  });
}

export async function getObject(bucket, key) {
  return bucket.get(key);
}

export async function putObject(bucket, key, body, contentType = 'application/octet-stream') {
  return bucket.put(key, body, { httpMetadata: { contentType } });
}

export async function deleteObject(bucket, key) {
  return bucket.delete(key);
}

// Build a relative URL the frontend can fetch to retrieve an R2 object.
// Frontend can also call /api/r2-get?key=... directly.
export function keyToUrl(key) {
  return `/api/r2-get?key=${encodeURIComponent(key)}`;
}

// Returns array of { key, uploaded, size } — mirrors enough of the old blob shape.
export async function listKeys(bucket, prefix, limit = 1000) {
  const out = [];
  let cursor = undefined;
  while (true) {
    const res = await bucket.list({ prefix, limit: Math.min(limit - out.length, 1000), cursor });
    for (const o of res.objects) out.push({ key: o.key, uploaded: o.uploaded, size: o.size });
    if (!res.truncated || out.length >= limit) break;
    cursor = res.cursor;
  }
  return out;
}

// CORS helper.
export function corsHeaders(extra = {}) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization, X-Spicemore-Key',
    ...extra,
  };
}

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { 'content-type': 'application/json', ...corsHeaders(), ...(init.headers || {}) }
  });
}

export function html(body, init = {}) {
  return new Response(body, {
    status: init.status || 200,
    headers: { 'content-type': 'text/html; charset=utf-8', ...corsHeaders(), ...(init.headers || {}) }
  });
}

export function preflight() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
