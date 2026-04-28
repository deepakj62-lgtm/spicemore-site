// Streams a single R2 object by key. Used by frontend in place of the
// public URLs that @vercel/blob used to return.
//   GET /api/r2-get?key=<key>
import { corsHeaders, preflight } from './_blob.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const bucket = env.BLOB_BUCKET || env.ATTENDANCE_BUCKET;
  const key = new URL(request.url).searchParams.get('key');
  if (!key) return new Response('Missing key', { status: 400, headers: corsHeaders() });
  const obj = await bucket.get(key);
  if (!obj) return new Response('Not found', { status: 404, headers: corsHeaders() });
  const headers = new Headers(corsHeaders());
  headers.set('content-type', obj.httpMetadata?.contentType || 'application/octet-stream');
  if (obj.httpMetadata?.cacheControl) headers.set('cache-control', obj.httpMetadata.cacheControl);
  return new Response(obj.body, { headers });
}
