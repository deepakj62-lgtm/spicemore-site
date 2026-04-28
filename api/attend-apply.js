const { put, list } = require('@vercel/blob');
const { Resend } = require('resend');

const DATA_PATH = 'attendance/data.json';
const SITE_URL = 'https://spicemore.com';
const FROM_EMAIL = 'SMTC Attendance <onboarding@resend.dev>';

const TYPE_LABELS = {
  pl: 'Paid Leave (PL)',
  ot: 'OT / Comp-off Leave',
  rl: 'Regional Leave (RL)',
  lop: 'Loss of Pay (LOP)'
};

async function loadData() {
  try {
    const { blobs } = await list({ prefix: 'attendance/' });
    const blob = blobs.find(b => b.pathname === DATA_PATH);
    if (!blob) return { managerEmail: '', employees: [], balances: {}, ot_credits: [], leave_applications: [] };
    const resp = await fetch(blob.url + '?nocache=' + Date.now());
    return await resp.json();
  } catch (e) {
    return { managerEmail: '', employees: [], balances: {}, ot_credits: [], leave_applications: [] };
  }
}

async function saveData(data) {
  data.updatedAt = new Date().toISOString();
  await put(DATA_PATH, JSON.stringify(data), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    cacheControlMaxAge: 0
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { employee, type, from_date, to_date, days, reason, employee_email } = req.body;
    if (!employee || !type || !from_date || !to_date || !days || !reason) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

    const application = {
      id, token, employee, type,
      from_date, to_date,
      days: parseFloat(days),
      reason,
      employee_email: employee_email || '',
      status: 'pending',
      applied_on: new Date().toISOString(),
      action_comment: '', action_date: '', action_by: ''
    };

    const data = await loadData();
    data.leave_applications = data.leave_applications || [];
    data.leave_applications.push(application);
    await saveData(data);

    // Send email to manager
    if (data.managerEmail && process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const approveUrl = `${SITE_URL}/api/attend-action?id=${id}&action=approve&token=${token}`;
      const dashUrl = `${SITE_URL}/staff-attendance.html`;
      const typeLabel = TYPE_LABELS[type] || type;
      const daysNum = parseFloat(days);

      await resend.emails.send({
        from: FROM_EMAIL,
        to: data.managerEmail,
        subject: `Leave Request — ${employee}: ${typeLabel} (${daysNum} day${daysNum !== 1 ? 's' : ''})`,
        html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f5f1ed;padding:24px">
  <div style="background:#2D5016;padding:20px 24px;border-radius:10px 10px 0 0">
    <h1 style="color:#fff;margin:0;font-size:20px">SMTC Leave Request</h1>
    <p style="color:#8FBC6F;margin:6px 0 0;font-size:13px">Spice More Trading Company — Staff Attendance</p>
  </div>
  <div style="background:#fff;padding:28px;border-radius:0 0 10px 10px;border:1px solid #ddd;border-top:none">
    <h2 style="color:#2D5016;margin-top:0">${employee} has applied for leave</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
      <tr style="background:#f9f7f4"><td style="padding:10px;color:#888;width:150px">Employee</td><td style="padding:10px;font-weight:600">${employee}</td></tr>
      <tr><td style="padding:10px;color:#888">Leave Type</td><td style="padding:10px;font-weight:600;color:#2D5016">${typeLabel}</td></tr>
      <tr style="background:#f9f7f4"><td style="padding:10px;color:#888">From</td><td style="padding:10px">${from_date}</td></tr>
      <tr><td style="padding:10px;color:#888">To</td><td style="padding:10px">${to_date}</td></tr>
      <tr style="background:#f9f7f4"><td style="padding:10px;color:#888">Days</td><td style="padding:10px;font-weight:600">${daysNum} day${daysNum !== 1 ? 's' : ''}</td></tr>
      <tr><td style="padding:10px;color:#888">Reason</td><td style="padding:10px">${reason}</td></tr>
      <tr style="background:#f9f7f4"><td style="padding:10px;color:#888">Applied On</td><td style="padding:10px">${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td></tr>
    </table>
    <div style="text-align:center;margin:28px 0 16px">
      <a href="${approveUrl}" style="display:inline-block;background:#2D5016;color:#fff;padding:13px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin-right:12px">✓ Approve</a>
      <a href="${dashUrl}" style="display:inline-block;background:#fff;color:#dc2626;padding:13px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;border:2px solid #dc2626">✗ Reject / Review</a>
    </div>
    <p style="color:#aaa;font-size:11px;text-align:center;margin:0">Approve is one-click. To reject or add a comment, use the Reject/Review link to open the Manager Dashboard.</p>
  </div>
</div>`
      });
    }

    return res.status(201).json({ ok: true, id, application });
  } catch (err) {
    console.error('attend-apply error:', err);
    return res.status(500).json({ error: err.message });
  }
};
