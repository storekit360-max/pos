'use strict';
/* PAGES (part 1): dashboard, POS, sales/returns, products, barcodes, inventory */
const P = {};                       // page renderers: P.name()
const view = h => { $('#view').innerHTML = h; };
const isMgr = () => me.role !== 'cashier';

/* ================= DASHBOARD ================= */
let df = { from: ymd(), to: ymd() };
P.dashboard = async () => {
  const t = ymd();
  if (!df.from) df.from = t;
  if (!df.to) df.to = t;
  const td = stats(t, t), mo = stats(monthStart(), t), period = stats(df.from, df.to);
  const dayKeys = [...new Set([
    ...db.sales.filter(s => s.status === 'done' && s.day >= df.from && s.day <= df.to).map(s => s.day),
    ...db.returns.filter(r => r.day >= df.from && r.day <= df.to).map(r => r.day),
    ...db.expenses.filter(e => !e.void && e.date >= df.from && e.date <= df.to).map(e => e.date)
  ])].sort().reverse();
  const lows = db.products.filter(p => p.active !== false && stockOf(p) <= (p.min ?? S().lowStock));
  const recv = db.customers.reduce((a, c) => a + Math.max(c.balance || 0, 0), 0), pay = db.suppliers.reduce((a, c) => a + Math.max(c.balance || 0, 0), 0);
  const days = []; for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const k = ymd(d); days.push([k.slice(5), stats(k, k).netSales]); }
  const mx = Math.max(...days.map(d => d[1]), 1);
  const agg = {}; db.sales.filter(s => s.status === 'done' && s.day >= ymd(new Date(Date.now() - 30 * 864e5))).forEach(s => s.items.forEach(i => agg[i.name] = (agg[i.name] || 0) + i.qty));
  const top = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 6);
  let bk = 'Not available in browser mode';
  if (window.posApi) { const b = await window.posApi.backups(); const l = b.log.find(x => x.ok); bk = l ? dt(l.at) : 'No backup yet'; const bad = b.log[0] && !b.log[0].ok; if (bad) bk += ' ⚠ last attempt failed'; }
  const shift = db.shifts.find(s => !s.closeAt);
  view(`${hdr('Dashboard', `<span class="mut">${new Date().toDateString()}</span>`)}
<div class="filters"><label class="mut">From <input type="date" data-in="dashFrom" value="${esc(df.from)}"></label><label class="mut">To <input type="date" data-in="dashTo" value="${esc(df.to)}"></label><button class="btn" data-act="dashToday">Today</button><button class="btn" data-act="dashMonth">This month</button></div>
<div class="cards">
<div class="card stat acc"><small>Today's Sales</small><b>${money(td.netSales)}</b></div>
<div class="card stat"><small>Transactions Today</small><b>${td.count}</b></div>
<div class="card stat"><small>Gross Profit Today</small><b>${money(td.gp)}</b></div>
<div class="card stat"><small>Expenses Today</small><b>${money(td.exp)}</b></div>
<div class="card stat"><small>Net Profit Today</small><b style="color:${td.net < 0 ? 'var(--bad)' : 'var(--ok)'}">${money(td.net)}</b></div>
<div class="card stat"><small>Net Profit (${esc(df.from)} – ${esc(df.to)})</small><b style="color:${period.net < 0 ? 'var(--bad)' : 'var(--ok)'}">${money(period.net)}</b></div></div>
<div class="cards">
<div class="card stat"><small>Month Sales</small><b>${money(mo.netSales)}</b></div>
<div class="card stat"><small>Month Gross Profit</small><b>${money(mo.gp)}</b></div>
<div class="card stat"><small>Stock Value (at cost)</small><b>${money(stockValue())}</b></div>
<div class="card stat"><small>Customers Owe Us</small><b>${money(recv)}</b></div>
<div class="card stat"><small>We Owe Suppliers</small><b>${money(pay)}</b></div></div>
<div class="card"><b>Daily net profit</b>${dayKeys.length ? tbl(['Date', 'Net sales', 'Gross profit', 'Expenses', '>Net profit'], dayKeys.map(d => { const s = stats(d, d); return `<tr><td>${d}</td><td class="r">${money(s.netSales)}</td><td class="r">${money(s.gp)}</td><td class="r">${money(s.exp)}</td><td class="r" style="color:${s.net < 0 ? 'var(--bad)' : 'var(--ok)'}"><b>${money(s.net)}</b></td></tr>`; })) : '<div class="empty">No sales, returns or expenses in this date range</div>'}</div><br>
<div class="grid2">
<div class="card"><b>Sales – last 7 days</b><div class="bars">${days.map(d => `<div class="bar" style="height:${Math.max(d[1] / mx * 100, 2)}%"><span>${d[1] ? Math.round(d[1]) : ''}</span></div>`).join('')}</div><div style="display:flex;gap:10px">${days.map(d => `<div class="bl">${d[0]}</div>`).join('')}</div></div>
<div class="card"><b>Best sellers (30 days)</b>${top.length ? top.map(([n, q]) => `<div class="tot"><span>${esc(n)}</span><b>${q}</b></div>`).join('') : '<div class="empty">No sales yet</div>'}</div>
<div class="card"><b>Low / Out of stock (${lows.length})</b>${lows.slice(0, 8).map(p => `<div class="tot"><span>${esc(p.name)}</span><span class="badge ${stockOf(p) <= 0 ? 'b-bad' : 'b-warn'}">${stockOf(p)}</span></div>`).join('') || '<div class="empty">All stocked</div>'}<br><button class="btn btn-s" data-act="nav" data-id="inventory">Open inventory</button></div>
<div class="card"><b>System</b><div class="tot"><span>Last backup</span><span>${esc(bk)}</span></div><div class="tot"><span>Cash register</span><span class="badge ${shift ? 'b-ok' : ''}">${shift ? 'Open' : 'Closed'}</span></div><div class="tot"><span>Active products</span><b>${db.products.filter(p => p.active !== false).length}</b></div><div class="tot"><span>Month returns</span><b>${money(mo.returns)}</b></div></div>
</div><br><div class="card"><b>Recent sales</b>${tbl(['Invoice', 'Time', 'Customer', '>Total', 'Status'], db.sales.slice(-8).reverse().map(s => `<tr><td>${esc(s.no)}</td><td>${dt(s.at)}</td><td>${esc(cust(s.customerId)?.name || 'Walk-in')}</td><td class="r">${money(s.total)}</td><td><span class="badge ${s.status === 'done' ? 'b-ok' : 'b-bad'}">${s.status}</span></td></tr>`))}</div>`);
};
I.dashFrom = v => { df.from = v; P.dashboard(); };
I.dashTo = v => { df.to = v; P.dashboard(); };
A.dashToday = () => { df = { from: ymd(), to: ymd() }; P.dashboard(); };
A.dashMonth = () => { df = { from: monthStart(), to: ymd() }; P.dashboard(); };

