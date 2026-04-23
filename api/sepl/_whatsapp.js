/*
 * SEPL WhatsApp send stub.
 *
 * Currently logs payloads and persists them to the `whatsapp-outbox/` blob
 * prefix so Deepak can eyeball what would have gone out. Returns
 * { ok: true, stubbed: true }.
 *
 * WIRE-UP OPTIONS — replace the body of `sendWhatsAppText` and
 * `sendWhatsAppDocument` below with one of these:
 *
 *   1. Meta WhatsApp Cloud API (recommended for business use)
 *      POST https://graph.facebook.com/v19.0/{PHONE_NUMBER_ID}/messages
 *      Env: WHATSAPP_CLOUD_TOKEN, WHATSAPP_PHONE_NUMBER_ID
 *
 *   2. Twilio WhatsApp
 *      POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
 *      Env: TWILIO_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
 *
 *   3. Tunneled local bridge (whatsapp-mcp at localhost:8080)
 *      POST http(s)://<public-tunnel>/api/send
 *      Env: WHATSAPP_BRIDGE_URL, WHATSAPP_BRIDGE_TOKEN
 *      (Deepak already runs a LaunchAgent bridge — easiest to prototype.)
 */

const { put } = require('@vercel/blob');

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
    console.error('[SEPL whatsapp stub] outbox write failed:', e.message);
  }
}

async function sendWhatsAppText(phone, text) {
  console.log('[SEPL whatsapp stub] text ->', phone, text);
  await saveOutbox('text', { phone, text, at: new Date().toISOString() });
  return { ok: true, stubbed: true };
}

async function sendWhatsAppDocument(phone, pdfBuffer, filename, caption) {
  console.log('[SEPL whatsapp stub] doc ->', phone, filename, caption, 'bytes:', pdfBuffer?.length || 0);
  // Persist the PDF too so Deepak can open what would have been sent.
  try {
    await put(`whatsapp-outbox/docs/${Date.now()}-${filename}`, pdfBuffer, {
      access: 'public',
      contentType: 'application/pdf',
      addRandomSuffix: false,
      cacheControlMaxAge: 0
    });
  } catch (e) {
    console.error('[SEPL whatsapp stub] doc blob write failed:', e.message);
  }
  await saveOutbox('document', { phone, filename, caption, bytes: pdfBuffer?.length || 0, at: new Date().toISOString() });
  return { ok: true, stubbed: true };
}

module.exports = { sendWhatsAppText, sendWhatsAppDocument };
