'use strict';
/* PAGES (part 2): suppliers, purchases, customers, expenses, cash register, reports, users, settings & backup */

/* ================= SUPPLIERS ================= */
const partyFields = (c = {}, isSup) => [{ k: 'name', l: isSup ? 'Company name' : 'Full name', v: c.name, req: 1, cls: 'full' }, { k: 'contact', l: 'Contact person', v: c.contact }, { k: 'phone', l: 'Phone', v: c.phone }, { k: 'whatsapp', l: 'WhatsApp', v: c.whatsapp }, { k: 'email', l: 'Email', v: c.email },
  isSup ? { k: 'terms', l: 'Payment terms', v: c.terms } : { k: 'type', l: 'Type', t: 'select', o: ['Retail', 'Wholesale'], v: c.type }, { k: 'limit', l: 'Credit limit (0 = none)', t: 'number', v: c.limit ?? 0 }, ...(c.id ? [] : [{ k: 'balance', l: 'Opening balance', t: 'number', v: 0 }]), { k: 'address', l: 'Address', v: c.address, cls: 'full' }, { k: 'notes', l: 'Notes', t: 'textarea', v: c.notes, cls: 'full' }];
let supq = '';
P.suppliers = () => {
  const bal = db.suppliers.reduce((a, s) => a + Math.max(s.balance || 0, 0), 0), mo = db.purchases.filter(p => p.day >= monthStart()).reduce((a, p) => a + p.total, 0), tdy = db.purchases.filter(p => p.day === ymd()).reduce((a, p) => a + p.total, 0);
  view(`${hdr('Suppliers', '<button class="btn" data-act="supCSV">Export CSV</button><button class="btn btn-p" data-act="newSup">+ New supplier</button>')}<div class="cards"><div class="card stat"><small>Suppliers</small><b>${db.suppliers.filter(s => s.active !== false).length}</b></div><div class="card stat"><small>Purchases today</small><b>${money(tdy)}</b></div><div class="card stat"><small>Purchases this month</small><b>${money(mo)}</b></div><div class="card stat acc"><small>Outstanding balances</small><b>${money(bal)}</b></div></div><div class="filters"><input data-in="supq" placeholder="Search…" style="width:300px"></div><div id="list"></div>`); drawSup();
};
function drawSup() { const q = supq.toLowerCase();
  $('#list').innerHTML = tbl(['Supplier', 'Phone', 'Terms', '>We owe', ''], db.suppliers.filter(s => s.active !== false && (!q || (s.name + s.phone + s.contact).toLowerCase().includes(q))).map(s => `<tr><td><b>${esc(s.name)}</b><br><small class="mut">${esc(s.contact || '')}</small></td><td>${esc(s.phone || '')}</td><td>${esc(s.terms || '')}</td><td class="r b" style="color:${s.balance > 0 ? 'var(--bad)' : ''}">${money(s.balance)}</td><td class="r" style="white-space:nowrap"><button class="btn btn-s btn-p" data-act="paySup" data-id="${s.id}">Pay</button> <button class="btn btn-s" data-act="stmtSup" data-id="${s.id}">Statement</button> <button class="btn btn-s" data-act="editSup" data-id="${s.id}">Edit</button> <button class="btn btn-s btn-d" data-act="archSup" data-id="${s.id}">Archive</button></td></tr>`)); }
I.supq = v => { supq = v; drawSup(); };
A.newSup = () => formModal('New supplier', partyFields({}, 1), v => { db.suppliers.push({ id: uid(), active: true, ...v }); save(); P.suppliers(); }, 'Create');
A.editSup = id => { const s = sup(id); formModal('Edit supplier', partyFields(s, 1), v => { Object.assign(s, v); save(); P.suppliers(); }); };
A.archSup = id => { sup(id).active = false; save(); P.suppliers(); };
A.paySup = id => { const s = sup(id); formModal('Pay supplier – ' + s.name, [{ k: 'amount', l: 'Amount', t: 'number', v: Math.max(s.balance, 0), req: 1 }, { k: 'method', l: 'Method', t: 'select', o: methods() }, { k: 'note', l: 'Reference / note' }], v => {
  if (v.amount <= 0) return 'Invalid amount'; s.balance = r2(s.balance - v.amount); db.payments.push({ id: uid(), type: 'supplier', party: id, amount: v.amount, method: v.method, note: v.note, at: nowISO(), day: ymd(), user: me.name }); log('supplier payment', s.name + ' ' + v.amount); save(); P.suppliers(); }, 'Record payment'); };
A.stmtSup = id => { const s = sup(id), rows = [...db.purchases.filter(p => p.supplier === id).map(p => ({ at: p.at, d: `Purchase ${p.no} ${p.invoice || ''}`, dr: p.total, cr: 0 })), ...db.payments.filter(p => p.type === 'supplier' && p.party === id).map(p => ({ at: p.at, d: 'Payment ' + p.method, dr: 0, cr: p.amount }))].sort((a, b) => a.at.localeCompare(b.at));
  modal('Statement – ' + s.name, tbl(['Date', 'Details', '>Purchases', '>Paid'], rows.map(r => `<tr><td>${dt(r.at)}</td><td>${esc(r.d)}</td><td class="r">${r.dr ? money(r.dr) : ''}</td><td class="r">${r.cr ? money(r.cr) : ''}</td></tr>`)) + `<p class="b">Balance owed: ${money(s.balance)}</p>`, `<button class="btn btn-p" data-act="printStmt" data-id="${id}">Print</button>`, true); };
A.printStmt = (id, el) => printHTML(`<h2>${esc(S().business)}</h2>` + el.closest('.modal').querySelector('.mb').innerHTML, 'table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ccc;padding:4px;text-align:left}.r{text-align:right}');
A.supCSV = () => download('suppliers.csv', toCSV([['Name', 'Phone', 'Email', 'Balance'], ...db.suppliers.map(s => [s.name, s.phone, s.email, s.balance])]));

