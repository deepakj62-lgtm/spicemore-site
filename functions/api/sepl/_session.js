// HMAC-SHA256 signed token using Web Crypto. Compatible with Cloudflare Workers.
// SECRET comes from env.SEPL_SESSION_SECRET (set via wrangler pages secret put).
//
// UNIFIED AUTH (2026-04): SEPL API verification now prefers the unified
// `sm_session` cookie (issued by /api/auth/login) and falls back to the
// legacy SEPL Bearer token only if no cookie is present. The cookie payload
// shape ({ u, n, role, ... }) is normalized here to the legacy SEPL shape
// ({ phone, name, role }) so existing handler logic continues to work.

import { getSession as getUnifiedSession } from '../auth/_session.js';

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

// Normalize the unified cookie session payload ({u,n,e,role,...}) to the
// legacy SEPL session shape ({phone,name,role}) consumed by existing handlers.
function normalizeUnified(s) {
  if (!s) return null;
  return {
    phone: s.u || '',
    name: s.n || '',
    role: s.role || 'staff',
    email: s.e || '',
    iat: s.iat,
    exp: s.exp,
  };
}

// Convenience for handlers that have a Request object.
// Tries unified cookie session first, falls back to legacy Bearer token.
export async function verifyToken(request, env) {
  const unified = await getUnifiedSession(request, env);
  if (unified) return normalizeUnified(unified);
  const auth = request.headers.get('authorization') || request.headers.get('Authorization');
  return verifyTokenFromHeader(auth, env.SEPL_SESSION_SECRET || 'dev-secret-change-me');
}

// Token from cookie OR ?t= query param OR Authorization header.
export async function verifyAny(request, env) {
  const unified = await getUnifiedSession(request, env);
  if (unified) return normalizeUnified(unified);
  const url = new URL(request.url);
  const qt = url.searchParams.get('t');
  if (qt) return verifyTokenFromHeader('Bearer ' + qt, env.SEPL_SESSION_SECRET || 'dev-secret-change-me');
  const auth = request.headers.get('authorization') || request.headers.get('Authorization');
  return verifyTokenFromHeader(auth, env.SEPL_SESSION_SECRET || 'dev-secret-change-me');
}

export async function mintToken(env, { phone, role, name }) {
  const now = Date.now();
  return sign(env.SEPL_SESSION_SECRET || 'dev-secret-change-me',
    { phone, role, name, iat: now, exp: now + 30 * 24 * 60 * 60 * 1000 });
}
