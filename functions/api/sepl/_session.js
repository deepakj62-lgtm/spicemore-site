// HMAC-SHA256 signed token using Web Crypto. Compatible with Cloudflare Workers.
// SECRET comes from env.SEPL_SESSION_SECRET (set via wrangler pages secret put).

function b64urlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(secret) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

async function sign(secret, payload) {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importKey(secret);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const sig = b64urlEncode(new Uint8Array(sigBuf));
  return `${body}.${sig}`;
}

export async function verifyTokenFromHeader(authHeader, secret) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) throw new Error('Missing bearer token');
  const token = authHeader.slice(7).trim();
  const [body, sig] = token.split('.');
  if (!body || !sig) throw new Error('Malformed token');
  const key = await importKey(secret);
  const ok = await crypto.subtle.verify(
    'HMAC', key, b64urlDecode(sig),
    new TextEncoder().encode(body)
  );
  if (!ok) throw new Error('Bad signature');
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  if (payload.exp && Date.now() > payload.exp) throw new Error('Token expired');
  return payload; // { phone, role, name, iat, exp }
}

// Convenience for handlers that have a Request object.
export async function verifyToken(request, env) {
  const auth = request.headers.get('authorization') || request.headers.get('Authorization');
  return verifyTokenFromHeader(auth, env.SEPL_SESSION_SECRET || 'dev-secret-change-me');
}

// Token from ?t= query param OR Authorization header.
export async function verifyAny(request, env) {
  const url = new URL(request.url);
  const qt = url.searchParams.get('t');
  if (qt) return verifyTokenFromHeader('Bearer ' + qt, env.SEPL_SESSION_SECRET || 'dev-secret-change-me');
  return verifyToken(request, env);
}

export async function mintToken(env, { phone, role, name }) {
  const now = Date.now();
  return sign(env.SEPL_SESSION_SECRET || 'dev-secret-change-me',
    { phone, role, name, iat: now, exp: now + 30 * 24 * 60 * 60 * 1000 });
}
