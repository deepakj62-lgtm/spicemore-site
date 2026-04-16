const { Resend } = require('resend');

function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

const FROM_EMAIL = 'SMTC Tools <onboarding@resend.dev>';
const SITE_URL = 'https://spicemore-site.vercel.app';

async function sendRequestConfirmation(request) {
  const resend = getResend();
  if (!resend || !request.requesterEmail) return;

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: request.requesterEmail,
      subject: `SMTC Request Received: ${request.toolName}`,
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8f9fa; padding: 24px;">
          <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: #4ecca3; margin: 0; font-size: 22px;">SMTC Corporate Tools</h1>
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
            <p style="color: #999; font-size: 12px; margin-bottom: 0;">This is an automated message from SMTC Corporate Tools.</p>
          </div>
        </div>
      `
    });
  } catch (err) {
    console.error('Email send failed (confirmation):', err.message);
  }
}

async function sendStatusUpdate(request, newStatus, note) {
  const resend = getResend();
  if (!resend || !request.requesterEmail) return;

  const statusLabels = {
    in_review: { label: 'In Review', color: '#17a2b8', bg: '#d1ecf1' },
    in_progress: { label: 'In Progress', color: '#fd7e14', bg: '#fff3cd' },
    ready_for_testing: { label: 'Ready for Testing', color: '#28a745', bg: '#d4edda' },
    live: { label: 'Live', color: '#4ecca3', bg: '#d4edda' },
    on_hold: { label: 'On Hold', color: '#6c757d', bg: '#e2e3e5' }
  };

  const statusInfo = statusLabels[newStatus] || { label: newStatus, color: '#666', bg: '#f0f0f0' };

  const testLinkSection = newStatus === 'ready_for_testing' ? `
    <div style="background: #d4edda; border: 1px solid #c3e6cb; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 0 0 8px; font-weight: 600; color: #155724;">Your tool is ready for testing!</p>
      <p style="margin: 0; color: #155724;">Please test the tool and provide feedback through the requests dashboard. If everything looks good, let us know and we'll make it live.</p>
    </div>
  ` : '';

  const liveLinkSection = newStatus === 'live' ? `
    <div style="background: #d4edda; border: 1px solid #c3e6cb; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 0 0 8px; font-weight: 600; color: #155724;">Your tool is now live!</p>
      <p style="margin: 0; color: #155724;">The tool has been deployed and is available in the SMTC Corporate portal. Access it anytime through the portal.</p>
    </div>
  ` : '';

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: request.requesterEmail,
      subject: `SMTC Update: ${request.toolName} - ${statusInfo.label}`,
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8f9fa; padding: 24px;">
          <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: #4ecca3; margin: 0; font-size: 22px;">SMTC Corporate Tools</h1>
            <p style="color: #a0a0b0; margin: 8px 0 0;">Status Update</p>
          </div>
          <div style="background: white; padding: 24px; border-radius: 0 0 12px 12px; border: 1px solid #e0e0e0; border-top: none;">
            <h2 style="color: #1a1a2e; margin-top: 0;">${request.toolName}</h2>
            <p>Hi ${request.requesterName || 'there'},</p>
            <p>Your request status has been updated:</p>
            <div style="text-align: center; margin: 20px 0;">
              <span style="background: ${statusInfo.bg}; color: ${statusInfo.color}; padding: 8px 20px; border-radius: 20px; font-weight: 600; font-size: 16px;">${statusInfo.label}</span>
            </div>
            ${note ? `<div style="background: #f8f9fa; border-left: 4px solid ${statusInfo.color}; padding: 12px 16px; margin: 16px 0; border-radius: 0 8px 8px 0;"><p style="margin: 0; color: #333;">${note}</p></div>` : ''}
            ${testLinkSection}
            ${liveLinkSection}
            <div style="text-align: center; margin: 24px 0;">
              <a href="${SITE_URL}/smtc-requests-view.html" style="display: inline-block; background: #4ecca3; color: #1a1a2e; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Request Details</a>
            </div>
            <p style="color: #999; font-size: 12px; margin-bottom: 0;">This is an automated message from SMTC Corporate Tools.</p>
          </div>
        </div>
      `
    });
  } catch (err) {
    console.error('Email send failed (status update):', err.message);
  }
}

module.exports = { sendRequestConfirmation, sendStatusUpdate };
