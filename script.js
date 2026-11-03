/* script.js – UI and business logic. All figures are computed from the database
   records on every render, so nothing is hardcoded and every view stays in sync. */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const P = n => 'P' + (+n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = v => { const n = parseFloat(v); if (isNaN(n) || n < 0) throw Error('Enter a valid amount (0 or more).'); return n; };
const today = () => new Date().toISOString().slice(0, 10);
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);

const STATUSES = ['Received', 'Awaiting diagnosis', 'Awaiting customer approval', 'Awaiting spare parts', 'In progress', 'Testing & QC', 'Completed', 'Awaiting collection', 'Collected', 'Cancelled'];
const DONE = ['Completed', 'Awaiting collection', 'Collected'];
const METHODS = ['Cash', 'Card', 'Bank transfer', 'Mobile money'].map(x => [x, x]);
const EXP_CATS = ['Spare parts', 'Transport', 'Equipment', 'Rent', 'Operational', 'Other'].map(x => [x, x]);
const TITLES = { dashboard: 'Dashboard', customers: 'Customers', repairs: 'Repair jobs', sales: 'Sales', inventory: 'Inventory', finance: 'Finance', log: 'Activity log' };

const S = {}; let view = 'dashboard', q = '';

/* ---------- data access & derived values ---------- */
const cust = id => S.customers.find(c => c.id === id);
const prod = id => S.products.find(p => p.id === id);
const custName = id => (cust(id) || {}).name || 'Walk-in';
const paid = id => sum(S.payments.filter(p => p.refId === id), p => p.amount);
const repairBal = r => r.status === 'Cancelled' ? 0 : r.price - paid(r.id);
const saleBal = s => s.total - paid(s.id);
const custBal = id => sum(S.repairs.filter(r => r.customerId === id), repairBal) + sum(S.sales.filter(s => s.customerId === id), saleBal);
const match = (...f) => f.join(' ').toLowerCase().includes(q.toLowerCase());

async function refresh() {
  for (const s of DB.STORES) if (s !== 'meta') S[s] = await DB.all(s);
  render();
}
async function save(store, o, action, old) {
  o.updatedAt = new Date().toISOString(); o.synced = false;
  await DB.put(store, o);
  await DB.put('audit', { id: DB.uid('a'), at: o.updatedAt, store, rec: o.ref || o.name || o.id, action, old: old ? JSON.stringify(old).slice(0, 300) : '', new: JSON.stringify(o).slice(0, 300), synced: false });
}