/* ================= POINT OF SALE ================= */
let cart = [], ps = { q: '', cat: '', cust: '', customerPhone: '', customerName: '', customerReady: false, phonePadOpen: false, customerMessage: '', dType: 'amt', dVal: 0, m1: 'Cash', a1: '', m2: '', a2: '', adjustmentId: '', adjustmentReason: '' };
if (window.posApi) {
  window.posApi.onCustomerPhoneInput(phone => {
    if (ps.customerReady) return;
    ps.customerPhone = String(phone || '').replace(/\D/g, '').slice(0, 20);
    P.pos();
  });
  window.posApi.onCustomerPhoneSubmit(() => { if (!ps.customerReady) A.lookupCustomer(); });
}
function posTotals() {
  let gross = 0, ld = 0; cart.forEach(i => { gross += i.qty * i.price; ld += i.disc; });
  const after = gross - ld; let bd = ps.dType === 'pct' ? after * ps.dVal / 100 : ps.dVal; bd = Math.min(Math.max(r2(bd), 0), after);
  const base = after - bd, charges = effectiveCharges().map(c => ({ name: c.name, rate: c.rate, amount: r2(base * c.rate / 100) }));
  const tax = r2(charges.reduce((sum, c) => sum + c.amount, 0));
  return { gross: r2(gross), lineDisc: r2(ld), billDisc: bd, tax, charges, total: r2(base + tax), itemsNet: r2(after) };
}
const measureUnit = p => ['kg', 'L'].includes(p?.unit) ? p.unit : 'each';
function parseSaleQty(raw, p) {
  const value = String(raw ?? '').trim().replace(',', '.').toLowerCase();
  const m = value.match(/^([0-9]*\.?[0-9]+)\s*(kg|g|l|ml)?$/);
  if (!m) return NaN;
  let q = Number(m[1]), u = m[2] || measureUnit(p);
  if (u === 'g') { if (measureUnit(p) !== 'kg') return NaN; q /= 1000; }
  if (u === 'ml') { if (measureUnit(p) !== 'L') return NaN; q /= 1000; }
  if ((u === 'kg' && measureUnit(p) !== 'kg') || (u === 'l' && measureUnit(p) !== 'L')) return NaN;
  if (measureUnit(p) === 'each' && (m[2] || !Number.isInteger(q))) return NaN;
  return Math.round(q * 1000000) / 1000000;
}
function effectiveCharges() { const c = Array.isArray(S().charges) ? S().charges.filter(x => x && x.enabled !== false && num(x.rate) > 0) : []; return c.length ? c : (num(S().taxRate) > 0 ? [{ name: 'VAT', rate: num(S().taxRate) }] : []); }
P.pos = () => {
  const editing = ps.adjustmentId ? db.sales.find(s => s.id === ps.adjustmentId) : null;
  view(`${editing ? `<div class="card" style="margin-bottom:12px"><b>Adjusting invoice ${esc(editing.no)}</b><p class="mut">Edit this bill in Point of Sale, then complete the adjustment to update the original invoice and its stock and balance.</p></div>` : ''}<div class="pos"><div class="l">
${ps.customerReady ? `<div class="card" style="margin-bottom:12px;display:flex;align-items:center;gap:12px"><div><small class="mut">Billing for</small><br><b>${esc(cust(ps.cust)?.name || '')}</b> · ${esc(cust(ps.cust)?.phone || '')}</div><span class="sp"></span><button class="btn btn-s" data-act="changePosCustomer">Change customer</button></div>` : `<div class="card" style="margin-bottom:12px;display:flex;align-items:center;gap:12px"><div><b>No customer selected</b><br><small class="mut">Optional. You can complete this sale without customer details.</small></div><span class="sp"></span><button class="btn btn-p" data-act="togglePosPhonePad">${ps.phonePadOpen ? 'Hide phone entry' : 'Enter customer phone'}</button></div>${ps.phonePadOpen ? `<div class="card" style="margin-bottom:12px"><h3>Enter customer mobile number</h3><p class="mut">Enter a number to find an existing customer or register a new one.</p><div class="filters"><input data-in="posPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="Customer phone number" value="${esc(ps.customerPhone)}" style="flex:1"><button class="btn btn-p" data-act="lookupCustomer">Find customer</button></div><div class="pos-numpad" aria-label="Phone number keypad">${['1','2','3','4','5','6','7','8','9','Clear','0','⌫'].map(k => `<button class="btn" data-act="phoneKey" data-key="${k}" aria-label="${k === '⌫' ? 'Backspace' : k}">${k}</button>`).join('')}</div>${ps.customerMessage ? `<p class="mut">${esc(ps.customerMessage)}</p>` : ''}</div>` : ''}`}
<div class="filters"><input id="scan" placeholder="📷 Scan barcode / IMEI and press Enter" style="flex:2;font-size:16px;border-color:var(--acc)" autofocus>
<input data-in="posq" placeholder="Search product..." style="flex:1" value="${esc(ps.q)}">${sel('poscat', [['', 'All categories'], ...db.categories], ps.cat)}</div>
<div class="pgrid" id="grid"></div></div>
<div class="card cartbox"><div class="hdr" style="margin:0"><b style="font-size:17px">${editing ? `Invoice ${esc(editing.no)}` : 'Current Bill'}</b><span class="sp"></span>${editing ? `<button class="btn btn-s" data-act="cancelSaleAdjustment">Cancel adjustment</button>` : `<button class="btn btn-s" data-act="holdSale">Hold</button><button class="btn btn-s" data-act="resumeSale">Held (${db.held.length})</button>`}<button class="btn btn-s btn-d" data-act="clearCart">Clear</button></div>
<div class="lines" id="lines"></div>
<div class="filters" style="margin:0 0 6px"><span class="mut" style="align-self:center">Bill discount</span><input data-in="dval" type="number" min="0" value="${ps.dVal || ''}" style="width:90px">${sel('dtype', [['amt', money(0).split(' ')[0]], ['pct', '%']], ps.dType)}</div>
<div id="tots"></div>
<div class="filters" style="margin:6px 0 0">${sel('m1', methods().concat(['Credit']), ps.m1)}<input data-in="a1" type="number" placeholder="Amount (blank = full)" value="${ps.a1}" style="flex:1"></div>
<div class="filters" style="margin:6px 0 8px">${sel('m2', [['', 'Split with…'], ...methods()], ps.m2)}<input data-in="a2" type="number" placeholder="Split amount" value="${ps.a2}" style="flex:1"></div>
<button class="btn btn-p btn-lg" data-act="${editing ? 'completeSaleAdjustment' : 'completeSale'}">✔ ${editing ? 'Complete bill adjustment' : 'Complete Sale (F9)'}</button></div></div>`);
  drawGrid(); drawCart(); (ps.phonePadOpen && !ps.customerReady ? $('[data-in="posPhone"]') : $('#scan'))?.focus();
};
A.newSale = () => {
  cart = [];
  Object.assign(ps, { q: '', cat: '', cust: '', customerPhone: '', customerName: '', customerReady: false, phonePadOpen: false, customerMessage: '', dType: 'amt', dVal: 0, m1: 'Cash', a1: '', m2: '', a2: '', adjustmentId: '', adjustmentReason: '', adjustmentCustomerPending: false });
  nav('pos');
};
// Treat Sri Lankan local numbers (07x…), country-code numbers (+947x…)
// and their stored variants as the same number. Keep other numbers intact.
const normalizedPhone = value => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('94') && digits.length === 11) return digits.slice(2);
  if (digits.startsWith('0') && digits.length === 10) return digits.slice(1);
  return digits;
};
A.phoneKey = (_id, el) => { const key = el?.dataset.key || ''; ps.customerPhone = key === 'Clear' ? '' : key === '⌫' ? ps.customerPhone.slice(0, -1) : ps.customerPhone + key; P.pos(); document.querySelector('[data-in="posPhone"]')?.focus(); };
A.togglePosPhonePad = () => { ps.phonePadOpen = !ps.phonePadOpen; P.pos(); if (ps.phonePadOpen) document.querySelector('[data-in="posPhone"]')?.focus(); };
A.lookupCustomer = () => {
  const phone = String(ps.customerPhone || '').trim(), digits = normalizedPhone(phone);
  if (digits.length < 7) return toast('Enter a valid phone number (at least 7 digits)', 'err');
  const match = db.customers.find(c => normalizedPhone(c.phone) === digits);
  if (match) { ps.cust = match.id; ps.customerReady = true; ps.phonePadOpen = false; ps.customerName = ''; ps.customerMessage = ''; P.pos(); return; }
  ps.cust = ''; ps.customerReady = false; ps.customerName = ''; ps.customerMessage = 'No customer found.'; P.pos();
  modal('Register new customer', `<p class="mut">No customer is registered with ${esc(phone)}. Add their name to create a customer profile.</p><label class="f"><span>Customer name</span><input data-in="posCustomerName" autocomplete="name" placeholder="Customer name"></label>`, `<button class="btn" data-act="closeModal">Cancel</button><button class="btn btn-p" data-act="registerPosCustomer">Register customer</button>`);
  document.querySelector('[data-in="posCustomerName"]')?.focus();
};
A.registerPosCustomer = () => {
  const phone = String(ps.customerPhone || '').trim(), digits = normalizedPhone(phone), name = String(ps.customerName || '').trim();
  if (digits.length < 7) return toast('Enter a valid phone number (at least 7 digits)', 'err');
  if (!name) return toast('Enter the customer name', 'err');
  const match = db.customers.find(c => normalizedPhone(c.phone) === digits);
  if (match) { ps.cust = match.id; } else {
    const customer = { id: uid(), name, phone, type: 'Retail', balance: 0 };
    db.customers.push(customer); ps.cust = customer.id; log('customer created', `${name} ${phone}`); save();
  }
  ps.customerReady = true; ps.phonePadOpen = false; ps.customerName = ''; ps.customerMessage = ''; if(ps.adjustmentId)ps.cust=db.sales.find(s=>s.id===ps.adjustmentId)?.customerId||''; closeTop(); P.pos(); if (ps.adjustmentCustomerPending) A.completeSaleAdjustment(ps.adjustmentId);
};
A.changePosCustomer = () => { ps.customerReady = false; ps.phonePadOpen = true; ps.customerPhone = ''; ps.customerName = ''; ps.customerMessage = ''; P.pos(); document.querySelector('[data-in="posPhone"]')?.focus(); };
function drawGrid() {
  const q = ps.q.toLowerCase();
  let list;
  list = db.products.filter(p => p.active !== false && (!ps.cat || p.category === ps.cat) && (!q || (p.name + p.sku + p.barcode + (p.model || '')).toLowerCase().includes(q)));
  $('#grid').innerHTML = list.map(p => `<div class="pc" data-act="addProd" data-id="${p.id}"><b>${esc(p.name)}</b><div class="pr">${money(p.price)} / ${measureUnit(p)}</div><small class="${stockOf(p) <= 0 ? 'b-bad badge' : 'mut'}">Stock: ${stockOf(p)} ${measureUnit(p)}${p.tracked ? ' · IMEI' : ''}</small></div>`).join('') || '<div class="empty">No products. Add some in Products.</div>';
}
function drawCart() {
  $('#lines').innerHTML = cart.length ? cart.map((i, n) => { const unit = measureUnit(prod(i.pid)); return `<div class="line" style="${i.qty===0?'opacity:.55':''}"><div><b>${esc(i.name)}</b>${i.imei ? `<br><small class="mut">IMEI/SN ${esc(i.imei)}</small>` : ''}</div><div class="b r">${money(i.qty * i.price - i.disc)}</div>
<div class="qty">${i.dev ? '<small class="mut">1 device</small>' : `<button data-act="qtyM" data-id="${n}">−</button><input aria-label="Quantity in ${unit}" title="Enter e.g. 0.5 or 500g" data-in="lineQty" data-commit="change" data-n="${n}" type="text" inputmode="decimal" value="${i.qty}" style="width:76px;padding:3px 6px"><small class="mut">${unit}</small><button data-act="qtyP" data-id="${n}">+</button>`} <small class="mut">@/${unit}</small><input data-in="lprice" data-n="${n}" type="number" step="any" value="${i.price}" style="width:80px;padding:3px 6px"> <small class="mut">disc</small><input data-in="ldisc" data-n="${n}" type="number" value="${i.disc || ''}" style="width:60px;padding:3px 6px"></div>
<div class="r"><button class="btn btn-s btn-d" data-act="rmLine" data-id="${n}">✕</button></div></div>`; }).join('') : '<div class="empty">Scan or tap a product to begin</div>';
  drawTots();
}
function drawTots() {
  const t = posTotals(), a2 = num(ps.a2), a1 = ps.a1 === '' ? Math.max(t.total - a2, 0) : num(ps.a1), sum = r2(a1 + a2);
  $('#tots').innerHTML = `<div class="tot"><span>Subtotal</span><span>${money(t.gross)}</span></div><div class="tot"><span>Discount</span><span>-${money(t.lineDisc + t.billDisc)}</span></div>${t.charges.map(c => `<div class="tot"><span>${esc(c.name)} (${c.rate}%)</span><span>${money(c.amount)}</span></div>`).join('')}<div class="tot big"><span>TOTAL</span><span>${money(t.total)}</span></div><div class="tot"><span>Change due</span><b>${money(Math.max(sum - t.total, 0))}</b></div>${sum < t.total - 0.005 ? `<div class="tot" style="color:var(--bad)"><span>Balance (credit)</span><b>${money(t.total - sum)}</b></div>` : ''}`;
  syncCustomerDisplay(t);
}
function syncCustomerDisplay(t = posTotals()) {
  if (window.posApi && S().customerDisplay) window.posApi.updateCustomerDisplay({ business: S().business, description: S().description, tagline: S().tagline, logo: S().logoData, footer: S().footer, accent: S().accent, currency: S().currency, mode: ps.customerReady ? (cart.length ? 'bill' : 'ready') : 'idle', phone: ps.customerPhone, customer: ps.cust ? cust(ps.cust)?.name : '', items: cart.map(i => ({ name: i.name, qty: i.qty, price: i.price, lineTotal: r2(i.qty * i.price - i.disc) })), subtotal: t.gross, discount: r2(t.lineDisc + t.billDisc), charges: t.charges, tax: t.tax, taxRate: S().taxRate, total: t.total });
}
function addToCart(p, dev) {
  if (p.tracked) {
    if (dev) { if (cart.some(i => i.dev === dev.id)) return toast('Device already in cart', 'err'); pushLine(p, dev); return; }
    const inCart = new Set(cart.map(i => i.dev)), av = p.devs.filter(d => d.status === 'in' && !inCart.has(d.id));
    if (!av.length) return toast('No devices in stock for ' + p.name, 'err');
    const ov = modal('Select device – ' + p.name, `<div class="tw"><table><tbody>${av.map(d => `<tr><td>${esc(d.imei)}${d.imei2 ? ' / ' + esc(d.imei2) : ''}</td><td class="r"><button class="btn btn-s btn-p" data-act="pickDev" data-id="${p.id}|${d.id}">Select</button></td></tr>`).join('')}</tbody></table></div>`);
    return;
  }
  const ex = cart.find(i => i.pid === p.id && !i.dev), orig = ps.adjustmentId ? db.sales.find(s=>s.id===ps.adjustmentId)?.items.filter(x=>x.pid===p.id&&!x.dev).reduce((a,x)=>a+num(x.qty),0)||0 : 0, want = (ex ? ex.qty : 0) + 1;
  if (want > p.stock + orig) return toast(`Only ${p.stock} in stock`, 'err');
  if (ex) ex.qty++; else pushLine(p, null);
  drawCart();
}
function pushLine(p, d) { cart.push({ pid: p.id, name: p.name, unit: measureUnit(p), qty: 1, price: ps.cust && cust(ps.cust)?.type === 'Wholesale' && p.wholesale ? p.wholesale : p.price, disc: 0, cost: d && d.cost ? d.cost : p.cost, dev: d ? d.id : null, imei: d ? d.imei : '', warrantyM: p.warranty || 0 }); drawCart(); }
A.pickDev = id => { const [pid, did] = id.split('|'), p = prod(pid); pushLine(p, p.devs.find(d => d.id === did)); closeTop(); $('#scan')?.focus(); };
A.addProd = id => { addToCart(prod(id)); $('#scan')?.focus(); };
A.qtyP = n => { const i = cart[+n], p = prod(i.pid), orig = ps.adjustmentId ? db.sales.find(s=>s.id===ps.adjustmentId)?.items.find(x=>x.pid===i.pid&&!x.dev)?.qty||0 : 0; if (i.qty + 1 > p.stock + orig) return toast('Not enough stock', 'err'); i.qty++; drawCart(); };
A.qtyM = n => { const i = cart[+n], original = ps.adjustmentId ? db.sales.find(s=>s.id===ps.adjustmentId)?.items.find(x=>x.pid===i.pid&&!x.dev) : null; if (i.qty > 1) i.qty--; else if (measureUnit(prod(i.pid)) !== 'each') i.qty=0; else if(original) i.qty=0; else cart.splice(+n, 1); drawCart(); };
A.rmLine = n => { const i=cart[+n], original=ps.adjustmentId?db.sales.find(s=>s.id===ps.adjustmentId)?.items.some(x=>x.pid===i.pid&&x.dev===i.dev):false; if(original)i.qty=0; else cart.splice(+n, 1); drawCart(); };
A.clearCart = async () => { if (cart.length && !(await confirmDlg('Clear the current bill?'))) return; cart = []; ps.a1 = ps.a2 = ''; ps.dVal = 0; P.pos(); };
A.holdSale = () => { if (!cart.length) return; db.held.push({ id: uid(), at: nowISO(), cart, cust: ps.cust }); cart = []; save(); toast('Bill held'); P.pos(); };
A.resumeSale = () => {
  if (!db.held.length) return toast('No held bills');
  modal('Held bills', tbl(['Time', 'Items', ''], db.held.map(h => `<tr><td>${dt(h.at)}</td><td>${h.cart.length}</td><td class="r"><button class="btn btn-s btn-p" data-act="loadHeld" data-id="${h.id}">Resume</button> <button class="btn btn-s btn-d" data-act="delHeld" data-id="${h.id}">Delete</button></td></tr>`)));
};
A.loadHeld = id => { const h = db.held.find(x => x.id === id); if (cart.length) return toast('Finish or hold the current bill first', 'err'); cart = h.cart; ps.cust = h.cust || ''; ps.customerReady = !!cust(ps.cust); ps.customerPhone = cust(ps.cust)?.phone || ''; db.held = db.held.filter(x => x !== h); save(); closeTop(); P.pos(); };
A.delHeld = id => { db.held = db.held.filter(x => x.id !== id); save(); closeTop(); };
I.posq = v => { ps.q = v; drawGrid(); }; I.poscat = v => { ps.cat = v; drawGrid(); };
I.adjustmentReason = v => { ps.adjustmentReason = v; };
I.posPhone = v => { ps.customerPhone = v; syncCustomerDisplay(); }; I.posCustomerName = v => { ps.customerName = v; }; I.dval = v => { ps.dVal = num(v); drawTots(); }; I.dtype = v => { ps.dType = v; drawTots(); };
I.m1 = v => { ps.m1 = v; }; I.m2 = v => { ps.m2 = v; }; I.a1 = v => { ps.a1 = v; drawTots(); }; I.a2 = v => { ps.a2 = v; drawTots(); };
I.lprice = (v, el) => { cart[+el.dataset.n].price = num(v); drawTots(); }; I.ldisc = (v, el) => { cart[+el.dataset.n].disc = num(v); drawTots(); };
I.lineQty = (v, el) => { const i=cart[+el.dataset.n], p=prod(i.pid), q=parseSaleQty(v,p); if (!Number.isFinite(q) || q <= 0) { el.value=String(i.qty); toast(`Enter a valid quantity in ${measureUnit(p)} (grams and millilitres are supported)`,'err'); return; } const other=cart.reduce((a,x,n)=>a+(n!==+el.dataset.n&&x.pid===i.pid&&!x.dev?x.qty:0),0), original=ps.adjustmentId?db.sales.find(s=>s.id===ps.adjustmentId)?.items.filter(x=>x.pid===i.pid&&!x.dev).reduce((a,x)=>a+num(x.qty),0)||0:0; if(q+other>p.stock+original){el.value=String(i.qty);toast(`Only ${p.stock+original-other} ${measureUnit(p)} available`,'err');return;} i.qty=q; el.value=String(q); drawTots(); };
function scanned(code) {
  const c = code.trim(); if (!c) return;
  let p = db.products.find(x => x.active !== false && (x.barcode === c || x.sku === c));
  if (p) return addToCart(p);
  for (const q of db.products) { const d = q.devs.find(x => x.imei === c || x.imei2 === c); if (d) { if (d.status !== 'in') return toast(`Device ${c} is ${d.status}`, 'err'); return addToCart(q, d); } }
  toast('Unknown barcode: ' + c, 'err');
}
A.completeSale = () => {
  if (ps.adjustmentId) return A.completeSaleAdjustment(ps.adjustmentId);
  if (!cart.length) return toast('Cart is empty', 'err');
  const t = posTotals(), c = ps.cust ? cust(ps.cust) : null;
  const pct = t.gross ? (t.lineDisc + t.billDisc) / t.gross * 100 : 0;
  if (pct > S().maxDiscountPct && me.role === 'cashier') return toast(`Discount ${pct.toFixed(1)}% exceeds limit (${S().maxDiscountPct}%). Manager approval needed.`, 'err');
  const need = {};
  for (const i of cart) { const p = prod(i.pid); if (!p) return toast('Product missing', 'err');
    if (!Number.isFinite(i.qty) || i.qty <= 0 || (measureUnit(p) === 'each' && !Number.isInteger(i.qty))) return toast(`Enter a valid quantity for ${p.name}`, 'err');
    if (i.dev) { const d = p.devs.find(x => x.id === i.dev); if (!d || d.status !== 'in') return toast(`Device ${i.imei} is no longer available`, 'err'); }
    else { need[i.pid] = (need[i.pid] || 0) + i.qty; if (need[i.pid] > p.stock) return toast('Insufficient stock: ' + p.name, 'err'); } }
  const a2 = ps.m2 ? num(ps.a2) : 0, a1 = ps.a1 === '' ? Math.max(t.total - a2, 0) : num(ps.a1);
  let pays = []; if (ps.m1 !== 'Credit' && a1 > 0) pays.push({ method: ps.m1, amount: r2(a1) }); if (ps.m2 && a2 > 0) pays.push({ method: ps.m2, amount: r2(a2) });
  const sum = r2(pays.reduce((a, p) => a + p.amount, 0)), change = r2(Math.max(sum - t.total, 0));
  if (change > 0) { const cp = pays.find(p => p.method === 'Cash'); if (!cp || cp.amount < change) return toast('Overpayment is only allowed with Cash', 'err'); cp.amount = r2(cp.amount - change); }
  const paid = r2(Math.min(sum, t.total)), due = r2(t.total - paid);
  if (due > 0.005 && !c) return toast('Select a customer for credit / part payment', 'err');
  if (due > 0.005 && c.limit && (c.balance || 0) + due > c.limit) return toast('Customer credit limit exceeded', 'err');
  const s = { id: uid(), no: nextNo('sale', S().invPrefix), at: nowISO(), day: ymd(), user: me.name, customerId: c ? c.id : '', status: 'done',
    items: cart.map(i => ({ pid: i.pid, name: i.name, unit: i.unit || measureUnit(prod(i.pid)), qty: i.qty, price: i.price, disc: i.disc, cost: i.cost, dev: i.dev, imei: i.imei, warrantyM: i.warrantyM, returned: 0 })),
    itemsGross: t.gross, lineDisc: t.lineDisc, billDisc: t.billDisc, itemsNet: t.itemsNet, chargeLines: t.charges, tax: t.tax, total: t.total, paid, change, pays };
  const now = new Date();
  for (const i of s.items) { const p = prod(i.pid);
    if (i.dev) { const d = p.devs.find(x => x.id === i.dev); d.status = 'sold'; d.saleId = s.id; d.soldAt = s.at; d.warrantyEnd = i.warrantyM ? ymd(new Date(now.getFullYear(), now.getMonth() + i.warrantyM, now.getDate())) : ''; recount(p); }
    else p.stock = Math.round((p.stock - i.qty) * 1000000) / 1000000;
    move(p, -i.qty, 'sale', s.no); }
  if (c && due > 0) c.balance = r2((c.balance || 0) + due);
  db.sales.push(s); const sourceQuote = db.quotations?.find(q => q.status === 'accepted' && q.customerId === s.customerId && q.items.length === s.items.length && q.items.every((qi, n) => qi.pid === s.items[n].pid && num(qi.qty) === num(s.items[n].qty) && r2(Math.max(num(prod(qi.pid)?.price) - num(qi.price), 0) * num(qi.qty)) === r2(num(s.items[n].disc)))); if (sourceQuote) { sourceQuote.status = 'converted'; sourceQuote.saleId = s.id; sourceQuote.convertedAt = s.at; } log('sale', s.no + ' ' + money(s.total)); save();
  cart = []; ps.a1 = ps.a2 = ''; ps.m2 = ''; ps.dVal = 0; ps.cust = ''; ps.customerReady = false; ps.phonePadOpen = false; ps.customerPhone = ''; ps.customerName = ''; ps.customerMessage = '';
  showReceipt(s); P.pos();
};
function showReceipt(s) { modal('Sale ' + s.no, receipt(s), `<button class="btn" data-act="closeModal">Close</button><button class="btn btn-p" data-act="printSale" data-id="${s.id}">🖨 Print receipt</button>`); }
A.printSale = id => { const s = db.sales.find(x => x.id === id); if (s) printSaleDoc(s); };      // page size, margins and scaling come from Invoice → Printer & page setup (pages2.js)

