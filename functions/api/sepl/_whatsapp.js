// SEPL WhatsApp send path — posts to a cloudflared-tunneled local whatsapp-mcp bridge.
// Env: WHATSAPP_BRIDGE_URL, WHATSAPP_BRIDGE_SECRET. Falls back to outbox blob audit.
import { putJSON, putObject } from '../_blob.js';

const TIMEOUT_MS = 15000;

function normalizeRecipient(phone) {
  if (!phone) return '';
  if (phone.includes('@')) return phone;
  return String(phone).replace(/[^\d]/g, '');
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function saveOutbox(bucket, kind, payload) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const key = `whatsapp-outbox/${ts}-${kind}.json`;
  try { await putJSON(bucket, key, payload); }
  catch (e) { console.error('[SEPL whatsapp] outbox write failed:', e.message); }
}

export async function testBridge(env) {
  const BRIDGE_URL = (env.WHATSAPP_BRIDGE_URL || '').replace(/\/$/, '');
  if (!BRIDGE_URL) return { ok: false, reason: 'WHATSAPP_BRIDGE_URL not set' };
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(`${BRIDGE_URL}/api/health`, { method: 'GET' }, 5000);
    const latencyMs = Date.now() - started;
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, latencyMs, body };
  } catch (e) {
    return { ok: false, reason: e.message, latencyMs: Date.now() - started };
  }
}

export async function sendWhatsAppText(env, phone, text) {
  const BRIDGE_URL = (env.WHATSAPP_BRIDGE_URL || '').replace(/\/$/, '');
  const BRIDGE_SECRET = env.WHATSAPP_BRIDGE_SECRET || '';
  const bucket = env.BLOB_BUCKET;
  const recipient = normalizeRecipient(phone);
  if (!BRIDGE_URL) {
    await saveOutbox(bucket, 'text-stub', { phone, text, at: new Date().toISOString() });
    return { ok: true, stubbed: true, reason: 'BRIDGE_URL not set' };
  }
  try {
    const res = await fetchWithTimeout(`${BRIDGE_URL}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Secret': BRIDGE_SECRET },
      body: JSON.stringify({ recipient, message: text })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      await saveOutbox(bucket, 'text-failed', { phone, text, status: res.status, body, at: new Date().toISOString() });
      return { ok: false, status: res.status, body };
    }
    return { ok: true, body };
  } catch (e) {
    await saveOutbox(bucket, 'text-exception', { phone, text, error: e.message, at: new Date().toISOString() });
    return { ok: false, error: e.message };
  }
}

export async function sendWhatsAppDocument(env, phone, pdfBuffer, filename, caption) {
  const BRIDGE_URL = (env.WHATSAPP_BRIDGE_URL || '').replace(/\/$/, '');
  const BRIDGE_SECRET = env.WHATSAPP_BRIDGE_SECRET || '';
  const bucket = env.BLOB_BUCKET;
  const recipient = normalizeRecipient(phone);

  if (!BRIDGE_URL) {
    try { await putObject(bucket, `whatsapp-outbox/docs/${Date.now()}-${filename}`, pdfBuffer, 'application/pdf'); }
    catch (e) { console.error('[SEPL whatsapp] doc stub blob failed:', e.message); }
    await saveOutbox(bucket, 'doc-stub', { phone, filename, caption, bytes: pdfBuffer?.length || 0, at: new Date().toISOString() });
    return { ok: true, stubbed: true, reason: 'BRIDGE_URL not set' };
  }
  try {
    const form = new FormData();
    form.append('recipient', recipient);
    form.append('caption', caption || '');
    const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
    form.append('file', blob, filename);
    const res = await fetchWithTimeout(`${BRIDGE_URL}/api/send-media`, {
      method: 'POST',
      headers: { 'X-Bridge-Secret': BRIDGE_SECRET },
      body: form
    }, 30000);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      await saveOutbox(bucket, 'doc-failed', { phone, filename, caption, status: res.status, body, at: new Date().toISOString() });
      return { ok: false, status: res.status, body };
    }
    return { ok: true, body };
  } catch (e) {
    await saveOutbox(bucket, 'doc-exception', { phone, filename, caption, error: e.message, at: new Date().toISOString() });
    return { ok: false, error: e.message };
  }
}