/* ---------- generic UI helpers ---------- */
function form(title, fields, vals, ok) {
  const d = $('#dlg');
  const input = f => f.t === 'select'
    ? `<select name="${f.k}">${f.o.map(o => `<option value="${esc(o[0])}" ${o[0] == (vals[f.k] ?? '') ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`
    : f.t === 'textarea' ? `<textarea name="${f.k}" rows="2">${esc(vals[f.k] || '')}</textarea>`
    : `<input name="${f.k}" type="${f.t || 'text'}" ${f.t === 'number' ? 'step="any" min="0"' : ''} value="${esc(vals[f.k] ?? '')}" ${f.r ? 'required' : ''} ${f.list ? 'list="' + f.list + '"' : ''}>`;
  d.innerHTML = `<form class="f"><h3>${title}</h3>${fields.map(f => `<label>${f.l}${input(f)}</label>`).join('')}<div class="bt"><button type="button" id="cx">Cancel</button><button class="gold">Save</button></div></form>`;
  d.showModal();
  $('#cx').onclick = () => d.close();
  d.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const o = {}; new FormData(e.target).forEach((v, k) => o[k] = v.trim());
    try { await ok(o); d.close(); await refresh(); } catch (x) { alert(x.message); }
  };
}
function info(title, html) {
  const d = $('#dlg');
  d.innerHTML = `<div class="f"><h3>${title}</h3>${html}<div class="bt"><button class="gold" id="cx">Close</button></div></div>`;
  d.showModal(); $('#cx').onclick = () => d.close();
}
const table = (heads, rows, right = []) => rows.length
  ? `<div class="tw"><table><tr>${heads.map((h, i) => `<th class="${right.includes(i) ? 'r' : ''}">${h}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${right.includes(i) ? 'r' : ''}">${c}</td>`).join('')}</tr>`).join('')}</table></div>`
  : '<div class="tw empty">Nothing here yet.</div>';
const btn = (a, id, label) => `<button class="sm" data-a="${a}" data-id="${id}">${label}</button>`;
const card = (l, v, bad) => `<div class="card ${bad ? 'bad' : ''}"><small>${l}</small><strong>${v}</strong></div>`;
const bar = (placeholder, add) => `<div class="toolbar"><input id="q" placeholder="${placeholder}" value="${esc(q)}">${add}</div>`;

/* ---------- views ---------- */
const V = {
  dashboard() {
    const rp = S.repairs.filter(r => r.status !== 'Cancelled');
    const pending = rp.filter(r => !DONE.includes(r.status)).length;
    const month = today().slice(0, 7);
    const recv = d => sum(S.payments.filter(p => p.date === d), p => p.amount);
    const low = S.products.filter(p => p.qty <= p.min);
    const days = [...Array(7)].map((_, i) => { const d = new Date(Date.now() - (6 - i) * 864e5).toISOString().slice(0, 10); return [d.slice(5), recv(d)]; });
    const max = Math.max(1, ...days.map(d => d[1]));
    const last = localStorage.getItem('lastBackup');
    const outstanding = sum(rp, repairBal) + sum(S.sales, saleBal);
    return (last === today() ? '' : `<div class="alert">${last ? 'Last backup: ' + last + '.' : 'No backup yet.'} Use “Back up data” to save a copy of your records.</div>`)
      + (low.length ? `<div class="alert"><b>Low stock:</b> ${low.map(p => esc(p.name) + ' (' + p.qty + ')').join(', ')}</div>` : '')
      + `<div class="cards">${card('Total repair jobs', S.repairs.length)}${card('Pending repairs', pending)}${card('Completed repairs', rp.filter(r => DONE.includes(r.status)).length)}${card('Awaiting collection', S.repairs.filter(r => r.status === 'Awaiting collection').length)}
      ${card('Total sales', P(sum(S.sales, s => s.total)))}${card('Repair revenue (value)', P(sum(rp, r => r.price)))}${card('Money received today', P(recv(today())))}${card('Money received this month', P(sum(S.payments.filter(p => p.date.startsWith(month)), p => p.amount)))}
      ${card('Outstanding customer balances', P(outstanding), outstanding > 0)}${card('Total expenses', P(sum(S.expenses, e => e.amount)))}${card('Units in stock', sum(S.products, p => p.qty))}${card('Low-stock items', low.length, low.length)}</div>
      <h3 class="sec">Money received – last 7 days</h3><div class="bar">${days.map(d => `<div><i style="height:${Math.round(d[1] / max * 80)}px" title="${P(d[1])}"></i>${d[0]}</div>`).join('')}</div>`;
  },
  customers() {
    const rows = S.customers.filter(c => match(c.ref, c.name, c.phone)).map(c => {
      const b = custBal(c.id);
      return [c.ref, esc(c.name), esc(c.phone), S.repairs.filter(r => r.customerId === c.id).length, `<span class="${b > 0 ? 'low' : ''}">${P(b)}</span>`, btn('histCustomer', c.id, 'History') + btn('editCustomer', c.id, 'Edit')];
    });
    return bar('Search by name, number or ID…', '<button class="gold" data-a="newCustomer">Add customer</button>') + table(['ID', 'Name', 'Contact', 'Repairs', 'Owes', ''], rows, [4]);
  },
  repairs() {
    const rows = S.repairs.slice().reverse().filter(r => match(r.ref, custName(r.customerId), r.brand, r.model, r.imei, r.status, r.problem)).map(r => {
      const b = repairBal(r);
      return [r.ref, esc(custName(r.customerId)), esc([r.brand, r.model].filter(Boolean).join(' ') || r.device), esc(r.status), P(r.price), P(paid(r.id)), `<span class="${b > 0 ? 'low' : 'ok'}">${P(b)}</span>`, esc(r.expected || ''), btn('status', r.id, 'Status') + btn('payRepair', r.id, 'Payment') + btn('editRepair', r.id, 'Edit') + btn('histRepair', r.id, 'History')];
    });
    return bar('Search reference, customer, device, IMEI or status…', '<button class="gold" data-a="newRepair">Receive device</button>') + table(['Job', 'Customer', 'Device', 'Status', 'Value', 'Paid', 'Balance', 'Due', ''], rows, [4, 5, 6]);
  },
  sales() {
    const rows = S.sales.slice().reverse().filter(s => match(s.ref, s.name, custName(s.customerId))).map(s => {
      const b = saleBal(s);
      return [s.ref, s.date, esc(custName(s.customerId)), esc(s.name), s.qty, P(s.total), P(paid(s.id)), `<span class="${b > 0 ? 'low' : 'ok'}">${P(b)}</span>`, b > 0 ? btn('paySale', s.id, 'Payment') : ''];
    });
    const t = sum(S.sales, s => s.total), c = sum(S.sales, s => s.cost);
    return `<div class="cards">${card('Total sales', P(t))}${card('Cost of goods sold', P(c))}${card('Estimated gross profit', P(t - c))}</div>`
      + bar('Search sales…', '<button class="gold" data-a="newSale">Record sale</button>') + table(['Ref', 'Date', 'Customer', 'Item', 'Qty', 'Total', 'Paid', 'Balance', ''], rows, [4, 5, 6, 7]);
  },
  inventory() {
    const rows = S.products.filter(p => match(p.name, p.category, p.supplier, p.compat)).map(p => [esc(p.name), esc(p.category), `<span class="${p.qty <= p.min ? 'low' : ''}">${p.qty}</span>`, P(p.buy), P(p.sell), P(p.qty * p.buy), btn('adjust', p.id, 'Adjust') + btn('editProduct', p.id, 'Edit')]);
    const mv = S.moves.slice(-10).reverse().map(m => [m.date, esc(m.name), (m.delta > 0 ? '+' : '') + m.delta, esc(m.reason)]);
    return `<div class="cards">${card('Stock valuation (at cost)', P(sum(S.products, p => p.qty * p.buy)))}${card('Retail value', P(sum(S.products, p => p.qty * p.sell)))}${card('Products', S.products.length)}</div>`
      + bar('Search products…', '<button class="gold" data-a="newProduct">Add product</button>') + table(['Product', 'Category', 'Qty', 'Buy', 'Sell', 'Value', ''], rows, [2, 3, 4, 5])
      + '<h3 class="sec">Recent stock movements</h3>' + table(['Date', 'Product', 'Change', 'Reason'], mv, [2]);
  },
  finance() {
    const recvd = sum(S.payments, p => p.amount), rp = S.repairs.filter(r => r.status !== 'Cancelled');
    const recorded = sum(S.sales, s => s.total) + sum(rp, r => r.price);
    const ex = sum(S.expenses, e => e.amount), gp = sum(S.sales, s => s.total - s.cost);
    const pay = S.payments.slice().reverse().slice(0, 25).map(p => [p.date, p.ref, esc(custName(p.customerId)), p.refType === 'repair' ? 'Repair' : 'Sale', esc(p.method), P(p.amount)]);
    const exr = S.expenses.slice().reverse().filter(e => match(e.category, e.description)).slice(0, 25).map(e => [e.date, esc(e.category), esc(e.description), P(e.amount)]);
    return `<div class="cards">${card('Total recorded (sales + repairs)', P(recorded))}${card('Money actually received', P(recvd))}${card('Outstanding from customers', P(recorded - recvd), recorded - recvd > 0)}${card('Total expenses', P(ex))}${card('Gross profit on sales', P(gp))}${card('Net operating result (cash)', P(recvd - ex))}</div>`
      + '<h3 class="sec">Payments received</h3>' + table(['Date', 'Ref', 'Customer', 'For', 'Method', 'Amount'], pay, [5])
      + '<div class="toolbar" style="margin-top:20px"><input id="q" placeholder="Search expenses…" value="' + esc(q) + '"><button class="gold" data-a="newExpense">Add expense</button></div>' + table(['Date', 'Category', 'Description', 'Amount'], exr, [3]);
  },
  log() {
    return table(['When', 'Record', 'Action', 'Sync'], S.audit.slice().reverse().slice(0, 100).map(a => [new Date(a.at).toLocaleString(), esc(a.store + ': ' + a.rec), esc(a.action), a.synced ? 'Synced' : 'Local only']));
  }
};

/* ---------- actions ---------- */
const CF = [{ k: 'name', l: 'Full name', r: 1 }, { k: 'phone', l: 'Contact number', r: 1 }, { k: 'notes', l: 'Notes', t: 'textarea' }];
const opts = (arr, f) => arr.map(f);
function repairFields() {
  return [{ k: 'customerId', l: 'Customer', t: 'select', o: S.customers.map(c => [c.id, c.name + ' – ' + c.phone]) },
    { k: 'device', l: 'Device type', t: 'select', o: ['Phone', 'Laptop', 'Tablet', 'Other'].map(x => [x, x]) },
    { k: 'brand', l: 'Brand' }, { k: 'model', l: 'Model' }, { k: 'imei', l: 'IMEI / serial number' },
    { k: 'condition', l: 'Physical condition' }, { k: 'accessories', l: 'Accessories received' },
    { k: 'problem', l: 'Reported problem', t: 'textarea', r: 1 }, { k: 'diagnosis', l: 'Diagnosis / recommended repair', t: 'textarea' },
    { k: 'price', l: 'Quoted repair cost (P)', t: 'number', r: 1 }, { k: 'parts', l: 'Replacement parts needed' },
    { k: 'tech', l: 'Technician' }, { k: 'expected', l: 'Expected completion', t: 'date' }, { k: 'warranty', l: 'Warranty (e.g. 30 days)' }];
}
function payForm(refType, rec) {
  const bal = refType === 'repair' ? repairBal(rec) : saleBal(rec);
  if (bal <= 0) return alert('Nothing outstanding on ' + rec.ref + '.');
  form(`Payment for ${rec.ref} (owing ${P(bal)})`, [{ k: 'amount', l: 'Amount received (P)', t: 'number', r: 1 }, { k: 'method', l: 'Method', t: 'select', o: METHODS }, { k: 'date', l: 'Date', t: 'date', r: 1 }], { date: today() }, async o => {
    const amt = num(o.amount);
    if (amt <= 0) throw Error('Amount must be more than zero.');
    if (amt > bal + 0.001) throw Error('Amount is more than the outstanding balance of ' + P(bal) + '.');
    await save('payments', { id: DB.uid('p'), ref: await DB.next('pay', 'PM-'), refType, refId: rec.id, customerId: rec.customerId, amount: amt, method: o.method, date: o.date }, 'payment received');
  });
}
const A = {
  newCustomer: () => form('New customer', CF, {}, async o => {
    if (S.customers.some(c => c.phone === o.phone)) throw Error('A customer with this number already exists.');
    await save('customers', { id: DB.uid('c'), ref: await DB.next('cust', 'C-'), ...o }, 'created');
  }),
  editCustomer: id => { const c = cust(id); form('Edit customer', CF, c, o => save('customers', { ...c, ...o }, 'updated', c)); },
  histCustomer: id => {
    const r = S.repairs.filter(x => x.customerId === id).map(x => `<li>${x.ref} – ${esc(x.brand + ' ' + x.model)} – ${esc(x.status)} – ${P(x.price)} (owing ${P(repairBal(x))})</li>`).join('');
    const s = S.sales.filter(x => x.customerId === id).map(x => `<li>${x.ref} – ${esc(x.name)} × ${x.qty} – ${P(x.total)} (owing ${P(saleBal(x))})</li>`).join('');
    info(esc(cust(id).name), `<b>Repairs</b><ul>${r || '<li>None</li>'}</ul><b>Purchases</b><ul>${s || '<li>None</li>'}</ul><b>Total owing: ${P(custBal(id))}</b>`);
  },
  newRepair: async () => {
    if (!S.customers.length) return alert('Register the customer first (Customers → Add customer).');
    form('Receive device', repairFields(), {}, async o => {
      const now = new Date().toISOString();
      await save('repairs', { id: DB.uid('r'), ref: await DB.next('repair', 'RJ-'), ...o, price: num(o.price), received: today(), status: 'Received', history: [{ s: 'Received', at: now, note: '' }] }, 'created');
    });
  },
  editRepair: id => { const r = S.repairs.find(x => x.id === id); form('Edit repair ' + r.ref, repairFields(), r, o => save('repairs', { ...r, ...o, price: num(o.price) }, 'updated', r)); },
  status: id => {
    const r = S.repairs.find(x => x.id === id);
    form('Update status – ' + r.ref, [{ k: 'status', l: 'Status', t: 'select', o: STATUSES.map(x => [x, x]) }, { k: 'note', l: 'Technician / repair note', t: 'textarea' }], r, async o => {
      if (o.status === 'Collected' && repairBal(r) > 0 && !confirm(`Customer still owes ${P(repairBal(r))}. Mark as collected anyway?`)) throw Error('Status not changed.');
      if (o.status === 'Cancelled' && !confirm('Cancel this repair job?')) throw Error('Status not changed.');
      if (o.status === r.status && !o.note) return;
      await save('repairs', { ...r, status: o.status, history: [...r.history, { s: o.status, at: new Date().toISOString(), note: o.note }] }, 'status → ' + o.status, { status: r.status });
    });
  },
  histRepair: id => { const r = S.repairs.find(x => x.id === id); info(r.ref + ' history', `<ul>${r.history.map(h => `<li>${new Date(h.at).toLocaleString()} – <b>${esc(h.s)}</b> ${esc(h.note || '')}</li>`).join('')}</ul>`); },
  payRepair: id => payForm('repair', S.repairs.find(x => x.id === id)),
  paySale: id => payForm('sale', S.sales.find(x => x.id === id)),
  newSale: () => {
    const avail = S.products.filter(p => p.qty > 0);
    if (!avail.length) return alert('No products in stock. Add stock in Inventory first.');
    form('Record sale', [{ k: 'productId', l: 'Product', t: 'select', o: avail.map(p => [p.id, `${p.name} (${p.qty} in stock, ${P(p.sell)})`]) }, { k: 'qty', l: 'Quantity', t: 'number', r: 1 }, { k: 'price', l: 'Unit price (blank = current price)', t: 'number' },
      { k: 'customerId', l: 'Customer (needed if not paid in full)', t: 'select', o: [['', 'Walk-in'], ...S.customers.map(c => [c.id, c.name])] }, { k: 'paid', l: 'Paid now (P)', t: 'number', r: 1 }, { k: 'method', l: 'Method', t: 'select', o: METHODS }], { qty: 1 }, async o => {
      const p = prod(o.productId), qty = num(o.qty), price = o.price === '' ? p.sell : num(o.price), total = qty * price, pd = num(o.paid);
      if (qty < 1 || qty > p.qty) throw Error('Only ' + p.qty + ' in stock.');
      if (pd > total) throw Error('Paid amount is more than the sale total.');
      if (pd < total && !o.customerId) throw Error('Choose a customer for sales that are not paid in full.');
      const sale = { id: DB.uid('s'), ref: await DB.next('sale', 'S-'), date: today(), productId: p.id, name: p.name, qty, price, cost: qty * p.buy, total, customerId: o.customerId };
      await save('sales', sale, 'created');
      if (pd > 0) await save('payments', { id: DB.uid('p'), ref: await DB.next('pay', 'PM-'), refType: 'sale', refId: sale.id, customerId: o.customerId, amount: pd, method: o.method, date: today() }, 'payment received');
      await stock(p, -qty, 'Sale ' + sale.ref);
    });
  },
  newProduct: () => form('Add product', PF, { min: 2 }, async o => {
    const p = { id: DB.uid('i'), ...o, buy: num(o.buy), sell: num(o.sell), qty: Math.floor(num(o.qty)), min: Math.floor(num(o.min)) };
    await save('products', p, 'created'); await stock(p, 0, 'Opening stock ' + p.qty, p.qty, true);
  }),
  editProduct: id => { const p = prod(id); form('Edit product', PF.filter(f => f.k !== 'qty'), p, o => save('products', { ...p, ...o, buy: num(o.buy), sell: num(o.sell), min: Math.floor(num(o.min)) }, 'updated', p)); },
  adjust: id => { const p = prod(id); form('Adjust stock – ' + p.name, [{ k: 'delta', l: 'Change (+ add, − remove)', t: 'number', r: 1 }, { k: 'reason', l: 'Reason', r: 1 }], {}, async o => {
    const d = parseFloat(o.delta); if (!d || p.qty + d < 0) throw Error('Invalid change – stock cannot go below zero.'); await stock(p, d, o.reason); }); },
  newExpense: () => form('Add expense', [{ k: 'date', l: 'Date', t: 'date', r: 1 }, { k: 'category', l: 'Category', t: 'select', o: EXP_CATS }, { k: 'amount', l: 'Amount (P)', t: 'number', r: 1 }, { k: 'description', l: 'Description', r: 1 }], { date: today() },
    async o => save('expenses', { id: DB.uid('e'), ...o, amount: num(o.amount) }, 'created')),
  backup: async () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(await DB.dump())], { type: 'application/json' }));
    a.download = 'wealth-tech-backup-' + today() + '.json'; a.click(); localStorage.setItem('lastBackup', today()); render();
  },
  restore: () => $('#file').click()
};
const PF = [{ k: 'name', l: 'Product name', r: 1 }, { k: 'category', l: 'Category', r: 1, list: 'cats' }, { k: 'compat', l: 'Device compatibility' }, { k: 'supplier', l: 'Supplier' },
  { k: 'buy', l: 'Buying price (P)', t: 'number', r: 1 }, { k: 'sell', l: 'Selling price (P)', t: 'number', r: 1 }, { k: 'qty', l: 'Quantity in stock', t: 'number', r: 1 }, { k: 'min', l: 'Low-stock alert at', t: 'number', r: 1 }];
