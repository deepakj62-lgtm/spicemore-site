// Spicemore OS — extended views.
// Auction, procurement, stock, finance, export, compliance, payroll — every
// feature a cardamom/pepper auction house in Kerala could plausibly need.
// Each view is defensive: where ERPNext custom doctypes don't exist yet, the
// view shows a clear "not-yet-configured" card instead of crashing.

(function () {
  const E = (tag, attrs = {}, ...kids) => {
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
  };
  const fmt = (n) => (n === null || n === undefined || n === '') ? '' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const fmtCr = (n) => {
    const v = Number(n) || 0;
    if (Math.abs(v) >= 1e7) return `₹${(v/1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 })} cr`;
    if (Math.abs(v) >= 1e5) return `₹${(v/1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 })} L`;
    return `₹${fmt(v)}`;
  };
  const today = () => new Date().toISOString().slice(0, 10);
  const V = window.Views;

  const notConfigured = (label, hint) => E('div', { class: 'card', style: { background: '#fde9cc', borderLeft: '4px solid var(--warn)' } },
    E('strong', {}, '⚠ ' + label + ' not yet configured. '),
    hint || 'This module ships as a stub; the custom doctype or workflow needs to be provisioned in ERPNext. The UI is wired — once the doctype exists, data flows in automatically.'
  );

  // ============================================================
  // AUCTION MODULE
  // ============================================================

  V.auction = async (root) => {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, 'Auction Day'));
    root.appendChild(E('p', { class: 'sub' }, "Today's live auction — sessions in progress, open lots, bids live"));

    const grid = E('div', { class: 'kpi-grid' }); root.appendChild(grid);
    const k1 = E('div', { class: 'kpi kpi-accent' }, E('div', { class: 'kpi-label' }, 'In Progress'), E('div', { class: 'kpi-value' }, '…'));
    const k2 = E('div', { class: 'kpi kpi-accent' }, E('div', { class: 'kpi-label' }, 'Open Lots Today'), E('div', { class: 'kpi-value' }, '…'));
    const k3 = E('div', { class: 'kpi kpi-accent' }, E('div', { class: 'kpi-label' }, 'Bidders Active'), E('div', { class: 'kpi-value' }, '…'));
    const k4 = E('div', { class: 'kpi kpi-accent' }, E('div', { class: 'kpi-label' }, 'Gross Bid Value'), E('div', { class: 'kpi-value' }, '…'));
    [k1, k2, k3, k4].forEach(x => grid.appendChild(x));

    const toolbar = E('div', { class: 'toolbar' });
    const newSession = E('button', { class: 'btn-primary' }, '+ New Session');
    const newLot = E('button', { class: 'btn' }, '+ New Lot');
    const openBid = E('button', { class: 'btn' }, '▶ Open Bid Entry');
    toolbar.appendChild(newSession); toolbar.appendChild(newLot); toolbar.appendChild(openBid);
    newSession.addEventListener('click', () => location.hash = '#auction-session-new');
    newLot.addEventListener('click', () => location.hash = '#auction-lot-new');
    openBid.addEventListener('click', () => location.hash = '#auction-bid');
    root.appendChild(toolbar);

    // Quick tiles for auction modules
    const tiles = E('div', { class: 'auction-tiles' });
    const mk = (h2, sub, hash) => {
      const t = E('a', { href: hash, class: 'auction-tile' }, E('div', { class: 'at-title' }, h2), E('div', { class: 'at-sub' }, sub));
      return t;
    };
    tiles.appendChild(mk('Calendar', 'Month view of sessions', '#auction-calendar'));
    tiles.appendChild(mk('Sessions', 'All auction sessions', '#auction-sessions'));
    tiles.appendChild(mk('Lots', 'Lots catalogue', '#auction-lots'));
    tiles.appendChild(mk('Bid Entry', 'Rapid bid logging', '#auction-bid'));
    tiles.appendChild(mk('Bidders', 'Registered bidders', '#auction-bidders'));
    tiles.appendChild(mk('Auction P&L', 'Commission + gross', '#auction-pnl'));
    root.appendChild(tiles);

    const card = E('div', { class: 'card', style: { marginTop: '12px' } });
    card.appendChild(E('h3', { style: { margin: '0 0 10px', fontSize: '14px' } }, "Today's Sessions"));
    const body = E('div', {}, E('div', { class: 'loading' }, 'Loading…'));
    card.appendChild(body);
    root.appendChild(card);

    try {
      const r = await ERP.list('Auction Session', { fields: ['name','session_date','session_type','location','status'], filters: [['session_date','=',today()]], limit: 20 });
      body.innerHTML = '';
      if (!(r.data || []).length) body.appendChild(E('div', { class: 'sub' }, 'No sessions today. Create a new session to start.'));
      else {
        const t = E('table', { class: 'table' },
          E('thead', {}, E('tr', {}, E('th', {}, 'Session'), E('th', {}, 'Type'), E('th', {}, 'Location'), E('th', {}, 'Status'), E('th', {}, ''))),
          E('tbody', {}, ...r.data.map(s => {
            const tr = E('tr', { class: 'clickable' });
            tr.appendChild(E('td', {}, s.name));
            tr.appendChild(E('td', {}, s.session_type || ''));
            tr.appendChild(E('td', {}, s.location || ''));
            tr.appendChild(E('td', {}, E('span', { class: 'pill ' + (s.status === 'In Progress' ? 'green' : 'amber') }, s.status || '')));
            const btn = E('button', { class: 'btn' }, 'Open');
            btn.addEventListener('click', (e) => { e.stopPropagation(); location.hash = `#auction-session?name=${encodeURIComponent(s.name)}`; });
            tr.appendChild(E('td', {}, btn));
            tr.addEventListener('click', () => location.hash = `#auction-session?name=${encodeURIComponent(s.name)}`);
            return tr;
          }))
        );
        body.appendChild(t);
      }
    } catch (e) { body.innerHTML = `<div class="sub">${e.message}</div>`; }

    try {
      const [live, lots, bidders] = await Promise.all([
        ERP.count('Auction Session', [['status','=','In Progress']]).catch(() => 0),
        ERP.count('Auction Lot', [['session_date','=',today()]]).catch(() => 0),
        ERP.count('Auction Bidder', [['is_active','=',1]]).catch(() => 0),
      ]);
      k1.querySelector('.kpi-value').textContent = live;
      k2.querySelector('.kpi-value').textContent = lots;
      k3.querySelector('.kpi-value').textContent = bidders;
      k4.querySelector('.kpi-value').textContent = '—';
    } catch {}
  };

  V['auction-calendar'] = async (root) => {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, 'Auction Calendar'));
    root.appendChild(E('p', { class: 'sub' }, 'Month view of upcoming auction sessions'));
    const out = E('div', {}); root.appendChild(out);
    out.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const r = await ERP.list('Auction Session', { fields: ['name','session_date','session_type','location','status'], limit: 200, order_by: 'session_date asc' });
      const sessions = r.data || [];
      out.innerHTML = '';
      const d = new Date(); const y = d.getFullYear(), m = d.getMonth();
      const first = new Date(y, m, 1); const daysIn = new Date(y, m+1, 0).getDate();
      const header = E('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '4px', marginBottom: '8px', fontSize: '11px', color: 'var(--mute)', textTransform: 'uppercase' } },
        ...['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => E('div', { style: { padding: '4px' } }, d))
      );
      out.appendChild(E('h3', {}, first.toLocaleString('en-IN', { month: 'long', year: 'numeric' })));
      out.appendChild(header);
      const grid = E('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '4px' } });
      const pad = (first.getDay() + 6) % 7; // Monday start
      for (let i = 0; i < pad; i++) grid.appendChild(E('div', {}));
      for (let day = 1; day <= daysIn; day++) {
        const dt = `${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const todays = sessions.filter(s => (s.session_date || '').slice(0,10) === dt);
        const cell = E('div', { style: { border: '1px solid var(--line)', borderRadius: '6px', padding: '6px', minHeight: '80px', fontSize: '11px', background: dt === today() ? 'var(--sm-green-soft)' : '#fff' } },
          E('div', { style: { fontWeight: '600', marginBottom: '4px' } }, day),
          ...todays.map(s => E('div', { class: 'pill green', style: { marginBottom: '2px', cursor: 'pointer' }, onclick: () => location.hash = `#auction-session?name=${encodeURIComponent(s.name)}` }, s.session_type || s.name))
        );
        grid.appendChild(cell);
      }
      out.appendChild(grid);
    } catch (e) { out.innerHTML = `<div class="loading">${e.message}</div>`; }
  };

  V['auction-sessions'] = (root) => listLike(root, {
    title: 'Auction Sessions', doctype: 'Auction Session',
    fields: ['name','session_date','session_type','location','status','start_time','end_time'],
    newHash: '#auction-session-new',
    rowHash: (r) => `#auction-session?name=${encodeURIComponent(r.name)}`,
  });

  V['auction-session-new'] = (root) => docForm(root, {
    title: 'New Auction Session', doctype: 'Auction Session',
    fields: [
      ['session_date', 'date', today(), true],
      ['session_type', 'select', 'Cardamom', true, ['Cardamom','Pepper','Mixed']],
      ['location', 'text', 'Kumily'],
      ['start_time', 'time', '10:00'],
      ['end_time', 'time', '16:00'],
      ['status', 'select', 'Planned', true, ['Planned','In Progress','Completed','Cancelled']],
      ['notes', 'textarea', ''],
    ],
    onCreated: (r) => location.hash = `#auction-session?name=${encodeURIComponent(r?.data?.name || '')}`,
  });

  V['auction-session'] = async (root) => {
    const name = new URLSearchParams(location.hash.split('?')[1] || '').get('name');
    root.innerHTML = '';
    const head = E('div', { style: { display: 'flex', justifyContent: 'space-between' } });
    head.appendChild(E('h1', { class: 'page', style: { margin: 0 } }, name));
    head.appendChild(E('a', { class: 'btn', href: '#auction-sessions' }, '← Sessions'));
    root.appendChild(head);
    root.appendChild(E('p', { class: 'sub' }, 'Auction session — lots, bids, and results'));

    try {
      const s = (await ERP.get('Auction Session', name)).data || {};
      const info = E('div', { class: 'card', style: { marginBottom: '12px' } });
      info.appendChild(E('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px' } },
        ['Date', s.session_date], ['Type', s.session_type], ['Location', s.location], ['Status', s.status],
        ['Start', s.start_time], ['End', s.end_time], ['Notes', s.notes]
      .flat().filter((_, i) => i % 2 === 0).map((lbl, i) => {
        const pair = [['Date', s.session_date], ['Type', s.session_type], ['Location', s.location], ['Status', s.status], ['Start', s.start_time], ['End', s.end_time]][i];
        if (!pair) return null;
        return E('div', {}, E('span', { class: 'sub' }, pair[0] + ': '), E('strong', {}, String(pair[1] || '—')));
      }).filter(Boolean)));
      root.appendChild(info);
    } catch {}

    const grid = E('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' } });
    root.appendChild(grid);

    const lotsCard = E('div', { class: 'card' });
    lotsCard.appendChild(E('h3', { style: { margin: '0 0 10px', fontSize: '13px' } }, 'Lots in this session'));
    const lotsBody = E('div', {}, E('div', { class: 'loading' }, 'Loading…')); lotsCard.appendChild(lotsBody);
    grid.appendChild(lotsCard);

    const bidsCard = E('div', { class: 'card' });
    bidsCard.appendChild(E('h3', { style: { margin: '0 0 10px', fontSize: '13px' } }, 'Bids recorded'));
    const bidsBody = E('div', {}, E('div', { class: 'loading' }, 'Loading…')); bidsCard.appendChild(bidsBody);
    grid.appendChild(bidsCard);

    try {
      const r = await ERP.list('Auction Lot', { fields: ['name','item','grade','qty_kg','bags','moisture_pct','reserve_price','channel','status'], filters: [['session','=',name]], limit: 200 });
      lotsBody.innerHTML = '';
      const rows = r.data || [];
      if (!rows.length) lotsBody.appendChild(E('div', { class: 'sub' }, 'No lots yet.'));
      else {
        lotsBody.appendChild(E('div', { class: 'table-wrap' }, E('table', { class: 'table' },
          E('thead', {}, E('tr', {}, E('th', {}, 'Lot'), E('th', {}, 'Grade'), E('th', { class: 'num' }, 'Kg'), E('th', { class: 'num' }, 'Bags'), E('th', { class: 'num' }, 'Reserve'), E('th', {}, 'Status'))),
          E('tbody', {}, ...rows.map(l => E('tr', {}, E('td', {}, l.name), E('td', {}, l.grade || l.item || ''), E('td', { class: 'num' }, fmt(l.qty_kg)), E('td', { class: 'num' }, fmt(l.bags)), E('td', { class: 'num' }, fmt(l.reserve_price)), E('td', {}, l.status || ''))))
        )));
      }
    } catch (e) { lotsBody.innerHTML = `<div class="sub">${e.message}</div>`; }

    try {
      const r = await ERP.list('Auction Bid', { fields: ['name','lot','bidder','bid_amount','channel','timestamp','is_winning'], filters: [['session','=',name]], limit: 500, order_by: 'timestamp desc' });
      bidsBody.innerHTML = '';
      const rows = r.data || [];
      if (!rows.length) bidsBody.appendChild(E('div', { class: 'sub' }, 'No bids yet — use Bid Entry to record.'));
      else {
        bidsBody.appendChild(E('div', { class: 'table-wrap' }, E('table', { class: 'table' },
          E('thead', {}, E('tr', {}, E('th', {}, 'Time'), E('th', {}, 'Lot'), E('th', {}, 'Bidder'), E('th', { class: 'num' }, 'Bid'), E('th', {}, 'Channel'), E('th', {}, 'Win?'))),
          E('tbody', {}, ...rows.map(b => E('tr', {}, E('td', {}, (b.timestamp || '').slice(11,16)), E('td', {}, b.lot || ''), E('td', {}, b.bidder || ''), E('td', { class: 'num' }, fmt(b.bid_amount)), E('td', {}, b.channel || ''), E('td', {}, b.is_winning ? '✓' : ''))))
        )));
      }
    } catch (e) { bidsBody.innerHTML = `<div class="sub">${e.message}</div>`; }
  };

  V['auction-lots'] = (root) => listLike(root, {
    title: 'Auction Lots', doctype: 'Auction Lot',
    fields: ['name','session','item','grade','qty_kg','bags','moisture_pct','reserve_price','status'],
    newHash: '#auction-lot-new',
  });

  V['auction-lot-new'] = (root) => docForm(root, {
    title: 'New Auction Lot', doctype: 'Auction Lot',
    fields: [
      ['session', 'link', '', true, 'Auction Session'],
      ['item', 'link', '', true, 'Item'],
      ['grade', 'text', ''],
      ['qty_kg', 'number', 0, true],
      ['bags', 'number', 0],
      ['moisture_pct', 'number', 0],
      ['reserve_price', 'number', 0, true],
      ['channel', 'select', 'Floor', true, ['Floor','Online','Phone','Proxy']],
      ['status', 'select', 'Open', true, ['Open','Sold','Unsold','Withdrawn']],
      ['notes', 'textarea', ''],
    ],
    onCreated: () => location.hash = '#auction-lots',
  });

  V['auction-bid'] = async (root) => {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, 'Live Bid Entry'));
    root.appendChild(E('p', { class: 'sub' }, 'Rapid bid entry during live auction — pick lot, pick bidder, type amount, Enter'));

    const form = E('form', { class: 'form-grid' });
    const fLot = E('input', { list: 'lot-list', required: true, placeholder: 'Lot #' });
    const fBidder = E('input', { list: 'bidder-list', required: true, placeholder: 'Bidder' });
    const fAmt = E('input', { type: 'number', step: '0.01', required: true, placeholder: 'Bid amount' });
    const fChannel = E('select', {}, ...['Floor','Online','Phone','Proxy'].map(c => E('option', { value: c }, c)));
    const fWin = E('input', { type: 'checkbox' });
    const lotList = E('datalist', { id: 'lot-list' });
    const bidderList = E('datalist', { id: 'bidder-list' });
    ERP.list('Auction Lot', { fields: ['name'], filters: [['status','=','Open']], limit: 200 }).then(r => (r.data || []).forEach(d => lotList.appendChild(E('option', { value: d.name })))).catch(()=>{});
    ERP.list('Auction Bidder', { fields: ['name'], filters: [['is_active','=',1]], limit: 500 }).then(r => (r.data || []).forEach(d => bidderList.appendChild(E('option', { value: d.name })))).catch(()=>{});
    root.appendChild(lotList); root.appendChild(bidderList);
    const row = (l, c, full) => { const r = E('div', { class: 'form-row' + (full ? ' full' : '') }); r.appendChild(E('label', {}, l)); r.appendChild(c); return r; };
    form.appendChild(row('Lot', fLot));
    form.appendChild(row('Bidder', fBidder));
    form.appendChild(row('Amount', fAmt));
    form.appendChild(row('Channel', fChannel));
    const winRow = E('div', { class: 'form-row full', style: { flexDirection: 'row', gap: '8px', alignItems: 'center' } });
    winRow.appendChild(fWin); winRow.appendChild(E('label', {}, 'Mark as winning bid for this lot'));
    form.appendChild(winRow);
    const actions = E('div', { class: 'form-actions' });
    const submit = E('button', { class: 'btn-primary' }, 'Record Bid (Enter)');
    actions.appendChild(submit); form.appendChild(actions);
    root.appendChild(form);

    // Recent feed
    const feed = E('div', { class: 'card', style: { marginTop: '14px' } });
    feed.appendChild(E('h3', { style: { margin: '0 0 10px', fontSize: '14px' } }, 'Recent Bids'));
    const feedBody = E('div', {}, E('div', { class: 'sub' }, 'Loading…'));
    feed.appendChild(feedBody); root.appendChild(feed);
    const reloadFeed = async () => {
      try {
        const r = await ERP.list('Auction Bid', { fields: ['name','lot','bidder','bid_amount','channel','timestamp','is_winning'], limit: 20, order_by: 'timestamp desc' });
        feedBody.innerHTML = '';
        const rows = r.data || [];
        if (!rows.length) { feedBody.appendChild(E('div', { class: 'sub' }, 'No bids yet.')); return; }
        feedBody.appendChild(E('div', { class: 'table-wrap' }, E('table', { class: 'table' },
          E('thead', {}, E('tr', {}, E('th', {}, 'Time'), E('th', {}, 'Lot'), E('th', {}, 'Bidder'), E('th', { class: 'num' }, 'Amount'), E('th', {}, 'Channel'), E('th', {}, 'Win?'))),
          E('tbody', {}, ...rows.map(b => E('tr', {}, E('td', {}, (b.timestamp || '').slice(11,16)), E('td', {}, b.lot || ''), E('td', {}, b.bidder || ''), E('td', { class: 'num' }, fmt(b.bid_amount)), E('td', {}, b.channel || ''), E('td', {}, b.is_winning ? '✓' : ''))))
        )));
      } catch (e) { feedBody.innerHTML = `<div class="sub">${e.message}</div>`; }
    };
    reloadFeed();

    form.addEventListener('submit', async (e) => {
      e.preventDefault(); submit.disabled = true;
      try {
        await ERP.create('Auction Bid', {
          lot: fLot.value, bidder: fBidder.value, bid_amount: Number(fAmt.value),
          channel: fChannel.value, is_winning: fWin.checked ? 1 : 0,
          timestamp: new Date().toISOString(),
        });
        window.toast && window.toast('Bid recorded');
        fAmt.value = ''; fWin.checked = false;
        fAmt.focus();
        reloadFeed();
      } catch (err) { window.toast && window.toast('Error: ' + err.message, 'err'); }
      finally { submit.disabled = false; }
    });
  };

  V['auction-bidders'] = (root) => listLike(root, {
    title: 'Auction Bidders', doctype: 'Auction Bidder',
    fields: ['name','bidder_name','mobile','gstin','deposit_amount','is_active'],
    newHash: '#auction-bidder-new',
  });
  V['auction-bidder-new'] = (root) => docForm(root, {
    title: 'New Bidder', doctype: 'Auction Bidder',
    fields: [
      ['bidder_name', 'text', '', true],
      ['mobile', 'text', ''],
      ['gstin', 'text', ''],
      ['pan', 'text', ''],
      ['address', 'textarea', ''],
      ['deposit_amount', 'number', 0],
      ['is_active', 'checkbox', true],
    ],
    onCreated: () => location.hash = '#auction-bidders',
  });

  V['auction-pnl'] = async (root) => {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, 'Auction P&L'));
    root.appendChild(E('p', { class: 'sub' }, 'Per-session gross, commission, and net'));
    const out = E('div', {}); root.appendChild(out);
    out.innerHTML = '<div class="loading">Computing…</div>';
    try {
      const [sess, lots] = await Promise.all([
        ERP.list('Auction Session', { fields: ['name','session_date','session_type','status'], limit: 100, order_by: 'session_date desc' }),
        ERP.list('Auction Lot', { fields: ['name','session','qty_kg','reserve_price','sold_price','commission'], limit: 2000 }).catch(() => ({ data: [] })),
      ]);
      const byS = {};
      (lots.data || []).forEach(l => { byS[l.session] = byS[l.session] || { kg: 0, gross: 0, comm: 0 }; byS[l.session].kg += Number(l.qty_kg) || 0; byS[l.session].gross += (Number(l.sold_price) || 0) * (Number(l.qty_kg) || 0); byS[l.session].comm += Number(l.commission) || 0; });
      out.innerHTML = '';
      const rows = (sess.data || []).map(s => ({ ...s, ...(byS[s.name] || { kg: 0, gross: 0, comm: 0 }) }));
      if (!rows.length) { out.appendChild(E('div', { class: 'sub' }, 'No sessions.')); return; }
      out.appendChild(E('div', { class: 'table-wrap' }, E('table', { class: 'table' },
        E('thead', {}, E('tr', {}, E('th', {}, 'Date'), E('th', {}, 'Session'), E('th', {}, 'Type'), E('th', { class: 'num' }, 'Kg'), E('th', { class: 'num' }, 'Gross'), E('th', { class: 'num' }, 'Commission'), E('th', {}, 'Status'))),
        E('tbody', {}, ...rows.map(r => E('tr', {}, E('td', {}, r.session_date || ''), E('td', {}, r.name), E('td', {}, r.session_type || ''), E('td', { class: 'num' }, fmt(r.kg)), E('td', { class: 'num' }, fmt(r.gross)), E('td', { class: 'num' }, fmt(r.comm)), E('td', {}, r.status || ''))))
      )));
    } catch (e) { out.innerHTML = `<div class="loading">${e.message}</div>`; }
  };

  // ============================================================
  // PROCUREMENT (FARMERS)
  // ============================================================

  V.procurement = (root) => {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, 'Field Procurement'));
    root.appendChild(E('p', { class: 'sub' }, 'Record inward from farmers — optimized for one-hand entry at the collection centre'));

    const form = E('form', { class: 'form-grid' });
    const fDate = E('input', { type: 'date', value: today(), required: true });
    const fFarmer = E('input', { list: 'farmer-list', required: true, placeholder: 'Farmer name or code' });
    const fItem = E('input', { list: 'item-list', required: true, placeholder: 'Cardamom Small / Pepper Garbled etc.' });
    const fGrade = E('input', { placeholder: 'Grade / quality notes' });
    const fBags = E('input', { type: 'number', placeholder: 'Bags' });
    const fKg = E('input', { type: 'number', step: '0.01', required: true, placeholder: 'Net kg' });
    const fRate = E('input', { type: 'number', step: '0.01', required: true, placeholder: 'Rate per kg' });
    const fAdv = E('input', { type: 'number', step: '0.01', placeholder: 'Advance paid on spot' });
    const fMode = E('select', {}, ...['Cash','UPI','Bank Transfer','Cheque','On account'].map(m => E('option', {}, m)));
    const fWare = E('input', { list: 'ware-list', placeholder: 'Warehouse (Kumily / etc.)' });
    const fNotes = E('textarea', { rows: 2, placeholder: 'Moisture %, condition, etc.' });

    const farmerList = E('datalist', { id: 'farmer-list' });
    const itemList = E('datalist', { id: 'item-list' });
    const wareList = E('datalist', { id: 'ware-list' });
    ERP.list('Supplier', { fields: ['name'], limit: 2000 }).then(r => (r.data || []).forEach(d => farmerList.appendChild(E('option', { value: d.name })))).catch(()=>{});
    ERP.list('Item', { fields: ['name','item_name'], limit: 500 }).then(r => (r.data || []).forEach(d => itemList.appendChild(E('option', { value: d.name })))).catch(()=>{});
    ERP.list('Warehouse', { fields: ['name'], limit: 50 }).then(r => (r.data || []).forEach(d => wareList.appendChild(E('option', { value: d.name })))).catch(()=>{});
    root.appendChild(farmerList); root.appendChild(itemList); root.appendChild(wareList);

    const row = (l, c, full) => { const r = E('div', { class: 'form-row' + (full ? ' full' : '') }); r.appendChild(E('label', {}, l)); r.appendChild(c); return r; };
    form.appendChild(row('Date', fDate));
    form.appendChild(row('Farmer', fFarmer));
    form.appendChild(row('Product', fItem));
    form.appendChild(row('Grade', fGrade));
    form.appendChild(row('Bags', fBags));
    form.appendChild(row('Net Kg', fKg));
    form.appendChild(row('Rate/kg', fRate));
    form.appendChild(row('Advance paid', fAdv));
    form.appendChild(row('Mode', fMode));
    form.appendChild(row('Warehouse', fWare));
    form.appendChild(row('Notes', fNotes, true));

    const total = E('div', { class: 'form-row full', style: { background: 'var(--sm-green-soft)', padding: '8px 12px', borderRadius: '6px' } });
    const totalV = E('strong', {}, '₹0.00');
    total.appendChild(E('span', {}, 'Procurement value: '));
    total.appendChild(totalV);
    form.appendChild(total);
    const recalc = () => { totalV.textContent = fmtCr((Number(fKg.value) || 0) * (Number(fRate.value) || 0)); };
    [fKg, fRate].forEach(el => el.addEventListener('input', recalc));

    const actions = E('div', { class: 'form-actions' });
    const submit = E('button', { class: 'btn-primary' }, 'Post Procurement');
    actions.appendChild(submit); form.appendChild(actions);
    root.appendChild(form);

    form.addEventListener('submit', async (e) => {
      e.preventDefault(); submit.disabled = true;
      try {
        const body = {
          company: window.state?.company || 'Spice More Trading Company',
          posting_date: fDate.value, supplier: fFarmer.value,
          items: [{ item_code: fItem.value, qty: Number(fKg.value), rate: Number(fRate.value), description: `${fGrade.value || ''} · ${fBags.value || 0} bags · ${fNotes.value || ''}`.trim(), warehouse: fWare.value }],
          remarks: fNotes.value, docstatus: 1,
        };
        const r = await ERP.create('Purchase Invoice', body);
        window.toast && window.toast('Procurement posted: ' + (r?.data?.name || 'OK'));
        if (Number(fAdv.value) > 0) {
          await ERP.create('Payment Entry', {
            doctype: 'Payment Entry', payment_type: 'Pay', company: body.company,
            posting_date: fDate.value, party_type: 'Supplier', party: fFarmer.value,
            paid_amount: Number(fAdv.value), received_amount: Number(fAdv.value),
            mode_of_payment: fMode.value, reference_date: fDate.value,
            remarks: `Advance against procurement ${r?.data?.name || ''}`,
            docstatus: 1,
          }).catch(() => {});
        }
        form.reset(); fDate.value = today(); recalc();
      } catch (err) { window.toast && window.toast('Error: ' + err.message, 'err'); }
      finally { submit.disabled = false; }
    });
  };

  V['farmer-advance'] = (root) => docForm(root, {
    title: 'Farmer Advance',
    sub: 'Advance paid against future crop — settle when procurement is received',
    doctype: 'Payment Entry',
    fields: [
      ['payment_type', 'hidden', 'Pay'],
      ['party_type', 'hidden', 'Supplier'],
      ['party', 'link', '', true, 'Supplier'],
      ['posting_date', 'date', today(), true],
      ['paid_amount', 'number', 0, true],
      ['mode_of_payment', 'select', 'Cash', true, ['Cash','UPI','Bank Transfer','Cheque']],
      ['paid_from', 'link', '', true, 'Account'],
      ['reference_no', 'text', ''],
      ['remarks', 'textarea', 'Advance against future crop'],
    ],
    extraBody: { docstatus: 1, received_amount: 'paid_amount' },
    onCreated: () => window.toast && window.toast('Advance posted'),
  });

  V['procurement-register'] = async (root) => {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, 'Procurement Register'));
    root.appendChild(E('p', { class: 'sub' }, 'All farmer inward in date range — exportable'));
    const from = E('input', { type: 'date', value: new Date(new Date().setMonth(new Date().getMonth()-1)).toISOString().slice(0,10) });
    const to = E('input', { type: 'date', value: today() });
    const go = E('button', { class: 'btn-primary' }, 'Apply');
    const exp = E('button', { class: 'btn' }, '⬇ Export CSV');
    root.appendChild(E('div', { class: 'toolbar' }, 'From', from, 'To', to, go, E('div', { class: 'spacer' }), exp));
    const out = E('div', {}); root.appendChild(out);
    let rows = [];
    const load = async () => {
      out.innerHTML = '<div class="loading">Loading…</div>';
      try {
        const r = await ERP.method('frappe.desk.query_report.run', { report_name: 'Purchase Register', filters: { company: window.state?.company, from_date: from.value, to_date: to.value } });
        const p = r?.message || r;
        rows = p?.result || [];
        if (window.renderReport) window.renderReport(out, p); else out.innerHTML = `<pre>${JSON.stringify(p, null, 2).slice(0, 4000)}</pre>`;
      } catch (e) { out.innerHTML = `<div class="loading">${e.message}</div>`; }
    };
    go.addEventListener('click', load);
    exp.addEventListener('click', () => window.exportCsv && window.exportCsv(rows, `procurement-${from.value}-${to.value}.csv`));
    load();
  };

  // ============================================================
  // STOCK & WAREHOUSE
  // ============================================================

  V['stock-entry'] = (root) => docForm(root, {
    title: 'Stock Entry', sub: 'Receive, transfer, issue, or adjust stock',
    doctype: 'Stock Entry',
    fields: [
      ['stock_entry_type', 'select', 'Material Receipt', true, ['Material Receipt','Material Issue','Material Transfer','Manufacture','Repack']],
      ['posting_date', 'date', today(), true],
      ['from_warehouse', 'link', '', false, 'Warehouse'],
      ['to_warehouse', 'link', '', false, 'Warehouse'],
      ['remarks', 'textarea', ''],
    ],
    extraBody: { docstatus: 0 },
    note: 'This creates a draft. Add item rows inside ERPNext or upgrade UI to add them inline. For faster inward, use Field Procurement.',
  });
  V['stock-aging'] = async (root) => {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, 'Stock Aging'));
    root.appendChild(E('p', { class: 'sub' }, 'Days-held by warehouse · grade — spot slow-moving or quality-risk lots'));
    const out = E('div', {}); root.appendChild(out);
    out.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const r = await ERP.method('frappe.desk.query_report.run', { report_name: 'Stock Ageing', filters: { company: window.state?.company, to_date: today(), range1: 30, range2: 60, range3: 90 } });
      if (window.renderReport) window.renderReport(out, r?.message || r);
    } catch (e) { out.innerHTML = `<div class="loading">${e.message}</div>`; }
  };
  V['batch-tracker'] = (root) => listLike(root, {
    title: 'Batch Tracker', doctype: 'Batch',
    fields: ['name','batch_id','item','manufacturing_date','expiry_date','batch_qty'],
  });
  V.warehouses = (root) => listLike(root, {
    title: 'Warehouses', doctype: 'Warehouse',
    fields: ['name','warehouse_name','warehouse_type','disabled'],
    newHash: '#warehouse-new',
  });
  V['warehouse-new'] = (root) => docForm(root, {
    title: 'New Warehouse', doctype: 'Warehouse',
    fields: [
      ['warehouse_name', 'text', '', true],
      ['warehouse_type', 'select', '', false, ['','Transit','Stores']],
      ['company', 'link', window.state?.company || '', true, 'Company'],
      ['address_line_1', 'text', ''],
      ['city', 'text', ''],
      ['state', 'text', 'Kerala'],
    ],
    onCreated: () => location.hash = '#warehouses',
  });

  // ============================================================
  // FINANCE / LOANS / WHR
  // ============================================================

  V.drawdown = (root) => docForm(root, {
    title: 'New Loan Drawdown', sub: 'Record a fresh draw from a sanctioned loan facility',
    doctype: 'Loan Drawdown',
    fields: [
      ['facility', 'link', '', true, 'Loan Facility'],
      ['drawdown_date', 'date', today(), true],
      ['amount', 'number', 0, true],
      ['purpose', 'select', 'Working Capital', false, ['Working Capital','Procurement','Export LC','Vehicle','Other']],
      ['narration', 'textarea', ''],
    ],
    onCreated: () => { window.toast && window.toast('Drawdown recorded'); location.hash = '#loans'; },
  });
  V.repayment = (root) => docForm(root, {
    title: 'Loan Repayment', sub: 'Principal + interest against a facility',
    doctype: 'Loan Repayment',
    fields: [
      ['facility', 'link', '', true, 'Loan Facility'],
      ['repayment_date', 'date', today(), true],
      ['principal', 'number', 0, true],
      ['interest', 'number', 0],
      ['penal_charges', 'number', 0],
      ['narration', 'textarea', ''],
    ],
    onCreated: () => { window.toast && window.toast('Repayment recorded'); location.hash = '#loans'; },
  });
  V['interest-accrual'] = async (root) => {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, 'Interest Accrual'));
    root.appendChild(E('p', { class: 'sub' }, 'Outstanding × rate × days / 365 — per facility'));
    const out = E('div', {}); root.appendChild(out);
    try {
      const r = await ERP.list('Loan Facility', { fields: ['name','facility_code','bank','facility_type','sanctioned_amount','outstanding_amount','interest_rate','rate_type'], limit: 50 });
      const rows = r.data || [];
      if (!rows.length) { out.innerHTML = '<div class="sub">No facilities.</div>'; return; }
      const now = new Date();
      rows.forEach(f => {
        const r = Number(f.interest_rate) || 0;
        const o = Number(f.outstanding_amount) || 0;
        f.daily_interest = (o * r / 100) / 365;
        f.mtd_interest = f.daily_interest * now.getDate();
      });
      out.innerHTML = '';
      out.appendChild(E('div', { class: 'table-wrap' }, E('table', { class: 'table' },
        E('thead', {}, E('tr', {}, E('th', {}, 'Facility'), E('th', {}, 'Bank'), E('th', {}, 'Type'), E('th', { class: 'num' }, 'Outstanding'), E('th', { class: 'num' }, 'Rate %'), E('th', { class: 'num' }, 'Daily Interest'), E('th', { class: 'num' }, 'Month-to-date'))),
        E('tbody', {}, ...rows.map(f => E('tr', {}, E('td', {}, f.name), E('td', {}, f.bank || ''), E('td', {}, f.facility_type || ''), E('td', { class: 'num' }, fmt(f.outstanding_amount)), E('td', { class: 'num' }, fmt(f.interest_rate)), E('td', { class: 'num' }, fmt(f.daily_interest)), E('td', { class: 'num' }, fmt(f.mtd_interest)))))
      )));
    } catch (e) { out.innerHTML = `<div class="loading">${e.message}</div>`; }
  };
  V['pdc-register'] = async (root) => {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, 'Post-dated Cheques'));
    root.appendChild(E('p', { class: 'sub' }, 'Cheques issued / received with future dates — track upcoming clearances'));
    const out = E('div', {}); root.appendChild(out);
    try {
      const r = await ERP.list('Payment Entry', { fields: ['name','party_type','party','payment_type','paid_amount','posting_date','reference_no','reference_date','mode_of_payment'], filters: [['mode_of_payment','=','Cheque'],['reference_date','>',today()]], limit: 500, order_by: 'reference_date asc' });
      const rows = r.data || [];
      out.innerHTML = '';
      if (!rows.length) { out.appendChild(E('div', { class: 'sub' }, 'No post-dated cheques.')); return; }
      out.appendChild(E('div', { class: 'table-wrap' }, E('table', { class: 'table' },
        E('thead', {}, E('tr', {}, E('th', {}, 'Cheque Date'), E('th', {}, 'Entry'), E('th', {}, 'Type'), E('th', {}, 'Party'), E('th', { class: 'num' }, 'Amount'), E('th', {}, 'Cheque #'))),
        E('tbody', {}, ...rows.map(p => E('tr', {}, E('td', {}, p.reference_date || ''), E('td', {}, p.name), E('td', {}, p.payment_type || ''), E('td', {}, p.party || ''), E('td', { class: 'num' }, fmt(p.paid_amount)), E('td', {}, p.reference_no || ''))))
      )));
    } catch (e) { out.innerHTML = `<div class="loading">${e.message}</div>`; }
  };

  // ============================================================
  // EXPORT MODULE (SEPL)
  // ============================================================

  V['shipping-bills'] = (root) => listLike(root, {
    title: 'Shipping Bills', doctype: 'Shipping Bill',
    fields: ['name','shb_no','shb_date','port','buyer','fob_value','status'],
    newHash: '#shipping-bill-new',
    stubLabel: 'Shipping Bill doctype',
  });
  V['shipping-bill-new'] = (root) => docForm(root, {
    title: 'New Shipping Bill', doctype: 'Shipping Bill',
    fields: [
      ['shb_no', 'text', '', true],
      ['shb_date', 'date', today(), true],
      ['port', 'select', 'Cochin', true, ['Cochin','Tuticorin','Nhava Sheva','Chennai','Mundra']],
      ['buyer', 'link', '', true, 'Customer'],
      ['container_no', 'text', ''],
      ['awb_or_bl', 'text', ''],
      ['fob_value', 'number', 0, true],
      ['currency', 'select', 'USD', true, ['USD','EUR','GBP','AED','SAR','INR']],
      ['status', 'select', 'Filed', true, ['Filed','LEO','Shipped','Delivered','Payment Received']],
      ['notes', 'textarea', ''],
    ],
  });
  V['lc-tracker'] = (root) => listLike(root, {
    title: 'Letter of Credit Tracker', doctype: 'LC Tracker',
    fields: ['name','lc_no','issuing_bank','amount','currency','expiry','status'],
    newHash: '#lc-new',
    stubLabel: 'LC Tracker doctype',
  });
  V['lc-new'] = (root) => docForm(root, {
    title: 'New LC', doctype: 'LC Tracker',
    fields: [
      ['lc_no', 'text', '', true],
      ['issuing_bank', 'text', ''],
      ['beneficiary', 'text', ''],
      ['amount', 'number', 0, true],
      ['currency', 'select', 'USD', true, ['USD','EUR','GBP']],
      ['issue_date', 'date', today()],
      ['expiry', 'date', ''],
      ['status', 'select', 'Open', true, ['Open','Utilised','Expired','Closed']],
    ],
  });
  V['forex-receivables'] = async (root) => {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, 'Forex Receivables'));
    root.appendChild(E('p', { class: 'sub' }, 'Outstanding from export customers — foreign currency'));
    const out = E('div', {}); root.appendChild(out);
    try {
      const r = await ERP.list('Sales Invoice', { fields: ['name','customer','posting_date','grand_total','outstanding_amount','currency','conversion_rate'], filters: [['currency','!=','INR'],['outstanding_amount','>',0]], limit: 200 });
      const rows = r.data || [];
      out.innerHTML = '';
      if (!rows.length) { out.appendChild(E('div', { class: 'sub' }, 'No forex receivables.')); return; }
      const total = rows.reduce((s, r) => s + (Number(r.outstanding_amount) || 0) * (Number(r.conversion_rate) || 1), 0);
      out.appendChild(E('div', { class: 'card', style: { marginBottom: '10px' } }, E('strong', {}, 'Total INR equivalent: '), fmtCr(total)));
      out.appendChild(E('div', { class: 'table-wrap' }, E('table', { class: 'table' },
        E('thead', {}, E('tr', {}, E('th', {}, 'Invoice'), E('th', {}, 'Customer'), E('th', {}, 'Date'), E('th', { class: 'num' }, 'Outstanding'), E('th', {}, 'Ccy'), E('th', { class: 'num' }, 'Rate'))),
        E('tbody', {}, ...rows.map(r => E('tr', {}, E('td', {}, r.name), E('td', {}, r.customer), E('td', {}, r.posting_date), E('td', { class: 'num' }, fmt(r.outstanding_amount)), E('td', {}, r.currency), E('td', { class: 'num' }, fmt(r.conversion_rate)))))
      )));
    } catch (e) { out.innerHTML = `<div class="loading">${e.message}</div>`; }
  };

  // ============================================================
  // REPORTS / COMPLIANCE / PAYROLL
  // ============================================================

  V.cashflow = async (root) => {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, 'Cash Flow — 30 Days'));
    root.appendChild(E('p', { class: 'sub' }, 'Inflow vs outflow from bank & cash accounts'));
    const out = E('div', {}); root.appendChild(out);
    out.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const r = await ERP.method('frappe.desk.query_report.run', { report_name: 'Cash Flow', filters: { company: window.state?.company, period_start_date: new Date(new Date().setDate(new Date().getDate()-30)).toISOString().slice(0,10), period_end_date: today(), periodicity: 'Monthly' } });
      if (window.renderReport) window.renderReport(out, r?.message || r);
    } catch (e) { out.innerHTML = `<div class="loading">${e.message}</div>`; }
  };
  V.budget = async (root) => {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, 'Budget vs Actual'));
    root.appendChild(E('p', { class: 'sub' }, 'Variance against annual budget'));
    const out = E('div', {}); root.appendChild(out);
    try {
      const r = await ERP.method('frappe.desk.query_report.run', { report_name: 'Budget Variance Report', filters: { company: window.state?.company, from_fiscal_year: '2026-2027', to_fiscal_year: '2026-2027', period: 'Yearly' } });
      if (window.renderReport) window.renderReport(out, r?.message || r);
    } catch (e) { out.innerHTML = `<div class="loading">Budget report not configured: ${e.message}</div>`; }
  };
  V['hsn-summary'] = async (root) => {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, 'HSN-wise Summary'));
    const out = E('div', {}); root.appendChild(out);
    try {
      const r = await ERP.method('frappe.desk.query_report.run', { report_name: 'HSN-wise-summary of outward supplies', filters: { company: window.state?.company, from_date: new Date(new Date().setMonth(new Date().getMonth()-1)).toISOString().slice(0,10), to_date: today() } });
      if (window.renderReport) window.renderReport(out, r?.message || r);
    } catch (e) { out.innerHTML = `<div class="loading">${e.message}</div>`; }
  };
  V['tds-register'] = async (root) => {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, 'TDS Register'));
    root.appendChild(E('p', { class: 'sub' }, 'TDS deducted on payments — for form 26Q filing'));
    const out = E('div', {}); root.appendChild(out);
    try {
      const r = await ERP.method('frappe.desk.query_report.run', { report_name: 'TDS Computation Summary', filters: { company: window.state?.company, fiscal_year: '2026-2027' } });
      if (window.renderReport) window.renderReport(out, r?.message || r);
    } catch (e) { out.innerHTML = `<div class="loading">Report not available: ${e.message}</div>`; }
  };
  V.einvoice = (root) => {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, 'e-Invoice Generation'));
    root.appendChild(E('p', { class: 'sub' }, 'Mandatory for turnover > ₹5 cr — requires GST portal API access'));
    root.appendChild(notConfigured('e-Invoice API', 'Once GSTN API credentials are provisioned, unsubmitted sales invoices will be batch-pushed and IRN/QR attached automatically.'));
  };
  V['eway-bill'] = (root) => {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, 'e-Way Bill'));
    root.appendChild(E('p', { class: 'sub' }, 'Generate e-way bills for stock transfers >₹50,000'));
    root.appendChild(notConfigured('e-Way Bill API', 'Needs NIC API credentials. Once added, goods-movement entries auto-generate e-way bill #.'));
  };
  V['gst-returns'] = (root) => {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, 'GST Returns Filing'));
    root.appendChild(E('p', { class: 'sub' }, 'GSTR-1, GSTR-3B, GSTR-9 — consolidated filing view'));
    const grid = E('div', { class: 'kpi-grid' }); root.appendChild(grid);
    [['GSTR-1', 'Outward supplies', '#gst'], ['GSTR-3B', 'Summary return', '#gst'], ['GSTR-9', 'Annual return', '#gst'], ['GSTR-2B', 'Auto-drafted ITC', '#gst']]
      .forEach(([t, s, h]) => grid.appendChild(E('a', { class: 'kpi kpi-accent', href: h, style: { textDecoration: 'none', color: 'inherit' } }, E('div', { class: 'kpi-label' }, t), E('div', { class: 'kpi-value' }, s))));
  };
  V.employees = (root) => listLike(root, {
    title: 'Employees', doctype: 'Employee',
    fields: ['name','employee_name','designation','department','status','date_of_joining'],
    newHash: '#employee-new',
  });
  V['employee-new'] = (root) => docForm(root, {
    title: 'New Employee', doctype: 'Employee',
    fields: [
      ['first_name', 'text', '', true],
      ['last_name', 'text', ''],
      ['gender', 'select', 'Male', true, ['Male','Female','Other']],
      ['date_of_joining', 'date', today(), true],
      ['date_of_birth', 'date', ''],
      ['designation', 'text', ''],
      ['department', 'text', ''],
      ['company', 'link', window.state?.company || '', true, 'Company'],
      ['status', 'select', 'Active', true, ['Active','Inactive','Left']],
    ],
  });
  V.salary = (root) => docForm(root, {
    title: 'Salary Entry',
    sub: 'Record monthly salary — creates a Salary Slip',
    doctype: 'Salary Slip',
    fields: [
      ['employee', 'link', '', true, 'Employee'],
      ['posting_date', 'date', today(), true],
      ['start_date', 'date', new Date(new Date().setDate(1)).toISOString().slice(0,10)],
      ['end_date', 'date', today()],
      ['gross_pay', 'number', 0, true],
      ['total_deduction', 'number', 0],
      ['remarks', 'textarea', ''],
    ],
  });
  V.attendance = (root) => listLike(root, {
    title: 'Attendance', doctype: 'Attendance',
    fields: ['name','employee','attendance_date','status','working_hours'],
  });
  V['cost-centers'] = (root) => listLike(root, {
    title: 'Cost Centers', doctype: 'Cost Center',
    fields: ['name','cost_center_name','parent_cost_center','is_group'],
  });
  V['audit-log'] = async (root) => {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, 'Audit Log'));
    root.appendChild(E('p', { class: 'sub' }, 'Recent create/edit/submit activity across the system'));
    const out = E('div', {}); root.appendChild(out);
    try {
      const r = await ERP.list('Version', { fields: ['name','ref_doctype','docname','owner','creation'], limit: 200, order_by: 'creation desc' });
      const rows = r.data || [];
      if (!rows.length) { out.innerHTML = '<div class="sub">No activity.</div>'; return; }
      out.appendChild(E('div', { class: 'table-wrap' }, E('table', { class: 'table' },
        E('thead', {}, E('tr', {}, E('th', {}, 'When'), E('th', {}, 'User'), E('th', {}, 'Doctype'), E('th', {}, 'Record'))),
        E('tbody', {}, ...rows.map(v => E('tr', {}, E('td', {}, (v.creation || '').slice(0,19).replace('T',' ')), E('td', {}, v.owner || ''), E('td', {}, v.ref_doctype || ''), E('td', {}, v.docname || ''))))
      )));
    } catch (e) { out.innerHTML = `<div class="loading">${e.message}</div>`; }
  };
  V['user-settings'] = async (root) => {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, 'Users & Roles'));
    root.appendChild(E('p', { class: 'sub' }, 'Staff accounts and what they can access'));
    try {
      const r = await ERP.list('User', { fields: ['name','full_name','enabled','user_type','last_login'], limit: 100 });
      const rows = r.data || [];
      const out = E('div', {}); root.appendChild(out);
      out.appendChild(E('div', { class: 'table-wrap' }, E('table', { class: 'table' },
        E('thead', {}, E('tr', {}, E('th', {}, 'Email'), E('th', {}, 'Name'), E('th', {}, 'Type'), E('th', {}, 'Last Login'), E('th', {}, 'Enabled'))),
        E('tbody', {}, ...rows.map(u => E('tr', {}, E('td', {}, u.name), E('td', {}, u.full_name || ''), E('td', {}, u.user_type || ''), E('td', {}, (u.last_login || '').slice(0,19).replace('T',' ')), E('td', {}, u.enabled ? '✓' : ''))))
      )));
    } catch (e) { root.appendChild(E('div', { class: 'loading' }, e.message)); }
  };

  // ============================================================
  // Dashboard — rich, role-aware
  // ============================================================
  const originalDashboard = V.dashboard;
  V.dashboard = async (root) => {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, 'Dashboard'));
    root.appendChild(E('p', { class: 'sub' }, `${window.state?.company || 'Spicemore'} — live operating snapshot`));

    const grid = E('div', { class: 'kpi-grid' });
    root.appendChild(grid);
    const mk = (label, val, sub) => {
      const el = E('div', { class: 'kpi kpi-accent' },
        E('div', { class: 'kpi-label' }, label),
        E('div', { class: 'kpi-value' }, val),
        sub ? E('div', { class: 'kpi-sub' }, sub) : null
      );
      grid.appendChild(el); return el;
    };
    const cards = {
      cust: mk('Customers', '…'),
      sup: mk('Suppliers', '…'),
      loans: mk('Active Loan Facilities', '…'),
      loanOut: mk('Loan Outstanding', '…'),
      arOut: mk('AR Outstanding', '…'),
      apOut: mk('AP Outstanding', '…'),
      stock: mk('Items', '…'),
      auction: mk('Auction Sessions (month)', '…'),
    };

    try {
      const [cust, sup, loans, items, si, pi, sess] = await Promise.all([
        ERP.count('Customer'),
        ERP.count('Supplier'),
        ERP.list('Loan Facility', { fields: ['name','outstanding_amount','status'], filters: [['status','=','Active']], limit: 50 }).catch(() => ({ data: [] })),
        ERP.count('Item').catch(() => 0),
        ERP.list('Sales Invoice', { fields: ['outstanding_amount'], filters: [['outstanding_amount','>',0]], limit: 2000 }).catch(() => ({ data: [] })),
        ERP.list('Purchase Invoice', { fields: ['outstanding_amount'], filters: [['outstanding_amount','>',0]], limit: 2000 }).catch(() => ({ data: [] })),
        ERP.count('Auction Session', [['session_date','>=',new Date(new Date().setDate(1)).toISOString().slice(0,10)]]).catch(() => 0),
      ]);
      cards.cust.querySelector('.kpi-value').textContent = fmt(cust);
      cards.sup.querySelector('.kpi-value').textContent = fmt(sup);
      cards.loans.querySelector('.kpi-value').textContent = fmt((loans.data || []).length);
      cards.loanOut.querySelector('.kpi-value').textContent = fmtCr((loans.data || []).reduce((s,r) => s + (Number(r.outstanding_amount)||0), 0));
      cards.arOut.querySelector('.kpi-value').textContent = fmtCr((si.data || []).reduce((s,r) => s + (Number(r.outstanding_amount)||0), 0));
      cards.apOut.querySelector('.kpi-value').textContent = fmtCr((pi.data || []).reduce((s,r) => s + (Number(r.outstanding_amount)||0), 0));
      cards.stock.querySelector('.kpi-value').textContent = fmt(items);
      cards.auction.querySelector('.kpi-value').textContent = fmt(sess);
    } catch (e) { window.toast && window.toast('Dashboard: ' + e.message, 'err'); }

    // Recent Sales + Recent Purchase side-by-side
    const side = E('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '14px' } });
    root.appendChild(side);
    const recentCard = (title, doctype, partyField) => {
      const card = E('div', { class: 'card' });
      card.appendChild(E('h3', { style: { margin: '0 0 10px', fontSize: '14px' } }, title));
      const body = E('div', {}, E('div', { class: 'sub' }, 'Loading…'));
      card.appendChild(body);
      side.appendChild(card);
      ERP.list(doctype, { fields: ['name', partyField, 'posting_date', 'grand_total', 'status'], limit: 8, order_by: 'posting_date desc' })
        .then(r => {
          body.innerHTML = '';
          const rows = r.data || [];
          if (!rows.length) { body.appendChild(E('div', { class: 'sub' }, 'No entries yet.')); return; }
          body.appendChild(E('div', { class: 'table-wrap' }, E('table', { class: 'table' },
            E('thead', {}, E('tr', {}, E('th', {}, 'Date'), E('th', {}, 'No'), E('th', {}, partyField), E('th', { class: 'num' }, 'Total'))),
            E('tbody', {}, ...rows.map(r => E('tr', {}, E('td', {}, r.posting_date), E('td', {}, r.name), E('td', {}, r[partyField] || ''), E('td', { class: 'num' }, fmt(r.grand_total)))))
          )));
        })
        .catch(e => body.innerHTML = `<div class="sub">${e.message}</div>`);
    };
    recentCard('Recent Sales', 'Sales Invoice', 'customer');
    recentCard('Recent Purchases', 'Purchase Invoice', 'supplier');
  };

  // ============================================================
  // Generic list + form helpers for custom/standard doctypes
  // ============================================================

  async function listLike(root, cfg) {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, cfg.title));
    if (cfg.sub) root.appendChild(E('p', { class: 'sub' }, cfg.sub));
    const search = E('input', { type: 'text', placeholder: 'Search…' });
    const expBtn = E('button', { class: 'btn' }, '⬇ Export CSV');
    const bar = E('div', { class: 'toolbar' }, search, E('div', { class: 'spacer' }), expBtn);
    if (cfg.newHash) {
      const b = E('a', { class: 'btn-primary', href: cfg.newHash }, cfg.newLabel || '+ New');
      bar.appendChild(b);
    }
    root.appendChild(bar);
    const out = E('div', {}); root.appendChild(out);
    out.innerHTML = '<div class="loading">Loading…</div>';
    let rows = [];
    try {
      const r = await ERP.list(cfg.doctype, { fields: cfg.fields, limit: cfg.limit || 500, order_by: 'modified desc' });
      rows = r.data || [];
      render();
    } catch (e) {
      out.innerHTML = '';
      out.appendChild(notConfigured(cfg.stubLabel || cfg.doctype, `Doctype "${cfg.doctype}" may not exist yet. Error: ${e.message}`));
    }
    function render() {
      const q = search.value.toLowerCase();
      const filt = q ? rows.filter(r => Object.values(r).some(v => String(v||'').toLowerCase().includes(q))) : rows;
      out.innerHTML = '';
      if (!filt.length) { out.appendChild(E('div', { class: 'sub' }, 'No records match.')); return; }
      const fields = cfg.fields || Object.keys(filt[0]);
      const wrap = E('div', { class: 'table-wrap' });
      const tbl = E('table', { class: 'table' },
        E('thead', {}, E('tr', {}, ...fields.map(f => E('th', {}, f.replace(/_/g,' '))))),
        E('tbody', {}, ...filt.slice(0, 500).map(r => {
          const tr = E('tr', cfg.rowHash ? { class: 'clickable' } : {}, ...fields.map(f => E('td', {}, r[f] === 1 ? '✓' : r[f] === 0 ? '' : (r[f] ?? ''))));
          if (cfg.rowHash) tr.addEventListener('click', () => location.hash = cfg.rowHash(r));
          return tr;
        }))
      );
      wrap.appendChild(tbl); out.appendChild(wrap);
      out.appendChild(E('p', { class: 'sub' }, `${filt.length} records`));
    }
    search.addEventListener('input', render);
    expBtn.addEventListener('click', () => window.exportCsv && window.exportCsv(rows, `${cfg.doctype.toLowerCase().replace(/\s+/g,'-')}-${today()}.csv`));
  }

  async function docForm(root, cfg) {
    root.innerHTML = '';
    root.appendChild(E('h1', { class: 'page' }, cfg.title));
    if (cfg.sub) root.appendChild(E('p', { class: 'sub' }, cfg.sub));
    if (cfg.note) root.appendChild(E('div', { class: 'card', style: { background: '#fff8e5', borderLeft: '4px solid var(--warn)', marginBottom: '14px' } }, cfg.note));

    const form = E('form', { class: 'form-grid' });
    const ctrls = {};
    for (const [name, type, def, required, extra] of cfg.fields) {
      if (type === 'hidden') { ctrls[name] = { value: def }; continue; }
      let c;
      if (type === 'textarea') c = E('textarea', { rows: 3, placeholder: name, value: def || '' });
      else if (type === 'select') c = E('select', {}, ...(extra || []).map(o => E('option', { value: o, selected: o === def }, o)));
      else if (type === 'checkbox') { c = E('input', { type: 'checkbox' }); if (def) c.checked = true; }
      else if (type === 'link') {
        c = E('input', { list: `list-${name}`, placeholder: extra, value: def || '' });
        const list = E('datalist', { id: `list-${name}` });
        ERP.list(extra, { fields: ['name'], limit: 500 }).then(r => (r.data || []).forEach(d => list.appendChild(E('option', { value: d.name })))).catch(()=>{});
        root.appendChild(list);
      }
      else if (type === 'date') c = E('input', { type: 'date', value: def || '' });
      else if (type === 'time') c = E('input', { type: 'time', value: def || '' });
      else if (type === 'number') c = E('input', { type: 'number', step: '0.01', value: def != null ? def : '' });
      else c = E('input', { type: 'text', value: def || '', placeholder: name });
      if (required) c.required = true;
      ctrls[name] = c;
      const row = E('div', { class: 'form-row' });
      row.appendChild(E('label', {}, name.replace(/_/g,' ')));
      row.appendChild(c);
      form.appendChild(row);
    }
    const actions = E('div', { class: 'form-actions' });
    const submit = E('button', { class: 'btn-primary', type: 'submit' }, 'Save');
    actions.appendChild(submit); form.appendChild(actions);
    root.appendChild(form);

    form.addEventListener('submit', async (e) => {
      e.preventDefault(); submit.disabled = true;
      try {
        const body = {};
        for (const [name] of cfg.fields) {
          const el = ctrls[name];
          if (!el) continue;
          if (el.type === 'checkbox') body[name] = el.checked ? 1 : 0;
          else body[name] = el.value;
        }
        Object.assign(body, cfg.extraBody || {});
        if (body.received_amount === 'paid_amount') body.received_amount = body.paid_amount;
        const r = await ERP.create(cfg.doctype, body);
        window.toast && window.toast('Saved: ' + (r?.data?.name || 'OK'));
        if (cfg.onCreated) cfg.onCreated(r);
        else form.reset();
      } catch (err) {
        window.toast && window.toast('Error: ' + err.message, 'err');
        if (String(err.message).match(/DocType|not found|cannot find/i)) {
          root.appendChild(notConfigured(cfg.doctype, 'Doctype not yet provisioned in ERPNext. Create it in the backend and this form activates.'));
        }
      } finally { submit.disabled = false; }
    });
  }

  // expose a few helpers globally so the dashboard & others can use them
  window.exportCsvExt = window.exportCsv;
})();