/* ================= SALES & RETURNS ================= */
let sf = { q: '', from: monthStart(), to: ymd() };
P.sales = () => {
  view(`${hdr('Sales & Returns', '<button class="btn" data-act="salesCSV">Export CSV</button>')}<div class="filters"><input data-in="sq" placeholder="Invoice, customer, product or IMEI" value="${esc(sf.q)}" style="width:300px"><label class="mut">From <input type="date" data-in="sfrom" value="${sf.from}"></label><label class="mut">To <input type="date" data-in="sto" value="${sf.to}"></label></div><div id="list"></div>`); drawSales();
};
const salesFiltered = () => { const q = sf.q.toLowerCase(); return db.sales.filter(s => s.day >= sf.from && s.day <= sf.to && (me.role !== 'cashier' || s.user === me.name) && (!q || (s.no + (cust(s.customerId)?.name || '') + s.items.map(i => i.name + i.imei).join()).toLowerCase().includes(q))).reverse(); };
function drawSales() {
  const l = salesFiltered(); const tot = l.filter(s => s.status === 'done').reduce((a, s) => a + s.total, 0);
  $('#list').innerHTML = `<p class="mut">${l.length} invoices · total ${money(tot)}</p>` + tbl(['Invoice', 'Date', 'Customer', 'Cashier', '>Total', '>Paid', 'Status', ''], l.slice(0, 300).map(s => `<tr><td><b>${esc(s.no)}</b></td><td>${dt(s.at)}</td><td>${esc(cust(s.customerId)?.name || 'Walk-in')}</td><td>${esc(s.user)}</td><td class="r">${money(s.total)}</td><td class="r">${money(s.paid)}</td><td><span class="badge ${s.status === 'done' ? 'b-ok' : 'b-bad'}">${s.status}${s.items.some(i => i.returned) ? ' · returns' : ''}</span></td><td class="r"><button class="btn btn-s" data-act="viewSale" data-id="${s.id}">View</button></td></tr>`));
}
I.sq = v => { sf.q = v; drawSales(); }; I.sfrom = v => { sf.from = v; drawSales(); }; I.sto = v => { sf.to = v; drawSales(); };
A.viewSale = id => { const s = db.sales.find(x => x.id === id);
  modal('Invoice ' + s.no, receipt(s), `<button class="btn" data-act="closeModal">Close</button>${isMgr() && s.status === 'done' ? `<button class="btn" data-act="adjustSale" data-id="${id}">Adjust bill</button><button class="btn btn-d" data-act="voidSale" data-id="${id}">Void</button>` : ''}${s.status === 'done' && (isMgr() || true) ? `<button class="btn" data-act="returnSale" data-id="${id}">Return items</button>` : ''}<button class="btn btn-p" data-act="printSale" data-id="${id}">🖨 Reprint</button>`); };
