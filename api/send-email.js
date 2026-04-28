const { Resend } = require('resend');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(503).json({ error: 'Email service not configured' });
  }

  try {
    const { to, subject, html, text } = req.body;

    if (!to || !subject || (!html && !text)) {
      return res.status(400).json({ error: 'Missing required fields: to, subject, and html or text' });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    const emailData = {
      from: 'Spicemore Tools <onboarding@resend.dev>',
      to: Array.isArray(to) ? to : [to],
      subject,
    };
    if (html) emailData.html = html;
    if (text) emailData.text = text;

    const result = await resend.emails.send(emailData);

    return res.status(200).json({ success: true, id: result.data?.id });

  } catch (error) {
    console.error('Send email error:', error);
    return res.status(500).json({ error: 'Failed to send email', details: error.message });
  }
};
