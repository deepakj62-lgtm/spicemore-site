// Auth session helpers for Spicemore. Pure Web Crypto — no bcrypt, no jose, no JWT lib.
//
// Required secret (set after first deploy):
//   wrangler pages secret put AUTH_SECRET --project-name=spicemore-site
// Generate one ad-hoc:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// Token format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, AUTH_SECRET))
// Cookie name: sm_session
// Password hash: PBKDF2-SHA256, 100k iterations, 32-byte output, 16-byte random salt — both stored as hex.

const COOKIE_NAME = 'sm_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const PBKDF2_ITERS = 100_000;
const PBKDF2_HASH_LEN = 32; // bytes
const PBKDF2_SALT_LEN = 16; // bytes

// ───── Encoding helpers ─────
function bytesToHex(buf) {
  const a = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < a.length; i++) s += a[i].toString(16).padStart(2, '0');
  return s;
}
function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0) throw new Error('bad hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function b64urlEncode(bytes) {
  const a = new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < a.length; i++) bin += String.fromCharCode(a[i]);
  return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const enc = new TextEncoder();
const dec = new TextDecoder();

// ───── Password hashing (PBKDF2-SHA256) ─────
export async function hashPassword(plain, saltHex) {
  let saltBytes;
  if (saltHex) {
    saltBytes = hexToBytes(saltHex);
  } else {
    saltBytes = new Uint8Array(PBKDF2_SALT_LEN);
    crypto.getRandomValues(saltBytes);
  }
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(String(plain)), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    key,
    PBKDF2_HASH_LEN * 8
  );
  return { salt: bytesToHex(saltBytes), hash: bytesToHex(bits) };
}

export async function verifyPassword(plain, saltHex, expectedHashHex) {
  if (!saltHex || !expectedHashHex) return false;
  try {
    const { hash } = await hashPassword(plain, saltHex);
    // Constant-time compare
    if (hash.length !== expectedHashHex.length) return false;
    let diff = 0;
    for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ expectedHashHex.charCodeAt(i);
    return diff === 0;
  } catch { return false; }
}

// ───── HMAC-SHA256 token ─────
async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function signToken(payload, secret) {
  if (!secret) throw new Error('AUTH_SECRET not set');
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = b64urlEncode(await hmacSign(secret, body));
  return `${body}.${sig}`;
}

export async function verifyToken(token, secret) {
  if (!token || typeof token !== 'string' || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = b64urlEncode(await hmacSign(secret, body));
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  let payload;
  try { payload = JSON.parse(dec.decode(b64urlDecode(body))); } catch { return null; }
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.exp === 'number' && Date.now() / 1000 > payload.exp) return null;
  return payload;
}

// ───── Cookie helpers ─────
export function buildSessionCookie(token) {
  return [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'Secure',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE}`,
    'Domain=spicemore.com',
  ].join('; ');
}

export function clearSessionCookie() {
  return [
    `${COOKIE_NAME}=`,
    'Path=/',
    'Secure',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Domain=spicemore.com',
  ].join('; ');
}

export function readSessionCookie(request) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === COOKIE_NAME) return part.slice(eq + 1).trim();
  }
  return null;
}

// ───── Mobile normalization ─────
// Accepts: "9447122533", "+91 94471 22533", "094471 22533", "919447122533"
// Returns: "9447122533" (10 digits) or null.
export function normalizeMobile(input) {
  if (!input) return null;
  let s = String(input).replace(/[^0-9]/g, '');
  if (s.length === 12 && s.startsWith('91')) s = s.slice(2);
  else if (s.length === 11 && s.startsWith('0')) s = s.slice(1);
  if (s.length !== 10) return null;
  return s;
}

// ───── Session lookup helper used by routes ─────
export async function getSession(request, env) {
  const token = readSessionCookie(request);
  if (!token) return null;
  return await verifyToken(token, env.AUTH_SECRET);
}

export const SESSION_TTL_SECONDS = COOKIE_MAX_AGE;

// ───── Role guard ─────
// Returns { session, errorResponse }. If errorResponse is set, the caller must return it.
// Usage:
//   const { session, errorResponse } = await requireRole(request, env, ['admin', 'manager']);
//   if (errorResponse) return errorResponse;
export async function requireRole(request, env, allowedRoles = null) {
  const session = await getSession(request, env);
  const errHeaders = { 'content-type': 'application/json', 'access-control-allow-origin': '*' };
  if (!session) {
    return {
      session: null,
      errorResponse: new Response(
        JSON.stringify({ ok: false, error: 'Authentication required' }),
        { status: 401, headers: errHeaders }
      )
    };
  }
  if (allowedRoles && !allowedRoles.includes(session.role)) {
    return {
      session,
      errorResponse: new Response(
        JSON.stringify({ ok: false, error: 'Insufficient permissions' }),
        { status: 403, headers: errHeaders }
      )
    };
  }
  return { session, errorResponse: null };
}