// Adjustments are edited and completed from the regular POS cart.
A.adjustSale = id => {
  const s = db.sales.find(x => x.id === id);
  if (!s || s.status !== 'done') return toast('Only completed bills can be adjusted', 'err');
  if (s.items.some(i => i.returned)) return toast('Bills with returns cannot be adjusted', 'err');
  if (cart.length) return toast('Finish or hold the current bill before adjusting another bill', 'err');
  closeTop(); ps.adjustmentId=id; ps.adjustmentReason=''; ps.adjustmentCustomerPending=false; ps.cust=s.customerId||''; ps.customerReady=!!cust(ps.cust); ps.customerPhone=cust(ps.cust)?.phone||''; ps.phonePadOpen=false;
  ps.q=''; ps.cat=''; ps.dType='amt'; ps.dVal=num(s.billDisc); ps.a1=''; ps.a2=''; ps.m1=s.pays?.find(p=>p.method!=='Credit')?.method||'Cash'; ps.m2='';
  cart=s.items.map(i=>({pid:i.pid,name:i.name,unit:i.unit||measureUnit(prod(i.pid)),qty:num(i.qty),price:num(i.price),disc:num(i.disc),cost:num(i.cost),dev:i.dev||null,imei:i.imei||'',warrantyM:num(i.warrantyM),returned:num(i.returned)}));
  nav('pos');
};
A.cancelSaleAdjustment = async () => { if(cart.length&&!(await confirmDlg('Cancel this bill adjustment?')))return; cart=[]; ps.adjustmentId='';ps.adjustmentReason='';ps.cust='';ps.customerReady=false;ps.customerPhone='';ps.dVal=0;ps.a1=ps.a2='';nav('sales'); };
A.completeSaleAdjustment = id => {
  const s=db.sales.find(x=>x.id===ps.adjustmentId); if(!s||s.status!=='done'||s.items.some(i=>i.returned))return toast('This bill can no longer be adjusted','err');
  const reason=String(ps.adjustmentReason||'').trim();
  const original=s.items.map(i=>({...i})), revised=cart.filter(i=>i.qty>0).map(i=>({...i,returned:num(i.returned||0)}));
  if(!revised.length||revised.some(i=>i.qty<0||!Number.isFinite(i.qty)||!prod(i.pid)||(measureUnit(prod(i.pid))==='each'&&!Number.isInteger(i.qty))))return toast('Keep at least one valid product and use valid quantities','err');
  const oldCounts={},newCounts={}; original.forEach(i=>{if(!i.dev)oldCounts[i.pid]=(oldCounts[i.pid]||0)+num(i.qty);}); revised.forEach(i=>{if(!i.dev)newCounts[i.pid]=(newCounts[i.pid]||0)+num(i.qty);});
  for(const pid of new Set([...Object.keys(oldCounts),...Object.keys(newCounts)])){const p=prod(pid),delta=(newCounts[pid]||0)-(oldCounts[pid]||0); if(delta>p.stock)return toast(`Only ${p.stock} additional ${p.name} in stock`,'err');}
  const t=posTotals(), oldDue=r2(Math.max(0,num(s.total)-num(s.paid))), newDue=r2(Math.max(0,t.total-num(s.paid))), dueDelta=r2(newDue-oldDue), customer=cust(s.customerId);
  if(dueDelta>0.005&&customer?.limit&&num(customer.balance)+dueDelta>customer.limit)return toast('Customer credit limit exceeded','err');
  const stockDeltas={}; for(const pid of new Set([...Object.keys(oldCounts),...Object.keys(newCounts)]))stockDeltas[pid]=(oldCounts[pid]||0)-(newCounts[pid]||0);
  const revisedDevices=new Set(revised.filter(i=>i.dev).map(i=>i.dev));
  const removedDevices=original.filter(i=>i.dev&&!revisedDevices.has(i.dev));
  for(const i of revised.filter(i=>i.dev)){
    if(!original.some(old=>old.dev===i.dev))return toast(`Device ${i.imei||i.dev} was not on the original invoice`,'err');
  }
  for(const i of removedDevices){const p=prod(i.pid),d=p?.devs.find(x=>x.id===i.dev);if(!d||d.status!=='sold'||d.saleId!==s.id)return toast(`Device ${i.imei||i.dev} is no longer assigned to this invoice`,'err');}
  s.items=revised.map(i=>({pid:i.pid,name:i.name,unit:i.unit||measureUnit(prod(i.pid)),qty:i.qty,price:i.price,disc:i.disc,cost:i.cost,dev:i.dev,imei:i.imei,warrantyM:i.warrantyM,returned:i.returned||0}));
  s.itemsGross=t.gross;s.lineDisc=t.lineDisc;s.billDisc=t.billDisc;s.itemsNet=t.itemsNet;s.chargeLines=t.charges;s.tax=t.tax;s.total=t.total;
  for(const [pid,delta] of Object.entries(stockDeltas)){const p=prod(pid);if(delta){p.stock+=delta;move(p,-delta,'adjustment',s.no,reason);}}
  for(const i of removedDevices){const p=prod(i.pid),d=p.devs.find(x=>x.id===i.dev);d.status='in';d.saleId='';d.soldAt='';d.warrantyEnd='';recount(p);move(p,1,'adjustment',s.no,reason||`Serialized device ${i.imei||i.dev} removed from bill`);}
  if(customer&&Math.abs(dueDelta)>0.005)customer.balance=r2(num(customer.balance)+dueDelta);
  s.change=r2(Math.max(0,num(s.paid)-s.total));const adjustment={at:nowISO(),user:me.name,reason,oldTotal:num(original.reduce((a,i)=>a+i.qty*i.price-i.disc,0)),newTotal:s.total,oldItems:original,newItems:s.items.map(i=>({...i})),dueDelta};s.adjustments=Array.isArray(s.adjustments)?s.adjustments:[];s.adjustments.push(adjustment);
  log('sale adjustment',`${s.no}: ${reason || 'No reason provided'} (${money(adjustment.oldTotal)} → ${money(s.total)})`);save();cart=[];ps.adjustmentId='';ps.adjustmentReason='';ps.adjustmentCustomerPending=false;ps.dVal=0;ps.a1=ps.a2='';ps.cust='';ps.customerReady=false;nav('sales');toast('Bill adjusted');
};
A.voidSale = async id => {
  const s = db.sales.find(x => x.id === id); if (s.items.some(i => i.returned)) return toast('Sale has returns – cannot void', 'err');
  if (!(await confirmDlg(`Void invoice ${s.no}? Stock will be restored.`))) return;
  s.items.forEach(i => { const p = prod(i.pid); if (i.dev) { const d = p.devs.find(x => x.id === i.dev); d.status = 'in'; d.saleId = ''; recount(p); } else p.stock += i.qty; move(p, i.qty, 'void', s.no); });
  const c = cust(s.customerId); if (c) c.balance = r2((c.balance || 0) - (s.total - s.paid));
  s.status = 'void'; s.voidBy = me.name; log('void', s.no); save(); document.querySelectorAll('.ov').forEach(o => o.remove()); P.sales(); toast('Invoice voided');
};
A.returnSale = id => {
  const s = db.sales.find(x => x.id === id); closeTop();
  const rows = s.items.map((i, n) => { const max = i.qty - (i.returned || 0), u=measureUnit(prod(i.pid)); return `<tr><td>${esc(i.name)}${i.imei ? `<br><small>${esc(i.imei)}</small>` : ''}</td><td>${max} ${u}</td><td><input name="q${n}" type="number" min="0" step="${u==='each'?'1':'any'}" max="${max}" value="0" style="width:70px" ${max ? '' : 'disabled'}></td><td><label><input type="checkbox" name="r${n}" checked> restock</label></td></tr>`; }).join('');
  const ov = modal('Return – ' + s.no, `<form><div class="tw"><table><thead><tr><th>Item</th><th>Returnable</th><th>Return qty</th><th>Condition</th></tr></thead><tbody>${rows}</tbody></table></div><br><div class="fg"><label class="f"><span>Refund method</span><select name="rm">${methods().concat(['Reduce customer balance']).map(m => `<option>${esc(m)}</option>`).join('')}</select></label><label class="f"><span>Reason</span><input name="reason" value="Customer return"></label></div><p class="mut sm">Un-tick "restock" for defective items; they will NOT return to sellable stock.</p></form>`, `<button class="btn" data-act="closeModal">Cancel</button><button class="btn btn-p" data-act="doReturn" data-id="${id}">Process return</button>`);
};
A.doReturn = (id, el) => {
  const s = db.sales.find(x => x.id === id), f = el.closest('.ov').querySelector('form'), items = []; let refund = 0;
  const ratio = s.itemsNet ? s.total / s.itemsNet : 1;
  s.items.forEach((i, n) => { const q = num(f.elements['q' + n]?.value); if (q <= 0 || q > i.qty - (i.returned || 0) || (measureUnit(prod(i.pid)) === 'each' && !Number.isInteger(q))) return; const amt = r2((i.qty * i.price - i.disc) / i.qty * q * ratio); refund += amt; items.push({ n, pid: i.pid, name: i.name, qty: q, amount: amt, cost: i.cost, dev: i.dev, imei: i.imei, restock: f.elements['r' + n].checked }); });
  if (!items.length) return toast('Enter a quantity to return', 'err');
  refund = r2(refund); const tax = s.total ? r2(refund * s.tax / s.total) : 0, method = f.elements.rm.value;
  items.forEach(it => { const si = s.items[it.n], p = prod(it.pid); si.returned = (si.returned || 0) + it.qty;
    if (it.dev) { const d = p.devs.find(x => x.id === it.dev); d.status = it.restock ? 'in' : 'returned'; recount(p); } else if (it.restock) p.stock += it.qty;
    move(p, it.restock ? it.qty : 0, 'return', s.no, it.restock ? 'restocked' : 'not restocked (defective)'); });
  const c = cust(s.customerId); if (method === 'Reduce customer balance') { if (!c) return toast('No customer on this invoice', 'err'); c.balance = r2((c.balance || 0) - refund); }
  db.returns.push({ id: uid(), no: nextNo('ret', S().retPrefix), saleId: s.id, saleNo: s.no, at: nowISO(), day: ymd(), items, refund, tax, method, reason: f.elements.reason.value, user: me.name });
  log('return', s.no + ' ' + money(refund)); save(); document.querySelectorAll('.ov').forEach(o => o.remove()); toast('Return processed: ' + money(refund)); if ($('#list')) drawSales();
};
A.salesCSV = () => download('sales.csv', toCSV([['Invoice', 'Date', 'Customer', 'Cashier', 'Total', 'Paid', 'Status'], ...salesFiltered().map(s => [s.no, s.at, cust(s.customerId)?.name || 'Walk-in', s.user, s.total, s.paid, s.status])]));

