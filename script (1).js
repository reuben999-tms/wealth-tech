'use strict';
/* ===== Wealth Tech Innovations – Business Manager v1 =====
   Single source of truth: IndexedDB -> in-memory cache S -> render().
   Every write goes through put(), which also writes the audit log. */
const DB_NAME = 'wti-business', DB_VER = 2;
const STORES = ['customers','repairs','products','sales','payments','expenses','moves','audit','settings','suppliers','supplierTx','warranties','employees','tasks'];
const STATUSES = ['Received','Awaiting diagnosis','Awaiting customer approval','Awaiting spare parts','In progress','Testing and quality control','Completed','Awaiting collection','Collected','Cancelled'];
const DONE = ['Completed','Awaiting collection','Collected'];
const DEF = { id:'cfg', biz:'Wealth Tech Innovations', lowDefault:5, warranty:30,
  cats:['Phone Accessories','Chargers','Screens','Batteries','Laptop Parts','Other'],
  brands:['Samsung','Apple','Huawei','Tecno','Infinix','HP','Dell','Lenovo'],
  techs:['Unassigned'], expCats:['Spare parts','Transport','Equipment','Rent','Operational','Other'] };
let db, S = {}, V = 'dashboard', Q = '', RF = '';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const P = n => 'P' + (Number(n) || 0).toFixed(2);
const today = () => new Date().toISOString().slice(0, 10);
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
const toast = (m, bad) => { const t = $('#toast'); t.textContent = m; t.style.background = bad ? '#c0392b' : '#111'; t.style.display = 'block'; setTimeout(() => t.style.display = 'none', 2800); };

/* ---------- database layer ---------- */
const idb = (mode, st, fn) => new Promise((ok, no) => { const t = db.transaction(st, mode); const r = fn(t.objectStore(st)); t.oncomplete = () => ok(r && r.result); t.onerror = () => no(t.error); });
function openDB() {
  return new Promise((ok, no) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = e => { const d = r.result; /* future migrations: switch on e.oldVersion */ STORES.forEach(s => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); }); };
    r.onsuccess = () => { db = r.result; ok(); }; r.onerror = () => no(r.error);
  });
}
function uid(prefix, st) {
  const n = Math.max(0, ...S[st].map(x => parseInt(String(x.id).split('-')[1]) || 0)) + 1;
  return prefix + '-' + String(n).padStart(4, '0');
}
async function put(st, o, note) {
  const old = S[st].find(x => x.id === o.id);
  const diff = old ? Object.keys(o).filter(k => !['updatedAt','synced','history'].includes(k) && JSON.stringify(old[k]) !== JSON.stringify(o[k])).map(k => `${k}: ${old[k] ?? ''} → ${o[k]}`).join('; ') : 'created';
  o.updatedAt = new Date().toISOString(); o.synced = false;
  await idb('readwrite', st, s => s.put(o));
  if (old) Object.assign(old, o); else S[st].push(o);
  if (st !== 'audit' && st !== 'settings') await put('audit', { id: 'AUD-' + Date.now() + Math.random().toString(36).slice(2, 5), ts: o.updatedAt, ref: o.id, store: st, action: note || (old ? 'updated' : 'created'), detail: diff });
}
async function loadAll() {
  for (const s of STORES) S[s] = await idb('readonly', s, st => st.getAll());
  S.cfg = S.settings.find(x => x.id === 'cfg') || { ...DEF };
}

/* ---------- calculations (never stored, always derived) ---------- */
const paidFor = id => sum(S.payments.filter(p => p.refId === id), p => p.amount);
const repVal = r => r.status === 'Cancelled' ? 0 : r.estimate;
const repDue = r => Math.max(0, repVal(r) - paidFor(r.id));
const saleDue = s => Math.max(0, s.total - paidFor(s.id));
const custName = id => (S.customers.find(c => c.id === id) || { name: 'Walk-in' }).name;
const custDue = id => sum(S.repairs.filter(r => r.customerId === id), repDue) + sum(S.sales.filter(s => s.customerId === id), saleDue);
const low = p => p.qty <= (p.min ?? S.cfg.lowDefault);
const totals = () => {
  const supPaid = sum(S.supplierTx.filter(t => t.type === 'payment'), t => t.amount), supOwed = sum(S.suppliers, x => Math.max(0, supBal(x.id))), received = sum(S.payments, p => p.amount), exp = sum(S.expenses, e => e.amount);
  const sales = sum(S.sales, s => s.total), cogs = sum(S.sales, s => s.qty * s.cost);
  return { received, exp, sales, cogs, gross: sales - cogs, repRev: sum(S.repairs, repVal),
    out: sum(S.repairs, repDue) + sum(S.sales, saleDue), net: received - exp - supPaid, supPaid, supOwed,
    stock: sum(S.products, p => p.qty), val: sum(S.products, p => p.qty * p.buy) };
};

