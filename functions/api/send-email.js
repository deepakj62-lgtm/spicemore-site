import { Resend } from 'resend';
import { json, preflight } from './_blob.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });
  if (!env.RESEND_API_KEY) return json({ error: 'Email service not configured' }, { status: 503 });

  try {
    const { to, subject, html, text } = await request.json();
    if (!to || !subject || (!html && !text)) {
      return json({ error: 'Missing required fields: to, subject, and html or text' }, { status: 400 });
    }
    const resend = new Resend(env.RESEND_API_KEY);
    const emailData = {
      from: 'Spicemore Tools <onboarding@resend.dev>',
      to: Array.isArray(to) ? to : [to], subject
    };
    if (html) emailData.html = html;
    if (text) emailData.text = text;
    const result = await resend.emails.send(emailData);
    return json({ success: true, id: result.data?.id });
  } catch (error) {
    console.error('Send email error:', error);
    return json({ error: 'Failed to send email', details: error.message }, { status: 500 });
  }
}