/* ================= PRODUCTS ================= */
let pf = { q: '', cat: '', st: '' }, picked = new Set();
P.products = () => {
  view(`${hdr('Products', `<button class="btn" data-act="impProd">Import CSV</button><button class="btn" data-act="expProd">Export CSV</button><button class="btn" data-act="manageLists">Categories / Brands</button><button class="btn btn-p" data-act="newProd">+ New product</button>`)}
<div class="filters"><input data-in="pq" placeholder="Search name, SKU, barcode, IMEI…" style="width:300px" value="${esc(pf.q)}">${sel('pcat', [['', 'All categories'], ...db.categories], pf.cat)}${sel('pst', [['', 'All stock'], ['low', 'Low stock'], ['out', 'Out of stock'], ['arch', 'Archived']], pf.st)}<button class="btn" data-act="labelsSel">🏷 Labels for selected</button><button class="btn btn-d" data-act="delSel">Delete selected</button></div><div id="list"></div>`); drawProducts();
};
function drawProducts() {
  const q = pf.q.toLowerCase();
  const l = db.products.filter(p => (pf.st === 'arch' ? p.active === false : p.active !== false) && (!pf.cat || p.category === pf.cat) &&
    (pf.st === 'low' ? stockOf(p) <= (p.min ?? S().lowStock) && stockOf(p) > 0 : pf.st === 'out' ? stockOf(p) <= 0 : true) &&
    (!q || (p.name + p.sku + p.barcode + (p.brand || '') + (p.model || '') + p.devs.map(d => d.imei + d.imei2).join()).toLowerCase().includes(q)));
  const shown = l.slice(0, 300);
  $('#list').innerHTML = `<p class="mut">${l.length} products · ${picked.size} selected</p>` + tbl(['!<input type="checkbox" data-in="pickAll" aria-label="Select all filtered products" title="Select all filtered products">', 'Product', 'Category', 'Barcode', '>Cost', '>Price', '>Stock', ''], shown.map(p => `<tr><td><input type="checkbox" data-in="pick" data-n="${p.id}" ${picked.has(p.id) ? 'checked' : ''}></td><td><b>${esc(p.name)}</b><br><small class="mut">${esc(p.brand || '')} ${esc(p.model || '')} · ${esc(p.sku)}</small></td><td>${esc(p.category || '')}</td><td>${esc(p.barcode)}</td><td class="r">${money(p.cost)}</td><td class="r">${money(p.price)} / ${measureUnit(p)}</td><td class="r"><span class="badge ${stockOf(p) <= 0 ? 'b-bad' : stockOf(p) <= (p.min ?? S().lowStock) ? 'b-warn' : 'b-ok'}">${stockOf(p)} ${measureUnit(p)}</span></td><td class="r" style="white-space:nowrap">${p.tracked ? `<button class="btn btn-s" data-act="devices" data-id="${p.id}">IMEI</button> ` : ''}<button class="btn btn-s" data-act="hist" data-id="${p.id}">History</button> <button class="btn btn-s" data-act="editProd" data-id="${p.id}">Edit</button> <button class="btn btn-s" data-act="dupProd" data-id="${p.id}">Copy</button> <button class="btn btn-s btn-d" data-act="delProd" data-id="${p.id}">Delete</button> <button class="btn btn-s btn-d" data-act="archProd" data-id="${p.id}">${p.active === false ? 'Restore' : 'Archive'}</button></td></tr>`));
  const selectAll = $('#list [data-in="pickAll"]');
  if (selectAll) {
    const selectedCount = l.filter(p => picked.has(p.id)).length;
    selectAll.checked = l.length > 0 && selectedCount === l.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < l.length;
    selectAll.disabled = l.length === 0;
  }
}
I.pq = v => { pf.q = v; drawProducts(); }; I.pcat = v => { pf.cat = v; drawProducts(); }; I.pst = v => { pf.st = v; drawProducts(); };
I.pick = (v, el) => { el.checked ? picked.add(el.dataset.n) : picked.delete(el.dataset.n); drawProducts(); };
I.pickAll = v => {
  const q = pf.q.toLowerCase();
  const matching = db.products.filter(p => (pf.st === 'arch' ? p.active === false : p.active !== false) && (!pf.cat || p.category === pf.cat) &&
    (pf.st === 'low' ? stockOf(p) <= (p.min ?? S().lowStock) && stockOf(p) > 0 : pf.st === 'out' ? stockOf(p) <= 0 : true) &&
    (!q || (p.name + p.sku + p.barcode + (p.brand || '') + (p.model || '') + p.devs.map(d => d.imei + d.imei2).join()).toLowerCase().includes(q)));
  matching.forEach(p => v ? picked.add(p.id) : picked.delete(p.id));
  drawProducts();
};
const prodFields = (p = {}) => [
  { k: 'name', l: 'Product name', v: p.name, req: 1, cls: 'full' }, { k: 'brand', l: 'Brand', t: 'select', v: p.brand, o: ['', ...db.brands] }, { k: 'category', l: 'Category', t: 'select', v: p.category, o: ['', ...db.categories] },
  { k: 'model', l: 'Model / Variant (e.g. 8GB/256GB Black)', v: p.model }, { k: 'sku', l: 'SKU (blank = auto)', v: p.sku }, { k: 'barcode', l: 'Barcode (blank = auto)', v: p.barcode },
  { k: 'unit', l: 'Sell and stock unit', t: 'select', v: p.unit || 'each', o: [['each', 'Each (whole items)'], ['kg', 'Kilogram (price and stock per kg)'], ['L', 'Litre (price and stock per L)']] },
  { k: 'cost', l: 'Cost price (per selected unit)', t: 'number', v: p.cost ?? 0 }, { k: 'price', l: 'Selling price (per selected unit)', t: 'number', v: p.price ?? 0, req: 1 }, { k: 'wholesale', l: 'Wholesale price (per selected unit)', t: 'number', v: p.wholesale ?? 0 }, { k: 'minPrice', l: 'Minimum selling price', t: 'number', v: p.minPrice ?? 0 },
  ...(p.id ? [] : [{ k: 'stock', l: 'Opening stock (in selected unit)', t: 'number', v: 0 }]), { k: 'min', l: 'Low-stock level (selected unit)', t: 'number', v: p.min ?? S().lowStock }, { k: 'warranty', l: 'Warranty (months)', t: 'number', v: p.warranty ?? 0 },
  { k: 'tracked', l: 'Track by IMEI / serial number (phones, watches)', t: 'checkbox', v: p.tracked, cls: 'full' }, { k: 'notes', l: 'Notes', t: 'textarea', v: p.notes, cls: 'full' }];
