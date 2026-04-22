// Spicemore OS — Accounting front-end.
// Single-page router + thin wrapper over the /api/erp proxy.

const ERP = {
  async call(path, { method = 'GET', query = {}, body } = {}) {
    const qs = new URLSearchParams({ path, method, ...query });
    const opts = { method: method === 'GET' ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' } };
    if (method !== 'GET' && body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch(`/api/erp?${qs.toString()}`, opts);
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!r.ok) throw new Error(json.message || json.error || text || `HTTP ${r.status}`);
    return json;
  },
  list(doctype, opts = {}) {
    const q = {};
    if (opts.fields) q.fields = JSON.stringify(opts.fields);
    if (opts.filters) q.filters = JSON.stringify(opts.filters);
    if (opts.limit) q.limit_page_length = opts.limit;
    if (opts.order_by) q.order_by = opts.order_by;
    return this.call(`resource/${encodeURIComponent(doctype)}`, { query: q });
  },
  get(doctype, name) { return this.call(`resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`); },
  create(doctype, body) { return this.call(`resource/${encodeURIComponent(doctype)}`, { method: 'POST', body }); },
  update(doctype, name, body) { return this.call(`resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, { method: 'PUT', body }); },
  method(path, body) { return this.call(`method/${path}`, { method: 'POST', body }); },
  count(doctype, filters) {
    const q = { doctype };
    if (filters) q.filters = JSON.stringify(filters);
    return this.call('method/frappe.client.get_count', { query: q }).then(r => (r?.message ?? 0));
  }
};

const state = {
  company: 'Spice More Trading Company',
};

function fmt(n) {
  if (n === null || n === undefined || n === '') return '';
  const v = Number(n);
  if (!isFinite(v)) return String(n);
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
function fmtCr(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e7) return `₹${(v/1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 })} cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v/1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 })} L`;
  return `₹${fmt(v)}`;
}
function today() { return new Date().toISOString().slice(0, 10); }
function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v !== null && v !== undefined) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// ---------- Views ----------
const Views = {};

Views.dashboard = async (root) => {
  root.innerHTML = '';
  root.appendChild(h('h1', { class: 'page' }, 'Dashboard'));
  root.appendChild(h('p', { class: 'sub' }, `${state.company} — live from ERPNext`));
  const grid = h('div', { class: 'kpi-grid' });
  root.appendChild(grid);
  const mk = (label, value, sub) => h('div', { class: 'kpi kpi-accent' },
    h('div', { class: 'kpi-label' }, label),
    h('div', { class: 'kpi-value' }, value),
    sub ? h('div', { class: 'kpi-sub' }, sub) : null,
  );
  const ph = (label) => {
    const el = mk(label, '…');
    grid.appendChild(el);
    return el;
  };
  const items = [
    ['Customers', ph('Customers')],
    ['Suppliers', ph('Suppliers')],
    ['Loan Facilities', ph('Active Loan Facilities')],
    ['WHR Pledges', ph('Active WHR Pledges')],
    ['Auction Bidders', ph('Registered Bidders')],
    ['Auction Sessions', ph('Sessions Planned')],
  ];
  try {
    const [cust, sup, loans, whr, bid, sess] = await Promise.all([
      ERP.count('Customer'),
      ERP.count('Supplier'),
      ERP.count('Loan Facility', [['status','=','Active']]).catch(() => '—'),
      ERP.count('WHR Pledge', [['status','=','Active']]).catch(() => '—'),
      ERP.count('Auction Bidder', [['is_active','=',1]]).catch(() => '—'),
      ERP.count('Auction Session').catch(() => '—'),
    ]);
    const vals = [cust, sup, loans, whr, bid, sess];
    items.forEach(([_, el], i) => { el.querySelector('.kpi-value').textContent = fmt(vals[i]); });
  } catch (e) { toast('Dashboard load failed: ' + e.message, 'err'); }

  // Recent invoices
  const recent = h('div', { class: 'card', style: { marginTop: '10px' } });
  recent.appendChild(h('h3', { style: { margin: '0 0 10px', fontSize: '14px' } }, 'Recent Sales Invoices'));
  const rlist = h('div', {}, h('div', { class: 'loading' }, 'Loading…'));
  recent.appendChild(rlist);
  root.appendChild(recent);
  try {
    const { data } = await ERP.list('Sales Invoice', { fields: ['name','customer','posting_date','grand_total','status'], limit: 10, order_by: 'posting_date desc' });
    rlist.innerHTML = '';
    if (!data?.length) { rlist.appendChild(h('div', { class: 'loading' }, 'No invoices yet.')); }
    else {
      const tbl = h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Invoice'), h('th', {}, 'Customer'), h('th', { class: 'num' }, 'Total'), h('th', {}, 'Status'))),
        h('tbody', {}, ...data.map(r => h('tr', {},
          h('td', {}, r.posting_date || ''),
          h('td', {}, r.name),
          h('td', {}, r.customer || ''),
          h('td', { class: 'num' }, fmt(r.grand_total)),
          h('td', {}, h('span', { class: 'pill ' + (r.status === 'Paid' ? 'green' : 'amber') }, r.status || '')),
        )))
      );
      rlist.appendChild(tbl);
    }
  } catch (e) { rlist.innerHTML = `<div class="loading">Could not load invoices: ${e.message}</div>`; }
};

Views.sales = (root) => entryForm(root, {
  title: 'Sales Entry',
  sub: 'Post a tax invoice to ERPNext',
  partyField: 'customer',
  partyDoctype: 'Customer',
  partyLabel: 'Customer',
  doctype: 'Sales Invoice',
  amountLabel: 'Sale Amount',
  submit: async (body) => ERP.create('Sales Invoice', body),
});

Views.purchase = (root) => entryForm(root, {
  title: 'Purchase Entry',
  sub: 'Post a supplier bill to ERPNext',
  partyField: 'supplier',
  partyDoctype: 'Supplier',
  partyLabel: 'Supplier',
  doctype: 'Purchase Invoice',
  amountLabel: 'Purchase Amount',
  submit: async (body) => ERP.create('Purchase Invoice', body),
});

function entryForm(root, cfg) {
  root.innerHTML = '';
  root.appendChild(h('h1', { class: 'page' }, cfg.title));
  root.appendChild(h('p', { class: 'sub' }, cfg.sub));
  const form = h('form', { class: 'form-grid' });
  const fDate = h('input', { type: 'date', value: today(), required: true });
  const fParty = h('input', { list: 'party-list', placeholder: `Search ${cfg.partyLabel}…`, required: true });
  const fVch = h('input', { type: 'text', placeholder: 'Voucher / Bill No' });
  const fItem = h('input', { list: 'item-list', placeholder: 'Item or description', required: true });
  const fQty = h('input', { type: 'number', step: '0.001', value: '1' });
  const fRate = h('input', { type: 'number', step: '0.01', required: true });
  const fTaxable = h('input', { type: 'number', step: '0.01', readonly: true });
  const fGst = h('select', {}, ['0','5','12','18','28'].map(v => h('option', { value: v }, `${v}%`)));
  const fTotal = h('input', { type: 'number', step: '0.01', readonly: true });
  const fNotes = h('textarea', { rows: 2, placeholder: 'Remarks / Material Centre' });

  const partyList = h('datalist', { id: 'party-list' });
  const itemList = h('datalist', { id: 'item-list' });
  root.appendChild(partyList); root.appendChild(itemList);

  ERP.list(cfg.partyDoctype, { fields: ['name'], limit: 500 }).then(r => {
    (r.data || []).forEach(d => partyList.appendChild(h('option', { value: d.name })));
  }).catch(() => {});
  ERP.list('Item', { fields: ['name','item_name'], limit: 500 }).then(r => {
    (r.data || []).forEach(d => itemList.appendChild(h('option', { value: d.name }, d.item_name || d.name)));
  }).catch(() => {});

  const recalc = () => {
    const taxable = (Number(fQty.value) || 0) * (Number(fRate.value) || 0);
    fTaxable.value = taxable.toFixed(2);
    const gst = Number(fGst.value) || 0;
    fTotal.value = (taxable * (1 + gst/100)).toFixed(2);
  };
  [fQty, fRate, fGst].forEach(el => el.addEventListener('input', recalc));
  recalc();

  const row = (label, control, full = false) => {
    const r = h('div', { class: 'form-row' + (full ? ' full' : '') });
    r.appendChild(h('label', {}, label));
    r.appendChild(control);
    return r;
  };
  form.appendChild(row('Date', fDate));
  form.appendChild(row('Voucher / Bill No', fVch));
  form.appendChild(row(cfg.partyLabel, fParty));
  form.appendChild(row('Item', fItem));
  form.appendChild(row('Qty', fQty));
  form.appendChild(row('Rate', fRate));
  form.appendChild(row(cfg.amountLabel, fTaxable));
  form.appendChild(row('GST Rate', fGst));
  form.appendChild(row('Grand Total', fTotal, true));
  form.appendChild(row('Remarks', fNotes, true));
  const actions = h('div', { class: 'form-actions' });
  const submit = h('button', { type: 'submit', class: 'btn-primary' }, 'Save & Submit');
  const saveOnly = h('button', { type: 'button', class: 'btn' }, 'Save Draft');
  actions.appendChild(saveOnly); actions.appendChild(submit);
  form.appendChild(actions);
  root.appendChild(form);

  const build = () => ({
    company: state.company,
    posting_date: fDate.value,
    [cfg.partyField]: fParty.value,
    bill_no: fVch.value,
    bill_date: fDate.value,
    remarks: fNotes.value,
    items: [{
      item_code: fItem.value,
      item_name: fItem.value,
      qty: Number(fQty.value) || 1,
      rate: Number(fRate.value) || 0,
      description: fItem.value,
    }],
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true; submit.textContent = 'Submitting…';
    try {
      const body = build();
      body.docstatus = 1;
      const r = await cfg.submit(body);
      toast(`Submitted: ${r?.data?.name || 'OK'}`);
      form.reset(); fDate.value = today(); recalc();
    } catch (err) {
      toast('Error: ' + err.message, 'err');
    } finally {
      submit.disabled = false; submit.textContent = 'Save & Submit';
    }
  });
  saveOnly.addEventListener('click', async () => {
    try {
      const r = await cfg.submit(build());
      toast(`Draft saved: ${r?.data?.name || 'OK'}`);
    } catch (err) { toast('Error: ' + err.message, 'err'); }
  });
}

// Payment / Receipt / Contra / Journal — all map to Payment Entry / Journal Entry
Views.receipt = (root) => paymentView(root, { title: 'Receipt', payment_type: 'Receive', party_type: 'Customer' });
Views.payment = (root) => paymentView(root, { title: 'Payment', payment_type: 'Pay', party_type: 'Supplier' });
Views.contra = (root) => contraView(root);
Views.journal = (root) => journalView(root);

function paymentView(root, cfg) {
  root.innerHTML = '';
  root.appendChild(h('h1', { class: 'page' }, cfg.title));
  root.appendChild(h('p', { class: 'sub' }, `${cfg.payment_type === 'Receive' ? 'Money in from ' + cfg.party_type : 'Money out to ' + cfg.party_type}`));
  const form = h('form', { class: 'form-grid' });
  const fDate = h('input', { type: 'date', value: today(), required: true });
  const fParty = h('input', { list: 'party-list', placeholder: cfg.party_type, required: true });
  const fMode = h('select', {}, ['Cash','Bank Transfer','Cheque','UPI','RTGS','NEFT'].map(m => h('option', {}, m)));
  const fAcct = h('input', { list: 'acct-list', placeholder: 'Paid From / To account (bank/cash ledger)', required: true });
  const fAmt = h('input', { type: 'number', step: '0.01', required: true });
  const fRef = h('input', { type: 'text', placeholder: 'Reference / Cheque / UTR' });
  const fNotes = h('textarea', { rows: 2, placeholder: 'Remarks' });

  const partyList = h('datalist', { id: 'party-list' });
  const acctList = h('datalist', { id: 'acct-list' });
  root.appendChild(partyList); root.appendChild(acctList);
  ERP.list(cfg.party_type, { fields: ['name'], limit: 500 }).then(r => (r.data || []).forEach(d => partyList.appendChild(h('option', { value: d.name })))).catch(()=>{});
  ERP.list('Account', { fields: ['name','account_type'], filters: [['account_type','in',['Bank','Cash']]], limit: 50 }).then(r => (r.data || []).forEach(d => acctList.appendChild(h('option', { value: d.name })))).catch(()=>{});

  const row = (label, c, full=false) => { const r = h('div', { class: 'form-row' + (full?' full':'') }); r.appendChild(h('label',{},label)); r.appendChild(c); return r; };
  form.appendChild(row('Date', fDate));
  form.appendChild(row(cfg.party_type, fParty));
  form.appendChild(row('Mode', fMode));
  form.appendChild(row('Bank / Cash Account', fAcct));
  form.appendChild(row('Amount', fAmt));
  form.appendChild(row('Reference', fRef));
  form.appendChild(row('Remarks', fNotes, true));
  const actions = h('div', { class: 'form-actions' });
  const submit = h('button', { type: 'submit', class: 'btn-primary' }, 'Post');
  actions.appendChild(submit);
  if (cfg.payment_type === 'Pay') {
    const bankBtn = h('button', { type: 'button', class: 'btn' }, '🏦 Send to Bank');
    bankBtn.addEventListener('click', () => openBankPayoutModal({
      beneficiary_name: fParty.value,
      amount: Number(fAmt.value) || 0,
      purpose: fNotes.value,
      mode: fMode.value,
      linked_erpnext_voucher: fRef.value,
    }));
    actions.appendChild(bankBtn);
  }
  form.appendChild(actions);
  root.appendChild(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      const body = {
        doctype: 'Payment Entry',
        payment_type: cfg.payment_type,
        company: state.company,
        posting_date: fDate.value,
        party_type: cfg.party_type,
        party: fParty.value,
        paid_amount: Number(fAmt.value),
        received_amount: Number(fAmt.value),
        reference_no: fRef.value,
        reference_date: fDate.value,
        mode_of_payment: fMode.value,
        remarks: fNotes.value,
        [cfg.payment_type === 'Receive' ? 'paid_to' : 'paid_from']: fAcct.value,
        docstatus: 1,
      };
      const r = await ERP.create('Payment Entry', body);
      toast(`Posted: ${r?.data?.name || 'OK'}`);
      form.reset(); fDate.value = today();
    } catch (err) { toast('Error: ' + err.message, 'err'); }
    finally { submit.disabled = false; }
  });
}

// ---------- Bank Payout Modal ----------
function openBankPayoutModal(prefill = {}) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const modal = h('div', { class: 'modal' });
  backdrop.appendChild(modal);
  modal.appendChild(h('h3', {}, 'Send Bank Payout for Approval'));
  modal.appendChild(h('p', { class: 'sub' }, 'Queues a payout. Human approver releases it to the bank. Axis/SBI/SIB API if configured, else routed to bulk NEFT file.'));
  const grid = h('div', { class: 'form-grid' });
  const fFrom = h('select', {}, h('option', { value: '' }, 'Loading bank accounts…'));
  const fName = h('input', { value: prefill.beneficiary_name || '', placeholder: 'Beneficiary name', required: true });
  const fAcct = h('input', { placeholder: 'Account number', required: true });
  const fIfsc = h('input', { placeholder: 'IFSC', required: true });
  const fAmt = h('input', { type: 'number', step: '0.01', value: prefill.amount || '', required: true });
  const fMode = h('select', {}, ...['IMPS','NEFT','RTGS','UPI'].map(m => h('option', { value: m, selected: m === (prefill.mode || 'NEFT') }, m)));
  const fPurpose = h('input', { value: prefill.purpose || '', placeholder: 'Purpose / narration' });
  const routeNote = h('div', { class: 'sub', style: { gridColumn: '1 / -1' } }, '');
  const row = (label, c, full) => { const r = h('div', { class: 'form-row' + (full ? ' full' : '') }); r.appendChild(h('label', {}, label)); r.appendChild(c); return r; };
  grid.appendChild(row('Paying From', fFrom, true));
  grid.appendChild(row('Beneficiary', fName, true));
  grid.appendChild(row('Account #', fAcct));
  grid.appendChild(row('IFSC', fIfsc));
  grid.appendChild(row('Amount', fAmt));
  grid.appendChild(row('Mode', fMode));
  grid.appendChild(row('Purpose', fPurpose, true));
  grid.appendChild(routeNote);
  modal.appendChild(grid);
  const actions = h('div', { class: 'modal-actions' });
  const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
  const queue = h('button', { class: 'btn-primary', type: 'button' }, 'Queue for Approval');
  actions.appendChild(cancel); actions.appendChild(queue);
  modal.appendChild(actions);
  document.body.appendChild(backdrop);

  // Load bank accounts + adapter config.
  Promise.all([
    ERP.list('Account', { fields: ['name'], filters: [['account_type','=','Bank']], limit: 50 }).catch(() => ({ data: [] })),
    fetch('/api/bank-payout').then(r => r.json()).catch(() => ({ adapters: {} })),
  ]).then(([accts, cfg]) => {
    fFrom.innerHTML = '';
    (accts.data || []).forEach(a => fFrom.appendChild(h('option', { value: a.name }, a.name)));
    const updateNote = () => {
      const v = (fFrom.value || '').toLowerCase();
      let code = 'file';
      if (v.includes('axis')) code = 'axis';
      else if (v.includes('sbi') || v.includes('state bank')) code = 'sbi';
      else if (v.includes('south indian') || v.includes('sib')) code = 'sib';
      const live = code !== 'file' && cfg.adapters && cfg.adapters[code];
      routeNote.textContent = live
        ? `→ Will fire via ${code.toUpperCase()} Corporate API on approval.`
        : `→ Will be added to the bulk NEFT file for ${code === 'file' ? 'upload at the bank portal' : code.toUpperCase() + ' (API creds not yet configured)'}.`;
    };
    fFrom.addEventListener('change', updateNote);
    updateNote();
  });

  cancel.addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  queue.addEventListener('click', async () => {
    if (!fName.value || !fAcct.value || !fIfsc.value || !fAmt.value) { toast('Fill all required fields', 'err'); return; }
    queue.disabled = true;
    try {
      const r = await fetch('/api/bank-payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submitter: 'accounting-ui',
          paid_from: fFrom.value,
          beneficiary_name: fName.value, beneficiary_account: fAcct.value, beneficiary_ifsc: fIfsc.value,
          amount: Number(fAmt.value), mode: fMode.value, purpose: fPurpose.value,
          linked_erpnext_voucher: prefill.linked_erpnext_voucher || '',
        })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed');
      toast(`Queued ${j.id} — go to Bank Approvals`);
      backdrop.remove();
      location.hash = '#approvals';
    } catch (e) { toast('Error: ' + e.message, 'err'); queue.disabled = false; }
  });
}

function contraView(root) {
  root.innerHTML = '';
  root.appendChild(h('h1', { class: 'page' }, 'Contra'));
  root.appendChild(h('p', { class: 'sub' }, 'Cash to bank / bank to cash / inter-bank transfer'));
  const form = h('form', { class: 'form-grid' });
  const fDate = h('input', { type: 'date', value: today(), required: true });
  const fFrom = h('input', { list: 'acct-list', required: true, placeholder: 'From account' });
  const fTo = h('input', { list: 'acct-list', required: true, placeholder: 'To account' });
  const fAmt = h('input', { type: 'number', step: '0.01', required: true });
  const fRef = h('input', { type: 'text', placeholder: 'Reference' });
  const fNotes = h('textarea', { rows: 2 });
  const acctList = h('datalist', { id: 'acct-list' });
  root.appendChild(acctList);
  ERP.list('Account', { fields: ['name'], filters: [['account_type','in',['Bank','Cash']]], limit: 50 }).then(r => (r.data || []).forEach(d => acctList.appendChild(h('option', { value: d.name })))).catch(()=>{});
  const row = (label, c, full=false) => { const r=h('div',{class:'form-row'+(full?' full':'')}); r.appendChild(h('label',{},label)); r.appendChild(c); return r; };
  form.appendChild(row('Date', fDate));
  form.appendChild(row('Amount', fAmt));
  form.appendChild(row('From', fFrom));
  form.appendChild(row('To', fTo));
  form.appendChild(row('Reference', fRef));
  form.appendChild(row('Remarks', fNotes, true));
  const actions = h('div', { class: 'form-actions' });
  const submit = h('button', { type: 'submit', class: 'btn-primary' }, 'Post');
  actions.appendChild(submit);
  form.appendChild(actions);
  root.appendChild(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault(); submit.disabled = true;
    try {
      const body = {
        doctype: 'Journal Entry', voucher_type: 'Contra Entry', posting_date: fDate.value, company: state.company,
        cheque_no: fRef.value, cheque_date: fDate.value, user_remark: fNotes.value,
        accounts: [
          { account: fFrom.value, credit_in_account_currency: Number(fAmt.value) },
          { account: fTo.value, debit_in_account_currency: Number(fAmt.value) },
        ],
        docstatus: 1,
      };
      const r = await ERP.create('Journal Entry', body);
      toast(`Posted: ${r?.data?.name || 'OK'}`);
      form.reset(); fDate.value = today();
    } catch (err) { toast('Error: ' + err.message, 'err'); }
    finally { submit.disabled = false; }
  });
}

function journalView(root) {
  root.innerHTML = '';
  root.appendChild(h('h1', { class: 'page' }, 'Journal Entry'));
  root.appendChild(h('p', { class: 'sub' }, 'Free-form debit/credit posting (Dr must equal Cr)'));
  const form = h('form', {});
  const fDate = h('input', { type: 'date', value: today(), required: true });
  const fRemark = h('input', { type: 'text', placeholder: 'Narration' });
  const acctList = h('datalist', { id: 'acct-list' });
  root.appendChild(acctList);
  ERP.list('Account', { fields: ['name'], limit: 2000 }).then(r => (r.data || []).forEach(d => acctList.appendChild(h('option', { value: d.name })))).catch(()=>{});
  const top = h('div', { class: 'form-grid' });
  const mk = (label, c) => { const r=h('div',{class:'form-row'}); r.appendChild(h('label',{},label)); r.appendChild(c); return r; };
  top.appendChild(mk('Date', fDate)); top.appendChild(mk('Narration', fRemark));
  form.appendChild(top);
  const tbl = h('table', { class: 'table', style: { marginTop: '12px' } },
    h('thead', {}, h('tr', {}, h('th', {}, 'Account'), h('th', { class: 'num' }, 'Debit'), h('th', { class: 'num' }, 'Credit'), h('th', {}, ''))),
    h('tbody', {})
  );
  const tbody = tbl.querySelector('tbody');
  const addRow = () => {
    const acc = h('input', { list: 'acct-list', style: { width: '100%' } });
    const dr = h('input', { type: 'number', step: '0.01', class: 'num', style: { width: '120px' } });
    const cr = h('input', { type: 'number', step: '0.01', class: 'num', style: { width: '120px' } });
    const rm = h('button', { type: 'button', class: 'btn' }, '×');
    const tr = h('tr', {}, h('td', {}, acc), h('td', { class: 'num' }, dr), h('td', { class: 'num' }, cr), h('td', {}, rm));
    rm.addEventListener('click', () => tr.remove());
    tbody.appendChild(tr);
    return { acc, dr, cr };
  };
  addRow(); addRow();
  form.appendChild(tbl);
  const add = h('button', { type: 'button', class: 'btn', style: { marginTop: '8px' } }, '+ Add row');
  add.addEventListener('click', () => addRow());
  form.appendChild(add);
  const actions = h('div', { class: 'form-actions' });
  const submit = h('button', { type: 'submit', class: 'btn-primary' }, 'Post');
  actions.appendChild(submit);
  form.appendChild(actions);
  root.appendChild(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault(); submit.disabled = true;
    try {
      const rows = [...tbody.querySelectorAll('tr')].map(tr => {
        const inputs = tr.querySelectorAll('input');
        return { account: inputs[0].value, debit_in_account_currency: Number(inputs[1].value)||0, credit_in_account_currency: Number(inputs[2].value)||0 };
      }).filter(r => r.account && (r.debit_in_account_currency || r.credit_in_account_currency));
      const dr = rows.reduce((s,r)=>s+r.debit_in_account_currency,0);
      const cr = rows.reduce((s,r)=>s+r.credit_in_account_currency,0);
      if (Math.abs(dr-cr) > 0.01) throw new Error(`Dr ${fmt(dr)} ≠ Cr ${fmt(cr)}`);
      const body = { doctype: 'Journal Entry', voucher_type: 'Journal Entry', posting_date: fDate.value, company: state.company, user_remark: fRemark.value, accounts: rows, docstatus: 1 };
      const r = await ERP.create('Journal Entry', body);
      toast(`Posted: ${r?.data?.name || 'OK'}`);
    } catch (err) { toast('Error: ' + err.message, 'err'); }
    finally { submit.disabled = false; }
  });
}

// ---------- Reports ----------
Views.daybook = async (root) => {
  root.innerHTML = '';
  root.appendChild(h('h1', { class: 'page' }, 'Day Book'));
  root.appendChild(h('p', { class: 'sub' }, 'All vouchers posted, chronological'));
  const from = h('input', { type: 'date', value: firstOfMonth() });
  const to = h('input', { type: 'date', value: today() });
  const go = h('button', { class: 'btn-primary' }, 'Apply');
  const bar = h('div', { class: 'toolbar' }, 'From', from, 'To', to, go, h('div', { class: 'spacer' }));
  root.appendChild(bar);
  const out = h('div', {});
  root.appendChild(out);
  const load = async () => {
    out.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const r = await ERP.method('frappe.desk.query_report.run', {
        report_name: 'General Ledger',
        filters: { company: state.company, from_date: from.value, to_date: to.value, group_by: 'Group by Voucher' }
      });
      renderReport(out, r?.message || r);
    } catch (e) { out.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
  };
  go.addEventListener('click', load); load();
};

Views.ledger = async (root) => {
  root.innerHTML = '';
  root.appendChild(h('h1', { class: 'page' }, 'Ledger'));
  root.appendChild(h('p', { class: 'sub' }, 'Account-wise or party-wise ledger'));
  const acct = h('input', { list: 'acct-list', placeholder: 'Account (optional)' });
  const party = h('input', { placeholder: 'Party name (optional)' });
  const from = h('input', { type: 'date', value: firstOfMonth() });
  const to = h('input', { type: 'date', value: today() });
  const go = h('button', { class: 'btn-primary' }, 'Apply');
  const acctList = h('datalist', { id: 'acct-list' });
  ERP.list('Account', { fields: ['name'], limit: 2000 }).then(r => (r.data || []).forEach(d => acctList.appendChild(h('option', { value: d.name })))).catch(()=>{});
  root.appendChild(acctList);
  root.appendChild(h('div', { class: 'toolbar' }, 'Account', acct, 'Party', party, 'From', from, 'To', to, go));
  const out = h('div', {});
  root.appendChild(out);
  const load = async () => {
    out.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const filters = { company: state.company, from_date: from.value, to_date: to.value };
      if (acct.value) filters.account = acct.value;
      if (party.value) { filters.party_type = 'Customer'; filters.party = [party.value]; }
      const r = await ERP.method('frappe.desk.query_report.run', { report_name: 'General Ledger', filters });
      renderReport(out, r?.message || r);
    } catch (e) { out.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
  };
  go.addEventListener('click', load); load();
};

Views.trial = async (root) => simpleReport(root, 'Trial Balance', 'Trial Balance', { fiscal_year: currentFy(), from_date: firstOfFy(), to_date: today(), periodicity: 'Yearly', with_period_closing_entry_for_reporting: 0 });
Views.balance = async (root) => simpleReport(root, 'Balance Sheet', 'Balance Sheet', { period_start_date: firstOfFy(), period_end_date: today(), periodicity: 'Yearly', accumulated_values: 1, fiscal_year: currentFy() });
Views.pnl = async (root) => simpleReport(root, 'Profit & Loss Statement', 'Profit and Loss Statement', { period_start_date: firstOfFy(), period_end_date: today(), periodicity: 'Yearly', accumulated_values: 1, fiscal_year: currentFy() });
Views.ageing = async (root) => simpleReport(root, 'Accounts Receivable Ageing', 'Accounts Receivable', { report_date: today(), ageing_based_on: 'Posting Date', range1: 30, range2: 60, range3: 90, range4: 120 });
Views.stock = async (root) => simpleReport(root, 'Stock Status', 'Stock Balance', { from_date: firstOfFy(), to_date: today() });
Views.gst = async (root) => gstView(root);

async function gstView(root) {
  root.innerHTML = '';
  root.appendChild(h('h1', { class: 'page' }, 'GST Reports'));
  root.appendChild(h('p', { class: 'sub' }, 'Sales & Purchase registers with GSTIN-wise tax totals'));
  const from = h('input', { type: 'date', value: firstOfMonth() });
  const to = h('input', { type: 'date', value: today() });
  const which = h('select', {}, h('option', { value: 'Sales Register' }, 'GSTR-1 (Sales)'), h('option', { value: 'Purchase Register' }, 'GSTR-2 (Purchase)'));
  const go = h('button', { class: 'btn-primary' }, 'Run');
  root.appendChild(h('div', { class: 'toolbar' }, 'Report', which, 'From', from, 'To', to, go));
  const out = h('div', {}); root.appendChild(out);
  const load = async () => {
    out.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const r = await ERP.method('frappe.desk.query_report.run', { report_name: which.value, filters: { company: state.company, from_date: from.value, to_date: to.value } });
      renderReport(out, r?.message || r);
    } catch (e) { out.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
  };
  go.addEventListener('click', load); load();
}

async function simpleReport(root, title, report_name, extraFilters) {
  root.innerHTML = '';
  root.appendChild(h('h1', { class: 'page' }, title));
  root.appendChild(h('p', { class: 'sub' }, `ERPNext report: ${report_name}`));
  const out = h('div', {}); root.appendChild(out);
  out.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const r = await ERP.method('frappe.desk.query_report.run', { report_name, filters: { company: state.company, ...extraFilters } });
    renderReport(out, r?.message || r);
  } catch (e) { out.innerHTML = `<div class="loading">Not available: ${e.message}</div>`; }
}

function renderReport(root, payload) {
  root.innerHTML = '';
  const cols = payload?.columns || [];
  const rows = payload?.result || [];
  if (!cols.length || !rows.length) {
    root.appendChild(h('div', { class: 'card' },
      h('p', { style: { margin: 0, color: 'var(--ink-2)' } }, 'No entries match the filters for this report yet.'),
      h('p', { class: 'sub', style: { marginTop: '6px' } }, 'Customers, suppliers and items are loaded (1800+ each) but no Sales or Purchase invoices have been posted yet. Post an entry via F2/F3 and it will show up here.'),
      h('div', { style: { marginTop: '10px', display: 'flex', gap: '8px' } },
        h('a', { href: '#sales', class: 'btn-primary' }, 'New Sales Invoice'),
        h('a', { href: '#purchase', class: 'btn' }, 'New Purchase Invoice'),
        h('a', { href: '#journal', class: 'btn' }, 'New Journal'),
      )
    ));
    return;
  }
  const wrap = h('div', { class: 'table-wrap' });
  const tbl = h('table', { class: 'table' });
  const thead = h('thead', {}, h('tr', {}, ...cols.map(c => h('th', { class: isNumCol(c) ? 'num' : '' }, c.label || c.fieldname || c))));
  const tbody = h('tbody', {});
  rows.slice(0, 500).forEach(r => {
    const tr = h('tr', {});
    cols.forEach(c => {
      const k = c.fieldname || c;
      const v = Array.isArray(r) ? r[cols.indexOf(c)] : r[k];
      tr.appendChild(h('td', { class: isNumCol(c) ? 'num' : '' }, isNumCol(c) ? fmt(v) : (v ?? '')));
    });
    tbody.appendChild(tr);
  });
  tbl.appendChild(thead); tbl.appendChild(tbody); wrap.appendChild(tbl); root.appendChild(wrap);
  if (rows.length > 500) root.appendChild(h('p', { class: 'sub' }, `Showing first 500 of ${rows.length} rows.`));
}
function isNumCol(c) { const t = (c.fieldtype || '').toLowerCase(); return t === 'float' || t === 'currency' || t === 'int' || t === 'percent'; }

// ---------- Masters ----------
Views.parties = (root) => partiesView(root);
Views.items = (root) => listView(root, { title: 'Items', doctype: 'Item', fields: ['name','item_name','item_group','stock_uom'], newLabel: '+ New Item', onNew: (reload) => openNewItemModal(reload) });
Views.accounts = (root) => listView(root, { title: 'Chart of Accounts', doctype: 'Account', fields: ['name','account_type','root_type','parent_account','is_group'], limit: 2000 });

// Sales/Purchase Returns + Credit/Debit Notes — all are flavours of the two entry forms.
Views['credit-note'] = (root) => entryForm(root, {
  title: 'Credit Note', sub: 'Issue a credit against a sale (customer owes less)',
  partyField: 'customer', partyDoctype: 'Customer', partyLabel: 'Customer',
  doctype: 'Sales Invoice', amountLabel: 'Credit Amount',
  submit: async (body) => ERP.create('Sales Invoice', { ...body, is_return: 1 }),
});
Views['debit-note'] = (root) => entryForm(root, {
  title: 'Debit Note', sub: 'Issue a debit against a purchase (supplier owes less)',
  partyField: 'supplier', partyDoctype: 'Supplier', partyLabel: 'Supplier',
  doctype: 'Purchase Invoice', amountLabel: 'Debit Amount',
  submit: async (body) => ERP.create('Purchase Invoice', { ...body, is_return: 1 }),
});
Views['sales-return'] = Views['credit-note'];
Views['purchase-return'] = Views['debit-note'];

Views.payables = async (root) => simpleReport(root, 'Payables Ageing', 'Accounts Payable', { report_date: today(), ageing_based_on: 'Posting Date', range1: 30, range2: 60, range3: 90, range4: 120 });

Views['bank-recon'] = async (root) => {
  root.innerHTML = '';
  root.appendChild(h('h1', { class: 'page' }, 'Bank Reconciliation'));
  root.appendChild(h('p', { class: 'sub' }, 'Match Payment Entries against your bank statement'));
  const acct = h('input', { list: 'acct-list', placeholder: 'Bank account (required)', required: true });
  const from = h('input', { type: 'date', value: firstOfMonth() });
  const to = h('input', { type: 'date', value: today() });
  const go = h('button', { class: 'btn-primary' }, 'Load');
  const acctList = h('datalist', { id: 'acct-list' });
  ERP.list('Account', { fields: ['name'], filters: [['account_type','=','Bank']], limit: 50 }).then(r => (r.data || []).forEach(d => acctList.appendChild(h('option', { value: d.name })))).catch(()=>{});
  root.appendChild(acctList);
  root.appendChild(h('div', { class: 'toolbar' }, 'Account', acct, 'From', from, 'To', to, go));
  const out = h('div', {}); root.appendChild(out);
  const load = async () => {
    if (!acct.value) { toast('Pick a bank account', 'err'); return; }
    out.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const r = await ERP.method('frappe.desk.query_report.run', {
        report_name: 'Bank Reconciliation Statement',
        filters: { company: state.company, account: acct.value, report_date: to.value, include_pos_transactions: 0 }
      });
      renderReport(out, r?.message || r);
    } catch (e) { out.innerHTML = `<div class="loading">Error: ${e.message}. Tip: use the Ledger view on the bank account for a simpler statement.</div>`; }
  };
  go.addEventListener('click', load);
};

// ---------- New Party / New Item modals ----------
function openNewPartyModal(type, onDone) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const modal = h('div', { class: 'modal' });
  backdrop.appendChild(modal);
  modal.appendChild(h('h3', {}, 'New ' + type));
  const grid = h('div', { class: 'form-grid' });
  const fName = h('input', { placeholder: type + ' name', required: true });
  const fGroup = h('input', { list: 'grp-list', placeholder: type + ' group' });
  const fGstin = h('input', { placeholder: 'GSTIN (tax_id)' });
  const fMobile = h('input', { placeholder: 'Mobile' });
  const fEmail = h('input', { placeholder: 'Email', type: 'email' });
  const fTerr = h('input', { placeholder: type === 'Customer' ? 'Territory' : 'Country', list: 'terr-list' });
  const grpList = h('datalist', { id: 'grp-list' });
  const terrList = h('datalist', { id: 'terr-list' });
  ERP.list(type + ' Group', { fields: ['name'], limit: 200 }).then(r => (r.data || []).forEach(d => grpList.appendChild(h('option', { value: d.name })))).catch(()=>{});
  ERP.list(type === 'Customer' ? 'Territory' : 'Country', { fields: ['name'], limit: 500 }).then(r => (r.data || []).forEach(d => terrList.appendChild(h('option', { value: d.name })))).catch(()=>{});
  modal.appendChild(grpList); modal.appendChild(terrList);
  const row = (label, c, full) => { const r = h('div', { class: 'form-row' + (full ? ' full' : '') }); r.appendChild(h('label', {}, label)); r.appendChild(c); return r; };
  grid.appendChild(row('Name', fName, true));
  grid.appendChild(row('Group', fGroup));
  grid.appendChild(row('GSTIN', fGstin));
  grid.appendChild(row('Mobile', fMobile));
  grid.appendChild(row('Email', fEmail));
  grid.appendChild(row(type === 'Customer' ? 'Territory' : 'Country', fTerr, true));
  modal.appendChild(grid);
  const actions = h('div', { class: 'modal-actions' });
  const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
  const save = h('button', { class: 'btn-primary', type: 'button' }, 'Create');
  actions.appendChild(cancel); actions.appendChild(save);
  modal.appendChild(actions);
  document.body.appendChild(backdrop);
  cancel.addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  save.addEventListener('click', async () => {
    if (!fName.value) { toast('Name required', 'err'); return; }
    save.disabled = true;
    try {
      const body = type === 'Customer'
        ? { customer_name: fName.value, customer_group: fGroup.value || 'All Customer Groups', customer_type: 'Company', tax_id: fGstin.value, mobile_no: fMobile.value, email_id: fEmail.value, territory: fTerr.value || 'All Territories' }
        : { supplier_name: fName.value, supplier_group: fGroup.value || 'All Supplier Groups', supplier_type: 'Company', tax_id: fGstin.value, mobile_no: fMobile.value, email_id: fEmail.value, country: fTerr.value || 'India' };
      await ERP.create(type, body);
      toast(`${type} created: ${fName.value}`);
      backdrop.remove();
      if (onDone) onDone();
    } catch (e) { toast('Error: ' + e.message, 'err'); save.disabled = false; }
  });
}

function openNewItemModal(onDone) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const modal = h('div', { class: 'modal' });
  backdrop.appendChild(modal);
  modal.appendChild(h('h3', {}, 'New Item'));
  const grid = h('div', { class: 'form-grid' });
  const fCode = h('input', { placeholder: 'Item code', required: true });
  const fName = h('input', { placeholder: 'Item name', required: true });
  const fGroup = h('input', { list: 'ig-list', placeholder: 'Item group' });
  const fUom = h('input', { list: 'uom-list', placeholder: 'UOM (e.g. Kg)', value: 'Kg' });
  const fStock = h('select', {}, h('option', { value: '1' }, 'Stock Item'), h('option', { value: '0' }, 'Non-Stock'));
  const ig = h('datalist', { id: 'ig-list' });
  const uom = h('datalist', { id: 'uom-list' });
  ERP.list('Item Group', { fields: ['name'], limit: 100 }).then(r => (r.data || []).forEach(d => ig.appendChild(h('option', { value: d.name })))).catch(()=>{});
  ERP.list('UOM', { fields: ['name'], limit: 100 }).then(r => (r.data || []).forEach(d => uom.appendChild(h('option', { value: d.name })))).catch(()=>{});
  modal.appendChild(ig); modal.appendChild(uom);
  const row = (label, c, full) => { const r = h('div', { class: 'form-row' + (full ? ' full' : '') }); r.appendChild(h('label', {}, label)); r.appendChild(c); return r; };
  grid.appendChild(row('Code', fCode));
  grid.appendChild(row('Name', fName));
  grid.appendChild(row('Group', fGroup));
  grid.appendChild(row('UOM', fUom));
  grid.appendChild(row('Stock?', fStock, true));
  modal.appendChild(grid);
  const actions = h('div', { class: 'modal-actions' });
  const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
  const save = h('button', { class: 'btn-primary', type: 'button' }, 'Create');
  actions.appendChild(cancel); actions.appendChild(save);
  modal.appendChild(actions);
  document.body.appendChild(backdrop);
  cancel.addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  save.addEventListener('click', async () => {
    if (!fCode.value || !fName.value) { toast('Code and name required', 'err'); return; }
    save.disabled = true;
    try {
      await ERP.create('Item', { item_code: fCode.value, item_name: fName.value, item_group: fGroup.value || 'All Item Groups', stock_uom: fUom.value || 'Kg', is_stock_item: Number(fStock.value) });
      toast(`Item created: ${fCode.value}`);
      backdrop.remove();
      if (onDone) onDone();
    } catch (e) { toast('Error: ' + e.message, 'err'); save.disabled = false; }
  });
}

// ---------- CSV export ----------
function exportCsv(rows, filename) {
  if (!rows || !rows.length) { toast('Nothing to export', 'err'); return; }
  const keys = Object.keys(rows[0]);
  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const csv = keys.join(',') + '\n' + rows.map(r => keys.map(k => esc(r[k])).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
Views.loans = (root) => listView(root, { title: 'Loan Book', doctype: 'Loan Facility', fields: ['name','facility_code','bank','facility_type','sanctioned_amount','outstanding_amount','status'] });
Views.whr = (root) => listView(root, { title: 'WHR Pledges', doctype: 'WHR Pledge', fields: ['name','whr_no','facility','qty_kg','total_value','drawing_power','status'] });
Views.fundraise = (root) => listView(root, { title: 'Fundraising', doctype: 'Investor Round', fields: ['name','round_name','round_type','target_amount','raised_amount','status'] });

async function partiesView(root) {
  root.innerHTML = '';
  root.appendChild(h('h1', { class: 'page' }, 'Parties'));
  root.appendChild(h('p', { class: 'sub' }, 'Customers & Suppliers — click a row to see full statement, outstanding, and history'));
  const tabs = h('div', { class: 'toolbar' });
  const tabCust = h('button', { class: 'btn-primary' }, 'Customers');
  const tabSup = h('button', { class: 'btn' }, 'Suppliers');
  const search = h('input', { type: 'text', placeholder: 'Search name / GSTIN / group…' });
  const newBtn = h('button', { class: 'btn-primary' }, '+ New');
  const exportBtn = h('button', { class: 'btn' }, '⬇ Export CSV');
  tabs.appendChild(tabCust); tabs.appendChild(tabSup); tabs.appendChild(search); tabs.appendChild(h('div', { class: 'spacer' })); tabs.appendChild(exportBtn); tabs.appendChild(newBtn);
  root.appendChild(tabs);
  const out = h('div', {}); root.appendChild(out);
  let mode = 'Customer';
  let data = [];
  const load = async () => {
    out.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const fields = mode === 'Customer'
        ? ['name','customer_name','customer_group','customer_type','tax_id','territory']
        : ['name','supplier_name','supplier_group','supplier_type','tax_id','country'];
      const r = await ERP.list(mode, { fields, limit: 2000, order_by: 'modified desc' });
      data = r.data || []; render();
    } catch (e) { out.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
  };
  const render = () => {
    const q = search.value.toLowerCase();
    const rows = q ? data.filter(r => Object.values(r).some(v => String(v||'').toLowerCase().includes(q))) : data;
    out.innerHTML = '';
    if (!rows.length) { out.appendChild(h('div', { class: 'loading' }, `No ${mode.toLowerCase()}s match.`)); return; }
    const fields = Object.keys(rows[0]);
    const wrap = h('div', { class: 'table-wrap' });
    const tbl = h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ...fields.map(f => h('th', {}, f.replace(/_/g,' '))))),
      h('tbody', {}, ...rows.slice(0, 500).map(r => {
        const tr = h('tr', { class: 'clickable' }, ...fields.map(f => h('td', {}, r[f] ?? '')));
        tr.addEventListener('click', () => { location.hash = `#party?type=${mode}&name=${encodeURIComponent(r.name)}`; });
        return tr;
      }))
    );
    wrap.appendChild(tbl); out.appendChild(wrap);
    out.appendChild(h('p', { class: 'sub' }, `${rows.length} ${mode.toLowerCase()}s${rows.length>500?' (showing 500)':''}`));
  };
  tabCust.addEventListener('click', () => { mode='Customer'; tabCust.className='btn-primary'; tabSup.className='btn'; load(); });
  tabSup.addEventListener('click', () => { mode='Supplier'; tabSup.className='btn-primary'; tabCust.className='btn'; load(); });
  search.addEventListener('input', render);
  newBtn.addEventListener('click', () => openNewPartyModal(mode, () => load()));
  exportBtn.addEventListener('click', () => exportCsv(data, `${mode.toLowerCase()}s-${today()}.csv`));
  load();
}

