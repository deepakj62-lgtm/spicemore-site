#!/usr/bin/env node
// Seed consignor accounts into auth/accounts.json from existing SEPL consignor records.
//
// What it does:
//   1. Logs in as admin via /api/auth/login to get an sm_session cookie.
//   2. Fetches all consignors via GET /api/sepl/consignors.
//   3. Fetches the existing auth/accounts.json from R2 (via `wrangler r2 object get`).
//   4. For each consignor with a non-empty phone:
//        - normalize to 10 digits (strip +91/0/spaces)
//        - skip if blank, malformed, or collides with an existing staff account
//        - hash mobile-as-password (PBKDF2-SHA256, same params as functions/api/auth/_session.js)
//        - merge entry into accounts.json keyed by 10-digit mobile, role='consignor'
//   5. Writes merged accounts.json to /tmp/accounts.json.
//   6. Uploads to R2 via `wrangler r2 object put spicemore-attendance/auth/accounts.json --remote`.
//
// Usage:
//   ADMIN_MOBILE=9620125393 ADMIN_PASSWORD=9620125393 node scripts/seed-consignors.mjs
//
// Env:
//   ADMIN_MOBILE     — admin/staff 10-digit mobile (default: 9620125393, Edwin)
//   ADMIN_PASSWORD   — admin password (default: same as mobile)
//   BASE_URL         — site base URL (default: https://spicemore.com)
//   BUCKET           — R2 bucket name (default: spicemore-attendance)
//   DRY_RUN          — if "1", don't upload to R2

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { execSync } from 'node:child_process';

const subtle = webcrypto.subtle;
const enc = new TextEncoder();

const PBKDF2_ITERS = 100_000;
const PBKDF2_HASH_LEN = 32;
const PBKDF2_SALT_LEN = 16;

const BASE_URL = process.env.BASE_URL || 'https://spicemore.com';
const BUCKET = process.env.BUCKET || 'spicemore-attendance';
const ADMIN_MOBILE = process.env.ADMIN_MOBILE || '9620125393';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ADMIN_MOBILE;
const DRY_RUN = process.env.DRY_RUN === '1';

function bytesToHex(buf) {
  const a = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < a.length; i++) s += a[i].toString(16).padStart(2, '0');
  return s;
}

async function hashPassword(plain) {
  const salt = new Uint8Array(PBKDF2_SALT_LEN);
  webcrypto.getRandomValues(salt);
  const key = await subtle.importKey('raw', enc.encode(String(plain)), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    key,
    PBKDF2_HASH_LEN * 8
  );
  return { salt: bytesToHex(salt), hash: bytesToHex(bits) };
}

function normalizeMobile(input) {
  if (!input) return null;
  let s = String(input).replace(/[^0-9]/g, '');
  if (s.length === 12 && s.startsWith('91')) s = s.slice(2);
  else if (s.length === 11 && s.startsWith('0')) s = s.slice(1);
  if (s.length !== 10) return null;
  return s;
}

async function loginAsAdmin() {
  const r = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_MOBILE, password: ADMIN_PASSWORD }),
    redirect: 'manual'
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) {
    throw new Error(`Admin login failed: ${r.status} ${JSON.stringify(d)}`);
  }
  const setCookie = r.headers.get('set-cookie') || '';
  const m = setCookie.match(/sm_session=([^;]+)/);
  if (!m) throw new Error(`No sm_session cookie in login response: ${setCookie}`);
  const role = d.user?.role;
  if (!['admin', 'staff', 'manager', 'ot_manager'].includes(role)) {
    throw new Error(`Admin account has role=${role}, need staff/admin/manager`);
  }
  console.log(`[login] role=${role} name=${d.user?.name}`);
  return `sm_session=${m[1]}`;
}

async function fetchConsignors(cookie) {
  const r = await fetch(`${BASE_URL}/api/sepl/consignors`, {
    headers: { 'Cookie': cookie }
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Failed to fetch consignors: ${r.status} ${t.slice(0, 300)}`);
  }
  const d = await r.json();
  return d.consignors || [];
}

function fetchExistingAccounts() {
  // Use wrangler to pull current accounts.json from R2.
  const tmpPath = '/tmp/accounts-existing.json';
  try {
    execSync(
      `wrangler r2 object get ${BUCKET}/auth/accounts.json --file=${tmpPath} --remote`,
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (e) {
    console.warn('[warn] could not fetch existing accounts.json from R2 — starting from empty.');
    console.warn('       stderr:', String(e.stderr || e.message).slice(0, 300));
    return {};
  }
  if (!existsSync(tmpPath)) return {};
  try {
    return JSON.parse(readFileSync(tmpPath, 'utf8'));
  } catch (e) {
    console.warn('[warn] existing accounts.json was unparseable — starting from empty.');
    return {};
  }
}

async function main() {
  console.log(`[config] base=${BASE_URL} bucket=${BUCKET} adminMobile=${ADMIN_MOBILE} dryRun=${DRY_RUN}`);

  const cookie = await loginAsAdmin();
  const consignors = await fetchConsignors(cookie);
  console.log(`[fetch] got ${consignors.length} consignor records`);

  const accounts = fetchExistingAccounts();
  const existingKeys = new Set(Object.keys(accounts));
  console.log(`[merge] existing accounts.json has ${existingKeys.size} entries`);

  const seeded = [];
  const skipped = [];

  for (const c of consignors) {
    const mobile = normalizeMobile(c.phone);
    if (!mobile) {
      skipped.push({ id: c.consignorId, name: c.name, phone: c.phone, reason: 'no/invalid phone' });
      continue;
    }
    const existing = accounts[mobile];
    if (existing && existing.role && existing.role !== 'consignor') {
      skipped.push({ id: c.consignorId, name: c.name, phone: c.phone, reason: `mobile ${mobile} already used by ${existing.role} "${existing.name}"` });
      continue;
    }
    if (existing && existing.role === 'consignor' && existing.consignorId === c.consignorId) {
      // Already seeded for the same consignor — skip silently to preserve any password change.
      skipped.push({ id: c.consignorId, name: c.name, phone: c.phone, reason: 'already provisioned (preserved)' });
      continue;
    }
    const { salt, hash } = await hashPassword(mobile);
    accounts[mobile] = {
      consignorId: c.consignorId,
      name: c.name || '',
      email: '',
      role: 'consignor',
      salt,
      hash,
      mustChangePassword: false,
      createdAt: new Date().toISOString(),
    };
    seeded.push({ id: c.consignorId, name: c.name, mobile });
    console.log(`[seeded] ${c.consignorId} ${c.name} -> ${mobile}`);
  }

  const outPath = '/tmp/accounts.json';
  writeFileSync(outPath, JSON.stringify(accounts, null, 2));
  console.log(`\n[write] ${Object.keys(accounts).length} total accounts -> ${outPath}`);
  console.log(`[summary] seeded=${seeded.length} skipped=${skipped.length}`);
  if (skipped.length) {
    console.log('[skipped]');
    for (const s of skipped) console.log(`  - ${s.id || '?'} ${s.name || ''} (${s.phone || 'no phone'}): ${s.reason}`);
  }

  if (DRY_RUN) {
    console.log('\n[dry-run] not uploading to R2.');
    return;
  }

  console.log(`\n[upload] -> r2://${BUCKET}/auth/accounts.json`);
  execSync(
    `wrangler r2 object put ${BUCKET}/auth/accounts.json --file=${outPath} --content-type=application/json --remote`,
    { stdio: 'inherit' }
  );
  console.log('[upload] done.');
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1); });