function saveProduct(p, v) {
  if (!['each', 'kg', 'L'].includes(v.unit)) return 'Choose a valid stock unit';
  if (v.tracked && v.unit !== 'each') return 'IMEI/serial tracked products must use Each';
  if (p.id && (p.unit || 'each') !== v.unit && (stockOf(p) !== 0 || db.sales.some(s => s.items.some(i => i.pid === p.id)))) return 'This product has stock or sales history. Create a new product to use a different unit.';
  if (v.unit === 'each' && (!Number.isInteger(num(v.min)) || (!p.id && !Number.isInteger(num(v.stock))))) return 'Each-unit stock quantities must be whole numbers';
  if (v.price < v.cost && !confirm_warn) { }
  const dup = db.products.find(x => x.id !== p.id && v.barcode && x.barcode === v.barcode); if (dup) return 'Barcode already used by ' + dup.name;
  const dupS = db.products.find(x => x.id !== p.id && v.sku && x.sku === v.sku); if (dupS) return 'SKU already used by ' + dupS.name;
  if (p.id && (p.price !== v.price || p.cost !== v.cost)) log('price change', `${p.name}: cost ${p.cost}→${v.cost}, price ${p.price}→${v.price}`);
  const isNew = !p.id; if (isNew) { p.id = uid(); p.devs = []; p.stock = 0; p.active = true; p.created = nowISO(); db.products.push(p); }
  const { stock, ...rest } = v; Object.assign(p, rest);
  if (!p.sku) { db.counters.sku++; p.sku = 'SKU' + String(db.counters.sku).padStart(5, '0'); }
  if (!p.barcode) p.barcode = newBarcode();
  if (isNew && !p.tracked && stock > 0) { p.stock = stock; move(p, stock, 'opening', '', 'Opening stock'); }
  save(); P.products();
}
const confirm_warn = true;
A.newProd = () => { const p = {}; formModal('New product', prodFields(), v => saveProduct(p, v), 'Create', true); };
A.editProd = id => { const p = prod(id); formModal('Edit product', prodFields(p), v => saveProduct(p, v), 'Save', true); };
A.dupProd = id => { const p = prod(id), n = { ...p, name: p.name + ' (copy)', sku: '', barcode: '' }; delete n.id; n.devs = []; formModal('Duplicate product', prodFields(n).filter(f => f.k !== 'stock'), v => saveProduct({}, v), 'Create', true); };
A.delProd = async id => { const p = prod(id); if (!p) return; await deleteProducts([p]); };
A.delSel = async () => { const ps = db.products.filter(p => picked.has(p.id)); if (!ps.length) return toast('Select products first', 'err'); await deleteProducts(ps); };
async function deleteProducts(ps) {
  const ids = new Set(ps.map(p => p.id));
  const sold = db.sales.some(s => s.items.some(i => ids.has(i.pid)));
  const purchased = db.purchases.some(p => p.lines.some(i => ids.has(i.pid)));
  if (sold || purchased) return toast('Some selected products are in sales or purchase history. Archive them instead so records stay available.', 'err');
  if (!(await confirmDlg(`Permanently delete ${ps.length} product${ps.length === 1 ? '' : 's'}? This cannot be undone.`, 'Delete'))) return;
  db.products = db.products.filter(p => !ids.has(p.id));
  picked = new Set([...picked].filter(id => !ids.has(id)));
  ps.forEach(p => log('product deleted', p.name)); save(); P.products(); toast(`${ps.length} product${ps.length === 1 ? '' : 's'} deleted`);
}
A.archProd = id => { const p = prod(id); p.active = p.active === false; log('archive', p.name); save(); P.products(); };
A.hist = id => { const p = prod(id);
  modal('Stock history – ' + p.name, tbl(['Date', 'Type', '>Qty', 'Ref', 'Note', 'User'], db.moves.filter(m => m.pid === id).slice(0, 200).map(m => `<tr><td>${dt(m.at)}</td><td>${m.type}</td><td class="r">${m.qty}</td><td>${esc(m.ref)}</td><td>${esc(m.note)}</td><td>${esc(m.user)}</td></tr>`)), '', true); };