/* ---------- UI helpers ---------- */
const tbl = (h, rows) => `<div class="tw"><table><thead><tr>${h.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${h.length}" class="empty">No records yet</td></tr>`}</tbody></table></div>`;
const hit = o => !Q || JSON.stringify(o).toLowerCase().includes(Q);
const card = (l, v, d) => `<div class="card ${d ? 'dark' : ''}"><small>${l}</small><b>${v}</b></div>`;
const opts = a => a.map(x => Array.isArray(x) ? x : [x, x]);
function show(html) { const m = $('#modal'); m.innerHTML = html + `<div class="row"><button class="ghost" onclick="$('#modal').close()">Close</button></div>`; if (!m.open) m.showModal(); }
function form(title, fields, cb, data = {}) {
  const m = $('#modal');
  m.innerHTML = `<form><h3>${title}</h3>${fields.map(f => `<label>${f.l}${f.t === 'select'
    ? `<select name="${f.n}">${opts(f.o).map(([v, l]) => `<option value="${esc(v)}" ${String(data[f.n] ?? f.v ?? '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
    : f.t === 'textarea' ? `<textarea name="${f.n}" rows="3">${esc(data[f.n] ?? '')}</textarea>`
    : `<input name="${f.n}" type="${f.t || 'text'}" step="any" ${f.t === 'number' ? 'min="0"' : ''} value="${esc(data[f.n] ?? f.v ?? '')}" ${f.r ? 'required' : ''}>`}</label>`).join('')}
    <div class="row"><button type="button" class="ghost" onclick="$('#modal').close()">Cancel</button><button>Save</button></div></form>`;
  m.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    try { await cb(Object.fromEntries(new FormData(e.target))); m.close(); render(); }
    catch (x) { toast(x.message, true); }
  };
  if (!m.open) m.showModal();
}
const tag = (s) => `<span class="tag ${DONE.includes(s) ? 'g' : s === 'Cancelled' ? 'r' : 'y'}">${s}</span>`;
const num = (v, name) => { const n = parseFloat(v); if (isNaN(n) || n < 0) throw new Error(name + ' must be a valid number (0 or more)'); return n; };

/* ---------- customers ---------- */
function custForm(id) {
  const c = S.customers.find(x => x.id === id);
  form(c ? 'Edit customer' : 'New customer', [{ n: 'name', l: 'Full name', r: 1 }, { n: 'phone', l: 'Contact number', r: 1 }, { n: 'note', l: 'Notes', t: 'textarea' }], async d => {
    if (S.customers.some(x => x.phone === d.phone.trim() && x.id !== id)) throw new Error('A customer with this number already exists');
    await put('customers', { ...(c || { id: uid('CUS', 'customers'), created: today() }), name: d.name.trim(), phone: d.phone.trim(), note: d.note });
  }, c || {});
}
function custView(id) {
  const c = S.customers.find(x => x.id === id);
  const rs = S.repairs.filter(r => r.customerId === id), ss = S.sales.filter(s => s.customerId === id);
  show(`<h3>${esc(c.name)} <small>${c.id}</small></h3><p>📞 ${esc(c.phone)} · Outstanding: <b class="${custDue(id) ? 'neg' : ''}">${P(custDue(id))}</b></p>
  <h4>Repairs</h4>${tbl(['Job', 'Device', 'Status', 'Balance'], rs.map(r => `<tr><td>${r.id}</td><td>${esc(r.brand + ' ' + r.model)}</td><td>${tag(r.status)}</td><td>${P(repDue(r))}</td></tr>`))}
  <h4>Purchases</h4>${tbl(['Sale', 'Item', 'Total', 'Balance'], ss.map(s => `<tr><td>${s.id}</td><td>${esc(s.name)} ×${s.qty}</td><td>${P(s.total)}</td><td>${P(saleDue(s))}</td></tr>`))}`);
}
const vCustomers = () => `<div class="top"><h2>Customers</h2><button onclick="custForm()">+ New customer</button></div>` +
  tbl(['ID', 'Name', 'Phone', 'Repairs', 'Purchases', 'Balance', ''], S.customers.filter(hit).map(c => `<tr><td>${c.id}</td><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${S.repairs.filter(r => r.customerId === c.id).length}</td><td>${S.sales.filter(s => s.customerId === c.id).length}</td><td class="${custDue(c.id) ? 'neg' : ''}">${P(custDue(c.id))}</td><td><button class="sm ghost" onclick="custView('${c.id}')">View</button> <button class="sm ghost" onclick="custForm('${c.id}')">Edit</button></td></tr>`));

/* ---------- payments (shared by repairs & sales) ---------- */
function payForm(type, refId) {
  const r = type === 'repair' ? S.repairs.find(x => x.id === refId) : S.sales.find(x => x.id === refId);
  const bal = type === 'repair' ? repDue(r) : saleDue(r);
  if (bal <= 0) return toast('Nothing outstanding on ' + refId);
  form(`Record payment for ${refId}`, [{ n: 'amount', l: `Amount (outstanding ${P(bal)})`, t: 'number', r: 1 }, { n: 'method', l: 'Method', t: 'select', o: ['Cash', 'Mobile money', 'Card', 'Bank transfer'] }, { n: 'date', l: 'Date', t: 'date', v: today() }], async d => {
    const a = num(d.amount, 'Amount');
    if (a <= 0) throw new Error('Enter an amount above 0');
    if (a > bal + 0.001) throw new Error('Payment exceeds the outstanding balance of ' + P(bal));
    await put('payments', { id: uid('PAY', 'payments'), refType: type, refId, customerId: r.customerId, amount: a, method: d.method, date: d.date });
  });
}

/* ---------- repairs ---------- */
function repairForm(id) {
  if (!S.customers.length) return toast('Register a customer first', true);
  const r = S.repairs.find(x => x.id === id);
  form(r ? 'Edit repair ' + id : 'Receive device', [
    { n: 'customerId', l: 'Customer', t: 'select', o: S.customers.map(c => [c.id, `${c.name} (${c.phone})`]) },
    { n: 'type', l: 'Device type', t: 'select', o: ['Phone', 'Laptop', 'Tablet', 'Other electronics'] },
    { n: 'brand', l: 'Brand', r: 1, v: '' }, { n: 'model', l: 'Model', r: 1 }, { n: 'imei', l: 'IMEI / Serial' },
    { n: 'condition', l: 'Physical condition' }, { n: 'accessories', l: 'Accessories received' },
    { n: 'problem', l: 'Reported problem', t: 'textarea', r: 1 }, { n: 'diagnosis', l: 'Initial diagnosis / recommended repair', t: 'textarea' },
    { n: 'estimate', l: 'Quoted repair cost (P)', t: 'number', r: 1 }, { n: 'parts', l: 'Replacement parts needed' },
    { n: 'tech', l: 'Technician', t: 'select', o: techList() }, { n: 'expected', l: 'Expected completion', t: 'date' },
    { n: 'warranty', l: 'Warranty (days)', t: 'number', v: S.cfg.warranty }, { n: 'notes', l: 'Technician notes', t: 'textarea' }], async d => {
    const o = { ...d, estimate: num(d.estimate, 'Cost'), warranty: num(d.warranty, 'Warranty') };
    if (d.imei && S.repairs.some(x => x.imei === d.imei && x.id !== id && !['Collected', 'Cancelled'].includes(x.status))) throw new Error('This IMEI/serial already has an open repair');
    if (r) await put('repairs', { ...r, ...o });
    else await put('repairs', { id: uid('JOB', 'repairs'), ...o, received: today(), status: 'Received', history: [{ ts: new Date().toISOString(), status: 'Received' }] });
  }, r || {});
}
function statusForm(id) {
  const r = S.repairs.find(x => x.id === id);
  form('Update status – ' + id, [{ n: 'status', l: 'New status', t: 'select', o: STATUSES, v: r.status }, { n: 'note', l: 'Note (optional)' }], async d => {
    if (d.status === 'Collected' && repDue(r) > 0 && !confirm(`Customer still owes ${P(repDue(r))}. Mark as collected anyway?`)) throw new Error('Cancelled');
    if (d.status === 'Cancelled' && !confirm('Cancel this repair job? Payments already taken stay on record.')) throw new Error('Cancelled');
    await put('repairs', { ...r, status: d.status, history: [...r.history, { ts: new Date().toISOString(), status: d.status, note: d.note }] }, 'status → ' + d.status);
  });
}
function repairView(id) {
  const r = S.repairs.find(x => x.id === id), pays = S.payments.filter(p => p.refId === id);
  show(`<h3>${r.id} ${tag(r.status)}</h3><p><b>${esc(custName(r.customerId))}</b> · ${esc(r.type)}: ${esc(r.brand)} ${esc(r.model)} ${r.imei ? '· IMEI ' + esc(r.imei) : ''}</p>
  <p>Problem: ${esc(r.problem)}<br>Diagnosis: ${esc(r.diagnosis)}<br>Tech: ${esc(r.tech)} · Due: ${r.expected || '—'} · Warranty: ${r.warranty} days</p>
  <div class="grid">${card('Service value', P(repVal(r)))}${card('Paid', P(paidFor(id)))}${card('Balance', P(repDue(r)), 1)}</div>
  <h4>Payments</h4>${tbl(['Ref', 'Date', 'Amount', 'Method'], pays.map(p => `<tr><td>${p.id}</td><td>${p.date}</td><td>${P(p.amount)}</td><td>${p.method}</td></tr>`))}
  <h4>Status history</h4>${tbl(['When', 'Status', 'Note'], [...r.history].reverse().map(h => `<tr><td>${h.ts.slice(0, 16).replace('T', ' ')}</td><td>${h.status}</td><td>${esc(h.note || '')}</td></tr>`))}
  <div class="row"><button onclick="statusForm('${id}')">Update status</button><button onclick="payForm('repair','${id}')">Add payment</button><button class="ghost" onclick="repairForm('${id}')">Edit</button><button class="ghost" onclick="printRepair('${id}')">Print receipt</button></div>`);
}
function printRepair(id) {
  const r = S.repairs.find(x => x.id === id), c = S.customers.find(x => x.id === r.customerId) || {}, w = window.open('', '_blank');
  w.document.write(`<body style="font-family:Arial;max-width:380px"><h2>${esc(S.cfg.biz)}</h2><h3>Repair receipt ${r.id}</h3>
  <p>Date: ${r.received}<br>Customer: ${esc(c.name)} (${esc(c.phone)})<br>Device: ${esc(r.brand)} ${esc(r.model)} ${esc(r.imei || '')}<br>Accessories: ${esc(r.accessories || 'none')}<br>Condition: ${esc(r.condition || '')}<br>Problem: ${esc(r.problem)}</p>
  <p>Service value: ${P(repVal(r))}<br>Paid: ${P(paidFor(id))}<br><b>Balance: ${P(repDue(r))}</b><br>Warranty: ${r.warranty} days from collection</p><p>Signature: ____________</p></body>`);
  w.document.close(); w.print();
}
const vRepairs = () => `<div class="top"><h2>Repairs</h2><span><select onchange="RF=this.value;render()"><option value="">All statuses</option>${STATUSES.map(s => `<option ${RF === s ? 'selected' : ''}>${s}</option>`).join('')}</select> <button onclick="repairForm()">+ Receive device</button></span></div>` +
  tbl(['Job', 'Customer', 'Device', 'Status', 'Due', 'Value', 'Balance', ''], S.repairs.filter(r => (!RF || r.status === RF) && hit(r)).reverse().map(r => `<tr><td>${r.id}</td><td>${esc(custName(r.customerId))}</td><td>${esc(r.brand + ' ' + r.model)}</td><td>${tag(r.status)}</td><td>${r.expected || '—'}</td><td>${P(repVal(r))}</td><td class="${repDue(r) ? 'neg' : ''}">${P(repDue(r))}</td><td><button class="sm" onclick="repairView('${r.id}')">Open</button></td></tr>`));

/* ---------- inventory ---------- */
function prodForm(id) {
  const p = S.products.find(x => x.id === id);
  const f = [{ n: 'name', l: 'Product name', r: 1 }, { n: 'cat', l: 'Category', t: 'select', o: S.cfg.cats }, { n: 'compat', l: 'Device compatibility' }];
  if (!p) f.push({ n: 'qty', l: 'Opening quantity', t: 'number', v: 0 });
  f.push({ n: 'buy', l: 'Buying price (P)', t: 'number', r: 1 }, { n: 'sell', l: 'Selling price (P)', t: 'number', r: 1 }, { n: 'supplier', l: 'Supplier' }, { n: 'min', l: 'Low-stock alert at', t: 'number', v: S.cfg.lowDefault });
  form(p ? 'Edit product' : 'New product', f, async d => {
    const o = { name: d.name.trim(), cat: d.cat, compat: d.compat, buy: num(d.buy, 'Buying price'), sell: num(d.sell, 'Selling price'), supplier: d.supplier, min: num(d.min, 'Alert level') };
    if (p) return put('products', { ...p, ...o });
    const q = num(d.qty, 'Quantity'), np = { id: uid('PRD', 'products'), ...o, qty: q };
    await put('products', np);
    if (q > 0) await put('moves', { id: uid('MOV', 'moves'), productId: np.id, name: np.name, qty: q, type: 'Opening stock', date: today() });
  }, p || {});
}
function adjForm(id) {
  const p = S.products.find(x => x.id === id);
  form(`Adjust stock – ${p.name} (now ${p.qty})`, [{ n: 'change', l: 'Change (+ adds, − removes)', t: 'number" min="-100000', r: 1 }, { n: 'reason', l: 'Reason', r: 1 }], async d => {
    const c = parseFloat(d.change);
    if (isNaN(c) || c === 0) throw new Error('Enter a non-zero change');
    if (p.qty + c < 0) throw new Error('Stock cannot go below zero');
    await put('products', { ...p, qty: p.qty + c });
    await put('moves', { id: uid('MOV', 'moves'), productId: id, name: p.name, qty: c, type: 'Adjustment', reason: d.reason, date: today() });
  });
}
const vInventory = () => `<div class="top"><h2>Inventory</h2><button onclick="prodForm()">+ New product</button></div><div class="grid">${card('Units in stock', totals().stock)}${card('Stock value (cost)', P(totals().val), 1)}${card('Low-stock items', S.products.filter(low).length)}</div><h3>Products</h3>` +
  tbl(['ID', 'Product', 'Category', 'Compatible', 'Qty', 'Buy', 'Sell', 'Value', ''], S.products.filter(hit).map(p => `<tr><td>${p.id}</td><td>${esc(p.name)}</td><td>${esc(p.cat)}</td><td>${esc(p.compat)}</td><td>${low(p) ? `<span class="tag r">${p.qty} LOW</span>` : p.qty}</td><td>${P(p.buy)}</td><td>${P(p.sell)}</td><td>${P(p.qty * p.buy)}</td><td><button class="sm ghost" onclick="adjForm('${p.id}')">Adjust</button> <button class="sm ghost" onclick="prodForm('${p.id}')">Edit</button></td></tr>`)) +
  `<h3>Movement history</h3>` + tbl(['Date', 'Product', 'Change', 'Type', 'Reason'], [...S.moves].reverse().slice(0, 30).map(m => `<tr><td>${m.date}</td><td>${esc(m.name)}</td><td class="${m.qty < 0 ? 'neg' : ''}">${m.qty > 0 ? '+' : ''}${m.qty}</td><td>${m.type}</td><td>${esc(m.reason || m.ref || '')}</td></tr>`));

/* ---------- sales ---------- */
function saleForm() {
  const stock = S.products.filter(p => p.qty > 0);
  if (!stock.length) return toast('No products in stock. Add stock in Inventory first', true);
  form('Record sale', [{ n: 'productId', l: 'Product', t: 'select', o: stock.map(p => [p.id, `${p.name} (${p.qty} left) – ${P(p.sell)}`]) },
    { n: 'qty', l: 'Quantity', t: 'number', v: 1, r: 1 }, { n: 'price', l: 'Unit price (blank = list price)', t: 'number' },
    { n: 'customerId', l: 'Customer (required if not fully paid)', t: 'select', o: [['', 'Walk-in'], ...S.customers.map(c => [c.id, c.name])] },
    { n: 'paid', l: 'Amount paid now (P)', t: 'number', v: 0 }, { n: 'method', l: 'Payment method', t: 'select', o: ['Cash', 'Mobile money', 'Card', 'Bank transfer'] }], async d => {
    const p = S.products.find(x => x.id === d.productId), q = parseInt(d.qty), price = d.price === '' ? p.sell : num(d.price, 'Price'), paid = num(d.paid || 0, 'Paid');
    if (!(q > 0)) throw new Error('Quantity must be at least 1');
    if (q > p.qty) throw new Error(`Only ${p.qty} in stock`);
    const total = q * price;
    if (paid > total + 0.001) throw new Error('Paid amount exceeds the sale total');
    if (paid < total && !d.customerId) throw new Error('Select a customer to record an unpaid balance');
    const s = { id: uid('SAL', 'sales'), date: today(), productId: p.id, name: p.name, cat: p.cat, qty: q, price, cost: p.buy, total, customerId: d.customerId };   // price & cost snapshot protect history
    await put('sales', s);
    await put('products', { ...p, qty: p.qty - q });
    await put('moves', { id: uid('MOV', 'moves'), productId: p.id, name: p.name, qty: -q, type: 'Sale', ref: s.id, date: today() });
    if (paid > 0) await put('payments', { id: uid('PAY', 'payments'), refType: 'sale', refId: s.id, customerId: d.customerId, amount: paid, method: d.method, date: today() });
  });
}
const vSales = () => `<div class="top"><h2>Sales</h2><button onclick="saleForm()">+ Record sale</button></div><div class="grid">${card('Total sales', P(totals().sales))}${card('Cost of goods sold', P(totals().cogs))}${card('Est. gross profit', P(totals().gross), 1)}</div><h3>Sales log</h3>` +
  tbl(['Sale', 'Date', 'Item', 'Total', 'Paid', 'Balance', 'Customer', ''], S.sales.filter(hit).reverse().map(s => `<tr><td>${s.id}</td><td>${s.date}</td><td>${esc(s.name)} ×${s.qty}</td><td>${P(s.total)}</td><td>${P(paidFor(s.id))}</td><td class="${saleDue(s) ? 'neg' : ''}">${P(saleDue(s))}</td><td>${esc(custName(s.customerId))}</td><td>${saleDue(s) ? `<button class="sm" onclick="payForm('sale','${s.id}')">Pay</button>` : ''}</td></tr>`));

/* ---------- finance ---------- */
function expForm() {
  form('Record expense', [{ n: 'cat', l: 'Category', t: 'select', o: S.cfg.expCats }, { n: 'amount', l: 'Amount (P)', t: 'number', r: 1 }, { n: 'date', l: 'Date', t: 'date', v: today() }, { n: 'desc', l: 'Description' }], async d => {
    const a = num(d.amount, 'Amount'); if (a <= 0) throw new Error('Amount must be above 0');
    await put('expenses', { id: uid('EXP', 'expenses'), cat: d.cat, amount: a, date: d.date, desc: d.desc });
  });
}
const vFinance = () => { const t = totals(); return `<div class="top"><h2>Finance</h2><span><button onclick="expForm()">+ Expense</button> <button class="ghost" onclick="print()">Print</button></span></div>
  <div class="grid">${card('Income received (cash)', P(t.received), 1)}${card('Recorded sales', P(t.sales))}${card('Repair revenue (value)', P(t.repRev))}${card('Outstanding customers owe', P(t.out))}${card('Total expenses', P(t.exp))}${card('Est. gross profit (sales)', P(t.gross))}${card('Owed to suppliers', P(t.supOwed))}${card('Paid to suppliers', P(t.supPaid))}${card('Net operating result (cash)', P(t.net), 1)}</div>
  <p><small>Unpaid amounts are never counted as cash received. Net = money received − expenses − supplier payments. Do not also log supplier-paid purchases as expenses.</small></p>
  <h3>Payments received</h3>${tbl(['Ref', 'Date', 'For', 'Customer', 'Amount', 'Method'], [...S.payments].reverse().filter(hit).map(p => `<tr><td>${p.id}</td><td>${p.date}</td><td>${p.refId}</td><td>${esc(custName(p.customerId))}</td><td>${P(p.amount)}</td><td>${p.method}</td></tr>`))}
  <h3>Expenses</h3>${tbl(['Ref', 'Date', 'Category', 'Description', 'Amount'], [...S.expenses].reverse().filter(hit).map(e => `<tr><td>${e.id}</td><td>${e.date}</td><td>${esc(e.cat)}</td><td>${esc(e.desc)}</td><td>${P(e.amount)}</td></tr>`))}`; };

/* ---------- dashboard ---------- */
const panel = (t, rows) => `<div class="panel"><h4>${t}</h4>${rows.map(([l, v]) => `<div class="kv"><span>${l}</span><b>${v}</b></div>`).join('')}</div>`;
const kpi = (l, v, d) => `<div class="kpi ${d ? 'dark' : ''}"><small>${l}</small><b>${v}</b></div>`;
function vDashboard() {
  const t = totals(), rs = S.repairs, d = today(), m = d.slice(0, 7), sm = (a, k) => sum(a.filter(x => x.date === k), x => x.amount);
  const days = [...Array(7)].map((_, i) => { const x = dayAdd(d, i - 6); return { x, inc: sm(S.payments, x), ex: sm(S.expenses, x) }; });
  const mx = Math.max(1, ...days.flatMap(z => [z.inc, z.ex]));
  const pend = rs.filter(r => !DONE.includes(r.status) && r.status !== 'Cancelled').length;
  return `<div class="top"><h2>Dashboard</h2><button class="ghost" onclick="print()">Print daily summary</button></div>
  <div class="kpis">${kpi('Received this month', P(sum(S.payments.filter(p => p.date.startsWith(m)), p => p.amount)), 1)}${kpi('Customers owe you', P(t.out))}${kpi('Pending repairs', pend)}${kpi('Low-stock items', S.products.filter(low).length)}</div>
  <div class="cols"><div class="panel"><h4>Last 7 days</h4><div class="bars">${days.map(z => `<div><span><i style="height:${z.inc / mx * 100}px" title="${P(z.inc)}"></i><i class="e" style="height:${z.ex / mx * 100}px" title="${P(z.ex)}"></i></span>${z.x.slice(5)}</div>`).join('')}</div><div class="legend">Gold = money received · Dark = expenses</div></div>
  ${panel('Today', [['Received', P(sm(S.payments, d))], ['Expenses', P(sm(S.expenses, d))], ['New repairs', rs.filter(r => r.received === d).length], ['Sales', S.sales.filter(s => s.date === d).length]])}</div>
  <div class="cols3">${panel('Repairs', [['Total jobs', rs.length], ['Completed', rs.filter(r => DONE.includes(r.status)).length], ['Pending', pend], ['Awaiting collection', rs.filter(r => r.status === 'Awaiting collection').length]])}
  ${panel('Money', [['Total sales', P(t.sales)], ['Repair revenue', P(t.repRev)], ['Total expenses', P(t.exp)], ['Owed to suppliers', P(t.supOwed)]])}
  ${panel('Stock', [['Units in stock', t.stock], ['Stock value', P(t.val)], ['Expenses this month', P(sum(S.expenses.filter(e => e.date.startsWith(m)), e => e.amount))]])}</div>
  <h3>Open repairs</h3>${tbl(['Job', 'Customer', 'Device', 'Status', 'Due'], rs.filter(r => !['Collected', 'Cancelled'].includes(r.status)).slice(0, 8).map(r => `<tr><td>${r.id}</td><td>${esc(custName(r.customerId))}</td><td>${esc(r.brand + ' ' + r.model)}</td><td>${tag(r.status)}</td><td>${r.expected || '—'}</td></tr>`))}`;
}

/* ---------- settings, backup, audit ---------- */
const vSettings = () => `<div class="top"><h2>Settings &amp; Backup</h2></div>
  <button onclick="cfgForm()">Edit business settings &amp; lists</button> <button onclick="backup()">⬇ Backup (JSON)</button> <button class="ghost" onclick="$('#rf').click()">⬆ Restore backup</button>
  <input id="rf" type="file" accept=".json" hidden onchange="restore(this.files[0])">
  <p>Back up regularly: data is stored only in this browser. Clearing browser data erases it.</p>`;
function cfgForm() {
  const c = S.cfg, L = a => a.join(', ');
  form('Business settings (comma-separated lists)', [{ n: 'biz', l: 'Business name' }, { n: 'lowDefault', l: 'Default low-stock level', t: 'number' }, { n: 'warranty', l: 'Default warranty (days)', t: 'number' },
    { n: 'cats', l: 'Product categories', t: 'textarea' }, { n: 'brands', l: 'Device brands', t: 'textarea' }, { n: 'techs', l: 'Technicians / employees', t: 'textarea' }, { n: 'expCats', l: 'Expense categories', t: 'textarea' }], async d => {
    const l = s => s.split(',').map(x => x.trim()).filter(Boolean);
    await put('settings', { ...c, biz: d.biz, lowDefault: num(d.lowDefault, 'Low stock'), warranty: num(d.warranty, 'Warranty'), cats: l(d.cats), brands: l(d.brands), techs: l(d.techs), expCats: l(d.expCats) });
    S.cfg = S.settings.find(x => x.id === 'cfg');
  }, { ...c, cats: L(c.cats), brands: L(c.brands), techs: L(c.techs), expCats: L(c.expCats) });
}
function backup() {
  const data = {}; STORES.forEach(s => data[s] = S[s]);
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'wti', version: DB_VER, date: new Date().toISOString(), data })], { type: 'application/json' }));
  a.download = `wti-backup-${today()}.json`; a.click(); toast('Backup downloaded');
}
async function restore(f) {
  if (!f) return;
  try {
    const j = JSON.parse(await f.text()); if (j.app !== 'wti') throw 0;
    if (!confirm('WARNING: restoring REPLACES all current records with the backup. Continue?')) return;
    for (const s of STORES) { await idb('readwrite', s, st => st.clear()); for (const o of j.data[s] || []) await idb('readwrite', s, st => st.put(o)); }
    await loadAll(); render(); toast('Backup restored');
  } catch { toast('Invalid backup file', true); }
}
const vAudit = () => `<div class="top"><h2>Activity Log</h2></div>` + tbl(['When', 'Record', 'Action', 'Changes'], [...S.audit].reverse().filter(hit).slice(0, 150).map(a => `<tr><td>${a.ts.slice(0, 16).replace('T', ' ')}</td><td>${a.ref}</td><td>${esc(a.action)}</td><td>${esc(a.detail)}</td></tr>`));

/* ================= VERSION 2 MODULES ================= */
const dayAdd = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const grp = (a, k, v) => { const m = {}; a.forEach(x => m[k(x)] = (m[k(x)] || 0) + v(x)); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
const techList = () => ['Unassigned', ...new Set([...S.cfg.techs.filter(t => t !== 'Unassigned'), ...S.employees.filter(e => e.role === 'Technician').map(e => e.name)])];
const ROLES = ['Administrator', 'Business owner', 'Manager', 'Technician', 'Salesperson'];

/* ---------- suppliers ---------- */
const supBal = id => sum(S.supplierTx.filter(t => t.supplierId === id), t => t.type === 'purchase' ? t.amount : -t.amount);
function supForm(id) {
  const s = S.suppliers.find(x => x.id === id);
  form(s ? 'Edit supplier' : 'New supplier', [{ n: 'name', l: 'Supplier name', r: 1 }, { n: 'phone', l: 'Contact information', r: 1 }, { n: 'items', l: 'Products supplied' }], async d =>
    put('suppliers', { ...(s || { id: uid('SUP', 'suppliers') }), name: d.name.trim(), phone: d.phone.trim(), items: d.items }), s || {});
}
function purchForm(id) {
  form('Record purchase – ' + S.suppliers.find(x => x.id === id).name, [
    { n: 'productId', l: 'Add received stock to product (optional)', t: 'select', o: [['', '— none —'], ...S.products.map(p => [p.id, p.name])] },
    { n: 'qty', l: 'Quantity received', t: 'number', v: 0 }, { n: 'amount', l: 'Total cost (P)', t: 'number', r: 1 },
    { n: 'paid', l: 'Paid now (P)', t: 'number', v: 0 }, { n: 'date', l: 'Date', t: 'date', v: today() }], async d => {
    const a = num(d.amount, 'Cost'), paid = num(d.paid || 0, 'Paid'), q = parseInt(d.qty) || 0;
    if (a <= 0) throw new Error('Cost must be above 0');
    if (paid > a) throw new Error('Paid exceeds the purchase cost');
    if (d.productId && q <= 0) throw new Error('Enter the quantity received');
    const t = { id: uid('SPT', 'supplierTx'), supplierId: id, type: 'purchase', amount: a, date: d.date, productId: d.productId, qty: q };
    await put('supplierTx', t);
    if (d.productId) {
      const p = S.products.find(x => x.id === d.productId);
      await put('products', { ...p, qty: p.qty + q, buy: a / q, supplier: S.suppliers.find(x => x.id === id).name });
      await put('moves', { id: uid('MOV', 'moves'), productId: p.id, name: p.name, qty: q, type: 'Supplier purchase', ref: t.id, date: d.date });
    }
    if (paid > 0) await put('supplierTx', { id: uid('SPT', 'supplierTx'), supplierId: id, type: 'payment', amount: paid, date: d.date, note: 'with ' + t.id });
  });
}
function supPayForm(id) {
  const bal = supBal(id); if (bal <= 0) return toast('Nothing owed to this supplier');
  form(`Pay supplier (owed ${P(bal)})`, [{ n: 'amount', l: 'Amount (P)', t: 'number', r: 1 }, { n: 'date', l: 'Date', t: 'date', v: today() }], async d => {
    const a = num(d.amount, 'Amount'); if (a <= 0 || a > bal + 0.001) throw new Error('Amount must be above 0 and not more than ' + P(bal));
    await put('supplierTx', { id: uid('SPT', 'supplierTx'), supplierId: id, type: 'payment', amount: a, date: d.date });
  });
}
const supHist = id => show(`<h3>${esc(S.suppliers.find(x => x.id === id).name)} – history</h3>` + tbl(['Ref', 'Date', 'Type', 'Amount'], S.supplierTx.filter(t => t.supplierId === id).reverse().map(t => `<tr><td>${t.id}</td><td>${t.date}</td><td>${t.type}</td><td>${P(t.amount)}</td></tr>`)));
const vSuppliers = () => `<div class="top"><h2>Suppliers</h2><button onclick="supForm()">+ New supplier</button></div><div class="grid">${card('Owed to suppliers', P(totals().supOwed), 1)}${card('Paid to suppliers', P(totals().supPaid))}</div><h3>Suppliers</h3>` +
  tbl(['ID', 'Name', 'Contact', 'Supplies', 'Purchased', 'Paid', 'Balance', ''], S.suppliers.filter(hit).map(s => { const tx = S.supplierTx.filter(t => t.supplierId === s.id); return `<tr><td>${s.id}</td><td>${esc(s.name)}</td><td>${esc(s.phone)}</td><td>${esc(s.items)}</td><td>${P(sum(tx.filter(t => t.type === 'purchase'), t => t.amount))}</td><td>${P(sum(tx.filter(t => t.type === 'payment'), t => t.amount))}</td><td class="${supBal(s.id) ? 'neg' : ''}">${P(supBal(s.id))}</td><td><button class="sm" onclick="purchForm('${s.id}')">Purchase</button> <button class="sm" onclick="supPayForm('${s.id}')">Pay</button> <button class="sm ghost" onclick="supHist('${s.id}')">History</button> <button class="sm ghost" onclick="supForm('${s.id}')">Edit</button></td></tr>`; }));

/* ---------- warranty & returns ---------- */
function warForm() {
  const refs = [...S.repairs.filter(r => r.status === 'Collected').map(r => [r.id, `${r.id} – ${r.brand} ${r.model}`]), ...S.sales.map(s => [s.id, `${s.id} – ${s.name}`])];
  if (!refs.length) return toast('Needs a collected repair or a recorded sale', true);
  form('New warranty', [{ n: 'refId', l: 'Repair or sale', t: 'select', o: refs }, { n: 'start', l: 'Start date', t: 'date', v: today() }, { n: 'days', l: 'Warranty days', t: 'number', v: S.cfg.warranty }, { n: 'conditions', l: 'Conditions', t: 'textarea' }], async d => {
    if (S.warranties.some(w => w.refId === d.refId)) throw new Error('This item already has a warranty');
    const r = S.repairs.find(x => x.id === d.refId) || S.sales.find(x => x.id === d.refId);
    await put('warranties', { id: uid('WAR', 'warranties'), refId: d.refId, customerId: r.customerId, item: r.model ? `${r.brand} ${r.model}` : r.name, start: d.start, expiry: dayAdd(d.start, num(d.days, 'Days')), conditions: d.conditions, status: 'Active' });
  });
}
function retForm(id) {
  const w = S.warranties.find(x => x.id === id);
  form('Return / claim – ' + w.item, [{ n: 'reason', l: 'Return reason', t: 'textarea', r: 1 }, { n: 'resolution', l: 'Resolution', t: 'select', o: ['Pending', 'Repaired again', 'Replaced', 'Refunded', 'Rejected'] }], async d => {
    if (w.expiry < today() && !confirm('This warranty has expired. Log the return anyway?')) throw new Error('Cancelled');
    await put('warranties', { ...w, reason: d.reason, resolution: d.resolution, status: d.resolution === 'Pending' ? 'Return open' : 'Resolved' });
  }, w);
}
const vWarranty = () => `<div class="top"><h2>Warranty &amp; Returns</h2><button onclick="warForm()">+ New warranty</button></div><p><small>Refunds: also record the money returned as an expense so Finance stays accurate.</small></p>` +
  tbl(['ID', 'Customer', 'Item', 'Ref', 'Expires', 'Status', 'Return / resolution', ''], S.warranties.filter(hit).map(w => `<tr><td>${w.id}</td><td>${esc(custName(w.customerId))}</td><td>${esc(w.item)}</td><td>${w.refId}</td><td>${w.expiry}</td><td><span class="tag ${w.expiry < today() ? 'r' : w.status === 'Active' ? 'g' : 'y'}">${w.expiry < today() && w.status === 'Active' ? 'Expired' : w.status}</span></td><td>${esc(w.reason ? w.reason + ' → ' + w.resolution : '')}</td><td><button class="sm ghost" onclick="retForm('${w.id}')">Log return</button></td></tr>`));

/* ---------- employees ---------- */
function empForm(id) {
  const e = S.employees.find(x => x.id === id);
  form(e ? 'Edit employee' : 'New employee', [{ n: 'name', l: 'Name', r: 1 }, { n: 'role', l: 'Role', t: 'select', o: ROLES }, { n: 'phone', l: 'Phone' }], d => put('employees', { ...(e || { id: uid('EMP', 'employees') }), name: d.name.trim(), role: d.role, phone: d.phone }), e || {});
}
const vEmployees = () => `<div class="top"><h2>Employees</h2><button onclick="empForm()">+ New employee</button></div><p><small>Roles are recorded now; login and permission enforcement arrive with the multi-user version.</small></p>` +
  tbl(['ID', 'Name', 'Role', 'Phone', 'Jobs assigned', 'Completed', ''], S.employees.filter(hit).map(e => { const j = S.repairs.filter(r => r.tech === e.name); return `<tr><td>${e.id}</td><td>${esc(e.name)}</td><td>${e.role}</td><td>${esc(e.phone)}</td><td>${j.length}</td><td>${j.filter(r => DONE.includes(r.status)).length}</td><td><button class="sm ghost" onclick="empForm('${e.id}')">Edit</button></td></tr>`; }));

/* ---------- tasks & projects ---------- */
function taskForm(id) {
  const t = S.tasks.find(x => x.id === id);
  form(t ? 'Edit task' : 'New task / project', [{ n: 'name', l: 'Task or project name', r: 1 }, { n: 'desc', l: 'Description', t: 'textarea' }, { n: 'owner', l: 'Responsible person', t: 'select', o: ['Unassigned', ...S.employees.map(e => e.name)] },
    { n: 'start', l: 'Start date', t: 'date', v: today() }, { n: 'due', l: 'Expected completion', t: 'date' }, { n: 'status', l: 'Status', t: 'select', o: ['Not started', 'In progress', 'Blocked', 'Done'] },
    { n: 'followUp', l: 'Follow-up reminder date', t: 'date' }, { n: 'notes', l: 'Notes', t: 'textarea' }], d => put('tasks', { ...(t || { id: uid('TSK', 'tasks') }), ...d }), t || {});
}
const vTasks = () => `<div class="top"><h2>Tasks &amp; Projects</h2><button onclick="taskForm()">+ New task</button></div>` +
  tbl(['ID', 'Task', 'Owner', 'Due', 'Follow-up', 'Status', ''], [...S.tasks].filter(hit).sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1).map(t => `<tr><td>${t.id}</td><td>${esc(t.name)}<br><small>${esc(t.desc)}</small></td><td>${esc(t.owner)}</td><td class="${t.due && t.due < today() && t.status !== 'Done' ? 'neg' : ''}">${t.due || '—'}</td><td>${t.followUp || '—'}</td><td>${tag2(t.status)}</td><td><button class="sm ghost" onclick="taskForm('${t.id}')">Update</button></td></tr>`));
const tag2 = s => `<span class="tag ${s === 'Done' ? 'g' : s === 'Blocked' ? 'r' : 'y'}">${s}</span>`;

/* ---------- reports & analytics ---------- */
let RP = 'month';
const rangeFrom = () => RP === 'today' ? today() : RP === 'week' ? dayAdd(today(), -((new Date().getDay() + 6) % 7)) : RP === 'month' ? today().slice(0, 7) + '-01' : '0000-00-00';
function vReports() {
  const f = rangeFrom(), In = x => x.date >= f;
  const pay = S.payments.filter(In), sl = S.sales.filter(In), ex = S.expenses.filter(In), sp = S.supplierTx.filter(t => t.type === 'payment' && In(t)), rp = S.repairs.filter(r => r.received >= f);
  const rec = sum(pay, p => p.amount), sales = sum(sl, s => s.total), cogs = sum(sl, s => s.qty * s.cost), exp = sum(ex, e => e.amount), sup = sum(sp, p => p.amount);
  const rows = l => l.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${P(v)}</td></tr>`);
  const techs = grp(S.repairs.filter(r => r.status !== 'Cancelled'), r => r.tech || 'Unassigned', () => 1);
  const debt = S.customers.map(c => [c.name, custDue(c.id)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  return `<div class="top"><h2>Reports</h2><span>${['today', 'week', 'month', 'all'].map(p => `<button class="${RP === p ? '' : 'ghost'}" onclick="RP='${p}';render()">${p[0].toUpperCase() + p.slice(1)}</button>`).join(' ')} <button class="ghost" onclick="print()">Print</button> <button class="ghost" onclick="exportCsv()">Export CSV</button></span></div>
  <div class="grid">${card('Cash received', P(rec), 1)}${card('Sales recorded', P(sales))}${card('Gross profit', P(sales - cogs))}${card('Margin', (sales ? (sales - cogs) / sales * 100 : 0).toFixed(1) + '%')}${card('Expenses', P(exp))}${card('Supplier payments', P(sup))}${card('Net result (cash)', P(rec - exp - sup), 1)}${card('Repairs received', rp.length)}${card('Repairs completed', rp.filter(r => DONE.includes(r.status)).length)}${card('Avg repair value', P(rp.length ? sum(rp, repVal) / rp.length : 0))}</div>
  <h3>Sales by category</h3>${tbl(['Category', 'Sales'], rows(grp(sl, s => s.cat, s => s.total)))}
  <h3>Expenses by category</h3>${tbl(['Category', 'Amount'], rows(grp(ex, e => e.cat, e => e.amount)))}
  <h3>Technician workload (all time)</h3>${tbl(['Technician', 'Jobs', 'Completed'], techs.map(([t, n]) => `<tr><td>${esc(t)}</td><td>${n}</td><td>${S.repairs.filter(r => (r.tech || 'Unassigned') === t && DONE.includes(r.status)).length}</td></tr>`))}
  <h3>Outstanding customer debts</h3>${tbl(['Customer', 'Owes'], rows(debt))}
  <h3>Stock valuation: ${P(totals().val)}</h3>`;
}
function exportCsv() {
  const f = rangeFrom(), In = x => x.date >= f, q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const r = [['type', 'date', 'ref', 'detail', 'amount'], ...S.sales.filter(In).map(s => ['sale', s.date, s.id, s.name + ' x' + s.qty, s.total]), ...S.payments.filter(In).map(p => ['payment', p.date, p.id, p.refId, p.amount]), ...S.expenses.filter(In).map(e => ['expense', e.date, e.id, e.cat + ' ' + e.desc, e.amount]), ...S.supplierTx.filter(In).map(t => ['supplier ' + t.type, t.date, t.id, t.supplierId, t.amount])];
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.map(x => x.map(q).join(',')).join('\n')], { type: 'text/csv' })); a.download = `wti-report-${RP}-${today()}.csv`; a.click();
}
function extraAlerts() {
  const d = today(), soon = dayAdd(d, 14);
  const w = S.warranties.filter(x => x.expiry >= d && x.expiry <= soon && x.status === 'Active'), t = S.tasks.filter(x => x.status !== 'Done' && ((x.due && x.due < d) || (x.followUp && x.followUp <= d)));
  return (w.length ? `<div class="alert">🛡 Warranties expiring within 14 days: ${w.map(x => x.id + ' ' + esc(x.item)).join(', ')}</div>` : '') + (t.length ? `<div class="alert">📌 Tasks overdue or due for follow-up: ${t.map(x => esc(x.name)).join(', ')}</div>` : '');
}