/* ================= PURCHASES / GOODS RECEIVING ================= */
let pnew = null;
P.purchases = () => {
  if (pnew) return drawPurchaseForm();
  view(`${hdr('Purchases & Goods Receiving', '<button class="btn btn-p" data-act="newPur">+ New purchase / receive stock</button>')}${tbl(['No', 'Date', 'Supplier', 'Invoice', '>Total', '>Paid', ''], db.purchases.slice().reverse().slice(0, 200).map(p => `<tr><td><b>${esc(p.no)}</b></td><td>${dt(p.at)}</td><td>${esc(sup(p.supplier)?.name || '-')}</td><td>${esc(p.invoice || '')}</td><td class="r">${money(p.total)}</td><td class="r">${money(p.paid)}</td><td class="r"><button class="btn btn-s" data-act="viewPur" data-id="${p.id}">View</button></td></tr>`))}`);
};
A.newPur = () => { pnew = { supplier: '', invoice: '', freight: 0, discount: 0, paid: '', method: 'Cash', lines: [] }; P.purchases(); };
function purTotal() { return r2(pnew.lines.reduce((a, l) => a + l.qty * l.cost, 0) + num(pnew.freight) - num(pnew.discount)); }
function drawPurchaseForm() {
  view(`${hdr('New purchase', '<button class="btn" data-act="cancelPur">Cancel</button>')}<div class="card"><div class="fg" style="grid-template-columns:repeat(4,1fr)">
<label class="f"><span>Supplier *</span><select data-in="psup"><option value="">Select…</option>${db.suppliers.filter(s => s.active !== false).map(s => `<option value="${s.id}" ${pnew.supplier === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
<label class="f"><span>Supplier invoice no.</span><input data-in="pinv" value="${esc(pnew.invoice)}"></label><label class="f"><span>Freight / landed cost</span><input type="number" data-in="pfr" value="${pnew.freight || ''}"></label><label class="f"><span>Discount</span><input type="number" data-in="pdis" value="${pnew.discount || ''}"></label></div></div><br>
<div class="card"><b>Add item</b><div class="fg" style="grid-template-columns:2fr 1fr 1fr auto;margin-top:8px"><select id="np"><option value="">Select product…</option>${db.products.filter(p => p.active !== false).map(p => `<option value="${p.id}">${esc(p.name)} ${esc(p.model || '')} ${p.tracked ? '(IMEI)' : ''}</option>`).join('')}</select><input id="nq" type="number" placeholder="Qty (non-IMEI)"><input id="nc" type="number" placeholder="Unit cost"><button class="btn btn-p" data-act="addPurLine">Add</button><textarea id="nd" rows="3" class="full" style="grid-column:1/-1" placeholder="For IMEI products: one IMEI per line (IMEI or IMEI,IMEI2). Quantity = number of lines."></textarea></div></div><br>
<div id="plines"></div><div class="card" style="margin-top:14px"><div class="fg" style="grid-template-columns:repeat(3,1fr)"><label class="f"><span>Paid now</span><input type="number" data-in="ppaid" value="${pnew.paid}" placeholder="0 = on credit"></label><label class="f"><span>Method</span><select data-in="pmeth">${methods().map(m => `<option ${m === pnew.method ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label><div><div class="mut sm">Total</div><b style="font-size:22px" id="ptot"></b></div></div><br><button class="btn btn-p btn-lg" data-act="savePur">Receive stock & save purchase</button></div>`); drawPurLines();
}
function drawPurLines() { $('#plines').innerHTML = tbl(['Product', '>Qty', '>Cost', '>Line', ''], pnew.lines.map((l, n) => `<tr><td>${esc(prod(l.pid).name)}${l.devs ? `<br><small class="mut">${esc(l.devs.map(d => d.imei).join(', '))}</small>` : ''}</td><td class="r">${l.qty}</td><td class="r">${money(l.cost)}</td><td class="r">${money(l.qty * l.cost)}</td><td class="r"><button class="btn btn-s btn-d" data-act="rmPurLine" data-id="${n}">✕</button></td></tr>`), 'No items added'); $('#ptot').textContent = money(purTotal()); }
I.psup = v => pnew.supplier = v; I.pinv = v => pnew.invoice = v; I.pfr = v => { pnew.freight = num(v); $('#ptot').textContent = money(purTotal()); }; I.pdis = v => { pnew.discount = num(v); $('#ptot').textContent = money(purTotal()); }; I.ppaid = v => pnew.paid = v; I.pmeth = v => pnew.method = v;
A.cancelPur = () => { pnew = null; P.purchases(); };
A.rmPurLine = n => { pnew.lines.splice(+n, 1); drawPurLines(); };
A.addPurLine = () => {
  const p = prod($('#np').value); if (!p) return toast('Select a product', 'err'); const cost = num($('#nc').value);
  if (p.tracked) { const used = pnew.lines.flatMap(l => (l.devs || []).flatMap(d => [d.imei, d.imei2].filter(Boolean))); const r = parseDevices($('#nd').value, used); if (r.errors.length) return toast(r.errors.join('; '), 'err'); if (!r.items.length) return toast('Enter IMEI numbers', 'err'); pnew.lines.push({ pid: p.id, qty: r.items.length, cost, devs: r.items }); $('#nd').value = ''; }
  else { const q = num($('#nq').value); if (q <= 0) return toast('Enter quantity', 'err'); pnew.lines.push({ pid: p.id, qty: q, cost }); }
  $('#nq').value = ''; $('#nc').value = ''; drawPurLines();
};
A.savePur = () => {
  if (!pnew.supplier) return toast('Select a supplier', 'err'); if (!pnew.lines.length) return toast('Add items', 'err');
  const total = purTotal(), paid = pnew.paid === '' ? 0 : num(pnew.paid); if (paid > total) return toast('Paid exceeds total', 'err');
  const extra = r2(num(pnew.freight) - num(pnew.discount)), base = pnew.lines.reduce((a, l) => a + l.qty * l.cost, 0), no = nextNo('pur', S().purPrefix);
  pnew.lines.forEach(l => { const p = prod(l.pid), landed = base ? r2(l.cost + extra * (l.cost / base)) : l.cost, cur = stockOf(p);   // weighted average cost incl. landed cost
    p.cost = r2((cur * p.cost + l.qty * landed) / (cur + l.qty)); p.lastCost = landed; p.lastPurchase = nowISO();
    if (l.devs) { l.devs.forEach(d => p.devs.push({ id: uid(), imei: d.imei, imei2: d.imei2, status: 'in', cost: landed, at: nowISO(), purchase: no })); recount(p); } else p.stock += l.qty;
    move(p, l.qty, 'purchase', no); });
  const s = sup(pnew.supplier); s.balance = r2((s.balance || 0) + total - paid);
  db.purchases.push({ id: uid(), no, at: nowISO(), day: ymd(), supplier: pnew.supplier, invoice: pnew.invoice, freight: num(pnew.freight), discount: num(pnew.discount), total, paid, method: pnew.method, user: me.name, lines: pnew.lines.map(l => ({ pid: l.pid, name: prod(l.pid).name, qty: l.qty, cost: l.cost, imeis: (l.devs || []).map(d => d.imei) })) });
  if (paid > 0) db.payments.push({ id: uid(), type: 'supplier', party: pnew.supplier, amount: paid, method: pnew.method, note: no, at: nowISO(), day: ymd(), user: me.name });
  log('purchase', no + ' ' + money(total)); save(); pnew = null; toast('Stock received: ' + no); P.purchases();
};
A.viewPur = id => { const p = db.purchases.find(x => x.id === id); modal('Purchase ' + p.no, `<p>${esc(sup(p.supplier)?.name || '')} · ${dt(p.at)} · Invoice ${esc(p.invoice || '-')}</p>` + tbl(['Item', '>Qty', '>Cost'], p.lines.map(l => `<tr><td>${esc(l.name)}${l.imeis.length ? `<br><small>${esc(l.imeis.join(', '))}</small>` : ''}</td><td class="r">${l.qty}</td><td class="r">${money(l.cost)}</td></tr>`)) + `<p class="b">Total ${money(p.total)} · Paid ${money(p.paid)}</p>`, `<button class="btn btn-p" data-act="printStmt">Print</button>`, true); };

/* ================= CUSTOMERS ================= */
let cq = '';
P.customers = () => { view(`${hdr('Customers', '<button class="btn" data-act="cusCSV">Export CSV</button><button class="btn btn-p" data-act="newCus">+ New customer</button>')}<div class="filters"><input data-in="cq" placeholder="Search name / phone…" style="width:300px"></div><div id="list"></div>`); drawCus(); };
function drawCus() { const q = cq.toLowerCase(); $('#list').innerHTML = tbl(['Customer', 'Phone', 'Type', '>Owes us', ''], db.customers.filter(c => !q || (c.name + c.phone).toLowerCase().includes(q)).map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.phone || '')}</td><td>${esc(c.type || '')}</td><td class="r b" style="color:${c.balance > 0 ? 'var(--bad)' : ''}">${money(c.balance)}</td><td class="r" style="white-space:nowrap"><button class="btn btn-s btn-p" data-act="payCus" data-id="${c.id}">Receive payment</button> <button class="btn btn-s" data-act="stmtCus" data-id="${c.id}">History</button> <button class="btn btn-s" data-act="editCus" data-id="${c.id}">Edit</button></td></tr>`)); }
I.cq = v => { cq = v; drawCus(); };
A.newCus = () => formModal('New customer', partyFields({}, 0), v => { db.customers.push({ id: uid(), ...v }); save(); P.customers(); }, 'Create');
A.editCus = id => { const c = cust(id); formModal('Edit customer', partyFields(c, 0), v => { Object.assign(c, v); save(); P.customers(); }); };
A.payCus = id => { const c = cust(id); formModal('Payment from ' + c.name, [{ k: 'amount', l: 'Amount', t: 'number', v: Math.max(c.balance, 0), req: 1 }, { k: 'method', l: 'Method', t: 'select', o: methods() }, { k: 'note', l: 'Note' }], v => {
  if (v.amount <= 0) return 'Invalid amount'; c.balance = r2(c.balance - v.amount); db.payments.push({ id: uid(), type: 'customer', party: id, amount: v.amount, method: v.method, note: v.note, at: nowISO(), day: ymd(), user: me.name }); log('customer payment', c.name + ' ' + v.amount); save(); P.customers(); }, 'Record payment'); };
A.stmtCus = id => { const c = cust(id), rows = [...db.sales.filter(s => s.customerId === id && s.status === 'done').map(s => ({ at: s.at, d: 'Sale ' + s.no, a: s.total, k: 'dr' })), ...db.payments.filter(p => p.type === 'customer' && p.party === id).map(p => ({ at: p.at, d: 'Payment ' + p.method, a: p.amount, k: 'cr' }))].sort((a, b) => a.at.localeCompare(b.at));
  modal('History – ' + c.name, tbl(['Date', 'Details', '>Amount'], rows.map(r => `<tr><td>${dt(r.at)}</td><td>${esc(r.d)}</td><td class="r">${r.k === 'cr' ? '−' : ''}${money(r.a)}</td></tr>`)) + `<p class="b">Balance: ${money(c.balance)}</p>`, '', true); };
A.cusCSV = () => download('customers.csv', toCSV([['Name', 'Phone', 'Email', 'Type', 'Balance'], ...db.customers.map(c => [c.name, c.phone, c.email, c.type, c.balance])]));

/* ================= EXPENSES ================= */
let ef = { from: monthStart(), to: ymd() };
P.expenses = () => { view(`${hdr('Expenses', '<button class="btn" data-act="expCSV">Export CSV</button><button class="btn btn-p" data-act="newExp">+ Add expense</button>')}<div class="filters"><label class="mut">From <input type="date" data-in="efrom" value="${ef.from}"></label><label class="mut">To <input type="date" data-in="eto" value="${ef.to}"></label></div><div id="list"></div>`); drawExp(); };
const expList = () => db.expenses.filter(e => e.date >= ef.from && e.date <= ef.to).sort((a, b) => b.date.localeCompare(a.date));
function drawExp() { const l = expList(); $('#list').innerHTML = `<p class="mut">Total: <b>${money(l.filter(e => !e.void).reduce((a, e) => a + e.amount, 0))}</b></p>` + tbl(['Date', 'Category', 'Description', 'Paid to', 'Method', '>Amount', ''], l.map(e => `<tr style="${e.void ? 'opacity:.45;text-decoration:line-through' : ''}"><td>${e.date}</td><td>${esc(e.cat)}</td><td>${esc(e.desc)}</td><td>${esc(e.to || '')}</td><td>${esc(e.method)}</td><td class="r">${money(e.amount)}</td><td class="r">${e.void ? '' : `<button class="btn btn-s btn-d" data-act="voidExp" data-id="${e.id}">Void</button>`}</td></tr>`)); }
I.efrom = v => { ef.from = v; drawExp(); }; I.eto = v => { ef.to = v; drawExp(); };
A.newExp = () => formModal('Add expense', [{ k: 'date', l: 'Date', t: 'date', v: ymd() }, { k: 'cat', l: 'Category', t: 'select', o: db.expCats }, { k: 'desc', l: 'Description', cls: 'full' }, { k: 'amount', l: 'Amount', t: 'number', req: 1 }, { k: 'method', l: 'Paid by', t: 'select', o: methods() }, { k: 'to', l: 'Paid to' }, { k: 'ref', l: 'Reference no.' }], v => { if (v.amount <= 0) return 'Invalid amount'; db.expenses.push({ id: uid(), ...v, user: me.name, at: nowISO() }); log('expense', v.cat + ' ' + v.amount); save(); P.expenses(); }, 'Add');
A.voidExp = async id => { if (!(await confirmDlg('Void this expense?'))) return; const e = db.expenses.find(x => x.id === id); e.void = true; log('expense void', e.desc + ' ' + e.amount); save(); drawExp(); };
A.expCSV = () => download('expenses.csv', toCSV([['Date', 'Category', 'Description', 'Paid to', 'Method', 'Amount', 'Void'], ...expList().map(e => [e.date, e.cat, e.desc, e.to, e.method, e.amount, e.void ? 'yes' : ''])]));

/* ================= CASH REGISTER ================= */
function cashFlow(from, to) {
  const inR = t => t >= from && t <= to; let c = { sales: 0, refunds: 0, exp: 0, custIn: 0, supOut: 0 };
  db.sales.filter(s => s.status === 'done' && inR(s.at)).forEach(s => s.pays.filter(p => p.method === 'Cash').forEach(p => c.sales += p.amount));
  db.sales.filter(s => s.status === 'void' && inR(s.at)).forEach(s => s.pays.filter(p => p.method === 'Cash').forEach(p => c.sales += 0));
  db.returns.filter(r => inR(r.at) && r.method === 'Cash').forEach(r => c.refunds += r.refund);
  db.expenses.filter(e => !e.void && inR(e.at) && e.method === 'Cash').forEach(e => c.exp += e.amount);
  db.payments.filter(p => inR(p.at) && p.method === 'Cash').forEach(p => p.type === 'customer' ? c.custIn += p.amount : c.supOut += p.amount);
  return c;
}
P.register = () => {
  const sh = db.shifts.find(s => !s.closeAt); let cur = '';
  if (sh) { const c = cashFlow(sh.openAt, nowISO()), exp = r2(sh.opening + c.sales + c.custIn - c.refunds - c.exp - c.supOut);
    cur = `<div class="card"><h3>Shift open since ${dt(sh.openAt)} (${esc(sh.openBy)})</h3><div class="tot"><span>Opening cash</span><span>${money(sh.opening)}</span></div><div class="tot"><span>+ Cash sales</span><span>${money(c.sales)}</span></div><div class="tot"><span>+ Customer payments (cash)</span><span>${money(c.custIn)}</span></div><div class="tot"><span>− Cash refunds</span><span>${money(c.refunds)}</span></div><div class="tot"><span>− Cash expenses</span><span>${money(c.exp)}</span></div><div class="tot"><span>− Supplier payments (cash)</span><span>${money(c.supOut)}</span></div><div class="tot big"><span>Expected in drawer</span><span>${money(exp)}</span></div><br><button class="btn btn-p" data-act="closeShift">Close shift</button></div>`; }
  else cur = `<div class="card"><h3>No open shift</h3><button class="btn btn-p" data-act="openShift">Open shift</button></div>`;
  view(`${hdr('Cash Register')}${cur}<br><h3>Closed shifts</h3>${tbl(['Opened', 'Closed', 'Cashier', '>Opening', '>Expected', '>Counted', '>Difference'], db.shifts.filter(s => s.closeAt).reverse().map(s => `<tr><td>${dt(s.openAt)}</td><td>${dt(s.closeAt)}</td><td>${esc(s.openBy)}</td><td class="r">${money(s.opening)}</td><td class="r">${money(s.expected)}</td><td class="r">${money(s.counted)}</td><td class="r b" style="color:${s.diff ? 'var(--bad)' : 'var(--ok)'}">${money(s.diff)}</td></tr>`))}`);
};
A.openShift = () => formModal('Open shift', [{ k: 'opening', l: 'Opening cash in drawer', t: 'number', v: 0 }], v => { db.shifts.push({ id: uid(), openAt: nowISO(), openBy: me.name, opening: v.opening }); save(); P.register(); }, 'Open');
A.closeShift = () => { const sh = db.shifts.find(s => !s.closeAt); formModal('Close shift', [{ k: 'counted', l: 'Counted cash in drawer', t: 'number', req: 1 }, { k: 'note', l: 'Notes' }], v => { const c = cashFlow(sh.openAt, nowISO()); Object.assign(sh, { closeAt: nowISO(), counted: v.counted, expected: r2(sh.opening + c.sales + c.custIn - c.refunds - c.exp - c.supOut), note: v.note }); sh.diff = r2(sh.counted - sh.expected); log('shift closed', 'diff ' + sh.diff); save(); P.register(); toast('Shift closed. Difference ' + money(sh.diff)); }, 'Close shift'); };

/* ================= REPORTS ================= */
let rf = { type: 'pl', from: monthStart(), to: ymd() };
const RT = [['pl', 'Profit & Loss'], ['sales', 'Sales list'], ['daily', 'Daily sales'], ['products', 'Product-wise sales & profit'], ['cats', 'Category-wise'], ['brands', 'Brand-wise'], ['cashiers', 'Cashier-wise'], ['customers', 'Customer-wise'], ['methods', 'Payment methods'], ['returns', 'Returns'], ['stock', 'Stock valuation'], ['low', 'Low / out of stock'], ['dead', 'Slow-moving / dead stock (60 days)'], ['imei', 'IMEI inventory'], ['suppliers', 'Supplier balances'], ['receivables', 'Customer balances'], ['expenses', 'Expenses by category'], ['audit', 'Audit log']];
function reportData() {
  const { type: t, from, to } = rf, sales = db.sales.filter(s => s.status === 'done' && s.day >= from && s.day <= to), M = true;
  const agg = (keyFn) => { const m = {}; sales.forEach(s => s.items.forEach(i => { const k = keyFn(i, s) || '-'; const x = m[k] = m[k] || { q: 0, rev: 0, cost: 0 }; x.q += i.qty; x.rev += i.qty * i.price - i.disc; x.cost += i.qty * i.cost; })); return Object.entries(m).map(([k, x]) => [k, x.q, r2(x.rev), r2(x.cost), r2(x.rev - x.cost)]).sort((a, b) => b[2] - a[2]); };
  const aggCols = n => [{ h: n }, { h: 'Qty' }, { h: 'Revenue', m: M }, { h: 'Cost', m: M }, { h: 'Profit', m: M }];
  switch (t) {
    case 'pl': { const s = stats(from, to); return { cols: [{ h: 'Item' }, { h: 'Amount', m: M }], rows: [['Gross sales (before discount)', s.gross], ['Less: discounts', -s.disc], ['Less: returns & refunds', -s.returns], ['NET SALES (excl. tax)', s.netSales], ['Cost of goods sold (recorded cost basis)', -s.cogs], ['GROSS PROFIT', s.gp], ['Operating expenses', -s.exp], ['NET OPERATING RESULT', s.net]], note: 'COGS uses the weighted-average cost recorded at the time of each sale; restocked returns reverse their cost. Tax collected is excluded. Gross profit is not net profit.' }; }
    case 'sales': return { cols: [{ h: 'Invoice' }, { h: 'Date' }, { h: 'Customer' }, { h: 'Cashier' }, { h: 'Total', m: M }], rows: sales.map(s => [s.no, s.day, cust(s.customerId)?.name || 'Walk-in', s.user, s.total]) };
    case 'daily': { const m = {}; sales.forEach(s => { m[s.day] = m[s.day] || [0, 0]; m[s.day][0]++; m[s.day][1] += s.total; }); return { cols: [{ h: 'Date' }, { h: 'Invoices' }, { h: 'Sales', m: M }], rows: Object.entries(m).sort().map(([d, v]) => [d, v[0], r2(v[1])]) }; }
    case 'products': return { cols: aggCols('Product'), rows: agg(i => i.name) };
    case 'cats': return { cols: aggCols('Category'), rows: agg(i => prod(i.pid)?.category) };
    case 'brands': return { cols: aggCols('Brand'), rows: agg(i => prod(i.pid)?.brand) };
    case 'cashiers': { const m = {}; sales.forEach(s => { m[s.user] = (m[s.user] || 0) + s.total; }); return { cols: [{ h: 'Cashier' }, { h: 'Sales', m: M }], rows: Object.entries(m).map(([k, v]) => [k, r2(v)]) }; }
    case 'customers': { const m = {}; sales.forEach(s => { const k = cust(s.customerId)?.name || 'Walk-in'; m[k] = (m[k] || 0) + s.total; }); return { cols: [{ h: 'Customer' }, { h: 'Sales', m: M }], rows: Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r2(v)]) }; }
    case 'methods': return { cols: [{ h: 'Method' }, { h: 'Received', m: M }], rows: Object.entries(stats(from, to).meth).map(([k, v]) => [k, r2(v)]) };
    case 'returns': return { cols: [{ h: 'No' }, { h: 'Date' }, { h: 'Invoice' }, { h: 'Reason' }, { h: 'Refund', m: M }], rows: db.returns.filter(r => r.day >= from && r.day <= to).map(r => [r.no, r.day, r.saleNo, r.reason, r.refund]) };
    case 'stock': return { cols: [{ h: 'Product' }, { h: 'Stock' }, { h: 'Cost', m: M }, { h: 'Value', m: M }], rows: db.products.filter(p => p.active !== false).map(p => [p.name, stockOf(p), p.cost, r2(stockOf(p) * p.cost)]) };
    case 'low': return { cols: [{ h: 'Product' }, { h: 'Stock' }, { h: 'Min' }], rows: db.products.filter(p => p.active !== false && stockOf(p) <= (p.min ?? S().lowStock)).map(p => [p.name, stockOf(p), p.min ?? S().lowStock]) };
    case 'dead': { const cut = ymd(new Date(Date.now() - 60 * 864e5)), sold = new Set(); db.sales.filter(s => s.day >= cut && s.status === 'done').forEach(s => s.items.forEach(i => sold.add(i.pid))); return { cols: [{ h: 'Product' }, { h: 'Stock' }, { h: 'Value', m: M }], rows: db.products.filter(p => p.active !== false && stockOf(p) > 0 && !sold.has(p.id)).map(p => [p.name, stockOf(p), r2(stockOf(p) * p.cost)]) }; }
    case 'imei': return { cols: [{ h: 'Product' }, { h: 'IMEI' }, { h: 'IMEI 2' }, { h: 'Status' }, { h: 'Warranty to' }], rows: db.products.flatMap(p => p.devs.map(d => [p.name, d.imei, d.imei2 || '', d.status, d.warrantyEnd || ''])) };
    case 'suppliers': return { cols: [{ h: 'Supplier' }, { h: 'Balance owed', m: M }], rows: db.suppliers.map(s => [s.name, s.balance || 0]) };
    case 'receivables': return { cols: [{ h: 'Customer' }, { h: 'Phone' }, { h: 'Balance', m: M }], rows: db.customers.filter(c => c.balance).map(c => [c.name, c.phone, c.balance]) };
    case 'expenses': { const m = {}; db.expenses.filter(e => !e.void && e.date >= from && e.date <= to).forEach(e => m[e.cat] = (m[e.cat] || 0) + e.amount); return { cols: [{ h: 'Category' }, { h: 'Total', m: M }], rows: Object.entries(m).map(([k, v]) => [k, r2(v)]) }; }
    case 'audit': return { cols: [{ h: 'Time' }, { h: 'User' }, { h: 'Action' }, { h: 'Detail' }], rows: db.audit.slice(0, 500).map(a => [dt(a.at), a.user, a.action, a.detail]) };
  }
}
P.reports = () => { view(`${hdr('Reports', '<button class="btn" data-act="repCSV">Export CSV</button><button class="btn btn-p" data-act="repPrint">🖨 Print / PDF</button>')}<div class="filters">${sel('rtype', RT, rf.type)}<label class="mut">From <input type="date" data-in="rfrom" value="${rf.from}"></label><label class="mut">To <input type="date" data-in="rto" value="${rf.to}"></label><button class="btn" data-act="repToday">Today</button><button class="btn" data-act="repMonth">This month</button></div><div id="list"></div>`); drawRep(); };
const repTable = () => { const r = reportData(); return { r, html: (r.note ? `<p class="mut">${esc(r.note)}</p>` : '') + tbl(r.cols.map((c, i) => (c.m || typeof r.rows[0]?.[i] === 'number' && i ? '>' : '') + c.h), r.rows.map(row => `<tr>${row.map((v, i) => `<td class="${r.cols[i].m ? 'r' : ''}">${r.cols[i].m ? money(v) : esc(v)}</td>`).join('')}</tr>`)) }; };
function drawRep() { $('#list').innerHTML = repTable().html; }
I.rtype = v => { rf.type = v; drawRep(); }; I.rfrom = v => { rf.from = v; drawRep(); }; I.rto = v => { rf.to = v; drawRep(); };
A.repToday = () => { rf.from = rf.to = ymd(); P.reports(); }; A.repMonth = () => { rf.from = monthStart(); rf.to = ymd(); P.reports(); };
A.repCSV = () => { const r = reportData(); download(`report_${rf.type}_${rf.from}_${rf.to}.csv`, toCSV([r.cols.map(c => c.h), ...r.rows])); };
A.repPrint = () => printHTML(`<h2>${esc(S().business)} – ${RT.find(x => x[0] === rf.type)[1]}</h2><p>${rf.from} to ${rf.to}</p>` + repTable().html, 'table{width:100%;border-collapse:collapse;font-size:12px}td,th{border-bottom:1px solid #ccc;padding:4px;text-align:left}.r{text-align:right}th.r{text-align:right}', 'Report');

/* ================= TAX & CHARGES ================= */
P.taxes = () => {
  const rows = Array.isArray(S().charges) ? S().charges : (num(S().taxRate) > 0 ? [{ id: 'legacy-vat', name: 'VAT', rate: num(S().taxRate), enabled: true }] : []);
  view(`${hdr('VAT & Charges', '<button class="btn btn-p" data-act="newCharge">+ Add tax or charge</button>')}<p class="mut">Set VAT, service charge, or other percentage charges. Enabled charges are calculated on the discounted subtotal and added to every new bill. Existing completed bills keep the rates used when they were created.</p><div class="card">${tbl(['Tax / charge', '>Rate', 'Status', ''], rows.map(c => `<tr><td><b>${esc(c.name)}</b></td><td class="r">${num(c.rate)}%</td><td><span class="badge ${c.enabled === false ? 'b-warn' : 'b-ok'}">${c.enabled === false ? 'Disabled' : 'Active'}</span></td><td class="r"><button class="btn btn-s" data-act="editCharge" data-id="${esc(c.id)}">Edit</button> <button class="btn btn-s btn-d" data-act="delCharge" data-id="${esc(c.id)}">Remove</button></td></tr>`), 'No taxes or charges configured. Add VAT, service charge, or another percentage charge.')}</div><p class="mut sm">Each enabled charge appears as a separate line on the current bill, customer display, receipt, and invoice.</p>`);
};
A.newCharge = () => formModal('Add tax or charge', [{ k: 'name', l: 'Tax or charge name', v: 'VAT', req: 1 }, { k: 'rate', l: 'Rate (%)', t: 'number', v: 0, req: 1 }, { k: 'enabled', l: 'Apply to new bills', t: 'select', o: ['Yes', 'No'], v: 'Yes' }], v => {
  if (!v.name.trim()) return 'Enter a name';
  if (!Number.isFinite(v.rate) || v.rate < 0 || v.rate > 100) return 'Rate must be between 0 and 100';
  S().charges = (Array.isArray(S().charges) ? S().charges : []).concat({ id: uid(), name: v.name.trim(), rate: v.rate, enabled: v.enabled === 'Yes' });
  S().taxRate = 0;
  log('charge created', v.name + ' ' + v.rate + '%'); save(); P.taxes();
}, 'Add');
A.editCharge = id => { const c = (S().charges || []).find(x => x.id === id) || (id === 'legacy-vat' ? { id, name: 'VAT', rate: num(S().taxRate), enabled: true } : null); if (!c) return;
  formModal('Edit tax or charge', [{ k: 'name', l: 'Tax or charge name', v: c.name, req: 1 }, { k: 'rate', l: 'Rate (%)', t: 'number', v: c.rate, req: 1 }, { k: 'enabled', l: 'Apply to new bills', t: 'select', o: ['Yes', 'No'], v: c.enabled === false ? 'No' : 'Yes' }], v => {
    if (!v.name.trim()) return 'Enter a name';
    if (!Number.isFinite(v.rate) || v.rate < 0 || v.rate > 100) return 'Rate must be between 0 and 100';
    if (id === 'legacy-vat') S().charges = [{ id: uid(), name: v.name.trim(), rate: v.rate, enabled: v.enabled === 'Yes' }];
    else Object.assign(c, { name: v.name.trim(), rate: v.rate, enabled: v.enabled === 'Yes' });
    S().taxRate = 0; log('charge updated', v.name + ' ' + v.rate + '%'); save(); P.taxes();
  }, 'Save');
};
A.delCharge = id => { if (id === 'legacy-vat') S().taxRate = 0; else S().charges = (S().charges || []).filter(c => c.id !== id); log('charge removed', id); save(); P.taxes(); };

/* ================= ATTENDANCE ================= */
function attendanceRows(day) {
  return db.users.filter(u => u.active).map(u => {
    const a = db.attendance.find(x => x.userId === u.id && x.day === day) || null;
    return [u, a];
  });
}
const attendanceManager = () => ['owner', 'manager'].includes(me?.role);
const validAttendanceTime = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
function attendanceHours(a) {
  if (!validAttendanceTime(a?.checkIn) || !validAttendanceTime(a?.checkOut)) return 0;
  let mins = (+a.checkOut.slice(0, 2) * 60 + +a.checkOut.slice(3)) - (+a.checkIn.slice(0, 2) * 60 + +a.checkIn.slice(3));
  if (mins < 0) mins += 24 * 60;
  return Math.round(mins / 60 * 100) / 100;
}
function attendanceLate(a) { return validAttendanceTime(a?.checkIn) && validAttendanceTime(S().attendanceStart || '09:00') && a.checkIn > (S().attendanceStart || '09:00'); }
function attendanceRecord(userId, day) {
  let a = db.attendance.find(x => x.userId === userId && x.day === day);
  if (!a) { a = { id: uid(), userId, day, status: 'present', checkIn: '', checkOut: '', note: '', createdAt: nowISO() }; db.attendance.push(a); }
  return a;
}
function attendanceSelfAction() {
  const a = me?.id && db.attendance.find(x => x.userId === me.id && x.day === ymd());
  if (!a?.checkIn) return 'Check in';
  if (!a.checkOut) return 'Check out';
  return 'Attendance recorded';
}
function attendanceSelfButton() {
  const action = attendanceSelfAction();
  return `<button class="btn btn-p" data-act="attendanceSelf" ${action === 'Attendance recorded' ? 'disabled' : ''}>${action === 'Attendance recorded' ? '✓ ' : '⏱ '}${action}</button>`;
}
function saveAttendance(a, detail) {
  a.hours = attendanceHours(a); a.late = attendanceLate(a); a.updatedAt = nowISO(); a.updatedBy = me.name;
  log('attendance', detail); save();
}
P.attendance = () => {
  if (!attendanceManager()) return toast('Only owners and managers can view attendance', 'err');
  const day = ymd(), date = $('#attendanceDate')?.value || day, rows = attendanceRows(date);
  const counts = { present: 0, absent: 0, leave: 0, half: 0, unmarked: 0 };
  rows.forEach(([, a]) => { if (!a) counts.unmarked++; else if (a.status === 'half') counts.half++; else if (counts[a.status] !== undefined) counts[a.status]++; });
  const statusSelect = a => `<select data-in="attendanceField" data-id="${esc(a?.id || '')}" data-user="${esc(a?.userId || '')}" data-key="status" ${locked ? 'disabled' : ''}><option value="" ${!a ? 'selected' : ''}>Not marked</option>${[['present','Present'],['absent','Absent'],['leave','Leave'],['half','Half day']].map(([v,l]) => `<option value="${v}" ${a?.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const locked = date !== day;
  const summary = `<div class="filters"><label class="mut">Month <input id="attendanceMonth" type="month" value="${esc(date.slice(0,7))}" data-in="attendanceMonth"></label><button class="btn" data-act="attendanceCSV">Export monthly CSV</button></div>${attendanceMonthSummary(date.slice(0,7))}`;
  view(`${hdr('Attendance', attendanceSelfButton())}<div class="filters"><label class="mut">Date <input id="attendanceDate" type="date" value="${esc(date)}" data-in="attendanceDate"></label><button class="btn" data-act="attendanceToday">Today</button><span class="sp"></span><span class="badge b-ok">Present ${counts.present}</span><span class="badge b-bad">Absent ${counts.absent}</span><span class="badge b-warn">Leave ${counts.leave}</span><span class="badge">Half day ${counts.half}</span><span class="badge">Not marked ${counts.unmarked}</span></div><div class="card"><p class="mut">Mark active staff attendance. Viewing a date does not create or change records. ${locked ? 'Past dates are read-only.' : 'Entries are saved on this device and available offline.'}</p>${tbl(['Staff member','Status','Check in','Check out','Hours','Late','Notes'], rows.map(([u,a]) => `<tr><td><b>${esc(u.name)}</b><br><small class="mut">${esc(u.role)}</small></td><td>${statusSelect(a)}</td><td><input aria-label="${esc(u.name)} check-in" type="time" data-in="attendanceField" data-id="${esc(a?.id || '')}" data-user="${esc(u.id)}" data-key="checkIn" value="${esc(a?.checkIn || '')}" ${locked?'disabled':''}></td><td><input aria-label="${esc(u.name)} check-out" type="time" data-in="attendanceField" data-id="${esc(a?.id || '')}" data-user="${esc(u.id)}" data-key="checkOut" value="${esc(a?.checkOut || '')}" ${locked?'disabled':''}></td><td>${a ? attendanceHours(a).toFixed(2) : '—'}</td><td>${a ? (attendanceLate(a) ? 'Yes' : 'No') : '—'}</td><td><input aria-label="${esc(u.name)} attendance notes" data-in="attendanceField" data-id="${esc(a?.id || '')}" data-user="${esc(u.id)}" data-key="note" value="${esc(a?.note || '')}" placeholder="Optional note" ${locked?'disabled':''}></td></tr>`), 'No active staff users')}</div><h3>Monthly summary</h3>${summary}`);
};
function attendanceMonthSummary(month) {
  const users = db.users.filter(u => u.active);
  const rows = users.map(u => { const records = db.attendance.filter(a => a.userId === u.id && String(a.day || '').slice(0,7) === month);
    const c = { present:0, absent:0, leave:0, half:0, hours:0, late:0 };
    records.forEach(a => { if (Object.prototype.hasOwnProperty.call(c, a.status)) c[a.status]++; c.hours += attendanceHours(a); if (attendanceLate(a)) c.late++; });
    return [u, c];
  });
  return tbl(['Employee','Present','Absent','Leave','Half days','Hours worked','Late'], rows.map(([u,c]) => `<tr><td>${esc(u.name)}</td><td>${c.present}</td><td>${c.absent}</td><td>${c.leave}</td><td>${c.half}</td><td>${c.hours.toFixed(2)}</td><td>${c.late}</td></tr>`), 'No staff');
}
I.attendanceField = (value, el) => {
  if (!attendanceManager()) return toast('Only owners and managers can edit attendance', 'err');
  const day = $('#attendanceDate')?.value || ymd(); if (day !== ymd()) return toast('Past attendance is read-only', 'err');
  const key = el.dataset.key, userId = el.dataset.user;
  let a = db.attendance.find(x => x.id === el.dataset.id && x.day === day);
  if (!a && key !== 'status' && key !== 'note') return;
  if (!a && !value) return;
  if (!a) a = attendanceRecord(userId, day);
  a[key] = value;
  saveAttendance(a, `${db.users.find(u => u.id === userId)?.name || 'Staff'} · ${day} · ${key === 'status' ? value : key}`);
  if (key === 'status') P.attendance();
};
A.attendanceDate = () => P.attendance();
I.attendanceMonth = (value) => { if (!/^\d{4}-\d{2}$/.test(value)) return; const date = $('#attendanceDate'); if (date) date.value = `${value}-01`; P.attendance(); };
A.attendanceToday = () => { if ($('#attendanceDate')) $('#attendanceDate').value = ymd(); P.attendance(); };
A.attendanceCSV = () => { if (!attendanceManager()) return toast('Only owners and managers can export attendance', 'err'); const month = $('#attendanceMonth')?.value || ($('#attendanceDate')?.value || ymd()).slice(0,7); const rows = db.attendance.filter(a => String(a.day || '').slice(0,7) === month).map(a => { const u = db.users.find(x => x.id === a.userId); return [u?.name || 'Deleted user', u?.role || '', a.day, a.status || '', a.checkIn || '', a.checkOut || '', attendanceHours(a) || 0, attendanceLate(a) ? 'yes' : 'no', a.note || '']; }); download(`attendance_${month}.csv`, toCSV([['Staff member','Role','Date','Status','Check in','Check out','Hours','Late','Notes'], ...rows])); };
A.attendanceSelf = () => {
  if (!me?.id) return;
  const day = ymd(), existing = db.attendance.find(x => x.userId === me.id && x.day === day);
  if (existing?.checkIn && existing?.checkOut) return toast(`Today's attendance is already recorded (${existing.checkIn}–${existing.checkOut})`);
  const a = attendanceRecord(me.id, day), now = new Date(), time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  if (!a.checkIn) { a.checkIn = time; a.status = 'present'; saveAttendance(a, `${me.name} · ${day} · check in`); toast(`Checked in at ${time}`); }
  else if (!a.checkOut) { a.checkOut = time; saveAttendance(a, `${me.name} · ${day} · check out`); toast(`Checked out at ${time}`); }
  document.querySelectorAll('[data-act="attendanceSelf"]').forEach(button => {
    const action = attendanceSelfAction(); button.textContent = action === 'Attendance recorded' ? 'Attendance recorded' : action;
    button.disabled = action === 'Attendance recorded';
  });
  if (current === 'attendance' && attendanceManager()) P.attendance();
};

/* ================= USERS ================= */
P.users = () => { view(`${hdr('Users & Permissions', '<button class="btn btn-p" data-act="newUser">+ New user</button>')}<p class="mut">Owner: everything · Manager: everything except users, settings & backup · Cashier: POS, own sales, customers</p>${tbl(['Name', 'Username', 'Role', 'Status', ''], db.users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td><td>${u.role}</td><td><span class="badge ${u.active ? 'b-ok' : 'b-bad'}">${u.active ? 'active' : 'disabled'}</span></td><td class="r"><button class="btn btn-s" data-act="pwUser" data-id="${u.id}">Reset password</button> ${u.id !== me.id ? `<button class="btn btn-s btn-d" data-act="togUser" data-id="${u.id}">${u.active ? 'Disable' : 'Enable'}</button>` : ''}</td></tr>`))}`); };
A.newUser = () => formModal('New user', [{ k: 'name', l: 'Full name', req: 1 }, { k: 'username', l: 'Username', req: 1 }, { k: 'role', l: 'Role', t: 'select', o: ['cashier', 'manager', 'owner'] }, { k: 'pw', l: 'Password (min 6)', t: 'password', req: 1 }], v => {
  if (v.pw.length < 6) return 'Password too short'; if (db.users.some(u => u.username.toLowerCase() === v.username.toLowerCase())) return 'Username exists';
  hashPw(v.username.toLowerCase(), v.pw).then(h => { db.users.push({ id: uid(), name: v.name, username: v.username.toLowerCase(), role: v.role, hash: h, active: true }); log('user created', v.username); save(); P.users(); }); });
A.pwUser = id => { const u = db.users.find(x => x.id === id); formModal('New password for ' + u.name, [{ k: 'pw', l: 'Password (min 6)', t: 'password', req: 1 }], v => { if (v.pw.length < 6) return 'Too short'; hashPw(u.username, v.pw).then(h => { u.hash = h; log('password reset', u.username); save(); toast('Password updated'); }); }); };
A.togUser = id => { const u = db.users.find(x => x.id === id); if (u.role === 'owner' && db.users.filter(x => x.role === 'owner' && x.active).length < 2 && u.active) return toast('Keep at least one active owner', 'err'); u.active = !u.active; log('user toggle', u.username); save(); P.users(); };

/* ================= SETTINGS & BACKUP ================= */
P.settings = async () => {
  const s = S(); let bk = '<p class="mut">Automatic folder backups work in the desktop app. In a browser use Export / Import below.</p>', dp = '';
  if (window.posApi) { dp = await window.posApi.dataPath(); const b = await window.posApi.backups();
    bk = `<div class="fg"><label class="f full"><span>Backup folder (blank = Documents/TheSmartPOS-Backups)</span><div style="display:flex;gap:8px"><input id="bkdir" value="${esc(s.backupDir)}" style="flex:1"><button class="btn" data-act="pickDir">Browse…</button></div></label>
<label class="f"><span>Schedule</span><select id="bkfreq"><option value="daily" ${s.backupFrequency !== 'weekly' ? 'selected' : ''}>Every day</option><option value="weekly" ${s.backupFrequency === 'weekly' ? 'selected' : ''}>Every week</option></select></label><label class="f"><span>Backup time</span><input id="bktime" type="time" value="${esc(s.backupTime || '02:00')}"></label><label class="f" id="bkdaywrap" style="${s.backupFrequency === 'weekly' ? '' : 'display:none'}"><span>Day of week</span><select id="bkday">${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => `<option value="${i}" ${Number(s.backupWeekday ?? 1) === i ? 'selected' : ''}>${d}</option>`).join('')}</select></label><label class="f"><span>Keep backups (days)</span><input id="bkkeep" type="number" min="1" value="${s.backupKeep}"></label><label class="f ck full"><input id="bkon" type="checkbox" ${s.backupOn ? 'checked' : ''}> Enable scheduled backups (runs after missed time on next app start)</label></div>
<br><button class="btn btn-p" data-act="saveBackupCfg">Save backup settings</button> <button class="btn" data-act="backupNow">Backup now</button> <button class="btn btn-d" data-act="restoreBk">Restore from backup…</button>
<p class="mut sm">Folder in use: ${esc(b.dir)}</p>${tbl(['When', 'Type', 'Result'], b.log.map(l => `<tr><td>${dt(l.at)}</td><td>${l.kind}</td><td><span class="badge ${l.ok ? 'b-ok' : 'b-bad'}">${l.ok ? 'OK' : 'FAILED'}</span> <small>${esc(l.ok ? l.file : l.error)}</small></td></tr>`), 'No backups yet')}`; }
  const f = (k, l, t = 'text') => `<label class="f"><span>${l}</span><input data-in="set" data-n="${k}" type="${t}" value="${esc(s[k])}"></label>`;
  const lic = licenseInfo ? `<p class="mut">Status: <b>${licenseInfo.type === 'permanent' ? 'Permanent' : licenseInfo.active ? `${licenseInfo.type === 'trial' ? '24-hour trial' : licenseInfo.type === 'monthly' ? '30-day license' : '7-day license'} · expires ${dt(licenseInfo.expiresAt)}` : 'Expired'}</b></p>` : '<p class="mut">License management is available in the desktop app.</p>';
  view(`${hdr('Settings & Backup')}<div class="grid2"><div class="card"><h3>Business identity & receipts</h3><div class="fg">${f('business', 'Business / POS name')}${f('tagline', 'Slogan / tagline')}${f('description', 'Business description')}${f('phone', 'Phone')}${f('address', 'Address')}${f('email', 'Email')}${f('currency', 'Currency symbol')}<div class="f full"><span>Business logo</span><div style="display:flex;align-items:center;gap:12px"><img ${s.logoData ? `src="${esc(s.logoData)}"` : ''} alt="Logo preview" style="width:56px;height:56px;object-fit:contain;background:#fff;border-radius:8px"><button class="btn" data-act="pickLogo">Choose logo…</button>${s.logoData ? '<button class="btn btn-d" data-act="removeLogo">Remove</button>' : ''}</div></div><div class="f full"><span>Authorized signature image (for quotation / invoice documents)</span><div style="display:flex;align-items:center;gap:12px">${s.signatureData ? `<img src="${esc(s.signatureData)}" alt="Signature preview" style="width:130px;height:48px;object-fit:contain;background:#fff;border:1px solid var(--bd);border-radius:6px">` : '<span class="mut">No signature saved</span>'}<button class="btn" data-act="pickSignature">Choose signature…</button>${s.signatureData ? '<button class="btn btn-d" data-act="removeSignature">Remove</button>' : ''}</div></div>${f('invPrefix', 'Invoice prefix')}${f('purPrefix', 'Purchase prefix')}${f('lowStock', 'Default low-stock level', 'number')}${f('maxDiscountPct', 'Max cashier discount %', 'number')}${f('payMethods', 'Payment methods (comma separated)')}${f('attendanceStart', 'Attendance start time', 'time')}<label class="f"><span>Invoice / receipt size</span><select data-in="set" data-n="receiptSize">${[['80','80 mm thermal'],['58','58 mm thermal'],['A4','A4 sheet'],['Letter','Letter sheet']].map(([x, label]) => `<option value="${x}" ${x == s.receiptSize ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${f('footer', 'Receipt footer')}${f('returnPolicy', 'Return policy')}${f('warranty', 'Warranty text')}</div></div>
<div class="card"><h3>Appearance</h3><div class="fg"><label class="f"><span>Theme colour</span><input type="color" data-in="set" data-n="accent" value="${s.accent}" style="height:40px"></label><label class="f ck"><input type="checkbox" data-in="set" data-n="dark" ${s.dark ? 'checked' : ''}> Dark mode</label></div><br><h3>Customer display</h3><p class="mut">Show the live basket, discounts, tax and total in a separate customer-facing window.</p><label class="f ck"><input type="checkbox" data-in="customerDisplay" ${s.customerDisplay ? 'checked' : ''}> Enable customer display</label><br><button class="btn btn-p" data-act="openCustomerDisplay" ${s.customerDisplay ? '' : 'disabled'}>Open customer display</button><br><br><h3>License</h3>${lic}<form id="licenseSettings" class="fg"><label class="f"><span>License key</span><input name="key" autocomplete="off" required placeholder="Enter license key"></label><button class="btn btn-p" type="submit">Activate license</button></form><br><h3>Data</h3><p class="mut sm">Data file: ${esc(dp || 'browser storage')}</p><button class="btn" data-act="exportAll">Export all data (JSON)</button> <button class="btn" data-act="importAll">Import data (JSON)</button><br><br><button class="btn" data-act="demo">Load demo data</button> <button class="btn" data-act="rmDemo">Remove demo data</button></div></div><br><div class="card"><h3>System update</h3><p class="mut">The POS checks the live server when it starts and every few hours while online. Daily screen updates download in seconds and apply with one click (or automatically at the login screen). A new desktop app version, when needed, is downloaded, verified and installed for you. Your shop data stays on this computer.</p><label class="f full"><span>Update server URL</span><input id="updateManifestUrl" type="url" placeholder="https://pos360live.vercel.app/updates/latest.json" value="${esc(s.updateManifestUrl || '')}"></label><br><button class="btn" data-act="checkUpdate">Check for updates</button> <button class="btn btn-p" id="applyUiUpdateBtn" data-act="applyUiUpdate" hidden>Restart to apply update</button> <button class="btn btn-p" data-act="installUpdate" hidden>Install and restart</button><div id="updateStatus" class="mut sm" style="margin-top:10px"></div><p class="mut sm">Update test feature: build 2026-11-03 13:00</p></div><br><div class="card"><h3>Backup & Restore</h3>${bk}</div>`);
  const receiptSizeField = $('[data-in="set"][data-n="receiptSize"]')?.closest('.f');
  receiptSizeField?.insertAdjacentHTML('afterend', `${f('receiptPadding', 'Print padding (mm)', 'number')}${f('receiptOffsetX', 'Manual horizontal offset (mm)', 'number')}${f('receiptOffsetY', 'Manual vertical offset (mm)', 'number')}<label class="f ck"><input type="checkbox" data-in="set" data-n="receiptAutoAlign" ${s.receiptAutoAlign !== false ? 'checked' : ''}> Auto center invoice</label><div class="f full"><small class="mut">Use the offsets to correct printer-specific feed or margin differences.</small></div>`);
  window.updateUi?.refreshStatus();
  $('#licenseSettings')?.addEventListener('submit', async e => { e.preventDefault(); const r = await window.posApi.activateLicense(e.target.elements.key.value); if (!r.ok) return toast(r.error, 'err'); licenseInfo = r.status; toast(licenseInfo.type === 'permanent' ? 'System permanently unlocked' : licenseInfo.type === 'monthly' ? 'System unlocked for 30 days' : 'System unlocked for 7 days'); P.settings(); });
};
I.set = (v, el) => { const k = el.dataset.n; S()[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? num(v) : v; save(); applyTheme(); if (['business', 'tagline', 'description', 'logoData', 'footer', 'accent', 'currency'].includes(k)) syncBranding(); if (current === 'invoice' && k.startsWith('invoice')) refreshInvoicePreview(); };
I.customerDisplay = v => { S().customerDisplay = !!v; save(); const button = $('[data-act="openCustomerDisplay"]'); if (button) button.disabled = !v; if (!window.posApi) return toast('Customer display is available in the desktop app', 'err'); if (v) { window.posApi.openCustomerDisplay(); syncBranding(); } else window.posApi.closeCustomerDisplay(); };
A.openCustomerDisplay = () => { if (S().customerDisplay && window.posApi) { window.posApi.openCustomerDisplay(); syncBranding(); } };
async function browserLogoData(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPG, or WebP image.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Choose an image smaller than 12 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('The selected image could not be opened.')); image.src = url; });
    const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', 0.86);
  } finally { URL.revokeObjectURL(url); }
}

