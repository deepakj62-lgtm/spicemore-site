const { put, list } = require('@vercel/blob');

const DATA_PATH = 'attendance/data.json';

function defaultData() {
  return {
    managerEmail: '',
    fy: 'FY27',
    fy_start: '2026-04-01',
    fy_end: '2027-03-31',
    employees: [],
    work_types: {},
    balances: {},
    ot_credits: [],
    leave_applications: []
  };
}

// FY27 seed data from Spicemore Staff Attendance Roster
function fy27Seed() {
  const employees = [
    'A VELMURUGAN','ABHIRAMI','AKHIL VS','BINCY LIJO','JOSHY JOSEPH',
    'LIJO VARGHESE','LIYA MURALI','M RAJAMANICKAM','M SURESH','M THARIQ AKRAM',
    'MARY GEORGE','MINI JOHNY','MOORTHY','R RAJESH','S GOWSIK','SANOOP T S','SHAJI K SEBASTIAN'
  ];
  const work_types = {
    'A VELMURUGAN': 'Auction', 'AKHIL VS': 'Auction', 'JOSHY JOSEPH': 'Auction',
    'M RAJAMANICKAM': 'Auction', 'M SURESH': 'Auction', 'M THARIQ AKRAM': 'Auction',
    'S GOWSIK': 'Auction', 'SANOOP T S': 'Auction', 'SHAJI K SEBASTIAN': 'Auction'
  };
  // PL & RL used as of end of April 2026
  const balances = {
    'A VELMURUGAN':     { pl_used: 0,   rl_used: 0 },
    'ABHIRAMI':         { pl_used: 0,   rl_used: 1 },
    'AKHIL VS':         { pl_used: 1,   rl_used: 1 },
    'BINCY LIJO':       { pl_used: 2,   rl_used: 0 },
    'JOSHY JOSEPH':     { pl_used: 1.5, rl_used: 0 },
    'LIJO VARGHESE':    { pl_used: 2,   rl_used: 0 },
    'LIYA MURALI':      { pl_used: 0,   rl_used: 0 },
    'M RAJAMANICKAM':   { pl_used: 0,   rl_used: 0 },
    'M SURESH':         { pl_used: 0.5, rl_used: 0 },
    'M THARIQ AKRAM':   { pl_used: 1.5, rl_used: 0 },
    'MARY GEORGE':      { pl_used: 3,   rl_used: 0 },
    'MINI JOHNY':       { pl_used: 0,   rl_used: 0 },
    'MOORTHY':          { pl_used: 4,   rl_used: 0 },
    'R RAJESH':         { pl_used: 1,   rl_used: 0 },
    'S GOWSIK':         { pl_used: 0,   rl_used: 0 },
    'SANOOP T S':       { pl_used: 0,   rl_used: 1 },
    'SHAJI K SEBASTIAN':{ pl_used: 2,   rl_used: 0 },
  };
  // OT credits from April 2026 (hours/7 rounded to nearest 0.5). Expire May 28.
  const ot_credits = [
    { id:'seed_avm', employee:'A VELMURUGAN',    date_worked:'2026-04-28', hours:24, days_earned:3.5, days_availed:0, expires_on:'2026-05-28', logged_by:'Supervisor', logged_on:'2026-04-28T00:00:00.000Z', notes:'April OT' },
    { id:'seed_avs', employee:'AKHIL VS',        date_worked:'2026-04-28', hours:15, days_earned:2.0, days_availed:1, expires_on:'2026-05-28', logged_by:'Supervisor', logged_on:'2026-04-28T00:00:00.000Z', notes:'April OT' },
    { id:'seed_jj',  employee:'JOSHY JOSEPH',    date_worked:'2026-04-28', hours:15, days_earned:2.0, days_availed:1, expires_on:'2026-05-28', logged_by:'Supervisor', logged_on:'2026-04-28T00:00:00.000Z', notes:'April OT' },
    { id:'seed_mrm', employee:'M RAJAMANICKAM',  date_worked:'2026-04-28', hours:7,  days_earned:1.0, days_availed:0, expires_on:'2026-05-28', logged_by:'Supervisor', logged_on:'2026-04-28T00:00:00.000Z', notes:'April OT' },
    { id:'seed_ms',  employee:'M SURESH',        date_worked:'2026-04-28', hours:20, days_earned:3.0, days_availed:0, expires_on:'2026-05-28', logged_by:'Supervisor', logged_on:'2026-04-28T00:00:00.000Z', notes:'April OT' },
    { id:'seed_mta', employee:'M THARIQ AKRAM',  date_worked:'2026-04-28', hours:7,  days_earned:1.0, days_availed:0, expires_on:'2026-05-28', logged_by:'Supervisor', logged_on:'2026-04-28T00:00:00.000Z', notes:'April OT' },
    { id:'seed_sg',  employee:'S GOWSIK',        date_worked:'2026-04-28', hours:23, days_earned:3.5, days_availed:0, expires_on:'2026-05-28', logged_by:'Supervisor', logged_on:'2026-04-28T00:00:00.000Z', notes:'April OT' },
    { id:'seed_sts', employee:'SANOOP T S',      date_worked:'2026-04-28', hours:23, days_earned:3.5, days_availed:0, expires_on:'2026-05-28', logged_by:'Supervisor', logged_on:'2026-04-28T00:00:00.000Z', notes:'April OT' },
    { id:'seed_sks', employee:'SHAJI K SEBASTIAN',date_worked:'2026-04-28',hours:11, days_earned:1.5, days_availed:1, expires_on:'2026-05-28', logged_by:'Supervisor', logged_on:'2026-04-28T00:00:00.000Z', notes:'April OT' },
  ];
  // Historical approved leave records from April 2026
  const leave_applications = [
    { id:'h_avs_pl', token:'hist', employee:'AKHIL VS',         type:'pl', from_date:'2026-04-01', to_date:'2026-04-01', days:1,   reason:'Personal (April)', status:'approved', applied_on:'2026-04-01T00:00:00.000Z', action_comment:'', action_date:'2026-04-01T00:00:00.000Z', action_by:'Manager', employee_email:'' },
    { id:'h_blj_pl', token:'hist', employee:'BINCY LIJO',       type:'pl', from_date:'2026-04-01', to_date:'2026-04-02', days:2,   reason:'Personal (April)', status:'approved', applied_on:'2026-04-01T00:00:00.000Z', action_comment:'', action_date:'2026-04-01T00:00:00.000Z', action_by:'Manager', employee_email:'' },
    { id:'h_jj_pl',  token:'hist', employee:'JOSHY JOSEPH',     type:'pl', from_date:'2026-04-01', to_date:'2026-04-01', days:1.5, reason:'Personal (April)', status:'approved', applied_on:'2026-04-01T00:00:00.000Z', action_comment:'', action_date:'2026-04-01T00:00:00.000Z', action_by:'Manager', employee_email:'' },
    { id:'h_lv_pl',  token:'hist', employee:'LIJO VARGHESE',    type:'pl', from_date:'2026-04-01', to_date:'2026-04-02', days:2,   reason:'Personal (April)', status:'approved', applied_on:'2026-04-01T00:00:00.000Z', action_comment:'', action_date:'2026-04-01T00:00:00.000Z', action_by:'Manager', employee_email:'' },
    { id:'h_msu_pl', token:'hist', employee:'M SURESH',         type:'pl', from_date:'2026-04-01', to_date:'2026-04-01', days:0.5, reason:'Personal (April)', status:'approved', applied_on:'2026-04-01T00:00:00.000Z', action_comment:'', action_date:'2026-04-01T00:00:00.000Z', action_by:'Manager', employee_email:'' },
    { id:'h_mta_pl', token:'hist', employee:'M THARIQ AKRAM',   type:'pl', from_date:'2026-04-01', to_date:'2026-04-01', days:1.5, reason:'Personal (April)', status:'approved', applied_on:'2026-04-01T00:00:00.000Z', action_comment:'', action_date:'2026-04-01T00:00:00.000Z', action_by:'Manager', employee_email:'' },
    { id:'h_mg_pl',  token:'hist', employee:'MARY GEORGE',      type:'pl', from_date:'2026-04-01', to_date:'2026-04-03', days:3,   reason:'Personal (April)', status:'approved', applied_on:'2026-04-01T00:00:00.000Z', action_comment:'', action_date:'2026-04-01T00:00:00.000Z', action_by:'Manager', employee_email:'' },
    { id:'h_mo_pl',  token:'hist', employee:'MOORTHY',          type:'pl', from_date:'2026-04-01', to_date:'2026-04-04', days:4,   reason:'Personal (April)', status:'approved', applied_on:'2026-04-01T00:00:00.000Z', action_comment:'', action_date:'2026-04-01T00:00:00.000Z', action_by:'Manager', employee_email:'' },
    { id:'h_rr_pl',  token:'hist', employee:'R RAJESH',         type:'pl', from_date:'2026-04-01', to_date:'2026-04-01', days:1,   reason:'Personal (April)', status:'approved', applied_on:'2026-04-01T00:00:00.000Z', action_comment:'', action_date:'2026-04-01T00:00:00.000Z', action_by:'Manager', employee_email:'' },
    { id:'h_sks_pl', token:'hist', employee:'SHAJI K SEBASTIAN',type:'pl', from_date:'2026-04-01', to_date:'2026-04-02', days:2,   reason:'Personal (April)', status:'approved', applied_on:'2026-04-01T00:00:00.000Z', action_comment:'', action_date:'2026-04-01T00:00:00.000Z', action_by:'Manager', employee_email:'' },
    { id:'h_ab_rl',  token:'hist', employee:'ABHIRAMI',         type:'rl', from_date:'2026-04-01', to_date:'2026-04-01', days:1,   reason:'Regional Holiday (April)', status:'approved', applied_on:'2026-04-01T00:00:00.000Z', action_comment:'', action_date:'2026-04-01T00:00:00.000Z', action_by:'Manager', employee_email:'' },
    { id:'h_avs_rl', token:'hist', employee:'AKHIL VS',         type:'rl', from_date:'2026-04-01', to_date:'2026-04-01', days:1,   reason:'Regional Holiday (April)', status:'approved', applied_on:'2026-04-01T00:00:00.000Z', action_comment:'', action_date:'2026-04-01T00:00:00.000Z', action_by:'Manager', employee_email:'' },
    { id:'h_sts_rl', token:'hist', employee:'SANOOP T S',       type:'rl', from_date:'2026-04-01', to_date:'2026-04-01', days:1,   reason:'Regional Holiday (April)', status:'approved', applied_on:'2026-04-01T00:00:00.000Z', action_comment:'', action_date:'2026-04-01T00:00:00.000Z', action_by:'Manager', employee_email:'' },
    { id:'h_avs_ot', token:'hist', employee:'AKHIL VS',         type:'ot', from_date:'2026-04-01', to_date:'2026-04-01', days:1,   reason:'OT Comp-off (April)', status:'approved', applied_on:'2026-04-01T00:00:00.000Z', action_comment:'', action_date:'2026-04-01T00:00:00.000Z', action_by:'Manager', employee_email:'' },
    { id:'h_jj_ot',  token:'hist', employee:'JOSHY JOSEPH',     type:'ot', from_date:'2026-04-01', to_date:'2026-04-01', days:1,   reason:'OT Comp-off (April)', status:'approved', applied_on:'2026-04-01T00:00:00.000Z', action_comment:'', action_date:'2026-04-01T00:00:00.000Z', action_by:'Manager', employee_email:'' },
    { id:'h_sks_ot', token:'hist', employee:'SHAJI K SEBASTIAN',type:'ot', from_date:'2026-04-01', to_date:'2026-04-01', days:1,   reason:'OT Comp-off (April)', status:'approved', applied_on:'2026-04-01T00:00:00.000Z', action_comment:'', action_date:'2026-04-01T00:00:00.000Z', action_by:'Manager', employee_email:'' },
  ];
  return { ...defaultData(), employees, work_types, balances, ot_credits, leave_applications, fy:'FY27', fy_start:'2026-04-01', fy_end:'2027-03-31' };
}

