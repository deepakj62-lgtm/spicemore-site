/*
 * SEPL WhatsApp — Meta Cloud API implementation.
 *
 * RENAME TO _whatsapp.js AFTER META APPROVAL — see META-WABA-SETUP.md Step 7.
 *
 * Required env (set in Vercel before swap):
 *   META_WHATSAPP_TOKEN               — permanent System User token (EAA…)
 *   META_WHATSAPP_PHONE_NUMBER_ID     — numeric phone-number ID from WABA
 *   META_WHATSAPP_BUSINESS_ACCOUNT_ID — numeric WABA ID (not strictly needed
 *                                       for /messages, but handy for ops)
 *
 * Exports (same signatures as the stub — callers don't change):
 *   sendWhatsAppText(phone, text)
 *   sendWhatsAppDocument(phone, pdfBuffer, filename, caption)
 *
 * Plus a new export for template messages (needed for OTP outside the 24h
 * customer-service window — which is always, for OTPs):
 *   sendWhatsAppTemplate(phone, templateName, languageCode, components)
 *   sendSeplOtp(phone, code)  — convenience wrapper for sepl_otp template
 *
 * Outbox archival behavior is preserved — every outbound message is also
 * written to the `whatsapp-outbox/` blob prefix for audit.
 */

const { put } = require('@vercel/blob');

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function cfg() {
  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error(
      '[SEPL whatsapp] missing META_WHATSAPP_TOKEN or META_WHATSAPP_PHONE_NUMBER_ID in env'
    );
  }
  return { token, phoneNumberId };
}

// Meta expects E.164 without the leading '+'. Accept either.
function toMetaPhone(phone) {
  if (!phone) return phone;
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

async function metaPost(path, body) {
  const { token } = cfg();
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    const code = json?.error?.code;
    const sub = json?.error?.error_subcode;
    throw new Error(
      `[SEPL whatsapp] Meta API error ${res.status} (code=${code}, sub=${sub}): ${msg}`
    );
  }
  return json;
}

async function metaPostForm(path, form) {
  const { token } = cfg();
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `[SEPL whatsapp] Meta media upload error ${res.status}: ${json?.error?.message || 'unknown'}`
    );
  }
  return json;
}

/**
 * Plain free-form text. Only delivers within the 24h customer-service window
 * (i.e. the recipient has messaged SEPL within the last 24h). Outside that
 * window Meta will reject — use a template instead.
 */
async function sendWhatsAppText(phone, text) {
  const { phoneNumberId } = cfg();
  const to = toMetaPhone(phone);
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body: text }
  };

  try {
    const result = await metaPost(`/${phoneNumberId}/messages`, body);
    await saveOutbox('text', { phone: to, text, at: new Date().toISOString(), result });
    return { ok: true, messageId: result?.messages?.[0]?.id };
  } catch (e) {
    console.error('[SEPL whatsapp] sendText failed:', e.message);
    await saveOutbox('text-failed', { phone: to, text, at: new Date().toISOString(), error: e.message });
    return { ok: false, error: e.message };
  }
}

/**
 * Upload a PDF buffer to Meta's media endpoint, then send it as a document.
 * Caption is optional.
 */
async function sendWhatsAppDocument(phone, pdfBuffer, filename, caption) {
  const { phoneNumberId } = cfg();
  const to = toMetaPhone(phone);

  try {
    // Step 1 — upload media (multipart/form-data).
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'application/pdf');
    form.append(
      'file',
      new Blob([pdfBuffer], { type: 'application/pdf' }),
      filename
    );
    const uploaded = await metaPostForm(`/${phoneNumberId}/media`, form);
    const mediaId = uploaded?.id;
    if (!mediaId) throw new Error('no media id returned from Meta');

    // Step 2 — send document message referencing the media id.
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'document',
      document: {
        id: mediaId,
        filename,
        ...(caption ? { caption } : {})
      }
    };
    const result = await metaPost(`/${phoneNumberId}/messages`, body);

    // Also persist the PDF to outbox for audit (same as stub behavior).
    try {
      await put(`whatsapp-outbox/docs/${Date.now()}-${filename}`, pdfBuffer, {
        access: 'public',
        contentType: 'application/pdf',
        addRandomSuffix: false,
        cacheControlMaxAge: 0
      });
    } catch (e) {
      console.error('[SEPL whatsapp] doc blob archive failed:', e.message);
    }
    await saveOutbox('document', {
      phone: to, filename, caption, bytes: pdfBuffer?.length || 0,
      mediaId, at: new Date().toISOString(), result
    });
    return { ok: true, messageId: result?.messages?.[0]?.id, mediaId };
  } catch (e) {
    console.error('[SEPL whatsapp] sendDocument failed:', e.message);
    await saveOutbox('document-failed', {
      phone: to, filename, caption, at: new Date().toISOString(), error: e.message
    });
    return { ok: false, error: e.message };
  }
}

/**
 * Generic template message. `components` is the Meta components array, e.g.:
 *   [{ type: 'body', parameters: [{ type: 'text', text: '482913' }] }]
 */
async function sendWhatsAppTemplate(phone, templateName, languageCode, components) {
  const { phoneNumberId } = cfg();
  const to = toMetaPhone(phone);
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode || 'en' },
      ...(components && components.length ? { components } : {})
    }
  };
  try {
    const result = await metaPost(`/${phoneNumberId}/messages`, body);
    await saveOutbox('template', {
      phone: to, templateName, languageCode, components,
      at: new Date().toISOString(), result
    });
    return { ok: true, messageId: result?.messages?.[0]?.id };
  } catch (e) {
    console.error('[SEPL whatsapp] sendTemplate failed:', e.message);
    await saveOutbox('template-failed', {
      phone: to, templateName, at: new Date().toISOString(), error: e.message
    });
    return { ok: false, error: e.message };
  }
}

/**
 * Convenience: send the `sepl_otp` authentication template.
 * Authentication templates require the code to appear as both the {{1}} body
 * parameter AND the Copy Code button payload.
 */
async function sendSeplOtp(phone, code) {
  const components = [
    {
      type: 'body',
      parameters: [{ type: 'text', text: String(code) }]
    },
    {
      type: 'button',
      sub_type: 'url', // Meta's auth-template copy-code button uses sub_type 'url' with index 0 in v21
      index: '0',
      parameters: [{ type: 'text', text: String(code) }]
    }
  ];
  return sendWhatsAppTemplate(phone, 'sepl_otp', 'en', components);
}

module.exports = {
  sendWhatsAppText,
  sendWhatsAppDocument,
  sendWhatsAppTemplate,
  sendSeplOtp
};