/* ---------- shell ---------- */
const VIEWS = { dashboard: vDashboard, customers: vCustomers, repairs: vRepairs, sales: vSales, inventory: vInventory, finance: vFinance, settings: vSettings, audit: vAudit, suppliers: vSuppliers, warranty: vWarranty, tasks: vTasks, employees: vEmployees, reports: vReports };
function render() {
  $('#view').innerHTML = VIEWS[V]();
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === V));
  document.title = S.cfg.biz + ' – Business Manager';
  const lows = S.products.filter(low), over = S.repairs.filter(r => r.expected && r.expected < today() && !['Completed', 'Awaiting collection', 'Collected', 'Cancelled'].includes(r.status));
  $('#alerts').innerHTML = extraAlerts() + (lows.length ? `<div class="alert">⚠ Low stock: ${lows.map(p => esc(p.name) + ' (' + p.qty + ')').join(', ')}</div>` : '') + (over.length ? `<div class="alert">⏰ Overdue repairs: ${over.map(r => r.id).join(', ')}</div>` : '');
  const pend = ['customers', 'repairs', 'products', 'sales', 'payments', 'expenses', 'moves', 'suppliers', 'supplierTx', 'warranties', 'employees', 'tasks'].reduce((n, s) => n + S[s].filter(x => !x.synced).length, 0);
  $('#sync').textContent = `💾 Saved locally · ${pend} not yet synced (cloud sync planned)`;
}
function netStatus() { const o = navigator.onLine; $('#net').innerHTML = `<span class="${o ? 'on-l' : 'off-l'}">● ${o ? 'Online' : 'Offline – working locally'}</span>`; }
document.addEventListener('DOMContentLoaded', async () => {
  try { await openDB(); await loadAll(); } catch (e) { document.body.innerHTML = '<p style="padding:20px">This browser cannot open the local database: ' + e + '</p>'; return; }
  $('#nav').onclick = e => { const a = e.target.closest('a'); if (a) { V = a.dataset.v; Q = ''; $('#search').value = ''; $('#side').classList.remove('open'); render(); } };
  if (localStorage.getItem('wti-collapsed') === '1') document.body.classList.add('collapsed');
  $('#burger').onclick = () => { if (innerWidth <= 800) $('#side').classList.toggle('open'); else localStorage.setItem('wti-collapsed', document.body.classList.toggle('collapsed') ? '1' : '0'); };
  $('#search').oninput = e => { Q = e.target.value.toLowerCase(); render(); };
  addEventListener('online', netStatus); addEventListener('offline', netStatus); netStatus(); render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();   // ask browser not to evict data
});