// ---------- Party Detail (drill-down) ----------
Views.party = async (root) => {
  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  const type = params.get('type') || 'Customer';
  const name = params.get('name') || '';
  root.innerHTML = '';
  const head = h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } });
  head.appendChild(h('h1', { class: 'page', style: { margin: 0 } }, name));
  const back = h('a', { class: 'btn', href: '#parties' }, '← Back to Parties');
  head.appendChild(back);
  root.appendChild(head);
  root.appendChild(h('p', { class: 'sub' }, `${type} · account statement, outstanding, transactions`));

  const kpi = h('div', { class: 'kpi-grid' }); root.appendChild(kpi);
  const kOut = h('div', { class: 'kpi kpi-accent' }, h('div', { class: 'kpi-label' }, 'Outstanding'), h('div', { class: 'kpi-value' }, '…'));
  const kInv = h('div', { class: 'kpi kpi-accent' }, h('div', { class: 'kpi-label' }, type === 'Customer' ? 'Sales Invoices' : 'Purchase Invoices'), h('div', { class: 'kpi-value' }, '…'));
  const kTxn = h('div', { class: 'kpi kpi-accent' }, h('div', { class: 'kpi-label' }, 'Payments'), h('div', { class: 'kpi-value' }, '…'));
  kpi.appendChild(kOut); kpi.appendChild(kInv); kpi.appendChild(kTxn);

  // Info card
  try {
    const info = await ERP.get(type, name);
    const d = info.data || {};
    const card = h('div', { class: 'card', style: { marginBottom: '14px' } });
    const details = [
      ['GSTIN', d.tax_id], ['Group', d[type === 'Customer' ? 'customer_group' : 'supplier_group']],
      ['Type', d[type === 'Customer' ? 'customer_type' : 'supplier_type']],
      ['Territory/Country', d.territory || d.country],
      ['Mobile', d.mobile_no], ['Email', d.email_id],
    ].filter(r => r[1]);
    card.appendChild(h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px 24px' } },
      ...details.map(([k, v]) => h('div', {}, h('span', { class: 'sub' }, k + ': '), h('strong', {}, String(v))))
    ));
    root.appendChild(card);
  } catch {}

  // Invoices + Payments
  const grid = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' } });
  root.appendChild(grid);

  const invDoc = type === 'Customer' ? 'Sales Invoice' : 'Purchase Invoice';
  const partyField = type === 'Customer' ? 'customer' : 'supplier';
  const invCard = h('div', { class: 'card' }); invCard.appendChild(h('h3', { style: { margin: '0 0 10px', fontSize: '13px' } }, invDoc + 's'));
  const invBody = h('div', {}, h('div', { class: 'loading' }, 'Loading…')); invCard.appendChild(invBody);
  grid.appendChild(invCard);

  const payCard = h('div', { class: 'card' }); payCard.appendChild(h('h3', { style: { margin: '0 0 10px', fontSize: '13px' } }, 'Payment Entries'));
  const payBody = h('div', {}, h('div', { class: 'loading' }, 'Loading…')); payCard.appendChild(payBody);
  grid.appendChild(payCard);

  try {
    const inv = await ERP.list(invDoc, {
      fields: ['name','posting_date','grand_total','outstanding_amount','status'],
      filters: [[partyField,'=',name]], limit: 200, order_by: 'posting_date desc',
    });
    const rows = inv.data || [];
    const totalInv = rows.reduce((s,r)=>s+(Number(r.grand_total)||0),0);
    const out = rows.reduce((s,r)=>s+(Number(r.outstanding_amount)||0),0);
    kInv.querySelector('.kpi-value').textContent = rows.length;
    kOut.querySelector('.kpi-value').textContent = fmtCr(out);
    invBody.innerHTML = '';
    if (!rows.length) invBody.appendChild(h('div', { class: 'sub' }, 'No invoices yet.'));
    else {
      const wrap = h('div', { class: 'table-wrap' });
      wrap.appendChild(h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Invoice'), h('th', { class: 'num' }, 'Total'), h('th', { class: 'num' }, 'Outstanding'), h('th', {}, 'Status'))),
        h('tbody', {}, ...rows.map(r => h('tr', {}, h('td', {}, r.posting_date || ''), h('td', {}, r.name), h('td', { class: 'num' }, fmt(r.grand_total)), h('td', { class: 'num' }, fmt(r.outstanding_amount)), h('td', {}, h('span', { class: 'pill ' + (r.status === 'Paid' ? 'green' : r.outstanding_amount > 0 ? 'amber' : 'green') }, r.status || '')))))
      ));
      invBody.appendChild(wrap);
      invBody.appendChild(h('p', { class: 'sub', style: { marginTop: '6px' } }, `Total invoiced: ${fmtCr(totalInv)}`));
    }
  } catch (e) { invBody.innerHTML = `<div class="loading">${e.message}</div>`; }

  try {
    const pay = await ERP.list('Payment Entry', {
      fields: ['name','posting_date','paid_amount','payment_type','mode_of_payment','reference_no'],
      filters: [['party_type','=',type],['party','=',name]], limit: 200, order_by: 'posting_date desc',
    });
    const rows = pay.data || [];
    kTxn.querySelector('.kpi-value').textContent = rows.length;
    payBody.innerHTML = '';
    if (!rows.length) payBody.appendChild(h('div', { class: 'sub' }, 'No payments yet.'));
    else {
      const wrap = h('div', { class: 'table-wrap' });
      wrap.appendChild(h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Entry'), h('th', {}, 'Type'), h('th', {}, 'Mode'), h('th', { class: 'num' }, 'Amount'), h('th', {}, 'Ref'))),
        h('tbody', {}, ...rows.map(r => h('tr', {}, h('td', {}, r.posting_date || ''), h('td', {}, r.name), h('td', {}, r.payment_type || ''), h('td', {}, r.mode_of_payment || ''), h('td', { class: 'num' }, fmt(r.paid_amount)), h('td', {}, r.reference_no || ''))))
      ));
      payBody.appendChild(wrap);
    }
  } catch (e) { payBody.innerHTML = `<div class="loading">${e.message}</div>`; }
};

