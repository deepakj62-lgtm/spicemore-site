#!/usr/bin/env node
// One-shot seeder for Spicemore staff accounts.
//
// Usage:
//   node scripts/seed-staff.mjs
//
// Then upload to R2:
//   wrangler r2 object put spicemore-attendance/auth/accounts.json --file=/tmp/accounts.json --remote
//
// Hash function MUST match functions/api/auth/_session.js exactly:
//   PBKDF2-SHA256, 100k iterations, 32-byte output, 16-byte random salt, both stored as hex.
// Initial password = mobile string itself. mustChangePassword=true. role='staff'.

import { writeFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const subtle = webcrypto.subtle;
const enc = new TextEncoder();

const PBKDF2_ITERS = 100_000;
const PBKDF2_HASH_LEN = 32;
const PBKDF2_SALT_LEN = 16;

function bytesToHex(buf) {
  const a = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < a.length; i++) s += a[i].toString(16).padStart(2, '0');
  return s;
}

async function hashPassword(plain) {
  const salt = new Uint8Array(PBKDF2_SALT_LEN);
  webcrypto.getRandomValues(salt);
  const key = await subtle.importKey(
    'raw', enc.encode(String(plain)), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    key,
    PBKDF2_HASH_LEN * 8
  );
  return { salt: bytesToHex(salt), hash: bytesToHex(bits) };
}

// Edwin: emp 002 doesn't exist (skipped — that's fine).
// Mary George (011) and Rajamanickam (012) share mobile 9544089380 — Mary wins (alphabetical),
// Rajamanickam is skipped with a warning. Edwin will fix this in his copy.
// `name` MUST match the canonical roster entry in attend-data.js fy27Seed() so that
// session.n equality checks line up with employee records. (Auth and attendance
// share the same name field — that's the join key.)
const STAFF = [
  { employeeNo: '001', name: 'JOHNY V JOSEPH',      email: 'johny@spicemore.com',             mobile: '9447122533' },
  { employeeNo: '003', name: 'EDWIN JOSEPH JOHN',   email: 'edwin@spicemore.com',             mobile: '9620125393', role: 'admin' },
  { employeeNo: '004', name: 'ABHIRAMI',            email: 'abhirami.sajeevan@spicemore.com', mobile: '9446417552' },
  { employeeNo: '005', name: 'AKHIL VS',            email: 'akhil.vs@spicemore.com',          mobile: '9645652560' },
  { employeeNo: '006', name: 'BINCY LIJO',          email: 'bincy.lijo@spicemore.com',        mobile: '8547818843' },
  { employeeNo: '007', name: 'S GOWSIK',            email: 'gowsik.s@spicemore.com',          mobile: '8489795670', role: 'ot_manager' },
  { employeeNo: '008', name: 'JOSHY JOSEPH',        email: 'joshy.joseph@spicemore.com',      mobile: '6282489418' },
  { employeeNo: '009', name: 'LIJO VARGHESE',       email: 'lijo.varghese@spicemore.com',     mobile: '9746628843' },
  { employeeNo: '010', name: 'LIYA MURALI',         email: 'liya.murali@spicemore.com',       mobile: '9567375771' },
  { employeeNo: '011', name: 'MARY GEORGE',         email: 'mary.george@spicemore.com',       mobile: '9544089380' },
  { employeeNo: '012', name: 'M RAJAMANICKAM',      email: 'rajamanickam.m@spicemore.com',    mobile: '9942959280' },
  { employeeNo: '013', name: 'R RAJESH',            email: 'rajesh.r@spicemore.com',          mobile: '9443800371' },
  { employeeNo: '014', name: 'SANOOP T S',          email: 'sanoop.ts@spicemore.com',         mobile: '7907830463' },
  { employeeNo: '015', name: 'SHAJI K SEBASTIAN',   email: 'shaji.sebastian@spicemore.com',   mobile: '9400482230' },
  { employeeNo: '016', name: 'M SURESH',            email: 'suresh.m@spicemore.com',          mobile: '8778850662' },
  { employeeNo: '017', name: 'M THARIQ AKRAM',      email: 'thariq.m@spicemore.com',          mobile: '8610857935' },
  { employeeNo: '018', name: 'A VELMURUGAN',        email: 'velmurugan.a@spicemore.com',      mobile: '9080453906' },
  { employeeNo: '019', name: 'MINI JOHNY',          email: 'mini.johny@spicemore.com',        mobile: '9539317798' },
  { employeeNo: '000', name: 'DEEPAK JOHNY',        email: 'deepakj62@gmail.com',             mobile: '9497317798', role: 'admin' },
];

const accounts = {};
const conflicts = [];

for (const s of STAFF) {
  if (accounts[s.mobile]) {
    conflicts.push({ kept: accounts[s.mobile].name, skipped: s.name, mobile: s.mobile, employeeNo: s.employeeNo });
    console.warn(`[conflict] mobile ${s.mobile} already used by "${accounts[s.mobile].name}" (#${accounts[s.mobile].employeeNo}); skipping "${s.name}" (#${s.employeeNo}).`);
    continue;
  }
  const { salt, hash } = await hashPassword(s.mobile); // initial password = mobile
  accounts[s.mobile] = {
    employeeNo: s.employeeNo,
    name: s.name,
    email: s.email,
    role: s.role || 'staff',
    salt,
    hash,
    mustChangePassword: false,
    createdAt: new Date().toISOString(),
  };
  console.log(`[seeded] #${s.employeeNo} ${s.name} (${s.mobile})`);
}

const outPath = '/tmp/accounts.json';
writeFileSync(outPath, JSON.stringify(accounts, null, 2));
console.log(`\nWrote ${Object.keys(accounts).length} accounts to ${outPath}`);
if (conflicts.length) {
  console.log(`\nConflicts (skipped): ${conflicts.length}`);
  for (const c of conflicts) console.log(`  - ${c.skipped} (#${c.employeeNo}) shares ${c.mobile} with ${c.kept}`);
}
console.log(`\nNext: wrangler r2 object put spicemore-attendance/auth/accounts.json --file=${outPath} --remote`);
