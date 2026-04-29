import { Resend } from 'resend';
import { getJSON, putJSON, json, preflight } from './_blob.js';
import { requireRole } from './auth/_session.js';

const DATA_PATH = 'attendance/data.json';
const SITE_URL = 'https://spicemore.com';
const FROM_EMAIL = 'Spicemore Attendance <attendance@send.spicemore.com>';

const TYPE_LABELS = {
  pl: 'Paid Leave (PL)', ot: 'OT / Comp-off Leave',
  rl: 'Regional Leave (RL)', lop: 'Loss of Pay (LOP)'
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });
  const bucket = env.ATTENDANCE_BUCKET || env.BLOB_BUCKET;

  // Require any logged-in session.
  const { session, errorResponse } = await requireRole(request, env);
  if (errorResponse) return errorResponse;

  try {
    let { employee, type, from_date, to_date, days, reason, employee_email } = await request.json();
    if (!employee || !type || !from_date || !to_date || !days || !reason) {
      return json({ error: 'Missing required fields' }, { status: 400 });
    }
    // Staff may only submit for themselves; admin/manager may submit for anyone;
    // ot_manager (Gowsik) may submit type='ot' for any employee, but other leave types still locked to self.
    const isAdmin = session.role === 'admin' || session.role === 'manager';
    const isOtMgr = session.role === 'ot_manager';
    const sessionName = (session.n || '').trim().toUpperCase();
    const claimedName = String(employee).trim().toUpperCase();
    const submittingForSelf = sessionName === claimedName;
    if (!isAdmin) {
      if (isOtMgr) {
        if (type !== 'ot' && !submittingForSelf) {
          return json({ error: 'OT manager can only submit OT/Comp-off on behalf of others — for PL/RL/LOP submit your own application' }, { status: 403 });
        }
      } else if (!submittingForSelf) {
        return json({ error: 'You may only submit leave for yourself' }, { status: 403 });
      }
      // Force employee_email to the session's email when submitting for self (prevents spoofing).
      // For OT manager submitting on someone else's behalf, employee_email comes from the request (manager's own email)
      // so the Reply-To still routes back to the OT manager who can answer follow-ups.
      if (submittingForSelf) employee_email = session.e || employee_email || '';
      else if (isOtMgr) employee_email = session.e || employee_email || '';
    }
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const application = {
      id, token, employee, type, from_date, to_date,
      days: parseFloat(days), reason,
      employee_email: employee_email || '',
      status: 'pending',
      applied_on: new Date().toISOString(),
      action_comment: '', action_date: '', action_by: ''
    };

    const data = await getJSON(bucket, DATA_PATH, { managerEmail: '', employees: [], balances: {}, ot_credits: [], leave_applications: [] });
    data.leave_applications = data.leave_applications || [];
    data.leave_applications.push(application);
    data.updatedAt = new Date().toISOString();
    await putJSON(bucket, DATA_PATH, data);

    // Recipients: managerEmail can be a comma-separated list. Fan out as a single send with multiple to-addresses.
    const recipients = String(data.managerEmail || '')
      .split(/[,;]/)
      .map(s => s.trim())
      .filter(Boolean);

    let emailStatus = { sent: false, reason: null, to: recipients };
    if (recipients.length === 0) emailStatus.reason = 'managerEmail not configured in Settings';
    else if (!env.RESEND_API_KEY) emailStatus.reason = 'RESEND_API_KEY env missing';
    else {
      const resend = new Resend(env.RESEND_API_KEY);
      const approveUrl = `${SITE_URL}/api/attend-action?id=${id}&action=approve&token=${token}`;
      const dashUrl = `${SITE_URL}/staff-attendance.html`;
      const typeLabel = TYPE_LABELS[type] || type;
      const daysNum = parseFloat(days);

      // Reply-To = the applying staff's email so a manager can hit "reply" and reach them directly.
      const replyTo = (employee_email && /@/.test(employee_email)) ? employee_email : null;

      const sendResult = await resend.emails.send({
        from: FROM_EMAIL,
        to: recipients,
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject: `Leave Request — ${employee}: ${typeLabel} (${daysNum} day${daysNum !== 1 ? 's' : ''})`,
        html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f5f1ed;padding:24px">
  <div style="background:#2D5016;padding:20px 24px;border-radius:10px 10px 0 0">
    <h1 style="color:#fff;margin:0;font-size:20px">Spicemore Leave Request</h1>
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
      <a href="${approveUrl}" style="display:inline-block;background:#2D5016;color:#fff;padding:13px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin-right:12px">Approve</a>
      <a href="${dashUrl}" style="display:inline-block;background:#fff;color:#dc2626;padding:13px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;border:2px solid #dc2626">Reject / Review</a>
    </div>
    <p style="color:#aaa;font-size:11px;text-align:center;margin:0">Approve is one-click. To reject or add a comment, use the Reject/Review link to open the Manager Dashboard.</p>
  </div>
</div>`
      });
      if (sendResult && sendResult.error) {
        emailStatus.reason = `Resend error: ${sendResult.error.message || sendResult.error.name || JSON.stringify(sendResult.error)}`;
      } else {
        emailStatus.sent = true;
        emailStatus.id = sendResult && sendResult.data && sendResult.data.id;
      }
    }

    return json({ ok: true, id, application, emailStatus }, { status: 201 });
  } catch (err) {
    console.error('attend-apply error:', err);
    return json({ error: err.message }, { status: 500 });
  }
}
