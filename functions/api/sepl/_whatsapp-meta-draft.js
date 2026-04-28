/*
 * SEPL WhatsApp — Meta Cloud API implementation (DRAFT).
 * Rename to _whatsapp.js after Meta WABA approval.
 *
 * Required env (Pages secrets):
 *   META_WHATSAPP_TOKEN
 *   META_WHATSAPP_PHONE_NUMBER_ID
 *   META_WHATSAPP_BUSINESS_ACCOUNT_ID  (optional)
 *
 * All exports take `env` as first arg (Cloudflare Pages style).
 */
import { putJSON, putObject } from '../_blob.js';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function cfg(env) {
  const token = env.META_WHATSAPP_TOKEN;
  const phoneNumberId = env.META_WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error('[SEPL whatsapp] missing META_WHATSAPP_TOKEN or META_WHATSAPP_PHONE_NUMBER_ID in env');
  }
  return { token, phoneNumberId };
}

function toMetaPhone(phone) {
  if (!phone) return phone;
  return String(phone).replace(/[^\d]/g, '');
}

async function saveOutbox(bucket, kind, payload) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  try { await putJSON(bucket, `whatsapp-outbox/${ts}-${kind}.json`, payload); }
  catch (e) { console.error('[SEPL whatsapp] outbox write failed:', e.message); }
}

async function metaPost(env, path, body) {
  const { token } = cfg(env);
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j?.error?.message || `HTTP ${res.status}`;
    throw new Error(`[SEPL whatsapp] Meta API error ${res.status} (code=${j?.error?.code}): ${msg}`);
  }
  return j;
}

async function metaPostForm(env, path, form) {
  const { token } = cfg(env);
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`[SEPL whatsapp] Meta media upload error ${res.status}: ${j?.error?.message || 'unknown'}`);
  return j;
}

export async function sendWhatsAppText(env, phone, text) {
  const bucket = env.BLOB_BUCKET;
  const { phoneNumberId } = cfg(env);
  const to = toMetaPhone(phone);
  try {
    const result = await metaPost(env, `/${phoneNumberId}/messages`, {
      messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text',
      text: { preview_url: false, body: text }
    });
    await saveOutbox(bucket, 'text', { phone: to, text, at: new Date().toISOString(), result });
    return { ok: true, messageId: result?.messages?.[0]?.id };
  } catch (e) {
    await saveOutbox(bucket, 'text-failed', { phone: to, text, at: new Date().toISOString(), error: e.message });
    return { ok: false, error: e.message };
  }
}

export async function sendWhatsAppDocument(env, phone, pdfBuffer, filename, caption) {
  const bucket = env.BLOB_BUCKET;
  const { phoneNumberId } = cfg(env);
  const to = toMetaPhone(phone);
  try {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'application/pdf');
    form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), filename);
    const uploaded = await metaPostForm(env, `/${phoneNumberId}/media`, form);
    const mediaId = uploaded?.id;
    if (!mediaId) throw new Error('no media id returned from Meta');
    const result = await metaPost(env, `/${phoneNumberId}/messages`, {
      messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'document',
      document: { id: mediaId, filename, ...(caption ? { caption } : {}) }
    });
    try { await putObject(bucket, `whatsapp-outbox/docs/${Date.now()}-${filename}`, pdfBuffer, 'application/pdf'); }
    catch (e) { console.error('[SEPL whatsapp] doc blob archive failed:', e.message); }
    await saveOutbox(bucket, 'document', { phone: to, filename, caption, bytes: pdfBuffer?.length || 0, mediaId, at: new Date().toISOString(), result });
    return { ok: true, messageId: result?.messages?.[0]?.id, mediaId };
  } catch (e) {
    await saveOutbox(bucket, 'document-failed', { phone: to, filename, caption, at: new Date().toISOString(), error: e.message });
    return { ok: false, error: e.message };
  }
}

export async function sendWhatsAppTemplate(env, phone, templateName, languageCode, components) {
  const bucket = env.BLOB_BUCKET;
  const { phoneNumberId } = cfg(env);
  const to = toMetaPhone(phone);
  const body = {
    messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template',
    template: { name: templateName, language: { code: languageCode || 'en' }, ...(components && components.length ? { components } : {}) }
  };
  try {
    const result = await metaPost(env, `/${phoneNumberId}/messages`, body);
    await saveOutbox(bucket, 'template', { phone: to, templateName, languageCode, components, at: new Date().toISOString(), result });
    return { ok: true, messageId: result?.messages?.[0]?.id };
  } catch (e) {
    await saveOutbox(bucket, 'template-failed', { phone: to, templateName, at: new Date().toISOString(), error: e.message });
    return { ok: false, error: e.message };
  }
}

export async function sendSeplOtp(env, phone, code) {
  const components = [
    { type: 'body', parameters: [{ type: 'text', text: String(code) }] },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(code) }] }
  ];
  return sendWhatsAppTemplate(env, phone, 'sepl_otp', 'en', components);
}