async function listView(root, cfg) {
  root.innerHTML = '';
  root.appendChild(h('h1', { class: 'page' }, cfg.title));
  root.appendChild(h('p', { class: 'sub' }, `${cfg.doctype} records`));
  const search = h('input', { type: 'text', placeholder: 'Search…' });
  const exportBtn = h('button', { class: 'btn' }, '⬇ Export CSV');
  const bar = h('div', { class: 'toolbar' }, search, h('div', { class: 'spacer' }), exportBtn);
  if (cfg.onNew) {
    const newBtn = h('button', { class: 'btn-primary' }, cfg.newLabel || '+ New');
    newBtn.addEventListener('click', () => cfg.onNew(() => reload()));
    bar.appendChild(newBtn);
  }
  root.appendChild(bar);
  const out = h('div', {}); root.appendChild(out);
  out.innerHTML = '<div class="loading">Loading…</div>';
  let all = [];
  const reload = async () => {
    out.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const { data } = await ERP.list(cfg.doctype, { fields: cfg.fields, limit: cfg.limit || 200 });
      all = data || [];
      render();
    } catch (e) { out.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
  };
  exportBtn.addEventListener('click', () => exportCsv(all, `${cfg.doctype.toLowerCase().replace(/\s+/g,'-')}-${today()}.csv`));
  await reload();
  function render() {
    const q = search.value.toLowerCase();
    const rows = q ? all.filter(r => Object.values(r).some(v => String(v || '').toLowerCase().includes(q))) : all;
    out.innerHTML = '';
    if (!rows.length) { out.appendChild(h('div', { class: 'loading' }, 'No records.')); return; }
    const wrap = h('div', { class: 'table-wrap' });
    const tbl = h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ...cfg.fields.map(f => h('th', { class: isNumField(f)?'num':'' }, f)))),
      h('tbody', {}, ...rows.map(r => h('tr', {}, ...cfg.fields.map(f => h('td', { class: isNumField(f)?'num':'' }, isNumField(f) ? fmt(r[f]) : (r[f] ?? ''))))))
    );
    wrap.appendChild(tbl); out.appendChild(wrap);
    out.appendChild(h('p', { class: 'sub' }, `${rows.length} records`));
  }
  search.addEventListener('input', render);
}
function isNumField(f) { return /amount|qty|value|rate|power|total/i.test(f); }