A.manageLists = () => {
  const box = (key, title) => `<div><b>${title}</b><div class="filters" style="margin:6px 0"><input id="add_${key}" placeholder="Add new…"><button class="btn btn-p btn-s" data-act="addList" data-id="${key}">Add</button></div>${db[key].map((x, i) => `<div class="tot" style="gap:8px"><span>${esc(x)}</span><span class="sp"></span><button class="btn btn-s" data-act="editList" data-id="${key}|${i}">Edit</button><button class="btn btn-s btn-d" data-act="delList" data-id="${key}|${i}">Remove</button></div>`).join('') || '<div class="mut">No entries yet</div>'}</div>`;
  modal('Product categories & brands', `<div class="fg"><div class="full">${box('categories', 'Product categories')}</div><div class="full">${box('brands', 'Brands')}</div></div>`, '', true);
};
A.addList = k => { const input = $('#add_' + k), v = input.value.trim(); if (!v) return; if (db[k].some(x => x.toLowerCase() === v.toLowerCase())) return toast(`${v} already exists`, 'err'); db[k].push(v); save(); closeTop(); A.manageLists(); };
A.editList = id => {
  const [k, rawIndex] = id.split('|'), index = Number(rawIndex), old = db[k]?.[index]; if (old == null) return;
  formModal(`Edit ${k === 'categories' ? 'category' : 'brand'}`, [{ k: 'name', l: 'Name', v: old, req: 1 }], ({ name }) => {
    if (db[k].some((x, i) => i !== index && x.toLowerCase() === name.toLowerCase())) return `${name} already exists`;
    db[k][index] = name;
    const productField = k === 'categories' ? 'category' : k === 'brands' ? 'brand' : null;
    if (productField) db.products.forEach(p => { if (p[productField] === old) p[productField] = name; });
    log('list edit', `${k}: ${old} → ${name}`); save(); A.manageLists();
  }, 'Save');
};
A.delList = async id => {
  const [k, rawIndex] = id.split('|'), index = Number(rawIndex), value = db[k]?.[index]; if (value == null) return;
  const field = k === 'categories' ? 'category' : k === 'brands' ? 'brand' : null;
  const used = field ? db.products.filter(p => p[field] === value).length : 0;
  if (used && !(await confirmDlg(`Remove “${value}”? It is assigned to ${used} product${used === 1 ? '' : 's'}; those assignments will be cleared.`))) return;
  if (field && used) db.products.forEach(p => { if (p[field] === value) p[field] = ''; });
  db[k].splice(index, 1); log('list remove', `${k}: ${value}`); save(); closeTop(); A.manageLists();
};
A.expProd = () => download('products.csv', toCSV([['name', 'sku', 'barcode', 'category', 'brand', 'model', 'cost', 'price', 'stock', 'min', 'tracked', 'unit'], ...db.products.map(p => [p.name, p.sku, p.barcode, p.category, p.brand, p.model, p.cost, p.price, stockOf(p), p.min, p.tracked ? 1 : 0, p.unit || 'each'])]));
A.impProd = () => {
  modal('Import products (CSV)', `<p>Columns: <code>name,sku,barcode,category,brand,model,cost,price,stock,min,tracked,unit</code>. Unit can be each, kg, or L. Existing barcodes/SKUs are skipped, nothing is overwritten.</p>`, `<button class="btn" data-act="tplProd">Download template</button><button class="btn btn-p" data-act="pickProdCSV">Choose CSV file</button>`);
};
A.tplProd = () => download('products_template.csv', toCSV([['name', 'sku', 'barcode', 'category', 'brand', 'model', 'cost', 'price', 'stock', 'min', 'tracked', 'unit'], ['Samsung Charger 25W', '', '', 'Chargers', 'Brand', '25W', 1200, 1990, 10, 3, 0, 'each'], ['Rice', '', '', 'Groceries', '', '', 250, 350, 20, 2, 0, 'kg']]));
A.pickProdCSV = () => pickFile('.csv', txt => {
  const rows = parseCSV(txt), h = rows.shift().map(x => x.trim().toLowerCase()), g = (r, k) => (r[h.indexOf(k)] || '').trim(); let ok = 0; const errs = [];
  rows.forEach((r, i) => { const name = g(r, 'name'); if (!name) return errs.push(`Row ${i + 2}: no name`);
    const bc = g(r, 'barcode'), sk = g(r, 'sku'); if ((bc && db.products.some(p => p.barcode === bc)) || (sk && db.products.some(p => p.sku === sk))) return errs.push(`Row ${i + 2}: duplicate barcode/SKU – skipped`);
    const unit = g(r, 'unit') || 'each', tracked = ['1', 'true', 'yes'].includes(g(r, 'tracked').toLowerCase()); if (!['each', 'kg', 'L'].includes(unit) || (tracked && unit !== 'each')) return errs.push(`Row ${i + 2}: unsupported unit for product – skipped`);
    const p = { id: uid(), name, sku: sk, barcode: bc, category: g(r, 'category'), brand: g(r, 'brand'), model: g(r, 'model'), cost: num(g(r, 'cost')), price: num(g(r, 'price')), min: g(r, 'min') === '' ? S().lowStock : num(g(r, 'min')), unit, tracked, devs: [], stock: 0, active: true, created: nowISO() };
    if (!p.sku) { db.counters.sku++; p.sku = 'SKU' + String(db.counters.sku).padStart(5, '0'); } if (!p.barcode) p.barcode = newBarcode();
    if (g(r, 'category') && !db.categories.includes(p.category)) db.categories.push(p.category); if (p.brand && !db.brands.includes(p.brand)) db.brands.push(p.brand);
    if (!p.tracked && num(g(r, 'stock')) > 0) { p.stock = num(g(r, 'stock')); move(p, p.stock, 'opening', '', 'CSV import'); } db.products.push(p); ok++; });
  save(); closeTop(); P.products(); modal('Import result', `<p><b>${ok}</b> imported, <b>${errs.length}</b> skipped.</p><pre style="white-space:pre-wrap">${esc(errs.join('\n'))}</pre>`);
});

