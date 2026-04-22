// Default (traditional Busy-style) accounting view — FULL CRUD wired to ERPNext.
(function () {
  'use strict';

  // ---- ERP helper ----
  const api = {
    async call(path, { method = 'GET', query = {}, body } = {}) {
      const qs = new URLSearchParams({ path, method, ...query });
      const opts = { method: method === 'GET' ? 'GET' : (method === 'DELETE' ? 'DELETE' : 'POST'),
                     headers: { 'Content-Type': 'application/json' } };
      if (method !== 'GET' && method !== 'DELETE' && body !== undefined) opts.body = JSON.stringify(body);
      const r = await fetch(`/api/erp?${qs}`, opts);
      const t = await r.text();
      let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
      if (!r.ok) throw new Error(j.message || j.error || (typeof j.raw === 'string' ? j.raw.slice(0,200) : `HTTP ${r.status}`));
      return j;
    },
    list(dt, opts = {}) {
      const q = {};
      if (opts.fields) q.fields = JSON.stringify(opts.fields);
      if (opts.filters) q.filters = JSON.stringify(opts.filters);
      if (opts.limit) q.limit_page_length = opts.limit;
      if (opts.order_by) q.order_by = opts.order_by;
      return this.call(`resource/${encodeURIComponent(dt)}`, { query: q });
    },
    method(path, query = {}) { return this.call(`method/${path}`, { query }); },
    get(dt, name) { return this.call(`resource/${encodeURIComponent(dt)}/${encodeURIComponent(name)}`); },
    create(dt, body) { return this.call(`resource/${encodeURIComponent(dt)}`, { method: 'POST', body }); },
    update(dt, name, body) { return this.call(`resource/${encodeURIComponent(dt)}/${encodeURIComponent(name)}`, { method: 'PUT', body }); },
    del(dt, name) { return this.call(`resource/${encodeURIComponent(dt)}/${encodeURIComponent(name)}`, { method: 'DELETE' }); },
    cancel(dt, name) { return this.call('method/frappe.client.cancel', { method: 'POST', body: { doctype: dt, name } }); },
  };

  const state = {
    company: localStorage.getItem('bdCompany') || 'Spice More Trading Company',
    inited: false,
  };

  // ---- View switch ----
  function setShell(which) {
    document.body.classList.toggle('view-default', which === 'default');
    document.body.classList.toggle('view-custom',  which === 'custom');
    document.querySelectorAll('#viewSwitch .vs-btn').forEach(b => b.classList.toggle('active', b.dataset.shell === which));
    localStorage.setItem('bdShell', which);
    if (which === 'default' && !state.inited) { init(); state.inited = true; }
  }
  document.querySelectorAll('#viewSwitch .vs-btn').forEach(b => b.addEventListener('click', () => setShell(b.dataset.shell)));
  setShell(localStorage.getItem('bdShell') || 'custom');

  // ---- Utilities ----
  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function fmtN(n) { if (n === null || n === undefined || n === '') return ''; const x = Number(n); return isNaN(x) ? n : x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function abbr() { return state.company === 'Spice More Trading Company' ? 'SMTC' : 'SEPL'; }
  function todayISO() { return new Date().toISOString().slice(0,10); }
  function labelize(f) { return f.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase()); }
  const $ = (id) => document.getElementById(id);

  function setStatus(msg) { $('bdStatus').textContent = msg; }
  function setCount(msg)  { $('bdCount').textContent  = msg; }
  let toastTO;
  function toast(msg) { setStatus(msg); clearTimeout(toastTO); toastTO = setTimeout(() => setStatus('Ready.'), 3500); }

  function tickDate() { $('bdDate').textContent = new Date().toLocaleString('en-IN'); }
  tickDate(); setInterval(tickDate, 30000);

  // ---- Company selector ----
  const compSel = $('bdCompanySel');
  compSel.value = state.company;
  compSel.addEventListener('change', () => {
    state.company = compSel.value; localStorage.setItem('bdCompany', state.company);
    $('bdCompany').textContent = state.company;
    rerender();
  });
  $('bdCompany').textContent = state.company;

  // ---- Modal ----
  function openModal(titleHtml, bodyHtml, footerHtml) {
    $('bdModalBox').innerHTML = `
      <div class="bd-modal-head"><span>${titleHtml}</span><span class="bd-x" id="bdCloseX">×</span></div>
      <div class="bd-modal-body">${bodyHtml}</div>
      <div class="bd-modal-foot">${footerHtml || ''}</div>`;
    $('bdModal').classList.remove('hidden');
    $('bdCloseX').addEventListener('click', closeModal);
  }
  function closeModal() { $('bdModal').classList.add('hidden'); }

  // ---- Menu system ----
  const MENUS = {
    company: [
      { t: 'Select Company',      hk: 'F11',   act: () => { compSel.focus(); toast('Use the selector in the title bar'); } },
      { t: 'Financial Year Info', hk: '',      act: showFYInfo },
      { sep: true },
      { t: 'Configuration',       hk: 'F12',   act: showConfig },
    ],
    accounts: [
      { t: 'Chart of Accounts',   hk: '',      act: () => show('accounts') },
      { t: 'New Account',         hk: '',      act: () => openMasterCreate('Account') },
      { sep: true },
      { t: 'Receipt Voucher',     hk: 'F9',    act: () => openVoucher('receipt') },
      { t: 'Payment Voucher',     hk: 'F10',   act: () => openVoucher('payment') },
      { t: 'Journal Voucher',     hk: 'F8',    act: () => openVoucher('journal') },
      { t: 'Contra Voucher',      hk: '',      act: () => openVoucher('contra') },
    ],
    inventory: [
      { t: 'Items',               hk: '',      act: () => show('items') },
      { t: 'New Item',            hk: '',      act: () => openMasterCreate('Item') },
      { sep: true },
      { t: 'Stock Summary',       hk: '',      act: () => show('stock') },
    ],
    sales: [
      { t: 'Sales Invoice (new)', hk: 'F6',    act: () => openVoucher('sales') },
      { t: 'Sales Register',      hk: '',      act: () => show('sales-list') },
      { sep: true },
      { t: 'Customers',           hk: '',      act: () => show('customers') },
      { t: 'New Customer',        hk: '',      act: () => openMasterCreate('Customer') },
    ],
    purchase: [
      { t: 'Purchase Invoice (new)', hk: 'F7', act: () => openVoucher('purchase') },
      { t: 'Purchase Register',   hk: '',      act: () => show('purchase-list') },
      { sep: true },
      { t: 'Suppliers',           hk: '',      act: () => show('suppliers') },
      { t: 'New Supplier',        hk: '',      act: () => openMasterCreate('Supplier') },
    ],
    reports: [
      { t: 'Day Book',            hk: 'Ctrl+D',act: () => show('daybook') },
      { t: 'Party Ledger',        hk: 'Ctrl+L',act: () => show('partyledger') },
      { t: 'Account Ledger',      hk: '',      act: () => show('ledger') },
      { t: 'Trial Balance',       hk: 'Ctrl+T',act: () => show('trialbalance') },
      { t: 'Profit & Loss',       hk: '',      act: () => show('pnl') },
      { t: 'Balance Sheet',       hk: '',      act: () => show('balancesheet') },
    ],
    gst: [
      { t: 'GSTR-1 Summary',      hk: '',      act: () => show('gstr1') },
      { t: 'GSTR-3B Summary',     hk: '',      act: () => show('gstr3b') },
    ],
    utilities: [
      { t: 'Refresh',             hk: 'F5',    act: rerender },
      { t: 'Data Backup Info',    hk: '',      act: () => alert('Data is stored in ERPNext (Frappe Cloud). Backups are managed by the cloud provider. Contact Deepak for export.') },
    ],
    window: [
      { t: 'Welcome',             hk: '',      act: () => show('welcome') },
      { t: 'Close',               hk: 'Esc',   act: () => { closeModal(); show('welcome'); } },
    ],
    help: [
      { t: 'Keyboard Shortcuts',  hk: '',      act: () => show('welcome') },
      { t: 'About',               hk: '',      act: () => alert('Spicemore Books — Phase 1 traditional view.\nBackend: ERPNext (Frappe Cloud).\nBuilt for SMTC + SEPL.') },
    ],
  };

  function openMenu(el) {
    closeMenu();
    const name = el.dataset.menu; const items = MENUS[name] || [];
    el.classList.add('open');
    const dd = $('bdDropdown');
    dd.innerHTML = items.map((it, i) => it.sep ? '<div class="bd-sep"></div>' :
      `<div class="bd-item" data-i="${i}"><span>${escapeHtml(it.t)}</span><span class="bd-hk">${it.hk||''}</span></div>`).join('');
    const r = el.getBoundingClientRect();
    dd.style.left = r.left + 'px'; dd.style.top = r.bottom + 'px';
    dd.classList.remove('hidden');
    dd.querySelectorAll('.bd-item').forEach(n => {
      const i = Number(n.dataset.i); const it = items[i];
      n.addEventListener('click', () => { closeMenu(); if (it && it.act) it.act(); });
    });
  }
  function closeMenu() {
    document.querySelectorAll('.bd-menu.open').forEach(n => n.classList.remove('open'));
    $('bdDropdown').classList.add('hidden');
  }
  document.querySelectorAll('.bd-menu').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); openMenu(el); }));
  document.addEventListener('click', closeMenu);

  // ---- Sidebar nav ----
  document.querySelectorAll('#shell-default .bd-sidebar a[data-bd-view]').forEach(a => {
    a.addEventListener('click', (e) => { e.preventDefault(); show(a.dataset.bdView); });
  });

  // ---- Keyboard shortcuts ----
  document.addEventListener('keydown', (e) => {
    if (!document.body.classList.contains('view-default')) return;
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) {
      if (e.key === 'Escape') closeModal();
      return;
    }
    const k = e.key;
    if (k === 'F5')         { e.preventDefault(); rerender(); }
    else if (k === 'F6')    { e.preventDefault(); openVoucher('sales'); }
    else if (k === 'F7')    { e.preventDefault(); openVoucher('purchase'); }
    else if (k === 'F8')    { e.preventDefault(); openVoucher('journal'); }
    else if (k === 'F9')    { e.preventDefault(); openVoucher('receipt'); }
    else if (k === 'F10')   { e.preventDefault(); openVoucher('payment'); }
    else if (k === 'Escape'){ closeModal(); }
    else if (e.ctrlKey && k.toLowerCase() === 'd') { e.preventDefault(); show('daybook'); }
    else if (e.ctrlKey && k.toLowerCase() === 'l') { e.preventDefault(); show('partyledger'); }
    else if (e.ctrlKey && k.toLowerCase() === 't') { e.preventDefault(); show('trialbalance'); }
    else if (e.altKey) {
      const map = { c:'company', a:'accounts', i:'inventory', s:'sales', p:'purchase', r:'reports', g:'gst', u:'utilities', w:'window', h:'help' };
      const m = map[k.toLowerCase()];
      if (m) { e.preventDefault(); const el = document.querySelector(`.bd-menu[data-menu="${m}"]`); if (el) openMenu(el); }
    }
  });

  // ---- Router ----
  let currentView = 'welcome';
  const main = () => $('bdMain');
  function rerender() { show(currentView); }
  async function show(view) {
    currentView = view;
    document.querySelectorAll('#shell-default .bd-sidebar a').forEach(a => a.classList.toggle('active', a.dataset.bdView === view));
    setCount(''); setStatus('Loading…');
    if (view === 'welcome') { main().innerHTML = welcomeHtml(); setStatus('Ready.'); return; }
    main().innerHTML = '<div class="bd-loading">Loading…</div>';
    try {
      const fn = VIEWS[view];
      if (!fn) { main().innerHTML = `<div class="bd-empty">View not implemented: ${view}</div>`; return; }
      await fn();
      setStatus('Ready.');
    } catch (e) {
      console.error(e);
      main().innerHTML = `<div class="bd-empty">Error loading ${view}: ${escapeHtml(e.message)}</div>`;
      setStatus('Error');
    }
  }

  function welcomeHtml() {
    return `<div class="bd-welcome">
      <h1>Spicemore Books</h1>
      <p class="bd-sub">Traditional accounting view. Keyboard-first. Menu: <b>Alt + underlined letter</b></p>
      <table class="bd-shortcuts">
        <tr><td><kbd>F5</kbd></td><td>Refresh</td><td><kbd>F6</kbd></td><td>Sales Voucher</td></tr>
        <tr><td><kbd>F7</kbd></td><td>Purchase Voucher</td><td><kbd>F8</kbd></td><td>Journal</td></tr>
        <tr><td><kbd>F9</kbd></td><td>Receipt</td><td><kbd>F10</kbd></td><td>Payment</td></tr>
        <tr><td><kbd>Ctrl+D</kbd></td><td>Day Book</td><td><kbd>Ctrl+L</kbd></td><td>Party Ledger</td></tr>
        <tr><td><kbd>Ctrl+T</kbd></td><td>Trial Balance</td><td><kbd>Esc</kbd></td><td>Close</td></tr>
      </table>
    </div>`;
  }

  function crumb(path) { return `<div class="bd-crumb">${path}</div>`; }
  function toolbar(html) { return `<div class="bd-toolbar">${html}</div>`; }

  function gridHtml(cols, rows, opts = {}) {
    if (!rows || !rows.length) return `<div class="bd-empty">${opts.empty || 'No records.'}</div>`;
    const head = cols.map(c => `<th${c.num ? ' class="num"' : ''}>${escapeHtml(c.label)}</th>`).join('');
    const body = rows.map((r, i) => '<tr data-i="'+i+'">' + cols.map(c => {
      const v = typeof c.val === 'function' ? c.val(r) : r[c.key];
      return `<td${c.num ? ' class="num"' : ''}>${c.num ? fmtN(v) : (v == null ? '' : escapeHtml(v))}</td>`;
    }).join('') + '</tr>').join('');
    let totalsRow = '';
    if (opts.totals) totalsRow = '<tr class="bd-totals">' + cols.map(c => {
      const v = opts.totals[c.key];
      return `<td${c.num ? ' class="num"' : ''}>${v == null ? '' : (c.num ? fmtN(v) : escapeHtml(v))}</td>`;
    }).join('') + '</tr>';
    return `<table class="bd-grid"><thead><tr>${head}</tr></thead><tbody>${body}${totalsRow}</tbody></table>`;
  }

  function attachRowClick(rows, handler) {
    main().querySelectorAll('.bd-grid tbody tr[data-i]').forEach(tr => {
      tr.addEventListener('click', () => handler(rows[Number(tr.dataset.i)]));
    });
  }

  // ======== VIEWS ========
  const VIEWS = {
    // Masters
    async customers() {
      const r = await api.list('Customer', { fields: ['name','customer_name','customer_group','territory','mobile_no'], limit: 500, order_by: 'creation desc' });
      main().innerHTML = crumb('<b>Masters</b> › Customers') +
        toolbar(`<button class="bd-btn primary" id="bdNew">+ New Customer</button> <input id="bdSearch" placeholder="Filter…" style="margin-left:auto">`) +
        `<div id="bdBody">${gridHtml([
          { key:'name', label:'Code' }, { key:'customer_name', label:'Name' },
          { key:'customer_group', label:'Group' }, { key:'territory', label:'Territory' }, { key:'mobile_no', label:'Mobile' },
        ], r.data)}</div>`;
      setCount(`${r.data.length} customers`);
      $('bdNew').addEventListener('click', () => openMasterCreate('Customer'));
      $('bdSearch').addEventListener('input', () => filterRows('bdSearch'));
      attachRowClick(r.data, row => openDetail('Customer', row.name));
    },
    async suppliers() {
      const r = await api.list('Supplier', { fields: ['name','supplier_name','supplier_group','mobile_no'], limit: 500, order_by: 'creation desc' });
      main().innerHTML = crumb('<b>Masters</b> › Suppliers') +
        toolbar(`<button class="bd-btn primary" id="bdNew">+ New Supplier</button> <input id="bdSearch" placeholder="Filter…" style="margin-left:auto">`) +
        `<div id="bdBody">${gridHtml([
          { key:'name', label:'Code' }, { key:'supplier_name', label:'Name' },
          { key:'supplier_group', label:'Group' }, { key:'mobile_no', label:'Mobile' },
        ], r.data)}</div>`;
      setCount(`${r.data.length} suppliers`);
      $('bdNew').addEventListener('click', () => openMasterCreate('Supplier'));
      $('bdSearch').addEventListener('input', () => filterRows('bdSearch'));
      attachRowClick(r.data, row => openDetail('Supplier', row.name));
    },
    async items() {
      const r = await api.list('Item', { fields: ['item_code','item_name','item_group','stock_uom','standard_rate'], limit: 500 });
      main().innerHTML = crumb('<b>Inventory</b> › Items') +
        toolbar(`<button class="bd-btn primary" id="bdNew">+ New Item</button> <input id="bdSearch" placeholder="Filter…" style="margin-left:auto">`) +
        `<div id="bdBody">${gridHtml([
          { key:'item_code', label:'Code' }, { key:'item_name', label:'Name' },
          { key:'item_group', label:'Group' }, { key:'stock_uom', label:'UoM' }, { key:'standard_rate', label:'Rate', num:true },
        ], r.data)}</div>`;
      setCount(`${r.data.length} items`);
      $('bdNew').addEventListener('click', () => openMasterCreate('Item'));
      $('bdSearch').addEventListener('input', () => filterRows('bdSearch'));
      attachRowClick(r.data, row => openDetail('Item', row.item_code));
    },
    async accounts() {
      const r = await api.list('Account', { fields: ['name','account_name','root_type','account_type','is_group','parent_account'], filters: [['company','=',state.company]], limit: 800, order_by: 'lft asc' });
      main().innerHTML = crumb('<b>Accounts</b> › Chart of Accounts') +
        toolbar(`<button class="bd-btn primary" id="bdNew">+ New Account</button> <input id="bdSearch" placeholder="Filter…" style="margin-left:auto">`) +
        `<div id="bdBody">${gridHtml([
          { key:'name', label:'Account' }, { key:'root_type', label:'Root' },
          { key:'account_type', label:'Type' }, { key:'is_group', label:'Group?', val: r => r.is_group ? 'Y' : '' },
        ], r.data)}</div>`;
      setCount(`${r.data.length} accounts`);
      $('bdNew').addEventListener('click', () => openMasterCreate('Account'));
      $('bdSearch').addEventListener('input', () => filterRows('bdSearch'));
      attachRowClick(r.data, row => openDetail('Account', row.name));
    },

    // Transaction lists
    async 'sales-list'()    { await docList('Sales Invoice',    ['name','posting_date','customer','grand_total','status'],           'posting_date desc'); },
    async 'purchase-list'() { await docList('Purchase Invoice', ['name','posting_date','supplier','grand_total','status'],           'posting_date desc'); },
    async 'receipt-list'()  { await docList('Payment Entry',    ['name','posting_date','party','paid_amount','payment_type'],        'posting_date desc', [['payment_type','=','Receive']]); },
    async 'payment-list'()  { await docList('Payment Entry',    ['name','posting_date','party','paid_amount','payment_type'],        'posting_date desc', [['payment_type','=','Pay']]); },
    async 'journal-list'()  { await docList('Journal Entry',    ['name','posting_date','voucher_type','total_debit'],                'posting_date desc'); },

    // Reports
    async daybook()       { await viewDayBook(); },
    async partyledger()   { await viewPartyLedger(); },
    async ledger()        { await viewAccountLedger(); },
    async trialbalance()  { await viewReport('Trial Balance'); },
    async pnl()           { await viewReport('Profit and Loss Statement'); },
    async balancesheet()  { await viewReport('Balance Sheet'); },
    async gstr1()         { await viewGSTR('GSTR-1'); },
    async gstr3b()        { await viewGSTR('GSTR-3B'); },
    async stock()         { await viewReport('Stock Balance'); },
  };

  function filterRows(searchId) {
    const q = $(searchId).value.toLowerCase();
    document.querySelectorAll('#bdBody .bd-grid tbody tr').forEach(tr => {
      tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  }

  async function docList(doctype, fields, order_by, extra = []) {
    const filters = [['company','=',state.company], ...extra];
    const r = await api.list(doctype, { fields, limit: 500, order_by, filters });
    const cols = fields.map(f => ({ key: f, label: labelize(f), num: /amount|total|debit|credit/.test(f) }));
    main().innerHTML = crumb(`<b>${doctype}</b>`) +
      toolbar(`<input id="bdSearch" placeholder="Filter…" style="margin-left:auto">`) +
      `<div id="bdBody">${gridHtml(cols, r.data)}</div>`;
    setCount(`${r.data.length} ${doctype}s`);
    $('bdSearch').addEventListener('input', () => filterRows('bdSearch'));
    attachRowClick(r.data, row => openDetail(doctype, row.name));
  }

  // ---- Day Book ----
  async function viewDayBook() {
    const today = todayISO(); const thirty = new Date(Date.now() - 30*86400000).toISOString().slice(0,10);
    main().innerHTML = toolbar(`From <input type="date" id="bdFrom" value="${thirty}"> To <input type="date" id="bdTo" value="${today}"> <button class="bd-btn" id="bdGo">Show</button>`) +
      '<div id="bdBody" class="bd-loading">Loading…</div>';
    async function load() {
      const from = $('bdFrom').value, to = $('bdTo').value;
      const common = { limit: 2000, filters: [['company','=',state.company],['posting_date','between',[from,to]]], order_by: 'posting_date desc' };
      const [si, pi, pe, je] = await Promise.all([
        api.list('Sales Invoice',    { ...common, fields: ['name','posting_date','customer','grand_total'] }),
        api.list('Purchase Invoice', { ...common, fields: ['name','posting_date','supplier','grand_total'] }),
        api.list('Payment Entry',    { ...common, fields: ['name','posting_date','party','payment_type','paid_amount'] }),
        api.list('Journal Entry',    { ...common, fields: ['name','posting_date','voucher_type','total_debit'] }),
      ]);
      const rows = [
        ...si.data.map(r => ({ _dt:'Sales Invoice',    date:r.posting_date, type:'Sales Inv', vch:r.name, party:r.customer, dr:r.grand_total, cr:0 })),
        ...pi.data.map(r => ({ _dt:'Purchase Invoice', date:r.posting_date, type:'Purchase',  vch:r.name, party:r.supplier, dr:0, cr:r.grand_total })),
        ...pe.data.map(r => ({ _dt:'Payment Entry',    date:r.posting_date, type:r.payment_type==='Receive'?'Receipt':'Payment', vch:r.name, party:r.party, dr:r.payment_type==='Receive'?r.paid_amount:0, cr:r.payment_type==='Pay'?r.paid_amount:0 })),
        ...je.data.map(r => ({ _dt:'Journal Entry',    date:r.posting_date, type:r.voucher_type||'Journal', vch:r.name, party:'', dr:r.total_debit, cr:r.total_debit })),
      ].sort((a,b) => (b.date||'').localeCompare(a.date||''));
      const totals = { dr: rows.reduce((s,r)=>s+(+r.dr||0),0), cr: rows.reduce((s,r)=>s+(+r.cr||0),0), vch: `${rows.length} entries` };
      $('bdBody').innerHTML = gridHtml([
        { key:'date', label:'Date' }, { key:'type', label:'Type' }, { key:'vch', label:'Voucher' },
        { key:'party', label:'Party' }, { key:'dr', label:'Debit', num:true }, { key:'cr', label:'Credit', num:true },
      ], rows, { empty:'No vouchers in range.', totals });
      setCount(`${rows.length} entries`);
      attachRowClick(rows, row => openDetail(row._dt, row.vch));
    }
    $('bdGo').addEventListener('click', load);
    load();
  }

  // ---- Party Ledger ----
  async function viewPartyLedger() {
    main().innerHTML = toolbar(`Party: <input id="bdParty" list="bdPartyList" placeholder="Start typing…" style="min-width:280px"> <datalist id="bdPartyList"></datalist> <button class="bd-btn" id="bdPGo">Show</button>`) +
      '<div id="bdBody" class="bd-empty">Pick a party and click Show.</div>';
    const [c, s] = await Promise.all([
      api.list('Customer', { fields:['name'], limit:3000 }),
      api.list('Supplier', { fields:['name'], limit:3000 }),
    ]);
    $('bdPartyList').innerHTML = [...c.data, ...s.data].map(p => `<option value="${escapeHtml(p.name)}">`).join('');
    $('bdPGo').addEventListener('click', async () => {
      const p = $('bdParty').value.trim(); if (!p) return;
      $('bdBody').innerHTML = '<div class="bd-loading">Loading…</div>';
      const [si, pi, pe] = await Promise.all([
        api.list('Sales Invoice',    { fields:['name','posting_date','grand_total'],         filters:[['company','=',state.company],['customer','=',p]], limit:3000, order_by:'posting_date asc' }),
        api.list('Purchase Invoice', { fields:['name','posting_date','grand_total'],         filters:[['company','=',state.company],['supplier','=',p]], limit:3000, order_by:'posting_date asc' }),
        api.list('Payment Entry',    { fields:['name','posting_date','payment_type','paid_amount'], filters:[['company','=',state.company],['party','=',p]], limit:3000, order_by:'posting_date asc' }),
      ]);
      const rows = [
        ...si.data.map(r => ({ _dt:'Sales Invoice',    date:r.posting_date, type:'Sales Inv', vch:r.name, dr:r.grand_total, cr:0 })),
        ...pi.data.map(r => ({ _dt:'Purchase Invoice', date:r.posting_date, type:'Purchase',  vch:r.name, dr:0, cr:r.grand_total })),
        ...pe.data.map(r => ({ _dt:'Payment Entry',    date:r.posting_date, type:r.payment_type==='Receive'?'Receipt':'Payment', vch:r.name, dr:r.payment_type==='Pay'?r.paid_amount:0, cr:r.payment_type==='Receive'?r.paid_amount:0 })),
      ].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
      let bal = 0; rows.forEach(r => { bal += (+r.dr||0) - (+r.cr||0); r.bal = bal; });
      const totals = { dr: rows.reduce((s,r)=>s+(+r.dr||0),0), cr: rows.reduce((s,r)=>s+(+r.cr||0),0), bal };
      $('bdBody').innerHTML = crumb(`<b>Party Ledger</b> › ${escapeHtml(p)}`) + gridHtml([
        {key:'date',label:'Date'},{key:'type',label:'Type'},{key:'vch',label:'Voucher'},
        {key:'dr',label:'Debit',num:true},{key:'cr',label:'Credit',num:true},{key:'bal',label:'Balance',num:true},
      ], rows, { empty:'No transactions.', totals });
      setCount(`${rows.length} rows · Bal ${fmtN(bal)}`);
      attachRowClick(rows, row => openDetail(row._dt, row.vch));
    });
  }

  // ---- Account Ledger ----
  async function viewAccountLedger() {
    main().innerHTML = toolbar(`Account: <input id="bdAcct" list="bdAcctList" style="min-width:340px" placeholder="Account name…"> <datalist id="bdAcctList"></datalist> <button class="bd-btn" id="bdAGo">Show</button>`) +
      '<div id="bdBody" class="bd-empty">Pick an account.</div>';
    const a = await api.list('Account', { fields:['name'], filters:[['company','=',state.company],['is_group','=',0]], limit: 3000 });
    $('bdAcctList').innerHTML = a.data.map(x => `<option value="${escapeHtml(x.name)}">`).join('');
    $('bdAGo').addEventListener('click', async () => {
      const acct = $('bdAcct').value.trim(); if (!acct) return;
      $('bdBody').innerHTML = '<div class="bd-loading">Loading…</div>';
      const r = await api.list('GL Entry', { fields:['posting_date','voucher_type','voucher_no','debit','credit','against'], filters:[['company','=',state.company],['account','=',acct]], limit:3000, order_by:'posting_date asc' });
      let bal = 0; r.data.forEach(x => { bal += (+x.debit||0) - (+x.credit||0); x.bal = bal; });
      const totals = { debit: r.data.reduce((s,x)=>s+(+x.debit||0),0), credit: r.data.reduce((s,x)=>s+(+x.credit||0),0), bal };
      $('bdBody').innerHTML = crumb(`<b>Account Ledger</b> › ${escapeHtml(acct)}`) + gridHtml([
        {key:'posting_date',label:'Date'},{key:'voucher_type',label:'Type'},{key:'voucher_no',label:'Voucher'},
        {key:'against',label:'Against'},{key:'debit',label:'Debit',num:true},{key:'credit',label:'Credit',num:true},{key:'bal',label:'Balance',num:true},
      ], r.data, { empty:'No entries.', totals });
      setCount(`${r.data.length} entries`);
      attachRowClick(r.data, row => openDetail(row.voucher_type, row.voucher_no));
    });
  }

  // ---- Reports via Frappe query_report.run ----
  async function viewReport(reportName) {
    const fy = '2025-2026';
    const filters = { company: state.company, from_date: `${fy.split('-')[0]}-04-01`, to_date: `${fy.split('-')[1]}-03-31`,
                      fiscal_year: fy, periodicity: 'Yearly', filter_based_on: 'Fiscal Year',
                      period_start_date: `${fy.split('-')[0]}-04-01`, period_end_date: `${fy.split('-')[1]}-03-31`,
                      presentation_currency: 'INR', period: 'Yearly' };
    try {
      const r = await api.call('method/frappe.desk.query_report.run', { query: { report_name: reportName, filters: JSON.stringify(filters) } });
      main().innerHTML = crumb(`<b>${escapeHtml(reportName)}</b> · ${fy}`) + renderReportTable(r?.message?.columns || [], r?.message?.result || []);
    } catch (e) {
      main().innerHTML = `<div class="bd-empty">${escapeHtml(reportName)} unavailable: ${escapeHtml(e.message)}</div>`;
    }
  }
  function renderReportTable(cols, rows) {
    if (!rows || !rows.length) return '<div class="bd-empty">No data.</div>';
    const cs = cols.map(c => typeof c === 'string' ? { label: c, fieldname: c } : c);
    const head = cs.map(c => `<th class="${/currency|float|int/i.test(c.fieldtype||'')?'num':''}">${escapeHtml(c.label || c.fieldname)}</th>`).join('');
    const body = rows.map(r => '<tr>' + cs.map((c, i) => {
      const v = Array.isArray(r) ? r[i] : r[c.fieldname];
      const isNum = /currency|float|int/i.test(c.fieldtype||'');
      return `<td class="${isNum?'num':''}">${isNum ? fmtN(v) : escapeHtml(v ?? '')}</td>`;
    }).join('') + '</tr>').join('');
    return `<table class="bd-grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  // ---- GSTR ----
  async function viewGSTR(name) {
    const now = new Date(); const yyyymm = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    main().innerHTML = toolbar(`Month: <input type="month" id="bdMonth" value="${yyyymm}"> <button class="bd-btn" id="bdGGo">Show</button>`) +
      '<div id="bdBody" class="bd-empty">Pick a month.</div>';
    async function go() {
      const m = $('bdMonth').value; const from = `${m}-01`;
      const toDate = new Date(Number(m.split('-')[0]), Number(m.split('-')[1]), 0).toISOString().slice(0,10);
      $('bdBody').innerHTML = '<div class="bd-loading">Loading…</div>';
      const si = await api.list('Sales Invoice', { fields:['name','posting_date','customer','grand_total','total_taxes_and_charges','net_total'], filters:[['company','=',state.company],['posting_date','between',[from,toDate]]], limit: 3000 });
      const tax = si.data.reduce((s,r)=>s+(+r.total_taxes_and_charges||0),0);
      const net = si.data.reduce((s,r)=>s+(+r.net_total||0),0);
      const gross = si.data.reduce((s,r)=>s+(+r.grand_total||0),0);
      $('bdBody').innerHTML = crumb(`<b>${name}</b> · ${m}`) +
        `<table class="bd-grid" style="max-width:560px">
          <tr><th>Metric</th><th class="num">Amount (₹)</th></tr>
          <tr><td>Taxable value</td><td class="num">${fmtN(net)}</td></tr>
          <tr><td>Total tax</td><td class="num">${fmtN(tax)}</td></tr>
          <tr class="bd-totals"><td>Invoice value</td><td class="num">${fmtN(gross)}</td></tr>
          <tr><td>Invoices</td><td class="num">${si.data.length}</td></tr>
        </table>`;
      setCount(`${si.data.length} invoices`);
    }
    $('bdGGo').addEventListener('click', go); go();
  }

  // ================= CRUD on any doc =================
  async function openDetail(doctype, name) {
    try {
      const r = await api.get(doctype, name);
      const d = r.data;
      const readonly = (d.docstatus === 1 || d.docstatus === 2);
      const statusTxt = ['Draft','Submitted','Cancelled'][d.docstatus] || '';
      const buttons = [];
      if (d.docstatus === 0) buttons.push('<button class="bd-btn" id="bdEdit">Edit</button>');
      if (d.docstatus === 1) buttons.push('<button class="bd-btn" id="bdCancel">Cancel Voucher</button>');
      if (d.docstatus !== 1) buttons.push('<button class="bd-btn" id="bdDelete" style="color:#a00">Delete</button>');
      openModal(
        `${escapeHtml(doctype)} — ${escapeHtml(name)} <span style="font-weight:400">(${statusTxt})</span>`,
        renderDocDetail(d),
        `${buttons.join(' ')} <button class="bd-btn primary" id="bdCloseBtn" style="margin-left:8px">Close</button>`
      );
      $('bdCloseBtn').addEventListener('click', closeModal);
      if ($('bdEdit'))   $('bdEdit').addEventListener('click',   () => openEdit(doctype, d));
      if ($('bdCancel')) $('bdCancel').addEventListener('click', () => cancelDoc(doctype, name));
      if ($('bdDelete')) $('bdDelete').addEventListener('click', () => deleteDoc(doctype, name));
    } catch (e) {
      toast('Error: ' + e.message);
    }
  }

  function renderDocDetail(d) {
    const skip = new Set(['idx','docstatus','doctype','owner','creation','modified','modified_by','lft','rgt','naming_series','_user_tags','_comments','_assign','_liked_by']);
    const rows = Object.entries(d).filter(([k,v]) => !skip.has(k) && v !== null && v !== undefined && v !== '' && !Array.isArray(v) && typeof v !== 'object')
      .map(([k,v]) => `<div class="bd-form-row"><label>${escapeHtml(labelize(k))}</label><div>${escapeHtml(String(v))}</div></div>`);
    const children = Object.entries(d).filter(([k,v]) => Array.isArray(v) && v.length && typeof v[0] === 'object');
    const childHtml = children.map(([k, arr]) => {
      const cols = Object.keys(arr[0]).filter(c => !/^(parent|parentfield|parenttype|doctype|name|owner|creation|modified|modified_by|idx|docstatus)$/.test(c));
      const head = cols.map(c => `<th>${escapeHtml(labelize(c))}</th>`).join('');
      const body = arr.map(row => '<tr>' + cols.map(c => `<td>${escapeHtml(row[c] ?? '')}</td>`).join('') + '</tr>').join('');
      return `<h4 style="margin:14px 0 4px">${escapeHtml(labelize(k))}</h4><table class="bd-grid">${head?'<thead><tr>'+head+'</tr></thead>':''}<tbody>${body}</tbody></table>`;
    }).join('');
    return rows.join('') + childHtml;
  }

  async function cancelDoc(doctype, name) {
    if (!confirm(`Cancel ${doctype} ${name}?  This submits docstatus=2 (cannot be undone).`)) return;
    try { await api.cancel(doctype, name); toast('Cancelled.'); closeModal(); rerender(); }
    catch (e) { toast('Error: ' + e.message); }
  }
  async function deleteDoc(doctype, name) {
    if (!confirm(`Permanently delete ${doctype} ${name}?`)) return;
    try { await api.del(doctype, name); toast('Deleted.'); closeModal(); rerender(); }
    catch (e) { toast('Error: ' + e.message); }
  }

  // ---- Edit (only simple text/number fields on draft docs) ----
  function openEdit(doctype, d) {
    const editable = ['customer_name','supplier_name','item_name','item_group','mobile_no','customer_group','supplier_group','territory',
                      'posting_date','due_date','grand_total','remarks','party','paid_amount','reference_no'];
    const fields = editable.filter(f => d[f] !== undefined);
    const body = fields.map(f => `
      <div class="bd-form-row"><label>${escapeHtml(labelize(f))}</label>
        <input id="e_${f}" value="${escapeHtml(d[f] ?? '')}" ${/date/.test(f)?'type="date"':(/amount|total/.test(f)?'type="number" step="0.01"':'')}>
      </div>`).join('');
    openModal(`Edit ${escapeHtml(doctype)} — ${escapeHtml(d.name)}`, body,
      `<button class="bd-btn primary" id="bdSaveEdit">Save</button> <button class="bd-btn" id="bdCancelEdit">Cancel</button>`);
    $('bdCancelEdit').addEventListener('click', closeModal);
    $('bdSaveEdit').addEventListener('click', async () => {
      const patch = {};
      for (const f of fields) { const v = $('e_'+f).value; if (v !== String(d[f] ?? '')) patch[f] = v; }
      if (!Object.keys(patch).length) { toast('No changes.'); return; }
      try { await api.update(doctype, d.name, patch); toast('Saved.'); closeModal(); rerender(); }
      catch (e) { toast('Error: ' + e.message); }
    });
  }

  // ================= Master Creation =================
  function openMasterCreate(type) {
    const configs = {
      Customer: { fields: [
          { k:'customer_name', l:'Name', req:true },
          { k:'customer_group', l:'Group', default:'Spicemore - Trader' },
          { k:'territory', l:'Territory', default:'India' },
          { k:'mobile_no', l:'Mobile' },
          { k:'email_id', l:'Email' },
          { k:'tax_id', l:'GSTIN' },
        ]},
      Supplier: { fields: [
          { k:'supplier_name', l:'Name', req:true },
          { k:'supplier_group', l:'Group', default:'Local' },
          { k:'supplier_type', l:'Type', default:'Company' },
          { k:'mobile_no', l:'Mobile' },
          { k:'email_id', l:'Email' },
          { k:'tax_id', l:'GSTIN' },
        ]},
      Item: { fields: [
          { k:'item_code', l:'Code', req:true },
          { k:'item_name', l:'Name', req:true },
          { k:'item_group', l:'Group', default:'All Item Groups' },
          { k:'stock_uom', l:'UoM', default:'Nos' },
          { k:'is_stock_item', l:'Stock Item (1/0)', default:'1' },
          { k:'standard_rate', l:'Rate', type:'number' },
        ]},
      Account: { fields: [
          { k:'account_name', l:'Name', req:true },
          { k:'parent_account', l:'Parent Account', req:true, placeholder:'e.g. Indirect Expenses - '+abbr() },
          { k:'account_type', l:'Account Type' },
          { k:'root_type', l:'Root', placeholder:'Asset/Liability/Income/Expense/Equity' },
          { k:'is_group', l:'Is Group (1/0)', default:'0' },
        ]},
    };
    const cfg = configs[type];
    const body = cfg.fields.map(f => `
      <div class="bd-form-row"><label>${escapeHtml(f.l)}${f.req?' *':''}</label>
        <input id="m_${f.k}" ${f.type==='number'?'type="number" step="0.01"':''}
               value="${escapeHtml(f.default ?? '')}" placeholder="${escapeHtml(f.placeholder||'')}"></div>`).join('');
    openModal(`New ${type}`, body,
      `<button class="bd-btn primary" id="bdSaveNew">Save</button> <button class="bd-btn" id="bdCancelNew">Cancel</button>`);
    $('bdCancelNew').addEventListener('click', closeModal);
    $('bdSaveNew').addEventListener('click', async () => {
      const doc = {};
      for (const f of cfg.fields) {
        const v = $('m_'+f.k).value.trim();
        if (f.req && !v) { toast(`${f.l} is required`); return; }
        if (v) doc[f.k] = f.type === 'number' ? parseFloat(v) : v;
      }
      if (type === 'Account') doc.company = state.company;
      try { const r = await api.create(type, doc); toast(`${type} saved: ${r.data?.name||''}`); closeModal(); rerender(); }
      catch (e) { toast('Error: ' + e.message); }
    });
  }

  // ================= Voucher Entry =================
  function openVoucher(type) {
    const today = todayISO();
    const party = (type==='sales'||type==='receipt') ? 'Customer' : (type==='purchase'||type==='payment') ? 'Supplier' : '';
    const partyRow = party ? `<div class="bd-form-row"><label>${party}</label><input id="bdPartyF" list="bdPartyFList" required><datalist id="bdPartyFList"></datalist></div>` : '';
    const refRow = (type==='sales'||type==='purchase') ? `<div class="bd-form-row"><label>Bill No.</label><input id="bdBill" required></div>` : '';

    let fields = `<div class="bd-form-row"><label>Date</label><input type="date" id="bdD" value="${today}"></div>${refRow}${partyRow}`;

    if (type==='sales' || type==='purchase') {
      fields += `
        <div class="bd-form-row"><label>Taxable Amt (₹)</label><input type="number" step="0.01" id="bdA" required></div>
        <div class="bd-form-row"><label>IGST</label><input type="number" step="0.01" id="bdI" value="0"></div>
        <div class="bd-form-row"><label>CGST</label><input type="number" step="0.01" id="bdC" value="0"></div>
        <div class="bd-form-row"><label>SGST</label><input type="number" step="0.01" id="bdS" value="0"></div>`;
    } else if (type==='receipt' || type==='payment') {
      fields += `
        <div class="bd-form-row"><label>Amount (₹)</label><input type="number" step="0.01" id="bdA" required></div>
        <div class="bd-form-row"><label>${type==='receipt'?'Paid To':'Paid From'} (Bank/Cash)</label><input id="bdBank" list="bdBankList" required><datalist id="bdBankList"></datalist></div>
        <div class="bd-form-row"><label>Reference No.</label><input id="bdRef"></div>`;
    } else if (type==='journal' || type==='contra') {
      fields += `
        <div class="bd-form-row"><label>Cheque/Ref No.</label><input id="bdRef"></div>
        <div style="margin-top:10px"><b>Accounts</b> <button class="bd-btn" id="bdAddRow" type="button">+ Row</button></div>
        <table class="bd-grid" id="bdJV" style="margin-top:6px">
          <thead><tr><th>Account</th><th>Debit (₹)</th><th>Credit (₹)</th><th></th></tr></thead>
          <tbody></tbody>
        </table>
        <datalist id="bdJVAcctList"></datalist>`;
    }
    fields += `<div class="bd-form-row"><label>Remarks</label><textarea id="bdRem" rows="2"></textarea></div>`;

    openModal(`New ${labelize(type)} Voucher`, `<form id="bdForm">${fields}</form>`,
      `<button class="bd-btn" id="bdCancelV" type="button">Cancel</button> <button class="bd-btn primary" id="bdSaveV" type="button">Save</button>`);

    $('bdCancelV').addEventListener('click', closeModal);
    $('bdSaveV').addEventListener('click', () => saveVoucher(type));

    populateVoucherLists(type);

    if (type==='journal' || type==='contra') {
      const addRow = () => {
        const tb = document.querySelector('#bdJV tbody');
        const tr = document.createElement('tr');
        tr.innerHTML = `<td><input class="bdJV-acct" list="bdJVAcctList" style="width:100%"></td>
                        <td><input type="number" step="0.01" class="bdJV-dr num" style="width:100%"></td>
                        <td><input type="number" step="0.01" class="bdJV-cr num" style="width:100%"></td>
                        <td><button type="button" class="bd-btn bdJV-rm">×</button></td>`;
        tb.appendChild(tr);
        tr.querySelector('.bdJV-rm').addEventListener('click', () => tr.remove());
      };
      $('bdAddRow').addEventListener('click', addRow);
      addRow(); addRow();
    }
  }

  async function populateVoucherLists(type) {
    if (type==='sales' || type==='receipt') {
      const r = await api.list('Customer', { fields:['name'], limit: 3000 });
      $('bdPartyFList').innerHTML = r.data.map(x=>`<option value="${escapeHtml(x.name)}">`).join('');
    } else if (type==='purchase' || type==='payment') {
      const r = await api.list('Supplier', { fields:['name'], limit: 3000 });
      $('bdPartyFList').innerHTML = r.data.map(x=>`<option value="${escapeHtml(x.name)}">`).join('');
    }
    if (type==='receipt' || type==='payment') {
      const r = await api.list('Account', { fields:['name'], filters:[['company','=',state.company],['account_type','in',['Bank','Cash']]], limit: 500 });
      $('bdBankList').innerHTML = r.data.map(x=>`<option value="${escapeHtml(x.name)}">`).join('');
    }
    if (type==='journal' || type==='contra') {
      const r = await api.list('Account', { fields:['name'], filters:[['company','=',state.company],['is_group','=',0]], limit: 3000 });
      $('bdJVAcctList').innerHTML = r.data.map(x=>`<option value="${escapeHtml(x.name)}">`).join('');
    }
  }

  async function saveVoucher(type) {
    try {
      const date = $('bdD').value;
      const remarks = $('bdRem').value;
      const ab = abbr();

      if (type==='sales' || type==='purchase') {
        const party = $('bdPartyF').value.trim();
        const bill = $('bdBill').value.trim();
        const amt = parseFloat($('bdA').value || '0');
        const igst = +$('bdI').value || 0, cgst = +$('bdC').value || 0, sgst = +$('bdS').value || 0;
        const t = type==='sales' ? 'Output' : 'Input';
        const taxes = [];
        if (igst) taxes.push({ charge_type:'Actual', account_head:`${t} IGST - ${ab}`, description:'IGST', tax_amount: igst });
        if (cgst) taxes.push({ charge_type:'Actual', account_head:`${t} CGST - ${ab}`, description:'CGST', tax_amount: cgst });
        if (sgst) taxes.push({ charge_type:'Actual', account_head:`${t} SGST - ${ab}`, description:'SGST', tax_amount: sgst });
        const doc = {
          company: state.company, posting_date: date, due_date: date, set_posting_time: 1, update_stock: 0,
          remarks, taxes, docstatus: 1,
          items: [{ item_code:'MIGRATION-AGG', item_name: `${labelize(type)} ${bill}`, qty: 1, rate: amt,
            [type==='sales'?'income_account':'expense_account']: type==='sales' ? `Sales - ${ab}` : `Cost of Goods Sold - ${ab}`,
            cost_center: `Main - ${ab}` }],
        };
        if (type==='sales')    { doc.customer = party; doc.po_no = bill;  await api.create('Sales Invoice', doc); }
        else                   { doc.supplier = party; doc.bill_no = bill; doc.bill_date = date; await api.create('Purchase Invoice', doc); }
      } else if (type==='receipt' || type==='payment') {
        const party = $('bdPartyF').value.trim();
        const bank = $('bdBank').value.trim();
        const ref = $('bdRef').value.trim();
        const amt = parseFloat($('bdA').value || '0');
        const doc = {
          payment_type: type==='receipt' ? 'Receive' : 'Pay',
          company: state.company, posting_date: date,
          party_type: type==='receipt' ? 'Customer' : 'Supplier', party,
          paid_from: type==='receipt' ? `Debtors - ${ab}` : bank,
          paid_to:   type==='receipt' ? bank : `Creditors - ${ab}`,
          paid_amount: amt, received_amount: amt,
          reference_no: ref || undefined, reference_date: date,
          remarks, docstatus: 1,
        };
        await api.create('Payment Entry', doc);
      } else if (type==='journal' || type==='contra') {
        const ref = $('bdRef').value.trim();
        const rows = Array.from(document.querySelectorAll('#bdJV tbody tr')).map(tr => ({
          account: tr.querySelector('.bdJV-acct').value.trim(),
          debit_in_account_currency:  parseFloat(tr.querySelector('.bdJV-dr').value || '0'),
          credit_in_account_currency: parseFloat(tr.querySelector('.bdJV-cr').value || '0'),
        })).filter(r => r.account && (r.debit_in_account_currency || r.credit_in_account_currency));
        if (rows.length < 2) { toast('At least 2 lines required'); return; }
        const totalDr = rows.reduce((s,r)=>s+r.debit_in_account_currency,0);
        const totalCr = rows.reduce((s,r)=>s+r.credit_in_account_currency,0);
        if (Math.abs(totalDr-totalCr) > 0.01) { toast(`Debit ${fmtN(totalDr)} ≠ Credit ${fmtN(totalCr)}`); return; }
        const doc = {
          voucher_type: type==='contra' ? 'Contra Entry' : 'Journal Entry',
          company: state.company, posting_date: date,
          cheque_no: ref || undefined, cheque_date: ref ? date : undefined,
          user_remark: remarks, accounts: rows, docstatus: 1,
        };
        await api.create('Journal Entry', doc);
      }
      closeModal();
      toast(`${labelize(type)} saved.`);
      if (/list$|daybook|ledger/.test(currentView)) rerender();
    } catch (e) {
      toast('Error: ' + e.message);
    }
  }

  // ---- Misc menu actions ----
  async function showFYInfo() {
    try {
      const r = await api.list('Fiscal Year', { fields:['name','year_start_date','year_end_date'], limit:10, order_by:'year_start_date desc' });
      const rows = r.data.map(f => `<tr><td>${escapeHtml(f.name)}</td><td>${escapeHtml(f.year_start_date)}</td><td>${escapeHtml(f.year_end_date)}</td></tr>`).join('');
      openModal('Financial Years', `<table class="bd-grid"><thead><tr><th>Year</th><th>Start</th><th>End</th></tr></thead><tbody>${rows}</tbody></table>`,
        `<button class="bd-btn primary" id="bdCloseBtn">Close</button>`);
      $('bdCloseBtn').addEventListener('click', closeModal);
    } catch (e) { toast('Error: ' + e.message); }
  }
  function showConfig() {
    openModal('Configuration', `
      <div class="bd-form-row"><label>Active Company</label><div>${escapeHtml(state.company)}</div></div>
      <div class="bd-form-row"><label>Company Code</label><div>${abbr()}</div></div>
      <div class="bd-form-row"><label>Backend</label><div>ERPNext (Frappe Cloud)</div></div>
      <div class="bd-form-row"><label>API Proxy</label><div>/api/erp</div></div>
      <div class="bd-form-row"><label>View Storage</label><div>localStorage (bdShell, bdCompany)</div></div>`,
      `<button class="bd-btn primary" id="bdCloseBtn">Close</button>`);
    $('bdCloseBtn').addEventListener('click', closeModal);
  }

  // ---- Init ----
  function init() { show('welcome'); }
  window.bdInit = init;
})();
