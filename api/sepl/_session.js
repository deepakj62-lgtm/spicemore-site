const crypto = require('crypto');

const SECRET = process.env.SEPL_SESSION_SECRET || 'dev-secret-change-me';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(body).digest());
  return `${body}.${sig}`;
}

function verifyToken(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('Missing bearer token');
  const token = auth.slice(7).trim();
  const [body, sig] = token.split('.');
  if (!body || !sig) throw new Error('Malformed token');
  const expected = b64url(crypto.createHmac('sha256', SECRET).update(body).digest());
  if (expected !== sig) throw new Error('Bad signature');
  const payload = JSON.parse(b64urlDecode(body).toString('utf8'));
  if (payload.exp && Date.now() > payload.exp) throw new Error('Token expired');
  return payload; // { phone, role, name, iat, exp }
}

function mintToken({ phone, role, name }) {
  const now = Date.now();
  return sign({ phone, role, name, iat: now, exp: now + 30 * 24 * 60 * 60 * 1000 });
}

function requireRole(req, role) {
  const p = verifyToken(req);
  if (p.role !== role) throw new Error(`Requires role ${role}`);
  return p;
}

module.exports = { verifyToken, mintToken, requireRole };
