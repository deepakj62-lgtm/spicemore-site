// Email helpers — uses Resend SDK. RESEND_API_KEY must be set as a Pages secret.
import { Resend } from 'resend';

const FROM_EMAIL = 'Spicemore Tools <noreply@send.spicemore.com>';
const ATTENDANCE_FROM = 'Spicemore Attendance <attendance@send.spicemore.com>';
const SITE_URL = 'https://spicemore.com';
const TYPE_LABELS = {
  pl: 'Paid Leave (PL)', ot: 'OT / Comp-off Leave',
  rl: 'Regional Leave (RL)', lop: 'Loss of Pay (LOP)'
};

function getResend(env) {
  if (!env.RESEND_API_KEY) return null;
  return new Resend(env.RESEND_API_KEY);
}

// Look up a staff member's email from R2 auth/accounts.json by canonical name.
// Returns null if not found.
export async function lookupStaffEmail(env, employeeName) {
  if (!employeeName) return null;
  const bucket = env.ATTENDANCE_BUCKET || env.BLOB_BUCKET;
  if (!bucket) return null;
  try {
    const obj = await bucket.get('auth/accounts.json');
    if (!obj) return null;
    const accounts = JSON.parse(await obj.text());
    const target = String(employeeName).trim().toUpperCase();
    for (const k of Object.keys(accounts)) {
      const a = accounts[k];
      if (String(a.name || '').trim().toUpperCase() === target && a.email) return a.email;
    }
  } catch (_) {}
  return null;
}

// Notify the applying staff that their leave was approved or rejected.
// Falls back to looking up the email from auth/accounts.json if the application
// doesn't carry one (e.g. OT-manager-submitted leaves where employee_email is the manager's).
export async function sendLeaveDecisionEmail(env, app, decision, replyToList) {
  const resend = getResend(env);
  if (!resend || !app) return;
  let to = (app.employee_email && /@/.test(app.employee_email)) ? app.employee_email : null;
  // If the stored email looks like the OT manager's, override by name lookup.
  // We do the lookup unconditionally as a safety net, but only swap if found.
  const looked = await lookupStaffEmail(env, app.employee);
  if (looked) to = looked;
  if (!to) return;
  const typeLabel = TYPE_LABELS[app.type] || app.type;
  const days = parseFloat(app.days);
  const isApproved = decision === 'approved';
  const accent = isApproved ? '#2D5016' : '#b33';
  const headline = isApproved ? 'Leave approved' : 'Leave rejected';
  const subject = `Spicemore Attendance — ${headline}: ${typeLabel} (${days} day${days !== 1 ? 's' : ''})`;
  const reply = Array.isArray(replyToList) ? replyToList.filter(Boolean) : (replyToList ? [replyToList] : []);
  try {
    await resend.emails.send({
      from: ATTENDANCE_FROM,
      to,
      ...(reply.length ? { reply_to: reply } : {}),
      subject,
      html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f5f1ed;padding:24px">
  <div style="background:${accent};padding:20px 24px;border-radius:10px 10px 0 0">
    <h1 style="color:#fff;margin:0;font-size:20px">${headline}</h1>
    <p style="color:#fff;opacity:.85;margin:6px 0 0;font-size:13px">Spice More Trading Company — Staff Attendance</p>
  </div>
  <div style="background:#fff;padding:28px;border-radius:0 0 10px 10px;border:1px solid #ddd;border-top:none">
    <p style="margin-top:0">Hi ${app.employee},</p>
    <p>Your leave application has been <strong style="color:${accent}">${decision}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
      <tr style="background:#f9f7f4"><td style="padding:10px;color:#888;width:150px">Leave Type</td><td style="padding:10px;font-weight:600;color:${accent}">${typeLabel}</td></tr>
      <tr><td style="padding:10px;color:#888">From</td><td style="padding:10px">${app.from_date}</td></tr>
      <tr style="background:#f9f7f4"><td style="padding:10px;color:#888">To</td><td style="padding:10px">${app.to_date}</td></tr>
      <tr><td style="padding:10px;color:#888">Days</td><td style="padding:10px;font-weight:600">${days} day${days !== 1 ? 's' : ''}</td></tr>
      ${app.action_comment ? `<tr style="background:#f9f7f4"><td style="padding:10px;color:#888">Manager comment</td><td style="padding:10px;font-style:italic">${app.action_comment}</td></tr>` : ''}
    </table>
    <p style="color:#666;font-size:13px;margin-bottom:0">Reply to this email if you need to discuss with your manager. Or open <a href="${SITE_URL}/staff-attendance" style="color:${accent}">your dashboard</a>.</p>
  </div>
</div>`
    });
  } catch (err) { console.error('sendLeaveDecisionEmail failed:', err.message); }
}

export async function sendRequestConfirmation(env, request) {
  const resend = getResend(env);
  if (!resend || !request.requesterEmail) return;
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: request.requesterEmail,
      subject: `Spicemore Request Received: ${request.toolName}`,
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8f9fa; padding: 24px;">
          <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: #4ecca3; margin: 0; font-size: 22px;">Spicemore Corporate Tools</h1>
            <p style="color: #a0a0b0; margin: 8px 0 0;">Spice More Trading Company</p>
          </div>
          <div style="background: white; padding: 24px; border-radius: 0 0 12px 12px; border: 1px solid #e0e0e0; border-top: none;">
            <h2 style="color: #1a1a2e; margin-top: 0;">Request Received!</h2>
            <p>Hi ${request.requesterName || 'there'},</p>
            <p>Your functionality request has been submitted successfully. Here are the details:</p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
              <tr><td style="padding: 8px; color: #666; width: 140px;">Tool Name:</td><td style="padding: 8px; font-weight: 600;">${request.toolName}</td></tr>
              <tr style="background: #f8f9fa;"><td style="padding: 8px; color: #666;">Request ID:</td><td style="padding: 8px; font-family: monospace;">${request.id}</td></tr>
              <tr><td style="padding: 8px; color: #666;">Priority:</td><td style="padding: 8px;">${(request.priority || 'normal').charAt(0).toUpperCase() + (request.priority || 'normal').slice(1)}</td></tr>
              <tr style="background: #f8f9fa;"><td style="padding: 8px; color: #666;">Status:</td><td style="padding: 8px;"><span style="background: #fff3cd; color: #856404; padding: 2px 10px; border-radius: 12px; font-size: 13px;">Submitted</span></td></tr>
              <tr><td style="padding: 8px; color: #666;">Files Uploaded:</td><td style="padding: 8px;">${(request.files || []).length} file(s)</td></tr>
            </table>
            <p>Our automated system will begin processing your request shortly. You'll receive email updates as the status changes.</p>
            <div style="text-align: center; margin: 24px 0;">
              <a href="${SITE_URL}/smtc-requests-view.html" style="display: inline-block; background: #4ecca3; color: #1a1a2e; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">Track Your Request</a>
            </div>
            <p style="color: #999; font-size: 12px; margin-bottom: 0;">This is an automated message from Spicemore Corporate Tools.</p>
          </div>
        </div>
      `
    });
  } catch (err) { console.error('Email send failed (confirmation):', err.message); }
}