A.pickLogo = async () => {
  const api = window.posApi;
  if (typeof api?.pickLogo === 'function') {
    const logo = await api.pickLogo();
    if (!logo) return;
    S().logoData = logo;
  } else {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try { S().logoData = await browserLogoData(file); save(); syncBranding(); P.settings(); }
      catch (error) { toast(error.message || 'Could not load the selected logo.', 'err'); }
    };
    input.click();
    return;
  }
  save(); syncBranding(); P.settings();
};
A.removeLogo = () => { S().logoData = ''; save(); syncBranding(); P.settings(); };
A.pickSignature = async () => { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'; input.onchange = async () => { const file = input.files?.[0]; if (!file) return; try { S().documentSignatureData = await browserLogoData(file); save(); P.settings(); } catch (error) { toast(error.message || 'Could not load signature image.', 'err'); } }; input.click(); };
A.removeSignature = () => { S().documentSignatureData = ''; save(); P.settings(); };
// A.checkUpdate / A.installUpdate / A.applyUiUpdate live in js/updater-ui.js
A.pickDir = async () => { const d = await window.posApi.pickFolder(); if (d) $('#bkdir').value = d; };
A.saveBackupCfg = async () => { const keep = Number($('#bkkeep').value); if (!Number.isInteger(keep) || keep < 1) return toast('Keep backups must be at least 1 day', 'err'); Object.assign(S(), { backupDir: $('#bkdir').value.trim(), backupTime: $('#bktime').value || '02:00', backupFrequency: $('#bkfreq').value, backupWeekday: Number($('#bkday').value), backupKeep: keep, backupOn: $('#bkon').checked }); log('backup config', `${S().backupDir || 'default folder'} · ${S().backupFrequency} at ${S().backupTime}`); save(); await flush(); try { const d = await window.posApi.setBackup(cfgForMain()); toast('Backup settings saved. Folder: ' + d); } catch (e) { toast('Could not save backup settings: ' + e.message, 'err'); } };
const cfgForMain = () => ({ dir: S().backupDir, time: S().backupTime || '02:00', frequency: S().backupFrequency || 'daily', weekday: Number(S().backupWeekday ?? 1), keep: Number(S().backupKeep) || 30, on: S().backupOn !== false });
A.backupNow = async () => { await flush(); const r = await window.posApi.backupNow(); if (r.ok) toast('Backup verified: ' + r.file); else toast('Backup FAILED: ' + r.error, 'err'); P.settings(); };
A.restoreBk = async () => { if (!(await confirmDlg('Restoring REPLACES all current data with the backup. A safety copy of current data is saved first. Continue?', 'Restore'))) return; await flush(); const r = await window.posApi.restore(); if (r.cancelled) return; if (r.error) return toast(r.error, 'err'); log('restore', 'database restored'); await loadDB(); toast('Restore complete'); location.reload(); };
A.exportAll = () => download(`TheSmartPOS_${ymd()}.json`, JSON.stringify(db), 'application/json');
A.importAll = () => pickFile('.json', async txt => { try { const d = JSON.parse(txt); if (!Array.isArray(d.products) || !d.settings) throw 0; if (!(await confirmDlg('Replace ALL current data with this file?'))) return; db = d; await flush(); location.reload(); } catch { toast('Not a valid backup file', 'err'); } });
A.demo = async () => {
  if (!(await confirmDlg('Add demo products, suppliers and customers (marked as demo, removable)?'))) return;
  const mk = (name, brand, cat, cost, price, stock, tr, model) => { const p = { id: uid(), name, brand, category: cat, model: model || '', cost, price, wholesale: Math.round(price * .95), min: 3, tracked: !!tr, devs: [], stock: 0, active: true, demo: true, warranty: tr ? 12 : 0, created: nowISO() }; db.counters.sku++; p.sku = 'SKU' + String(db.counters.sku).padStart(5, '0'); p.barcode = newBarcode();
    if (tr) { for (let i = 0; i < stock; i++) p.devs.push({ id: uid(), imei: genImei(), imei2: '', status: 'in', cost, at: nowISO() }); recount(p); } else p.stock = stock; move(p, stock, 'opening', '', 'Demo'); db.products.push(p); };
  mk('Samsung Galaxy A15 128GB', 'Samsung', 'Smartphones', 52000, 62900, 4, 1, '4GB/128GB'); mk('Xiaomi Redmi 13C 256GB', 'Xiaomi', 'Smartphones', 41000, 49900, 3, 1, '8GB/256GB'); mk('iPhone 13 128GB (Used)', 'Apple', 'Smartphones', 118000, 139000, 2, 1, '128GB');
  mk('Samsung 25W Fast Charger', 'Samsung', 'Chargers', 1700, 2900, 25, 0); mk('USB-C Cable 1m', 'Generic', 'Charging Cables', 250, 690, 60, 0); mk('Anker Power Bank 10000mAh', 'Anker', 'Power Banks', 6500, 9800, 10, 0); mk('Wired Earphones', 'Generic', 'Earphones', 350, 990, 40, 0);
  mk('Silicone Phone Case A15', 'Generic', 'Phone Cases', 300, 990, 30, 0); mk('Tempered Glass Protector', 'Generic', 'Screen Protectors', 120, 590, 80, 0); mk('Smart Watch T800', 'Generic', 'Smartwatches', 4200, 6900, 8, 0); mk('32GB Memory Card', 'Generic', 'Memory Cards', 900, 1800, 2, 0);
  db.suppliers.push({ id: uid(), name: 'Colombo Mobile Traders', phone: '0112345678', balance: 0, active: true, demo: true }, { id: uid(), name: 'Tech Imports Pvt Ltd', phone: '0117654321', balance: 0, active: true, demo: true });
  db.customers.push({ id: uid(), name: 'Nimal Perera', phone: '0771234567', type: 'Retail', balance: 0, demo: true }, { id: uid(), name: 'Ranna Mobile Shop (wholesale)', phone: '0719876543', type: 'Wholesale', balance: 0, limit: 200000, demo: true });
  log('demo data', 'loaded'); save(); toast('Demo data loaded'); P.settings();
};
A.rmDemo = async () => { if (!(await confirmDlg('Remove demo products, suppliers and customers? (Real data is untouched. Sales that used demo items stay in history.)'))) return; db.products = db.products.filter(p => !p.demo); db.suppliers = db.suppliers.filter(p => !p.demo); db.customers = db.customers.filter(p => !p.demo); save(); toast('Demo data removed'); };

P.invoice = () => {
  const s = S();
  const check = (key, label, value = true) => `<label class="f ck"><input type="checkbox" data-in="set" data-n="${key}" ${(s[key] ?? value) ? 'checked' : ''}> ${label}</label>`;
  const field = (key, label, type = 'text', value = '') => `<label class="f"><span>${label}</span><input type="${type}" data-in="set" data-n="${key}" value="${esc(s[key] ?? value)}"></label>`;
  view(`${hdr('Invoice templates', '<button class="btn btn-p" data-act="saveInvoiceTemplate">Save template</button>')}<div class="card"><p class="mut">Customize the layout used for completed sales and reprints. Changes save automatically, and the preview updates as you edit.</p><h3>Page and style</h3><div class="fg"><label class="f"><span>Template</span><select data-in="set" data-n="invoiceStyle"><option value="a4" ${s.invoiceStyle === 'a4' ? 'selected' : ''}>Business invoice</option><option value="receipt" ${s.invoiceStyle === 'receipt' ? 'selected' : ''}>Compact thermal receipt</option></select></label><label class="f"><span>Paper size</span><select data-in="set" data-n="invoicePageSize"><option ${s.invoicePageSize !== 'Letter' ? 'selected' : ''}>A4</option><option ${s.invoicePageSize === 'Letter' ? 'selected' : ''}>Letter</option></select></label><label class="f"><span>Heading colour</span><input type="color" data-in="set" data-n="invoiceAccent" value="${esc(s.invoiceAccent || '#333333')}"></label><label class="f"><span>Font</span><select data-in="set" data-n="invoiceFont">${['Arial','Georgia','Times New Roman','Courier New','Verdana'].map(x => `<option ${s.invoiceFont === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>${field('invoiceFontSize','Font size (px)','number',14)}${field('invoicePageMargin','Page margin (mm)','number',14)}${field('invoiceLogoWidth','Logo width (px)','number',120)}${field('invoiceTitle','Invoice heading','text','INVOICE')}</div><h3>Show on invoice</h3><div class="fg">${check('invoiceShowLogo','Business logo')}${check('invoiceShowBusiness','Business name')}${check('invoiceShowAddress','Business address')}${check('invoiceShowPhone','Business phone')}${check('invoiceShowEmail','Business email')}${check('invoiceShowCustomer','Customer details')}${check('invoiceShowCashier','Cashier name',false)}${check('invoiceShowDueDate','Due date')}${check('invoiceShowItemCode','Item SKU / code',false)}${check('invoiceShowDiscount','Discount line')}${check('invoiceShowCharges','Tax and charge lines')}${check('invoiceShowPayment','Paid amount')}${check('invoiceShowBalance','Balance due')}${check('invoiceShowNotes','Notes')}${check('invoiceShowTerms','Terms and conditions')}${check('invoiceShowFooter','Footer')}</div><div class="fg" style="margin-top:12px"><label class="f full"><span>Notes</span><textarea data-in="set" data-n="invoiceNotes">${esc(s.invoiceNotes || '')}</textarea></label><label class="f full"><span>Terms &amp; conditions</span><textarea data-in="set" data-n="invoiceTerms">${esc(s.invoiceTerms || '')}</textarea></label><label class="f full"><span>Custom footer (blank uses receipt footer)</span><input data-in="set" data-n="invoiceFooter" value="${esc(s.invoiceFooter || '')}"></label></div><p class="mut sm">Business identity and logo are managed in Settings &amp; Backup → Business identity &amp; receipts. These options only affect the business invoice layout.</p><button class="btn btn-p" data-act="saveInvoiceTemplate">Save template</button></div><div class="card" style="margin-top:14px"><h3>Live preview</h3><p class="mut sm">Sample invoice preview. Your real sales data appears on printed and reprinted invoices.</p><iframe id="invoicePreview" title="Invoice template preview" style="width:100%;height:720px;border:1px solid var(--bd);border-radius:8px;background:#fff"></iframe></div>`);
  refreshInvoicePreview();
};

/* ================= QUOTATIONS ================= */
let qf = { q: '' };
const quoteTotal = q => r2((q.items || []).reduce((sum, i) => sum + num(i.qty) * num(i.price), 0));
const quoteOriginalTotal = q => r2((q.items || []).reduce((sum, i) => sum + num(i.qty) * num(i.regularPrice ?? i.price), 0));
const quoteDiscountTotal = q => r2(quoteOriginalTotal(q) - quoteTotal(q));
P.quotations = () => {
  const q = qf.q.toLowerCase();
  const rows = (db.quotations || []).filter(x => !q || (x.no + (cust(x.customerId)?.name || x.customerName || '')).toLowerCase().includes(q)).slice().reverse();
  view(`${hdr('Quotations', '<button class="btn" data-act="newInvoiceDoc">+ New invoice document</button><button class="btn btn-p" data-act="newQuote">+ New quotation</button>')}<div class="filters"><input data-in="quoteSearch" placeholder="Search number or customer" value="${esc(qf.q)}"></div><div id="quoteList"></div>`);
  $('#quoteList').innerHTML = `<p class="mut">${rows.length} document${rows.length === 1 ? '' : 's'}</p>` + tbl(['Type / Number', 'Date', 'Valid until / PO', 'Customer', '>Total', 'Status', ''], rows.map(x => `<tr><td><b>${x.type === 'invoice' ? 'INVOICE' : 'QUOTE'} · ${esc(x.no)}</b></td><td>${esc(x.date)}</td><td>${esc(x.type === 'invoice' ? (x.poNumber || '—') : (x.validUntil || '—'))}</td><td>${esc(x.billName || cust(x.customerId)?.name || x.customerName || 'Walk-in')}</td><td class="r">${money(quoteTotal(x))}</td><td><span class="badge ${x.status === 'converted' ? 'b-ok' : x.status === 'accepted' ? 'b-warn' : ''}">${esc(x.status || 'draft')}</span></td><td class="r" style="white-space:nowrap"><button class="btn btn-s" data-act="printQuote" data-id="${x.id}">Preview / Print</button> <button class="btn btn-s" data-act="editQuote" data-id="${x.id}">Edit</button> ${x.type !== 'invoice' && x.status !== 'converted' ? `<button class="btn btn-s btn-p" data-act="convertQuote" data-id="${x.id}">Convert to sale</button>` : ''} <button class="btn btn-s btn-d" data-act="delQuote" data-id="${x.id}">Delete</button></td></tr>`), 'No quotations or invoice documents yet');
};
I.quoteSearch = v => { qf.q = v; P.quotations(); };
function quoteForm(q = {}) {
  const items = (q.items || []).map(i => ({ ...i, regularPrice: num(i.regularPrice ?? i.price) }));
  const options = db.customers.map(c => `<option value="${esc(c.id)}" ${q.customerId === c.id ? 'selected' : ''}>${esc(c.name)} · ${esc(c.phone || '')}</option>`).join('');
  const productOptions = db.products.filter(p => p.active !== false).map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${money(p.price)}</option>`).join('');
  const ov = modal(q.id ? 'Edit quotation' : 'New quotation', `<form class="fg" id="quoteForm"><h3 class="full">Company details</h3><label class="f"><span>Business name</span><input name="companyName" value="${esc(q.companyName ?? S().business)}"></label><label class="f"><span>Tagline</span><input name="companyTagline" value="${esc(q.companyTagline ?? S().tagline)}"></label><label class="f"><span>Business address</span><textarea name="companyAddress" rows="2">${esc(q.companyAddress ?? S().address)}</textarea></label><label class="f"><span>Business phone</span><input name="companyPhone" value="${esc(q.companyPhone ?? S().phone)}"></label><label class="f"><span>Business email</span><input name="companyEmail" value="${esc(q.companyEmail ?? S().email)}"></label><label class="f"><span>Document accent</span><input name="accent" type="color" value="${esc(q.accent || S().invoiceAccent || '#333333')}"></label><div class="full"><label class="f"><span>Customer</span><select name="customerId"><option value="">Walk-in / no customer</option>${options}</select></label></div><label class="f"><span>Bill to name</span><input name="billName" value="${esc(q.billName ?? cust(q.customerId)?.name ?? '')}"></label><label class="f"><span>Customer phone</span><input name="billPhone" value="${esc(q.billPhone ?? cust(q.customerId)?.phone ?? '')}"></label><label class="f"><span>Customer address</span><textarea name="billAddress" rows="2">${esc(q.billAddress ?? cust(q.customerId)?.address ?? '')}</textarea></label><h3 class="full">${q.type === 'invoice' ? 'Invoice' : 'Quotation'} details</h3><label class="f"><span>Document number</span><input name="no" value="${esc(q.no || '')}" required></label><label class="f"><span>Date</span><input name="date" type="date" value="${esc(q.date || ymd())}" required></label><label class="f"><span>Valid until</span><input name="validUntil" type="date" value="${esc(q.validUntil || '')}"></label><label class="f"><span>PO number</span><input name="poNumber" value="${esc(q.poNumber || '')}"></label><label class="f full"><span>Notes / terms (one per line)</span><textarea name="terms" rows="3">${esc(q.terms ?? S().invoiceTerms ?? '')}</textarea></label><div class="full"><div class="tot"><b>Items</b><span class="sp"></span><select id="quoteProduct"><option value="">Add product…</option>${productOptions}</select><button type="button" class="btn btn-s" data-act="quoteAddItem">Add product</button><button type="button" class="btn btn-s" data-act="quoteAddCustomItem">Add custom item</button></div><div id="quoteItems"></div></div><h3 class="full">Bank details (optional)</h3><label class="f ck"><input type="checkbox" name="bankOn" ${q.bankOn ? 'checked' : ''}> Show bank details on this document</label><label class="f"><span>Account number</span><input name="accNo" value="${esc(q.accNo || '')}"></label><label class="f"><span>Account name</span><input name="accName" value="${esc(q.accName || '')}"></label><label class="f"><span>Bank</span><input name="bank" value="${esc(q.bank || '')}"></label><label class="f"><span>Branch</span><input name="branch" value="${esc(q.branch || '')}"></label></form>`, `<button class="btn" data-act="closeModal">Cancel</button><button class="btn btn-p" data-act="quoteSave">Save ${q.type === 'invoice' ? 'invoice' : 'quotation'}</button>`, true);
  ov._quote = q; ov._items = items;
  const draw = (focus = null) => { const root = $('#quoteItems', ov); root.innerHTML = items.length ? `<div class="tw"><table><thead><tr><th>Description</th><th>Qty</th><th>Normal price</th><th>Discount price</th><th>Total</th><th></th></tr></thead><tbody>${items.map((i,n) => `<tr><td><textarea data-qi="${n}" data-qf="name" rows="2" style="min-width:180px">${esc(i.name)}</textarea><input placeholder="Item code" value="${esc(i.sku || '')}" data-qi="${n}" data-qf="sku" style="width:140px"></td><td><input type="number" min="0.01" step="any" value="${i.qty}" data-qi="${n}" data-qf="qty" style="width:76px"></td><td><input type="number" min="0" step="any" value="${i.regularPrice ?? i.price}" data-qi="${n}" data-qf="regularPrice" style="width:110px"></td><td><input type="number" min="0" step="any" value="${i.price}" data-qi="${n}" data-qf="price" style="width:110px"></td><td class="r">${money(num(i.qty)*num(i.price))}</td><td><button type="button" class="btn btn-s btn-d" data-act="quoteRemoveItem" data-id="${n}">Remove</button></td></tr>`).join('')}</tbody></table></div><div class="tot"><span>Original total: <b>${money(quoteOriginalTotal({items}))}</b></span><span>Discount: <b>${money(quoteDiscountTotal({items}))}</b></span><span>Total: <b>${money(quoteTotal({items}))}</b></span></div>` : '<div class="empty">Add products to this quotation.</div>'; if (focus) { const input = root.querySelector(`[data-qi="${focus.n}"][data-qf="${focus.key}"]`); input?.focus(); if (input?.setSelectionRange) input.setSelectionRange(input.value.length, input.value.length); } };
  ov._drawItems = draw; draw();
  ov.querySelector('#quoteForm').addEventListener('input', e => { if (e.target.dataset.qi === undefined) return; const n = +e.target.dataset.qi, key = e.target.dataset.qf; items[n][key] = ['qty','regularPrice','price'].includes(key) ? num(e.target.value) : e.target.value; draw({ n, key }); });
  ov.querySelector('#quoteForm').elements.customerId.addEventListener('change', e => { const selected = cust(e.target.value); if (!selected) return; const f = ov.querySelector('#quoteForm'); f.elements.billName.value = selected.name || ''; f.elements.billPhone.value = selected.phone || ''; f.elements.billAddress.value = selected.address || ''; });
  ov.querySelector('#quoteForm').addEventListener('submit', e => e.preventDefault());
  return ov;
}
A.newQuote = () => { const no = nextNo('quote', 'QT-'); const ov = quoteForm({ no }); };
A.newInvoiceDoc = () => { const no = nextNo('quote', 'INV-'); quoteForm({ no, type: 'invoice', terms: S().invoiceTerms || '' }); };
A.editQuote = id => { const q = db.quotations.find(x => x.id === id); if (q) quoteForm(q); };
A.quoteAddItem = (id, el) => { const ov = el.closest('.ov'), pid = $('#quoteProduct', ov).value, p = prod(pid); if (!p) return toast('Choose a product first', 'err'); ov._items.push({ pid: p.id, name: p.name, sku: p.sku || '', qty: 1, regularPrice: num(p.price), price: num(p.price) }); ov._drawItems(); };
A.quoteAddCustomItem = (id, el) => { const ov = el.closest('.ov'); ov._items.push({ pid: '', name: 'New item description', sku: '', qty: 1, regularPrice: 0, price: 0 }); ov._drawItems(); };
A.quoteRemoveItem = (n, el) => { const ov = el.closest('.ov'); ov._items.splice(+n, 1); ov._drawItems(); };
A.quoteSave = (id, el) => { const ov = el.closest('.ov'), f = ov.querySelector('#quoteForm'); if (!f.reportValidity()) return; if (!ov._items.length) return toast('Add at least one item', 'err'); const v = Object.fromEntries(new FormData(f)); const existing = ov._quote; const row = { ...(existing || {}), id: existing?.id || uid(), no: v.no.trim(), date: v.date, validUntil: v.validUntil, poNumber: v.poNumber, customerId: v.customerId, customerName: v.billName.trim() || cust(v.customerId)?.name || '', billName: v.billName.trim(), billPhone: v.billPhone.trim(), billAddress: v.billAddress.trim(), companyName: v.companyName.trim(), companyTagline: v.companyTagline.trim(), companyAddress: v.companyAddress.trim(), companyPhone: v.companyPhone.trim(), companyEmail: v.companyEmail.trim(), accent: v.accent, bankOn: f.elements.bankOn.checked, accNo: v.accNo, accName: v.accName, bank: v.bank, branch: v.branch, terms: v.terms, items: ov._items.map(i => ({ ...i, name: String(i.name || '').trim(), sku: String(i.sku || '').trim(), qty: num(i.qty), regularPrice: r2(i.regularPrice ?? i.price), price: r2(i.price) })), status: existing?.status || 'draft', createdAt: existing?.createdAt || nowISO(), updatedAt: nowISO(), user: existing?.user || me.name }; if (row.items.some(i => !i.name || i.qty <= 0 || i.price < 0 || i.regularPrice < 0)) return toast('Check item descriptions, quantities and prices', 'err'); const duplicate = db.quotations.find(x => x.no === row.no && x.id !== row.id); if (duplicate) return toast('Document number already exists', 'err'); if (existing) Object.assign(existing, row); else db.quotations.push(row); log('quotation', `${row.no} ${money(quoteTotal(row))}`); save(); ov.remove(); P.quotations(); toast('Quotation saved'); };
A.delQuote = async id => { const q = db.quotations.find(x => x.id === id); if (!q || !(await confirmDlg(`Delete quotation ${q.no}?`))) return; db.quotations = db.quotations.filter(x => x.id !== id); save(); P.quotations(); };
function quotePrintHTML(q) {
  const c = cust(q.customerId), rows = (q.items || []).map((i, n) => {
    const regular = num(i.regularPrice ?? i.price), discount = num(i.price), amount = num(i.qty) * discount;
    return `<tr><td>${n + 1}</td><td class="desc"><b>${esc(i.name)}</b>${i.sku ? `<br><small>${esc(i.sku)}</small>` : ''}</td><td class="r">${num(i.qty)}</td><td class="r">${money(regular)}</td><td class="r">${money(discount)}</td><td class="r">${money(amount)}</td></tr>`;
  }).join('');
  const blankRows = Array.from({ length: Math.max(0, 5 - (q.items || []).length) }, () => '<tr class="blank"><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>').join('');
  const terms = String(q.terms || '').split('\n').filter(x => x.trim());
  const accent = /^#[0-9a-f]{6}$/i.test(q.accent || '') ? q.accent : (S().invoiceAccent || '#333333');
  const company = { name: q.companyName ?? S().business, tagline: q.companyTagline ?? S().tagline, address: q.companyAddress ?? S().address, phone: q.companyPhone ?? S().phone, email: q.companyEmail ?? S().email };
  const customer = { name: q.billName || c?.name || q.customerName || 'Walk-in customer', address: q.billAddress ?? c?.address, phone: q.billPhone ?? c?.phone, email: c?.email };
  const title = q.type === 'invoice' ? 'INVOICE' : 'QUOTATION';
  const bank = q.bankOn ? `<div class="bank"><h2>BANK DETAILS</h2>${q.accNo ? `<p><b>Account Number:</b> ${esc(q.accNo)}</p>` : ''}${q.accName ? `<p><b>Account Name:</b> ${esc(q.accName)}</p>` : ''}${q.bank ? `<p><b>Bank:</b> ${esc(q.bank)}</p>` : ''}${q.branch ? `<p><b>Branch:</b> ${esc(q.branch)}</p>` : ''}</div>` : '';
  return `<main class="doc"><header><div class="identity">${S().logoData ? `<img class="logo" src="${esc(S().logoData)}" alt="">` : ''}<div><h1>${esc(company.name || 'POS')}</h1>${company.tagline ? `<div class="tagline">${esc(company.tagline)}</div>` : ''}</div></div><div class="title">${title}</div></header>
  <section class="info"><div class="company"><h2>BUSINESS DETAILS</h2>${company.address ? `<p>${esc(company.address).replace(/\n/g, '<br>')}</p>` : ''}${company.phone ? `<p>${esc(company.phone)}</p>` : ''}${company.email ? `<p>${esc(company.email)}</p>` : ''}</div><div class="bill"><h2>BILL TO</h2><b>${esc(customer.name)}</b>${customer.address ? `<p>${esc(customer.address).replace(/\n/g, '<br>')}</p>` : ''}${customer.phone ? `<p>${esc(customer.phone)}</p>` : ''}${customer.email ? `<p>${esc(customer.email)}</p>` : ''}</div><div class="meta"><div><b>DATE</b><span>${esc(q.date || '')}</span></div>${q.type === 'invoice' ? `<div><b>PO NO</b><span>${esc(q.poNumber || '—')}</span></div>` : `<div><b>VALID UNTIL</b><span>${esc(q.validUntil || '—')}</span></div>`}<div><b>${title} #</b><span>${esc(q.no || '')}</span></div></div></section>
  <table class="items"><thead><tr><th>#</th><th>DESCRIPTION</th><th>QTY</th><th>NORMAL PRICE</th><th>DISCOUNT PRICE</th><th>TOTAL</th></tr></thead><tbody>${rows}${blankRows}</tbody></table>
  <section class="summary"><div>${bank}<div class="terms"><h2>TERMS &amp; CONDITIONS</h2>${terms.length ? `<ul>${terms.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p>Prices and availability are subject to confirmation.</p>'}</div></div><div class="totals"><div><span>ORIGINAL TOTAL</span><b>${money(quoteOriginalTotal(q))}</b></div><div><span>DISCOUNT AMOUNT</span><b>${money(quoteDiscountTotal(q))}</b></div><div class="grand"><span>TOTAL</span><b>${money(quoteTotal(q))}</b></div></div></section>
  ${S().documentSignatureData ? `<div class="signature"><img src="${esc(S().documentSignatureData)}" alt="Authorized signature"><div class="signline">Authorized signatory</div></div>` : `<div class="signature"><div class="signline">Authorized signatory</div></div>`}<div class="thanks">${esc(S().footer || 'Thank you for your business.')}</div></main>`;
}
A.printQuote = id => {
  const q = db.quotations.find(x => x.id === id); if (!q) return;
  const accent = /^#[0-9a-f]{6}$/i.test(q.accent || '') ? q.accent : '#333333';
  const css = `@page{size:A4;margin:0}body{margin:0;color:#222;background:#fff;font:12px Arial,sans-serif}.doc{box-sizing:border-box;width:210mm;min-height:297mm;padding:18mm 17mm 15mm;position:relative}.doc *{box-sizing:border-box}header{height:42mm;position:relative;overflow:hidden;background:${accent};color:#fff;padding:9mm 10mm;display:flex;align-items:center;justify-content:space-between}header:after{content:"";position:absolute;right:-10mm;top:-25mm;width:95mm;height:90mm;transform:rotate(-25deg);background:rgba(255,255,255,.11)}.identity,.title{position:relative;z-index:1}.identity{display:flex;align-items:center;gap:12px;max-width:60%}.logo{width:62px;height:62px;object-fit:contain;background:#fff;border-radius:6px;padding:4px}.identity h1{font-size:21px;margin:0 0 5px}.tagline{font-size:10px;opacity:.9}.title{font-size:25px;font-weight:bold;letter-spacing:2px}.info{display:grid;grid-template-columns:1.1fr 1.1fr .9fr;gap:16px;padding:20px 0 16px;border-bottom:1px solid #ddd}.info h2,.terms h2,.bank h2{font-size:11px;color:${accent};letter-spacing:1px;margin:0 0 9px}.info p,.bank p{margin:3px 0;line-height:1.4}.meta div{display:flex;justify-content:space-between;gap:8px;padding:3px 0}.meta b{font-size:9px;color:#555}.items{width:100%;border-collapse:collapse;margin-top:19px;table-layout:fixed}.items th{background:${accent};color:white;text-align:right;font-size:9px;padding:9px 6px}.items th:nth-child(1){width:5%;text-align:center}.items th:nth-child(2){width:37%;text-align:left}.items th:nth-child(3){width:8%}.items th:nth-child(4),.items th:nth-child(5){width:17%}.items th:nth-child(6){width:16%}.items td{padding:9px 6px;border-bottom:1px solid #ddd;vertical-align:top}.items td:first-child{text-align:center}.desc{overflow-wrap:anywhere}.items small{color:#666}.r{text-align:right;white-space:nowrap}.blank td{height:30px}.summary{display:grid;grid-template-columns:1fr 235px;gap:22px;margin-top:20px}.terms h2{margin-bottom:6px}.terms ul{margin:0;padding-left:17px}.terms li{margin:5px 0;line-height:1.35}.totals>div{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid #eee}.totals span{font-size:9px;color:#555}.totals .grand{margin-top:4px;background:${accent};color:white;padding:10px}.totals .grand span{color:white;font-size:12px;font-weight:bold}.totals .grand b{font-size:15px}.signature{position:absolute;right:17mm;bottom:35mm;width:62mm;text-align:center}.signature img{display:block;max-width:52mm;max-height:22mm;object-fit:contain;margin:0 auto 5px}.signline{border-top:1px solid #555;padding-top:7px;font-size:10px}.thanks{position:absolute;bottom:14mm;left:17mm;right:17mm;border-top:2px solid ${accent};padding-top:9px;text-align:center;font-weight:bold;color:${accent}}`;
  modal('Quotation preview — ' + q.no, `<div class="quote-preview">${quotePrintHTML(q)}</div>`, `<button class="btn" data-act="closeModal">Close</button><button class="btn" data-act="printQuoteDoc" data-id="${esc(q.id)}">Print</button><button class="btn btn-p" data-act="printQuotePdf" data-id="${esc(q.id)}">Save as PDF</button>`, true);
  const style = document.createElement('style'); style.dataset.quotePreview = '1'; style.textContent = `.quote-preview{max-height:70vh;overflow:auto;background:#eef0f4;padding:16px}.quote-preview .doc{transform-origin:top left;transform:scale(.72);margin-bottom:-240px;box-shadow:0 2px 10px #0002}@media(max-width:850px){.quote-preview .doc{transform:scale(.55);margin-bottom:-380px}}`; document.head.appendChild(style);
  const ov = document.querySelector('.ov:last-child'); ov.addEventListener('remove', () => style.remove(), { once: true });
  ov._quoteCss = css; ov._quoteBody = quotePrintHTML(q); ov._quoteTitle = 'Quotation_' + (q.no || 'document');
};
A.printQuoteDoc = (id, el) => { const ov = el.closest('.ov'); if (ov) printHTML(ov._quoteBody, ov._quoteCss, ov._quoteTitle, { paperSize: 'A4' }); };
A.printQuotePdf = (id, el) => { const ov = el.closest('.ov'); if (ov) printHTML(ov._quoteBody, ov._quoteCss, ov._quoteTitle, { paperSize: 'A4' }); };
A.convertQuote = async id => { const q = db.quotations.find(x => x.id === id); if (!q || q.status === 'converted' || q.type === 'invoice') return; if (!(await confirmDlg(`Convert ${q.no} to a sale? Stock and payment will be handled in Point of Sale.`, 'Continue'))) return; if (cart.length) return toast('Finish or hold the current bill before loading a quotation', 'err'); const missing = q.items.filter(i => i.pid && !prod(i.pid)); if (missing.length) return toast('A quoted product is no longer in the product list', 'err'); for (const i of q.items) { if (!i.pid) return toast('Custom quotation items cannot be converted to a stock sale. Replace them with products first.', 'err'); const p = prod(i.pid); if (p.tracked || num(i.qty) > p.stock) return toast(`${p.name} is tracked by serial number or has insufficient stock`, 'err'); } cart = q.items.map(i => { const p = prod(i.pid), regular = num(p.price), quoted = num(i.price); return { pid:i.pid, name:i.name, qty:num(i.qty), price:regular, disc:r2(Math.max(regular - quoted, 0) * num(i.qty)), cost:p.cost || 0, dev:null, imei:'', warrantyM:p.warranty || 0 }; }); ps.cust = q.customerId || ''; ps.customerReady = !!cust(ps.cust); ps.customerPhone = cust(ps.cust)?.phone || ''; ps.dVal = 0; q.status = 'accepted'; q.acceptedAt = nowISO(); save(); nav('pos'); toast('Quote loaded into Point of Sale. Review tax and complete payment to create the sale.'); };
function refreshInvoicePreview() {
  const frame = $('#invoicePreview'); if (!frame) return;
  const sample = { no: 'INV-000123', at: nowISO(), day: ymd(), status: 'done', customerId: '', user: me?.name || 'Cashier', items: [{ name: 'Sample product', qty: 2, price: 1250, disc: 0, imei: '' }], itemsGross: 2500, lineDisc: 0, billDisc: 0, tax: 0, total: 2500, paid: 2500, pays: [{ method: 'Cash', amount: 2500 }], change: 0 };
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;background:#f3f4f6;padding:16px;display:flex;justify-content:center} @media(max-width:600px){body{margin:0;padding:8px}}</style></head><body>${receipt(sample)}</body></html>`;
}
A.saveInvoiceTemplate = async () => { await flush(); toast('Invoice template saved. New sales and reprints will use it.'); };