// ---------- Auction Day ----------
Views.auction = async (root) => {
  root.innerHTML = '';
  root.appendChild(h('h1', { class: 'page' }, 'Auction Day'));
  root.appendChild(h('p', { class: 'sub' }, 'Session control, live lots, bid entry, results'));
  const wrap = h('div', { class: 'kpi-grid' });
  root.appendChild(wrap);
  const plan = h('div', { class: 'kpi kpi-accent' }, h('div', { class: 'kpi-label' }, 'Planned Sessions'), h('div', { class: 'kpi-value' }, '…'));
  const live = h('div', { class: 'kpi kpi-accent' }, h('div', { class: 'kpi-label' }, 'In Progress'), h('div', { class: 'kpi-value' }, '…'));
  const lots = h('div', { class: 'kpi kpi-accent' }, h('div', { class: 'kpi-label' }, 'Open Lots'), h('div', { class: 'kpi-value' }, '…'));
  const bidders = h('div', { class: 'kpi kpi-accent' }, h('div', { class: 'kpi-label' }, 'Active Bidders'), h('div', { class: 'kpi-value' }, '…'));
  [plan, live, lots, bidders].forEach(k => wrap.appendChild(k));
  try {
    const [p, l, lt, b] = await Promise.all([
      ERP.count('Auction Session', [['status','=','Planned']]),
      ERP.count('Auction Session', [['status','=','In Progress']]),
      ERP.count('Auction Lot').catch(() => 0),
      ERP.count('Auction Bidder', [['is_active','=',1]]),
    ]);
    plan.querySelector('.kpi-value').textContent = p;
    live.querySelector('.kpi-value').textContent = l;
    lots.querySelector('.kpi-value').textContent = lt;
    bidders.querySelector('.kpi-value').textContent = b;
  } catch (e) { toast('Auction load: ' + e.message, 'err'); }

  const card = h('div', { class: 'card', style: { marginTop: '12px' } });
  card.appendChild(h('h3', { style: { margin: '0 0 10px', fontSize: '14px' } }, 'Upcoming Sessions'));
  const tbl = h('div', {}, h('div', { class: 'loading' }, 'Loading…'));
  card.appendChild(tbl);
  root.appendChild(card);
  try {
    const r = await ERP.list('Auction Session', { fields: ['name','session_date','session_type','location','status'], limit: 10, order_by: 'session_date desc' });
    tbl.innerHTML = '';
    const t = h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Session'), h('th', {}, 'Date'), h('th', {}, 'Type'), h('th', {}, 'Location'), h('th', {}, 'Status'))),
      h('tbody', {}, ...(r.data || []).map(s => h('tr', {}, h('td', {}, s.name), h('td', {}, s.session_date || ''), h('td', {}, s.session_type || ''), h('td', {}, s.location || ''), h('td', {}, h('span', { class: 'pill ' + (s.status === 'In Progress' ? 'green' : 'amber') }, s.status || '')))))
    );
    tbl.appendChild(t);
  } catch (e) { tbl.innerHTML = `<div class="loading">${e.message}</div>`; }
};

