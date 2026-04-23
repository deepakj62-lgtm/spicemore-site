/*
 * SEPL WhatsApp send path.
 *
 * Posts to a cloudflared-tunneled local whatsapp-mcp bridge
 * (whatsapp-bridge at localhost:8080 on Deepak's Mac).
 *
 *   WHATSAPP_BRIDGE_URL     e.g. https://foo.trycloudflare.com (no trailing slash)
 *   WHATSAPP_BRIDGE_SECRET  shared secret, sent as X-Bridge-Secret header
 *
 * Fallback behaviour: if the env vars are missing or the bridge call fails,
 * we log + persist the payload to the `whatsapp-outbox/` blob prefix so the
 * app never crashes and we retain an audit trail.
 */

const { put } = require('@vercel/blob');

const BRIDGE_URL = (process.env.WHATSAPP_BRIDGE_URL || '').replace(/\/$/, '');
const BRIDGE_SECRET = process.env.WHATSAPP_BRIDGE_SECRET || '';
const TIMEOUT_MS = 15000;

function normalizeRecipient(phone) {
  // Bridge expects either a bare E.164 (no '+') or a full JID.
  if (!phone) return '';
  if (phone.includes('@')) return phone;
  return String(phone).replace(/[^\d]/g, '');
}

async function saveOutbox(kind, payload) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const key = `whatsapp-outbox/${ts}-${kind}.json`;
  try {
    await put(key, JSON.stringify(payload, null, 2), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      cacheControlMaxAge: 0
    });
  } catch (e) {
    console.error('[SEPL whatsapp] outbox write failed:', e.message);
  }
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function testBridge() {
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

async function sendWhatsAppText(phone, text) {
  const recipient = normalizeRecipient(phone);
  if (!BRIDGE_URL) {
    console.warn('[SEPL whatsapp] BRIDGE_URL missing — stubbing');
    await saveOutbox('text-stub', { phone, text, at: new Date().toISOString() });
    return { ok: true, stubbed: true, reason: 'BRIDGE_URL not set' };
  }
  try {
    const res = await fetchWithTimeout(`${BRIDGE_URL}/api/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Secret': BRIDGE_SECRET
      },
      body: JSON.stringify({ recipient, message: text })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      console.error('[SEPL whatsapp] text send failed', res.status, body);
      await saveOutbox('text-failed', { phone, text, status: res.status, body, at: new Date().toISOString() });
      return { ok: false, status: res.status, body };
    }
    return { ok: true, body };
  } catch (e) {
    console.error('[SEPL whatsapp] text send exception', e.message);
    await saveOutbox('text-exception', { phone, text, error: e.message, at: new Date().toISOString() });
    return { ok: false, error: e.message };
  }
}

async function sendWhatsAppDocument(phone, pdfBuffer, filename, caption) {
  const recipient = normalizeRecipient(phone);
  if (!BRIDGE_URL) {
    console.warn('[SEPL whatsapp] BRIDGE_URL missing — stubbing doc');
    try {
      await put(`whatsapp-outbox/docs/${Date.now()}-${filename}`, pdfBuffer, {
        access: 'public',
        contentType: 'application/pdf',
        addRandomSuffix: false,
        cacheControlMaxAge: 0
      });
    } catch (e) {
      console.error('[SEPL whatsapp] doc stub blob failed:', e.message);
    }
    await saveOutbox('doc-stub', { phone, filename, caption, bytes: pdfBuffer?.length || 0, at: new Date().toISOString() });
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
      console.error('[SEPL whatsapp] doc send failed', res.status, body);
      await saveOutbox('doc-failed', { phone, filename, caption, status: res.status, body, at: new Date().toISOString() });
      return { ok: false, status: res.status, body };
    }
    return { ok: true, body };
  } catch (e) {
    console.error('[SEPL whatsapp] doc send exception', e.message);
    await saveOutbox('doc-exception', { phone, filename, caption, error: e.message, at: new Date().toISOString() });
    return { ok: false, error: e.message };
  }
}

module.exports = { sendWhatsAppText, sendWhatsAppDocument, testBridge };