export async function sendStatusUpdate(env, request, newStatus, note) {
  const resend = getResend(env);
  if (!resend || !request.requesterEmail) return;
  const statusLabels = {
    in_review: { label: 'In Review', color: '#17a2b8', bg: '#d1ecf1' },
    in_progress: { label: 'In Progress', color: '#fd7e14', bg: '#fff3cd' },
    ready_for_testing: { label: 'Ready for Testing', color: '#28a745', bg: '#d4edda' },
    live: { label: 'Live', color: '#4ecca3', bg: '#d4edda' },
    on_hold: { label: 'On Hold', color: '#6c757d', bg: '#e2e3e5' }
  };
  const statusInfo = statusLabels[newStatus] || { label: newStatus, color: '#666', bg: '#f0f0f0' };
  const testLinkSection = newStatus === 'ready_for_testing'
    ? `<div style="background:#d4edda;border:1px solid #c3e6cb;border-radius:8px;padding:16px;margin:16px 0;"><p style="margin:0 0 8px;font-weight:600;color:#155724;">Your tool is ready for testing!</p><p style="margin:0;color:#155724;">Please test the tool and provide feedback through the requests dashboard.</p></div>` : '';
  const liveLinkSection = newStatus === 'live'
    ? `<div style="background:#d4edda;border:1px solid #c3e6cb;border-radius:8px;padding:16px;margin:16px 0;"><p style="margin:0 0 8px;font-weight:600;color:#155724;">Your tool is now live!</p></div>` : '';
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: request.requesterEmail,
      subject: `Spicemore Update: ${request.toolName} - ${statusInfo.label}`,
      html: `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8f9fa;padding:24px;"><div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:24px;border-radius:12px 12px 0 0;text-align:center;"><h1 style="color:#4ecca3;margin:0;font-size:22px;">Spicemore Corporate Tools</h1><p style="color:#a0a0b0;margin:8px 0 0;">Status Update</p></div><div style="background:white;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e0e0e0;border-top:none;"><h2 style="color:#1a1a2e;margin-top:0;">${request.toolName}</h2><p>Hi ${request.requesterName || 'there'},</p><p>Your request status has been updated:</p><div style="text-align:center;margin:20px 0;"><span style="background:${statusInfo.bg};color:${statusInfo.color};padding:8px 20px;border-radius:20px;font-weight:600;font-size:16px;">${statusInfo.label}</span></div>${note ? `<div style="background:#f8f9fa;border-left:4px solid ${statusInfo.color};padding:12px 16px;margin:16px 0;border-radius:0 8px 8px 0;"><p style="margin:0;color:#333;">${note}</p></div>` : ''}${testLinkSection}${liveLinkSection}<div style="text-align:center;margin:24px 0;"><a href="${SITE_URL}/smtc-requests-view.html" style="display:inline-block;background:#4ecca3;color:#1a1a2e;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">View Request Details</a></div></div></div>`
    });
  } catch (err) { console.error('Email send failed (status update):', err.message); }
}
