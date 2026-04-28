const { put, list } = require('@vercel/blob');

const DATA_PATH = 'attendance/data.json';
const SITE_URL = 'https://spicemore.com';

async function loadData() {
  const { blobs } = await list({ prefix: 'attendance/' });
  const blob = blobs.find(b => b.pathname === DATA_PATH);
  if (!blob) throw new Error('No attendance data found');
  const resp = await fetch(blob.url + '?nocache=' + Date.now());
  return await resp.json();
}

async function saveData(data) {
  data.updatedAt = new Date().toISOString();
  await put(DATA_PATH, JSON.stringify(data), {
    access: 'public', contentType: 'application/json',
    addRandomSuffix: false, cacheControlMaxAge: 0
  });
}

function page(icon, title, body, link = true) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} | Spicemore</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;background:#f5f1ed;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{background:#fff;border-radius:14px;padding:44px 40px;max-width:460px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.10)}
.icon{font-size:52px;margin-bottom:16px}h2{color:#2D5016;font-size:22px;margin-bottom:12px}p{color:#666;line-height:1.6;margin-bottom:8px}
a{display:inline-block;margin-top:20px;background:#2D5016;color:#fff;padding:11px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px}</style></head>
<body><div class="card"><div class="icon">${icon}</div><h2>${title}</h2>${body}${link ? `<a href="${SITE_URL}/staff-attendance.html">Go to Dashboard →</a>` : ''}</div></body></html>`;
}

module.exports = async function handler(req, res) {
  const { id, action, token } = req.query;

  if (!id || !action || !token) {
    return res.status(400).send(page('⚠️', 'Missing Parameters', '<p>This link is incomplete. Please use the link from your email.</p>', false));
  }

  try {
    const data = await loadData();
    const app = (data.leave_applications || []).find(a => a.id === id);

    if (!app) {
      return res.status(404).send(page('❓', 'Not Found', '<p>This leave request could not be found.</p>'));
    }
    if (app.token !== token) {
      return res.status(403).send(page('🔒', 'Invalid Link', '<p>This approval link is not valid.</p>'));
    }
    if (app.status !== 'pending') {
      return res.status(200).send(page('ℹ️', `Already ${app.status.charAt(0).toUpperCase() + app.status.slice(1)}`,
        `<p><strong>${app.employee}</strong>'s leave has already been <strong>${app.status}</strong>.</p>
         ${app.action_comment ? `<p style="margin-top:8px;color:#888;font-style:italic">"${app.action_comment}"</p>` : ''}`));
    }

    if (action === 'approve') {
      app.status = 'approved';
      app.action_comment = req.query.comment || '';
      app.action_date = new Date().toISOString();
      app.action_by = 'Manager (email)';

      // Deduct balance
      const bal = data.balances[app.employee] = data.balances[app.employee] || {};
      if (app.type === 'pl') bal.pl_used = (bal.pl_used || 0) + app.days;
      if (app.type === 'rl') bal.rl_used = (bal.rl_used || 0) + app.days;
      if (app.type === 'ot') {
        let rem = app.days;
        const today = new Date().toISOString().slice(0, 10);
        for (const c of (data.ot_credits || [])) {
          if (c.employee === app.employee && c.expires_on >= today) {
            const avail = c.days_earned - (c.days_availed || 0);
            if (avail > 0) {
              const use = Math.min(avail, rem);
              c.days_availed = (c.days_availed || 0) + use;
              rem -= use;
            }
            if (rem <= 0) break;
          }
        }
      }

      await saveData(data);

      const typeLabel = { pl: 'Paid Leave', ot: 'OT / Comp-off Leave', rl: 'Regional Leave', lop: 'Loss of Pay' }[app.type] || app.type;
      return res.status(200).send(page('✅', 'Leave Approved',
        `<p><strong>${app.employee}</strong>'s ${typeLabel} has been approved.</p>
         <p style="margin-top:6px;color:#888">${app.from_date} to ${app.to_date} &nbsp;·&nbsp; ${app.days} day${app.days !== 1 ? 's' : ''}</p>`));
    }

    // For reject, redirect to manager dashboard with the request highlighted
    return res.status(302).setHeader('Location', `${SITE_URL}/staff-attendance.html?reject=${id}&token=${token}`).end();

  } catch (err) {
    console.error('attend-action error:', err);
    return res.status(500).send(page('⚠️', 'Error', `<p>Something went wrong. Please go to the dashboard to take action manually.</p>`));
  }
};