async function loadData() {
  try {
    const { blobs } = await list({ prefix: 'attendance/' });
    const blob = blobs.find(b => b.pathname === DATA_PATH);
    if (!blob) return defaultData();
    const resp = await fetch(blob.url + '?nocache=' + Date.now());
    return await resp.json();
  } catch (e) {
    return defaultData();
  }
}

async function saveData(data) {
  data.updatedAt = new Date().toISOString();
  await put(DATA_PATH, JSON.stringify(data), {
    access: 'public', contentType: 'application/json',
    addRandomSuffix: false, cacheControlMaxAge: 0
  });
  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      return res.status(200).json(await loadData());
    }

    if (req.method === 'POST') {
      const { action, payload } = req.body;
      let data = await loadData();

      if (action === 'seed_fy27') {
        data = fy27Seed();
        if (payload && payload.managerEmail) data.managerEmail = payload.managerEmail;
        await saveData(data);
        return res.status(200).json({ ok: true, data });
      }

      if (action === 'add_employee') {
        if (!data.employees.includes(payload.name)) {
          data.employees.push(payload.name);
        }
        if (payload.work_type !== undefined) {
          data.work_types = data.work_types || {};
          data.work_types[payload.name] = payload.work_type;
        }
        if (!data.balances[payload.name]) {
          data.balances[payload.name] = { pl_used: 0, rl_used: 0 };
        }
      }

      if (action === 'remove_employee') {
        data.employees = data.employees.filter(e => e !== payload.name);
      }

      if (action === 'update_settings') {
        if (payload.managerEmail !== undefined) data.managerEmail = payload.managerEmail;
      }

      if (action === 'log_ot') {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const hours = parseFloat(payload.hours) || 0;
        // Round to nearest 0.5 day (7 hrs = 1 day)
        const daysEarned = Math.round((hours / 7) * 2) / 2;
        const expires = new Date(payload.date);
        expires.setDate(expires.getDate() + 30);
        data.ot_credits = data.ot_credits || [];
        data.ot_credits.push({
          id, employee: payload.employee,
          date_worked: payload.date, hours, days_earned: daysEarned,
          days_availed: 0,
          expires_on: expires.toISOString().slice(0, 10),
          logged_by: payload.logged_by || 'Supervisor',
          logged_on: new Date().toISOString(),
          notes: payload.notes || ''
        });
      }

      if (action === 'delete_ot') {
        data.ot_credits = (data.ot_credits || []).filter(o => o.id !== payload.id);
      }

      if (action === 'approve_leave') {
        const app = (data.leave_applications || []).find(a => a.id === payload.id);
        if (app && app.status === 'pending') {
          app.status = 'approved';
          app.action_comment = payload.comment || '';
          app.action_date = new Date().toISOString();
          app.action_by = 'Manager';
          const bal = data.balances[app.employee] = data.balances[app.employee] || {};
          if (app.type === 'pl') bal.pl_used = (bal.pl_used || 0) + app.days;
          if (app.type === 'rl') bal.rl_used = (bal.rl_used || 0) + app.days;
          if (app.type === 'ot') {
            let rem = app.days;
            const today = new Date().toISOString().slice(0, 10);
            for (const c of (data.ot_credits || [])) {
              if (c.employee === app.employee && c.expires_on >= today) {
                const avail = c.days_earned - (c.days_availed || 0);
                if (avail > 0) { const use = Math.min(avail, rem); c.days_availed += use; rem -= use; }
                if (rem <= 0) break;
              }
            }
          }
        }
      }

      if (action === 'reject_leave') {
        const app = (data.leave_applications || []).find(a => a.id === payload.id);
        if (app && app.status === 'pending') {
          app.status = 'rejected';
          app.action_comment = payload.comment || '';
          app.action_date = new Date().toISOString();
          app.action_by = 'Manager';
        }
      }

      if (action === 'add_application') {
        data.leave_applications = data.leave_applications || [];
        data.leave_applications.push(payload);
      }

      await saveData(data);
      return res.status(200).json({ ok: true, data });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('attend-data error:', err);
    return res.status(500).json({ error: err.message });
  }
};