// ---------- Bank Approvals ----------
Views.approvals = async (root) => {
  root.innerHTML = '';
  root.appendChild(h('h1', { class: 'page' }, 'Bank Approvals'));
  root.appendChild(h('p', { class: 'sub' }, 'Review queued payouts, release via bank API (if configured) or the bulk NEFT file rail'));

  const bar = h('div', { class: 'toolbar' });
  const filter = h('select', {}, ...['all','pending_approval','ready_for_file','filed','sent','rejected','failed'].map(s => h('option', { value: s }, s.replace(/_/g,' '))));
  const refresh = h('button', { class: 'btn' }, 'Refresh');
  const fileBtn = h('a', { class: 'btn-primary', href: '#', style: { marginLeft: 'auto' } }, '⬇ Download NEFT File');
  const fileFmt = h('select', {}, h('option', { value: 'axis' }, 'Axis format'), h('option', { value: 'sbi' }, 'SBI format'), h('option', { value: 'generic' }, 'Generic CSV'));
  const confirmSent = h('button', { class: 'btn' }, 'Mark Batch as Sent');
  bar.appendChild(h('span', {}, 'Status')); bar.appendChild(filter); bar.appendChild(refresh);
  bar.appendChild(fileFmt); bar.appendChild(fileBtn); bar.appendChild(confirmSent);
  root.appendChild(bar);

  const adapters = h('div', {}); root.appendChild(adapters);
  const out = h('div', {}); root.appendChild(out);

  const load = async () => {
    out.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const r = await fetch('/api/bank-payout').then(r => r.json());
      adapters.innerHTML = '';
      const cfg = r.adapters || {};
      const pills = h('div', { class: 'card', style: { margin: '0 0 10px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } });
      pills.appendChild(h('strong', {}, 'Bank Rails:'));
      ['axis','sbi','sib'].forEach(k => {
        pills.appendChild(h('span', { class: 'pill ' + (cfg[k] ? 'green' : 'amber'), title: cfg[k] ? 'Live API configured' : 'API creds not yet set — will route to NEFT file' }, `${k.toUpperCase()} ${cfg[k] ? 'LIVE' : 'PENDING'}`));
      });
      pills.appendChild(h('span', { class: 'pill green' }, 'FILE ALWAYS-ON'));
      pills.appendChild(h('span', { class: 'sub' }, 'Paste Axis/SBI/SIB creds into Vercel env to flip PENDING → LIVE instantly.'));
      adapters.appendChild(pills);

      const all = r.entries || [];
      const rows = filter.value === 'all' ? all : all.filter(e => e.status === filter.value);
      out.innerHTML = '';
      if (!rows.length) { out.appendChild(h('div', { class: 'loading' }, 'No payouts in this state.')); return; }
      const wrap = h('div', { class: 'table-wrap' });
      const tbl = h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'ID'), h('th', {}, 'Created'), h('th', {}, 'From'), h('th', {}, 'Beneficiary'), h('th', {}, 'A/c · IFSC'), h('th', { class: 'num' }, 'Amount'), h('th', {}, 'Mode'), h('th', {}, 'Rail'), h('th', {}, 'Status'), h('th', {}, 'Batch / Ref'), h('th', {}, 'Actions'))),
        h('tbody', {}, ...rows.map(e => {
          const tr = h('tr', {});
          tr.appendChild(h('td', {}, e.id));
          tr.appendChild(h('td', {}, (e.createdAt || '').slice(0, 16).replace('T', ' ')));
          tr.appendChild(h('td', {}, e.paid_from || ''));
          tr.appendChild(h('td', {}, e.beneficiary_name || ''));
          tr.appendChild(h('td', {}, `${e.beneficiary_account || ''} · ${e.beneficiary_ifsc || ''}`));
          tr.appendChild(h('td', { class: 'num' }, fmt(e.amount)));
          tr.appendChild(h('td', {}, e.mode || ''));
          tr.appendChild(h('td', {}, (e.adapter || '').toUpperCase()));
          const pillClass = e.status === 'sent' ? 'green' : e.status === 'rejected' || e.status === 'failed' ? 'red' : 'amber';
          tr.appendChild(h('td', {}, h('span', { class: 'pill ' + pillClass }, (e.status || '').replace(/_/g,' '))));
          tr.appendChild(h('td', {}, e.batch_id || e.bank_reference || ''));
          const act = h('td', {});
          if (e.status === 'pending_approval') {
            const ap = h('button', { class: 'btn-primary', style: { marginRight: '4px' } }, 'Approve');
            const rj = h('button', { class: 'btn' }, 'Reject');
            ap.addEventListener('click', () => doPatch(e.id, 'approve'));
            rj.addEventListener('click', () => { const notes = prompt('Reason for rejection?') || ''; doPatch(e.id, 'reject', notes); });
            act.appendChild(ap); act.appendChild(rj);
          } else if (e.status === 'filed') {
            const mk = h('button', { class: 'btn' }, 'Mark Sent');
            mk.addEventListener('click', () => { const utr = prompt('UTR / bank reference?') || ''; doPatch(e.id, 'mark_file_sent', '', utr); });
            act.appendChild(mk);
          } else if (e.error) {
            act.appendChild(h('span', { class: 'sub', title: e.error }, e.error.slice(0, 40)));
          }
          tr.appendChild(act);
          return tr;
        }))
      );
      wrap.appendChild(tbl); out.appendChild(wrap);
    } catch (e) { out.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
  };
  const doPatch = async (id, action, notes = '', bank_reference = '') => {
    try {
      const r = await fetch('/api/bank-payout', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, approver: 'accounting-ui', notes, bank_reference })
      });
      const j = await r.json();
      if (!r.ok && !j.entry) throw new Error(j.error || 'Failed');
      toast(`${id}: ${(j.entry?.status || action).replace(/_/g,' ')}`);
      load();
    } catch (e) { toast('Error: ' + e.message, 'err'); }
  };
  fileBtn.addEventListener('click', async (ev) => {
    ev.preventDefault();
    try {
      const r = await fetch(`/api/bank-file?format=${fileFmt.value}`);
      if (!r.ok) throw new Error(await r.text());
      const blob = await r.blob();
      const batchId = r.headers.get('X-Batch-Id') || ('BATCH-' + Date.now());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${batchId}-${fileFmt.value}.csv`; a.click();
      URL.revokeObjectURL(url);
      toast(`Downloaded ${batchId}. Upload to bank portal, then click "Mark Batch as Sent".`);
      load();
    } catch (e) { toast('Error: ' + e.message, 'err'); }
  });
  confirmSent.addEventListener('click', async () => {
    const batch_id = prompt('Enter batch ID to mark as sent (from the downloaded filename, e.g. BATCH-20260420...)');
    if (!batch_id) return;
    const bank_reference = prompt('Bank reference / UTR (optional)') || '';
    try {
      const r = await fetch('/api/bank-file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm_sent', batch_id, bank_reference }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed');
      toast(`Marked ${j.sent} payouts in ${j.batch_id} as sent`);
      load();
    } catch (e) { toast('Error: ' + e.message, 'err'); }
  });
  filter.addEventListener('change', load);
  refresh.addEventListener('click', load);
  load();
};

// ---------- Suggestions Inbox ----------
Views.suggestions = async (root) => {
  root.innerHTML = '';
  root.appendChild(h('h1', { class: 'page' }, 'Suggestions Inbox'));
  root.appendChild(h('p', { class: 'sub' }, 'What employees are asking for — new pages, buttons, fixes, integrations'));
  const bar = h('div', { class: 'toolbar' });
  const statusF = h('select', {}, ...['all','new','in_review','planned','built','rejected'].map(s => h('option', { value: s }, s.replace('_',' '))));
  const refresh = h('button', { class: 'btn' }, 'Refresh');
  bar.appendChild(h('span', {}, 'Status')); bar.appendChild(statusF); bar.appendChild(refresh);
  root.appendChild(bar);
  const out = h('div', {}); root.appendChild(out);
  const load = async () => {
    out.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const r = await fetch('/api/suggestions').then(r => r.json());
      const all = r.entries || [];
      const rows = statusF.value === 'all' ? all : all.filter(e => (e.status || 'new') === statusF.value);
      out.innerHTML = '';
      if (!rows.length) { out.appendChild(h('div', { class: 'loading' }, 'No suggestions yet. Ask staff to use the footer bar on any page.')); return; }
      rows.forEach(e => {
        const card = h('div', { class: 'card', style: { marginBottom: '10px' } });
        const head = h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' } });
        head.appendChild(h('div', {},
          h('strong', {}, e.submitter || 'Anonymous'),
          h('span', { class: 'sub', style: { marginLeft: '8px' } }, `${(e.createdAt || '').slice(0,16).replace('T',' ')} · ${e.from_page || '?'} · ${e.language || ''}`)
        ));
        const pillClass = e.status === 'built' ? 'green' : e.status === 'rejected' ? 'red' : 'amber';
        head.appendChild(h('span', { class: 'pill ' + pillClass }, e.status || 'new'));
        card.appendChild(head);
        if (e.text) card.appendChild(h('p', { style: { margin: '8px 0 0', whiteSpace: 'pre-wrap' } }, e.text));
        if (e.transcript && e.transcript !== e.text) card.appendChild(h('p', { class: 'sub', style: { margin: '4px 0 0', whiteSpace: 'pre-wrap' } }, '🎙 ' + e.transcript));
        if (Array.isArray(e.links) && e.links.length) {
          const lw = h('div', { style: { marginTop: '6px', fontSize: '12px' } });
          lw.appendChild(h('strong', {}, '🔗 Links: '));
          e.links.forEach((l, i) => {
            if (i > 0) lw.appendChild(document.createTextNode(' · '));
            lw.appendChild(h('a', { href: l, target: '_blank', rel: 'noopener' }, l.length > 60 ? l.slice(0, 60) + '…' : l));
          });
          card.appendChild(lw);
        }
        if (Array.isArray(e.attachments) && e.attachments.length) {
          const aw = h('div', { style: { marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' } });
          e.attachments.forEach(att => {
            if (!att.url) { aw.appendChild(h('span', { class: 'pill red' }, att.name + ' (failed)')); return; }
            if ((att.type || '').startsWith('image/')) {
              aw.appendChild(h('a', { href: att.url, target: '_blank', rel: 'noopener' }, h('img', { src: att.url, alt: att.name, style: { maxHeight: '120px', maxWidth: '200px', borderRadius: '6px', border: '1px solid var(--line)' } })));
            } else {
              aw.appendChild(h('a', { href: att.url, target: '_blank', rel: 'noopener', class: 'btn' }, `📎 ${att.name}`));
            }
          });
          card.appendChild(aw);
        }
        if (e.notes) card.appendChild(h('p', { class: 'sub', style: { margin: '6px 0 0' } }, 'Notes: ' + e.notes));
        const actions = h('div', { style: { marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' } });
        ['in_review','planned','built','rejected'].forEach(s => {
          const b = h('button', { class: 'btn' }, s.replace('_',' '));
          b.addEventListener('click', () => patch(e.id, { status: s }));
          actions.appendChild(b);
        });
        const noteBtn = h('button', { class: 'btn' }, '+ note');
        noteBtn.addEventListener('click', () => { const n = prompt('Notes', e.notes || ''); if (n !== null) patch(e.id, { notes: n }); });
        actions.appendChild(noteBtn);
        card.appendChild(actions);
        out.appendChild(card);
      });
    } catch (err) { out.innerHTML = `<div class="loading">Error: ${err.message}</div>`; }
  };
  const patch = async (id, body) => {
    try {
      const r = await fetch('/api/suggestions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed');
      load();
    } catch (e) { toast('Error: ' + e.message, 'err'); }
  };
  statusF.addEventListener('change', load);
  refresh.addEventListener('click', load);
  load();
};

// ---------- Suggestion Footer Bar ----------
function wireSuggestBar() {
  const txt = document.getElementById('suggest-text');
  const lang = document.getElementById('suggest-lang');
  const mic = document.getElementById('suggest-mic');
  const send = document.getElementById('suggest-send');
  const attach = document.getElementById('suggest-attach');
  const files = document.getElementById('suggest-files');
  const chips = document.getElementById('suggest-chips');
  if (!txt || !send) return;

  // Pending attachments (kept as { name, type, data_base64 })
  const pending = [];
  const renderChips = () => {
    if (!chips) return;
    chips.innerHTML = '';
    pending.forEach((f, i) => {
      const chip = h('span', { class: 'chip' });
      chip.appendChild(document.createTextNode(`📎 ${f.name} (${Math.round(f.size/1024)} KB)`));
      const x = h('button', { type: 'button', title: 'Remove' }, '×');
      x.addEventListener('click', () => { pending.splice(i, 1); renderChips(); });
      chip.appendChild(x);
      chips.appendChild(chip);
    });
  };
  const readAsBase64 = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  if (attach) attach.addEventListener('click', () => files && files.click());
  if (files) files.addEventListener('change', async () => {
    for (const file of files.files) {
      if (file.size > 3 * 1024 * 1024) { toast(`${file.name}: too large (max 3 MB)`, 'err'); continue; }
      const data_base64 = await readAsBase64(file);
      pending.push({ name: file.name, type: file.type, size: file.size, data_base64 });
    }
    files.value = '';
    renderChips();
  });

  let rec = null;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { mic.disabled = true; mic.title = 'Voice not supported in this browser'; }
  mic.addEventListener('click', () => {
    if (!SR) return;
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = lang.value;
    rec.interimResults = true;
    rec.continuous = true;
    let finalText = '';
    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += t + ' '; else interim += t;
      }
      txt.value = (finalText + interim).trim();
    };
    rec.onerror = (e) => { toast('Mic: ' + e.error, 'err'); };
    rec.onend = () => { mic.classList.remove('rec'); mic.textContent = '🎙'; rec = null; };
    rec.start();
    mic.classList.add('rec'); mic.textContent = '■';
  });

  send.addEventListener('click', async () => {
    const text = txt.value.trim();
    if (!text && !pending.length) { toast('Type, dictate or attach something first', 'err'); return; }
    send.disabled = true;
    try {
      const r = await fetch('/api/suggestions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_page: location.hash || '#dashboard',
          language: lang.value,
          submitter: '',
          text,
          transcript: text,
          attachments: pending,
        })
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed');
      toast('Thanks — suggestion saved');
      txt.value = '';
      pending.length = 0;
      renderChips();
    } catch (e) { toast('Error: ' + e.message, 'err'); }
    finally { send.disabled = false; }
  });
}

// ---------- Utils ----------
function firstOfMonth() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0,10); }
function firstOfFy() { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear()-1; return `${y}-04-01`; }
function currentFy() { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear()-1; return `${y}-${y+1}`; }

// ---------- Router ----------
function route() {
  const view = (location.hash.replace('#','') || 'dashboard').split('?')[0];
  document.querySelectorAll('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  const crumb = document.getElementById('crumb');
  const activeLink = document.querySelector(`.nav-link[data-view="${view}"]`);
  crumb.textContent = activeLink ? activeLink.textContent.trim() : 'Dashboard';
  // Auto-open the <details> section containing the active link
  document.querySelectorAll('.nav-sec').forEach(d => { if (d.contains(activeLink)) d.open = true; });
  const root = document.getElementById('view');
  root.innerHTML = '<div class="loading">Loading…</div>';
  const fn = Views[view] || Views.dashboard;
  Promise.resolve(fn(root)).catch(err => { root.innerHTML = `<div class="loading">Error: ${err.message}</div>`; });
}

document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('company-select');
  if (sel) sel.addEventListener('change', () => { state.company = sel.value; route(); });
  document.querySelectorAll('.nav-link').forEach(a => a.addEventListener('click', (e) => {
    // hash change handles routing
  }));
  window.addEventListener('hashchange', route);
  wireSuggestBar();
  wireGlobalSearch();
  wireKeyboardShortcuts();
  route();
});

// ---------- Global Search (cmd-K) ----------
function wireGlobalSearch() {
  const input = document.getElementById('global-search');
  const box = document.getElementById('global-search-results');
  if (!input || !box) return;
  let timer = null, active = -1, items = [];

  const hide = () => { box.hidden = true; active = -1; };
  const navigate = (href) => { hide(); input.value = ''; location.hash = href; };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.blur(); hide(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, items.length - 1); renderActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); renderActive(); }
    else if (e.key === 'Enter' && active >= 0 && items[active]) { e.preventDefault(); navigate(items[active].href); }
  });
  const renderActive = () => { [...box.querySelectorAll('.sr-item')].forEach((el, i) => el.classList.toggle('active', i === active)); };

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(timer);
    if (!q) { hide(); return; }
    timer = setTimeout(() => doSearch(q), 180);
  });
  input.addEventListener('focus', () => { if (input.value.trim()) input.dispatchEvent(new Event('input')); });
  document.addEventListener('click', (e) => { if (!box.contains(e.target) && e.target !== input) hide(); });

  async function doSearch(q) {
    box.hidden = false;
    box.innerHTML = '<div class="sr-empty">Searching…</div>';
    try {
      const [cust, sup, item, si, pi] = await Promise.all([
        ERP.list('Customer', { fields: ['name','customer_name','tax_id'], filters: [['customer_name','like',`%${q}%`]], limit: 6 }).catch(() => ({ data: [] })),
        ERP.list('Supplier', { fields: ['name','supplier_name','tax_id'], filters: [['supplier_name','like',`%${q}%`]], limit: 6 }).catch(() => ({ data: [] })),
        ERP.list('Item', { fields: ['name','item_name','item_group'], filters: [['item_name','like',`%${q}%`]], limit: 6 }).catch(() => ({ data: [] })),
        ERP.list('Sales Invoice', { fields: ['name','customer','grand_total'], filters: [['name','like',`%${q}%`]], limit: 4 }).catch(() => ({ data: [] })),
        ERP.list('Purchase Invoice', { fields: ['name','supplier','grand_total'], filters: [['name','like',`%${q}%`]], limit: 4 }).catch(() => ({ data: [] })),
      ]);
      items = [];
      box.innerHTML = '';
      const addGroup = (label, rows, mkItem) => {
        if (!rows.length) return;
        box.appendChild(h('div', { class: 'sr-group' }, label));
        rows.forEach(r => {
          const it = mkItem(r);
          items.push(it);
          const el = h('a', { class: 'sr-item' },
            h('div', {}, it.title),
            h('div', { class: 'sr-sub' }, it.sub)
          );
          el.addEventListener('click', () => navigate(it.href));
          box.appendChild(el);
        });
      };
      addGroup('Customers', cust.data || [], r => ({ title: r.customer_name || r.name, sub: 'Customer · ' + (r.tax_id || r.name), href: `#party?type=Customer&name=${encodeURIComponent(r.name)}` }));
      addGroup('Suppliers', sup.data || [], r => ({ title: r.supplier_name || r.name, sub: 'Supplier · ' + (r.tax_id || r.name), href: `#party?type=Supplier&name=${encodeURIComponent(r.name)}` }));
      addGroup('Items', item.data || [], r => ({ title: r.item_name || r.name, sub: 'Item · ' + (r.item_group || ''), href: `#items` }));
      addGroup('Sales Invoices', si.data || [], r => ({ title: r.name, sub: `Sales · ${r.customer || ''} · ${fmtCr(r.grand_total)}`, href: `#sales` }));
      addGroup('Purchase Invoices', pi.data || [], r => ({ title: r.name, sub: `Purchase · ${r.supplier || ''} · ${fmtCr(r.grand_total)}`, href: `#purchase` }));
      if (!items.length) box.innerHTML = '<div class="sr-empty">No matches.</div>';
    } catch (e) { box.innerHTML = `<div class="sr-empty">Error: ${e.message}</div>`; }
  }
}

// ---------- Keyboard shortcuts (Busy-style) ----------
function wireKeyboardShortcuts() {
  const map = {
    F2: 'sales', F3: 'purchase', F4: 'receipt', F5: 'payment',
    F6: 'contra', F7: 'journal', F8: 'daybook', F9: 'ledger',
  };
  document.addEventListener('keydown', (e) => {
    // cmd-K / ctrl-K focuses global search
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const s = document.getElementById('global-search');
      if (s) { s.focus(); s.select(); }
      return;
    }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    const view = map[e.key];
    if (view) { e.preventDefault(); location.hash = '#' + view; }
  });
}