/* ---- IMEI devices ---- */
A.devices = id => {
  const p = prod(id), st = ['in', 'reserved', 'sold', 'returned', 'inspection', 'repair', 'supplier-returned', 'written-off'];
  const ov = modal('Devices – ' + p.name, `<div class="filters"><input id="devsearch" placeholder="Search IMEI…" style="flex:1"></div>${tbl(['IMEI / Serial', 'IMEI 2', 'Status', 'Warranty to', 'Invoice'], p.devs.map(d => `<tr><td>${esc(d.imei)}</td><td>${esc(d.imei2 || '')}</td><td><select data-in="devst" data-n="${p.id}|${d.id}">${st.map(s => `<option ${s === d.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td><td>${esc(d.warrantyEnd || '')}</td><td>${esc(db.sales.find(s => s.id === d.saleId)?.no || '')}</td></tr>`), 'No devices yet')}
<br><b>Add devices (one per line: IMEI or IMEI,IMEI2)</b><textarea id="newdevs" rows="4" style="width:100%" placeholder="356938035643809"></textarea><label class="f"><span>Unit cost for these devices (opening stock)</span><input id="devcost" type="number" value="${p.cost}"></label>`, `<button class="btn" data-act="closeModal">Close</button><button class="btn btn-p" data-act="addDevs" data-id="${id}">Add devices</button>`, true);
};
I.devst = (v, el) => { const [pid, did] = el.dataset.n.split('|'), p = prod(pid), d = p.devs.find(x => x.id === did); log('device status', `${d.imei}: ${d.status}→${v}`); d.status = v; recount(p); move(p, 0, 'device-status', d.imei, v); save(); };
A.addDevs = id => { const p = prod(id), r = parseDevices($('#newdevs').value); if (r.errors.length) return toast(r.errors.join('; '), 'err');
  const cost = num($('#devcost').value); r.items.forEach(x => p.devs.push({ id: uid(), imei: x.imei, imei2: x.imei2, status: 'in', cost, at: nowISO() })); recount(p); if (r.items.length) move(p, r.items.length, 'opening', '', 'Devices added'); log('devices added', p.name + ' x' + r.items.length); save(); closeTop(); A.devices(id); drawProducts && $('#list') && drawProducts(); };

/* ================= BARCODE LABELS ================= */
let lq = {};
P.barcodes = () => {
  const s = S();
  view(`${hdr('Barcode Labels', '<button class="btn btn-p" data-act="printLabels">🖨 Print labels</button>')}
<div class="card" style="margin-bottom:14px"><div class="fg" style="grid-template-columns:repeat(6,1fr)">${[['labelW', 'Label width (mm)'], ['labelH', 'Label height (mm)'], ['labelCols', 'Columns']].map(([k, l]) => `<label class="f"><span>${l}</span><input type="number" data-in="lset" data-n="${k}" value="${s[k]}"></label>`).join('')}
${[['labelBiz', 'Business name'], ['labelName', 'Product name'], ['labelSku', 'SKU'], ['labelPrice', 'Price']].map(([k, l]) => `<label class="f ck"><input type="checkbox" data-in="lchk" data-n="${k}" ${s[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>
<div class="filters"><input data-in="lsearch" placeholder="Search product…" style="width:300px"></div><div id="list"></div>`);
  const search = $('[data-in="lsearch"]');
  search?.closest('.filters')?.insertAdjacentHTML('beforebegin', `<div class="card" style="margin-bottom:14px"><h3>Printer page and alignment</h3><p class="mut">Auto center places labels on the configured paper. Set page size to match the printer driver, then use offsets to calibrate feed alignment.</p><div class="fg" style="grid-template-columns:repeat(4,minmax(130px,1fr))">${[['labelPageW','Paper width (mm)'],['labelPageH','Paper height (mm)'],['labelMarginTop','Top margin (mm)'],['labelMarginRight','Right margin (mm)'],['labelMarginBottom','Bottom margin (mm)'],['labelMarginLeft','Left margin (mm)'],['labelGapX','Horizontal gap (mm)'],['labelGapY','Vertical gap (mm)'],['labelPadding','Label inner padding (mm)'],['labelOffsetX','Manual X offset (mm)'],['labelOffsetY','Manual Y offset (mm)']].map(([k,l]) => `<label class="f"><span>${l}</span><input type="number" step="0.5" data-in="lset" data-n="${k}" value="${s[k] ?? 0}"></label>`).join('')}<label class="f ck"><input type="checkbox" data-in="lchk" data-n="labelAutoAlign" ${s.labelAutoAlign !== false ? 'checked' : ''}> Auto center labels</label></div></div>`);
  drawLabelList('');
};
function drawLabelList(q) {
  q = q.toLowerCase(); const l = db.products.filter(p => p.active !== false && (!q || (p.name + p.sku + p.barcode).toLowerCase().includes(q))).slice(0, 200);
  $('#list').innerHTML = tbl(['Product', 'Barcode', 'Preview', '>Copies'], l.map(p => `<tr><td><b>${esc(p.name)}</b><br><small class="mut">${esc(p.sku)}</small></td><td>${esc(p.barcode)}</td><td style="background:#fff">${barcodeSVG(p.barcode, 28, 1)}</td><td class="r"><input type="number" min="0" data-in="lqty" data-n="${p.id}" value="${lq[p.id] || (picked.has(p.id) ? 1 : 0)}" style="width:70px"></td></tr>`));
}
I.lsearch = v => drawLabelList(v); I.lqty = (v, el) => { lq[el.dataset.n] = Math.max(0, Math.floor(num(v))); };
I.lset = (v, el) => { const k = el.dataset.n; const offset = k === 'labelOffsetX' || k === 'labelOffsetY'; const nonNegative = /^label(Margin|Gap|Padding)/.test(k); S()[k] = offset ? num(v) : nonNegative ? Math.max(0, num(v)) : Math.max(1, k === 'labelCols' ? Math.floor(num(v)) : num(v)); save(); };
I.lchk = (v, el) => { S()[el.dataset.n] = el.checked; save(); };
A.labelsSel = () => { lq = {}; picked.forEach(id => lq[id] = 1); if (!picked.size) return toast('Tick products first', 'err'); nav('barcodes'); };
A.printLabels = () => {
  const s = S(), items = []; db.products.forEach(p => { const n = lq[p.id] || 0; for (let i = 0; i < n; i++) items.push(p); });
  if (!items.length) return toast('Set copies for at least one product', 'err');
  const html = items.map(p => `<div class="lb">${s.labelBiz ? `<div class="t">${esc(s.business)}</div>` : ''}${s.labelName ? `<div class="n">${esc(p.name)}</div>` : ''}${barcodeSVG(p.barcode, Math.max(s.labelH * 0.9 * 0.9 * 1, 20), 1.2).replace('<svg', '<svg style="max-width:100%;height:auto"')}<div class="c">${esc(p.barcode)}${s.labelSku ? ' · ' + esc(p.sku) : ''}</div>${s.labelPrice ? `<div class="p">${money(p.price)}</div>` : ''}</div>`).join('');
  const pageW = Math.max(1, num(s.labelPageW || 210)), pageH = Math.max(1, num(s.labelPageH || 297));
  const mt = Math.max(0, num(s.labelMarginTop ?? 3)), mr = Math.max(0, num(s.labelMarginRight ?? 3)), mb = Math.max(0, num(s.labelMarginBottom ?? 3)), ml = Math.max(0, num(s.labelMarginLeft ?? 3));
  const gapX = Math.max(0, num(s.labelGapX ?? 1)), gapY = Math.max(0, num(s.labelGapY ?? 1)), padding = Math.max(0, num(s.labelPadding ?? 1));
  const offsetX = num(s.labelOffsetX || 0), offsetY = num(s.labelOffsetY || 0);
  const align = s.labelAutoAlign !== false ? 'center' : 'start';
  const css = `@page{size:${pageW}mm ${pageH}mm;margin:${mt}mm ${mr}mm ${mb}mm ${ml}mm}html,body{margin:0}.g{display:grid;grid-template-columns:repeat(${Math.max(1,Math.floor(num(s.labelCols)))},${Math.max(1,num(s.labelW))}mm);column-gap:${gapX}mm;row-gap:${gapY}mm;justify-content:${align};position:relative;left:${offsetX}mm;top:${offsetY}mm}.lb{width:${Math.max(1,num(s.labelW))}mm;height:${Math.max(1,num(s.labelH))}mm;overflow:hidden;text-align:center;border:.1mm dashed #bbb;padding:${padding}mm;box-sizing:border-box;page-break-inside:avoid;break-inside:avoid;font-size:7pt}.t{font-size:6pt}.n{font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.c{font-size:6pt}.p{font-weight:bold;font-size:9pt}`;
  printHTML(`<div class="g">${html}</div>`, css, 'Labels', { pageSizeMm: { width: pageW, height: pageH } });
};

/* ================= INVENTORY ================= */
let invf = { q: '', st: '' };
P.inventory = () => {
  view(`${hdr('Inventory', '<button class="btn" data-act="invCSV">Export CSV</button><button class="btn" data-act="stocktake">Stocktake</button>')}<div class="cards"><div class="card stat acc"><small>Stock value (cost)</small><b>${money(stockValue())}</b></div><div class="card stat"><small>Total units</small><b>${db.products.reduce((a, p) => a + stockOf(p), 0)}</b></div><div class="card stat"><small>Low stock</small><b>${db.products.filter(p => p.active !== false && stockOf(p) > 0 && stockOf(p) <= (p.min ?? S().lowStock)).length}</b></div><div class="card stat"><small>Out of stock</small><b>${db.products.filter(p => p.active !== false && stockOf(p) <= 0).length}</b></div></div>
<div class="filters"><input data-in="iq" placeholder="Search…" style="width:280px">${sel('ist', [['', 'All'], ['low', 'Low stock'], ['out', 'Out of stock']], invf.st)}</div><div id="list"></div><br><h3>Recent stock movements</h3>${tbl(['Date', 'Product', 'Type', '>Qty', 'Ref', 'User'], db.moves.slice(0, 40).map(m => `<tr><td>${dt(m.at)}</td><td>${esc(m.name)}</td><td>${m.type}</td><td class="r">${m.qty}</td><td>${esc(m.ref)} ${esc(m.note)}</td><td>${esc(m.user)}</td></tr>`))}`); drawInv();
};
function drawInv() { const q = invf.q.toLowerCase();
  const l = db.products.filter(p => p.active !== false && (!q || (p.name + p.sku + p.barcode).toLowerCase().includes(q)) && (invf.st === 'low' ? stockOf(p) > 0 && stockOf(p) <= (p.min ?? S().lowStock) : invf.st === 'out' ? stockOf(p) <= 0 : true));
  $('#list').innerHTML = tbl(['Product', '>Stock', '>Min', '>Cost', '>Value', ''], l.slice(0, 300).map(p => `<tr><td>${esc(p.name)}</td><td class="r">${stockOf(p)} ${measureUnit(p)}</td><td class="r">${p.min ?? S().lowStock} ${measureUnit(p)}</td><td class="r">${money(p.cost)} / ${measureUnit(p)}</td><td class="r">${money(stockOf(p) * p.cost)}</td><td class="r">${p.tracked ? '<span class="mut sm">via IMEI</span>' : `<button class="btn btn-s" data-act="adjust" data-id="${p.id}">Adjust</button>`}</td></tr>`)); }
I.iq = v => { invf.q = v; drawInv(); }; I.ist = v => { invf.st = v; drawInv(); };
A.adjust = id => { const p = prod(id); formModal('Adjust stock – ' + p.name, [{ k: 'qty', l: 'Change (+ add / − remove)', t: 'number', v: 0 }, { k: 'type', l: 'Reason', t: 'select', o: ['Correction', 'Damaged', 'Lost', 'Found', 'Expired/Obsolete', 'Other'] }, { k: 'note', l: 'Note', cls: 'full' }], v => {
  if (!v.qty) return 'Enter a quantity'; if (p.stock + v.qty < 0) return 'Cannot go below zero'; p.stock += v.qty; move(p, v.qty, 'adjust:' + v.type, '', v.note); log('stock adjust', `${p.name} ${v.qty} (${v.type})`); save(); P.inventory(); }); };
A.stocktake = () => { const l = db.products.filter(p => p.active !== false && !p.tracked);
  modal('Stocktake – enter counted quantities', `<form>${tbl(['Product', 'System', 'Counted'], l.map(p => `<tr><td>${esc(p.name)}</td><td>${p.stock}</td><td><input name="c_${p.id}" type="number" style="width:90px" placeholder="skip"></td></tr>`))}</form>`, `<button class="btn" data-act="closeModal">Cancel</button><button class="btn btn-p" data-act="applyCount">Apply differences</button>`, true); };
A.applyCount = (id, el) => { const f = el.closest('.ov').querySelector('form'); let n = 0;
  db.products.forEach(p => { const e = f.elements['c_' + p.id]; if (!e || e.value === '') return; const c = num(e.value), d = c - p.stock; if (d) { p.stock = c; move(p, d, 'stocktake', '', `counted ${c}`); n++; } });
  log('stocktake', n + ' differences'); save(); closeTop(); P.inventory(); toast(n + ' products adjusted'); };
A.invCSV = () => download('inventory.csv', toCSV([['Product', 'SKU', 'Stock', 'Cost', 'Value'], ...db.products.map(p => [p.name, p.sku, stockOf(p), p.cost, r2(stockOf(p) * p.cost)])]));