async function stock(p, delta, reason, qtyOverride, opening) {
  const cur = prod(p.id) || p;
  if (!opening) await save('products', { ...cur, qty: cur.qty + delta }, 'stock ' + (delta > 0 ? '+' : '') + delta, { qty: cur.qty });
  await DB.put('moves', { id: DB.uid('m'), productId: p.id, name: p.name, delta: opening ? qtyOverride : delta, reason, date: today() });
}

/* ---------- render, events, status ---------- */
function render() {
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.dataset.v === view));
  $('#title').textContent = TITLES[view];
  $('#main').innerHTML = V[view]();
  $('#cats').innerHTML = [...new Set(S.products.map(p => p.category))].map(c => `<option value="${esc(c)}">`).join('');
  const pending = ['customers', 'repairs', 'products', 'sales', 'payments', 'expenses'].reduce((n, s) => n + S[s].filter(x => !x.synced).length, 0);
  $('#sync').className = 'pill ' + (pending ? 'warn' : 'on');
  $('#sync').textContent = pending ? pending + ' records saved on this device only' : 'Everything saved';
  const on = navigator.onLine; $('#conn').className = 'pill ' + (on ? 'on' : 'off'); $('#conn').textContent = on ? 'Online' : 'Offline – working locally';
}
document.addEventListener('click', e => {
  const n = e.target.closest('nav a'); if (n) { e.preventDefault(); view = n.dataset.v; q = ''; return render(); }
  const b = e.target.closest('[data-a]'); if (b) A[b.dataset.a](b.dataset.id);
});
document.addEventListener('input', e => {
  if (e.target.id !== 'q') return;
  q = e.target.value; render(); const i = $('#q'); i.focus(); i.setSelectionRange(q.length, q.length);
});
$('#file').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (!confirm('Restoring REPLACES all current records with the backup. Continue?')) return;
  try { await DB.load(JSON.parse(await f.text())); await refresh(); alert('Backup restored.'); } catch (x) { alert('Restore failed: ' + x.message); }
};
window.addEventListener('online', render); window.addEventListener('offline', render);
(async () => {
  await DB.open(); await refresh();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(() => {});
})();
