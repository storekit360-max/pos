'use strict';
/* CORE: data, helpers, barcode, printing, UI helpers. Edit freely. */
const LS_KEY = 'thesmart_pos_v1';
let db = null, me = null;
const LIVE_WEB = !window.posApi && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1' && location.protocol === 'https:';
let cloudRevision = 0, cloudSyncTimer = null, cloudSyncBusy = false, cloudLastError = '', cloudBaseData = null, cloudMutationId = '';
const A = {}, I = {};                    // click actions (data-act) and input handlers (data-in)

const $ = (s, r = document) => r.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const r2 = n => Math.round((+n + Number.EPSILON) * 100) / 100;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = () => db.settings;
const money = n => S().currency + ' ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = n => String(n).padStart(2, '0');
const ymd = d => { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const dt = iso => new Date(iso).toLocaleString();
const nowISO = () => new Date().toISOString();
const monthStart = () => ymd().slice(0, 8) + '01';
const prod = id => db.products.find(p => p.id === id);
const cust = id => db.customers.find(c => c.id === id);
const sup = id => db.suppliers.find(c => c.id === id);

function defaults() {
  return {
    v: 1,
    settings: {
      business: 'POS', address: '', phone: '', email: '', tagline: '', description: '', logoData: '', customerDisplay: false,
      invoiceStyle: 'a4', invoiceNotes: 'It was great doing business with you.', invoiceTerms: 'Please make the payment by the due date.',
      invoiceDocumentTemplateId: '', invoiceDocumentTemplates: [],
      invoiceTitle: 'INVOICE', invoiceFont: 'Arial', invoiceFontSize: 14, invoicePageSize: 'A4', invoicePageMargin: 14, invoiceLogoWidth: 120,
      invoiceShowLogo: true, invoiceShowBusiness: true, invoiceShowAddress: true, invoiceShowPhone: true, invoiceShowEmail: true,
      invoiceShowCustomer: true, invoiceShowCashier: false, invoiceShowDueDate: true, invoiceShowItemCode: false,
      invoiceShowDiscount: true, invoiceShowCharges: true, invoiceShowPayment: true, invoiceShowBalance: true,
      invoiceShowNotes: true, invoiceShowTerms: true, invoiceShowFooter: true, invoiceFooter: '',
      currency: 'Rs.', taxRate: 0, charges: [], receiptSize: '80', receiptPadding: 2, receiptAutoAlign: true, receiptOffsetX: 0, receiptOffsetY: 0, receiptCustomW: 80, receiptFontPct: 100, receiptFeedTop: 0, receiptFeedBottom: 0,
      invoicePaper: 'A4', invoicePaperW: 210, invoicePaperH: 297, invoiceMarginT: 0, invoiceMarginR: 0, invoiceMarginB: 0, invoiceMarginL: 0, invoiceFit: 'auto', invoiceScale: 100, invoiceOffsetX: 0, invoiceOffsetY: 0, footer: 'Thank you for shopping with us!',
      returnPolicy: 'Exchange within 7 days with receipt. No cash refunds.', warranty: 'Warranty as per supplier terms.',
      invPrefix: 'INV-', purPrefix: 'PUR-', retPrefix: 'RET-', lowStock: 5, maxDiscountPct: 20,
      accent: '#f97316', dark: false, labelW: 50, labelH: 30, labelCols: 3, labelName: true, labelSku: true, labelPrice: true, labelBiz: true,
      labelPageW: 210, labelPageH: 297, labelMarginTop: 3, labelMarginRight: 3, labelMarginBottom: 3, labelMarginLeft: 3, labelGapX: 1, labelGapY: 1, labelPadding: 1, labelAutoAlign: true, labelOffsetX: 0, labelOffsetY: 0,
      backupDir: '', backupTime: '02:00', backupFrequency: 'daily', backupWeekday: 1, backupKeep: 30, backupOn: true, payMethods: 'Cash,Card,Bank Transfer,QR / Digital', updateManifestUrl: 'https://pos360live.vercel.app/updates/latest.json', attendanceStart: '09:00', docSub: '', docFootTag: '', docSignName: '', docLogo: '', docBulb: '', docSign: ''
    },
    categories: ['Smartphones', 'Feature Phones', 'Tablets', 'Chargers', 'Charging Cables', 'Power Banks', 'Earphones', 'Headphones', 'Bluetooth Speakers', 'Phone Cases', 'Screen Protectors', 'Memory Cards', 'USB Drives', 'Smartwatches', 'Phone Parts', 'Repair Accessories', 'Other Accessories'],
    brands: ['Apple', 'Samsung', 'Xiaomi', 'Huawei', 'Oppo', 'Vivo', 'Realme', 'Anker', 'JBL', 'Generic'],
    expCats: ['Rent', 'Electricity', 'Internet', 'Salaries', 'Transport', 'Repairs', 'Packaging', 'Bank Charges', 'Marketing', 'Miscellaneous'],
    products: [], suppliers: [], customers: [], sales: [], returns: [], purchases: [], expenses: [], payments: [],
    moves: [], held: [], shifts: [], attendance: [], audit: [], users: [], quotations: [],
    counters: { sale: 0, pur: 0, ret: 0, bar: 0, sku: 0, quote: 0 }
  };
}

/* ---------- persistence ---------- */
let saveTimer;
function save() { if (LIVE_WEB && me && !cloudMutationId) cloudMutationId = uid(); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 120); }
async function flush() {
  clearTimeout(saveTimer);
  try {
    if (window.posApi) await window.posApi.save(db);
    else {
      localStorage.setItem(LS_KEY, JSON.stringify(db));
      if (LIVE_WEB && me) { localStorage.setItem(LS_KEY,JSON.stringify(db)); localStorage.setItem(LS_KEY+':pending',JSON.stringify({revision:cloudRevision,mutationId:cloudMutationId})); if (!cloudBaseData) refreshCloudThenSync(); else queueCloudSync(); }
    }
  }
  catch (e) { toast('SAVE FAILED: ' + e.message, 'err'); }
}
function queueCloudSync() { clearTimeout(cloudSyncTimer); cloudSyncTimer = setTimeout(syncCloud, 700); }
async function syncCloud() {
  if (!LIVE_WEB || !me || cloudSyncBusy || !navigator.onLine) return;
  cloudSyncBusy = true;
  try {
    if (typeof licenseInfo !== 'undefined' && licenseInfo?.state === 'expired') { cloudLastError='Your subscription expired. Local edits remain on this device and are not being sent. Export your data and contact support to renew.'; showCloudSyncStatus(); return; }
    const local = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (!cloudBaseData || !cloudMutationId || !local) { cloudLastError = 'Cloud baseline is unavailable. Reload while online before syncing changes.'; return; }
    const r = await fetch('/api/data', {method:'PUT',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({data:local,baseRevision:cloudRevision,clientMutationId:cloudMutationId})});
    const result = await r.json();
    if (!r.ok) { if (r.status === 409) cloudLastError = 'Cloud data changed in another session. Local edits are preserved on this device; export them before resolving the conflict.'; else if (r.status === 402 && result.code === 'LICENSE_EXPIRED') { if(typeof licenseInfo!=='undefined')licenseInfo={...(licenseInfo||{}),state:'expired',message:result.error}; cloudLastError='Your subscription expired. Local edits remain on this device and are not being sent. Export your data and contact support to renew.'; nav(current); showCloudSyncStatus(); } else if (r.status === 403 && result.code === 'TENANT_SUSPENDED') { cloudLastError='This shop is suspended. Unsynced local edits remain on this device.'; me = null; loginScreen(); showCloudSyncStatus(); } else if (r.status === 401) { me = null; loginScreen(); } else cloudLastError = result.error || 'Cloud sync failed'; if (r.status===409) showCloudSyncStatus(); return; }
    cloudRevision = result.revision; cloudBaseData = JSON.parse(JSON.stringify(local)); cloudMutationId = ''; localStorage.removeItem(LS_KEY + ':pending'); cloudLastError = '';
  } catch (_) { cloudLastError = 'Offline changes are saved on this device and will sync when reconnected.'; }
  finally { cloudSyncBusy = false; if (cloudLastError && me && navigator.onLine && !cloudLastError.startsWith('Cloud data changed') && !cloudLastError.startsWith('Your subscription expired')) { clearTimeout(cloudSyncTimer); cloudSyncTimer=setTimeout(syncCloud,5000); } }
}
window.addEventListener('online', () => { if (LIVE_WEB) refreshCloudThenSync(); });
async function refreshCloudThenSync() {
  if (!LIVE_WEB || !me || cloudSyncBusy || !navigator.onLine) return;
  try {
    const r = await fetch('/api/data',{credentials:'same-origin'}), response=await r.json();
    if (r.status === 401) { me=null; loginScreen(); return; }
    if (r.status === 403 && response.code === 'TENANT_SUSPENDED') { cloudLastError='This shop is suspended. Unsynced local edits remain on this device.'; me=null; loginScreen(); showCloudSyncStatus(); return; }
    if (!r.ok) throw new Error(response.error || 'Could not refresh cloud data');
    if (JSON.stringify(response.data) !== JSON.stringify(cloudBaseData)) {
      const local=JSON.parse(localStorage.getItem(LS_KEY)||'null');
      if (local && cloudBaseData && JSON.stringify(local) !== JSON.stringify(cloudBaseData)) { cloudLastError='Cloud data changed while this device had unsynced edits. Local copy is preserved; export it before resolving the conflict.'; showCloudSyncStatus(); return; }
      cloudBaseData=JSON.parse(JSON.stringify(response.data)); cloudRevision=response.revision;
      db=response.data; localStorage.setItem(LS_KEY,JSON.stringify(db));
    }
    if (cloudLastError.startsWith('Cloud data changed')) return;
    queueCloudSync();
  } catch (_) { cloudLastError='Offline changes remain saved on this device and will sync when reconnected.'; }
}
function showCloudSyncStatus() { if (typeof toast === 'function' && cloudLastError) toast(cloudLastError,'err'); }
async function loadDB() {
  let d = null;
  try {
    if (window.posApi) d = await window.posApi.load();
    else if (LIVE_WEB) { const local = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (local) d = local; }
    else d = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
  }
  catch (e) { throw new Error('Local shop data could not be opened. The app has not created or replaced any database files. ' + (e?.message || '')); }
  if (d) { const df = defaults(); d.settings = Object.assign(df.settings, d.settings); for (const k in df) if (!(k in d)) d[k] = df[k]; d.counters = Object.assign(df.counters, d.counters); }
  // Replace the placeholder URL retained by older client profiles.
  if (d?.settings?.updateManifestUrl === 'https://YOUR-VERCEL-DOMAIN/updates/latest.json') {
    d.settings.updateManifestUrl = defaults().settings.updateManifestUrl;
    if (window.posApi) await window.posApi.save(d);
  }
  db = d;
}
window.addEventListener('beforeunload', () => { if (!window.posApi && db) localStorage.setItem(LS_KEY, JSON.stringify(db)); });
function log(action, detail) { db.audit.unshift({ at: nowISO(), user: me ? me.name : '-', action, detail }); if (db.audit.length > 2000) db.audit.length = 2000; }
function nextNo(kind, prefix) { db.counters[kind]++; return prefix + String(db.counters[kind]).padStart(6, '0'); }

/* ---------- security ---------- */
async function sha(s) {
  if (crypto && crypto.subtle) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
  let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return 'f' + h;
}
const hashPw = (salt, pw) => sha(salt + ':' + pw);

/* ---------- stock helpers ---------- */
const stockOf = p => p.tracked ? p.devs.filter(d => d.status === 'in').length : p.stock;
function recount(p) { if (p.tracked) p.stock = p.devs.filter(d => d.status === 'in').length; }
function move(p, qty, type, ref, note) { db.moves.unshift({ id: uid(), at: nowISO(), pid: p.id, name: p.name, qty, type, ref: ref || '', note: note || '', user: me ? me.name : '' }); if (db.moves.length > 20000) db.moves.length = 20000; }
function luhn(s) { let sum = 0, alt = false; for (let i = s.length - 1; i >= 0; i--) { let n = +s[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; } return sum % 10 === 0; }
function parseDevices(text, extraSeen) {
  const seen = new Set(extraSeen || []); db.products.forEach(p => p.devs.forEach(d => { seen.add(d.imei); if (d.imei2) seen.add(d.imei2); }));
  const items = [], errors = [];
  text.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => {
    const [a, b] = l.split(/[,;\s]+/);
    // IMEI values are accepted as entered. Some devices and imported records
    // have non-standard lengths or check digits, and serial numbers are also
    // supported in this field.
    if (!a) return;
    if (seen.has(a) || (b && seen.has(b))) return errors.push(a + ': duplicate identifier');
    seen.add(a); if (b) seen.add(b); items.push({ imei: a, imei2: b || '' });
  });
  return { items, errors };
}
function genImei() { let s = ''; for (let i = 0; i < 14; i++) s += Math.floor(Math.random() * 10); for (let d = 0; d < 10; d++) if (luhn(s + d)) return s + d; }
function newBarcode() { db.counters.bar++; return '2' + String(db.counters.bar).padStart(9, '0'); }   // internal shop code (not GS1)

/* ---------- Code 128 barcode (offline SVG) ---------- */
const C128 = "212222,222122,222221,121223,121322,131222,122213,122312,132212,221213,221312,231212,112232,122132,122231,113222,123122,123221,223211,221132,221231,213212,223112,312131,311222,321122,321221,312212,322112,322211,212123,212321,232121,111323,131123,131321,112313,132113,132311,211313,231113,231311,112133,112331,132131,113123,113321,133121,313121,211331,231131,213113,213311,213131,311123,311321,331121,312113,312311,332111,314111,221411,431111,111224,111422,121124,121421,141122,141221,112214,112412,122114,122411,142112,142211,241211,221114,413111,241112,134111,111242,121142,121241,114212,124112,124211,411212,421112,421211,212141,214121,412121,111143,111341,131141,114113,114311,411113,411311,113141,114131,311141,411131,211412,211214,211232,2331112".split(',');
function barcodeSVG(text, h = 40, mod = 1.5) {
  text = String(text); const codes = [104]; let sum = 104;
  for (let i = 0; i < text.length; i++) { const v = text.charCodeAt(i) - 32; if (v < 0 || v > 94) continue; codes.push(v); }
  let pos = 1; for (let i = 1; i < codes.length; i++, pos++) sum += codes[i] * pos;
  codes.push(sum % 103, 106);
  let x = 10 * mod, bars = '';
  codes.forEach(c => { const pat = C128[c]; for (let i = 0; i < pat.length; i++) { const w = +pat[i] * mod; if (i % 2 === 0) bars += `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${h}"/>`; x += w; } });
  const W = x + 10 * mod;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(1)}" height="${h}" viewBox="0 0 ${W.toFixed(1)} ${h}" shape-rendering="crispEdges" fill="#000">${bars}</svg>`;
}

/* ---------- printing (works in Electron and browsers) ---------- */
function printHTML(body, css = '', title = 'Print', printOptions = {}) {
  if (window.posApi?.printHTML) {
    window.posApi.printHTML({ body, css, title, ...printOptions }).then(result => {
      if (result?.cancelled) return;
      toast(result?.mode === 'pdf' ? 'PDF saved successfully' : 'Print dialog opened');
    }).catch(e => toast('Printing failed: ' + e.message, 'err'));
    return;
  }
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const d = f.contentWindow.document; d.open();
  d.write(`<html><head><title>${esc(title)}</title><style>body{font-family:Arial,sans-serif;margin:0;color:#000}${css}</style></head><body>${body}</body></html>`);
  d.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 3000); }, 400);
}

/* ---------- UI helpers ---------- */
function toast(msg, type) {
  const t = document.createElement('div'); t.className = 'toast' + (type === 'err' ? ' err' : ''); t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), type === 'err' ? 6000 : 3000);
}
function modal(title, body, foot = '', wide = false) {
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<div class="modal ${wide ? 'wide' : ''}"><div class="mh"><b>${esc(title)}</b><button class="btn btn-s" data-act="closeModal">✕</button></div><div class="mb">${body}</div>${foot ? `<div class="mf">${foot}</div>` : ''}</div>`;
  document.body.appendChild(ov); const first = ov.querySelector('input,select,textarea'); if (first) first.focus();
  return ov;
}
A.closeModal = (id, el) => { const ov = el.closest('.ov'); if (ov) ov.remove(); };
const closeTop = () => { const o = [...document.querySelectorAll('.ov')].pop(); if (o) o.remove(); };
function fieldHTML(f) {
  const v = f.v ?? '';
  if (f.t === 'checkbox') return `<label class="f ck ${f.cls || ''}"><input type="checkbox" name="${f.k}" ${v ? 'checked' : ''}> ${esc(f.l)}</label>`;
  let inp;
  if (f.t === 'select') inp = `<select name="${f.k}">${(f.o || []).map(o => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`; }).join('')}</select>`;
  else if (f.t === 'textarea') inp = `<textarea name="${f.k}" rows="${f.rows || 3}" placeholder="${esc(f.ph || '')}">${esc(v)}</textarea>`;
  else inp = `<input name="${f.k}" type="${f.t || 'text'}" value="${esc(v)}" placeholder="${esc(f.ph || '')}" ${f.t === 'number' ? 'step="any"' : ''} ${f.req ? 'required' : ''}>`;
  return `<label class="f ${f.cls || ''}"><span>${esc(f.l)}${f.req ? ' *' : ''}</span>${inp}</label>`;
}
function formModal(title, fields, cb, saveText = 'Save', wide = false) {
  const ov = modal(title, `<form class="fg">${fields.map(fieldHTML).join('')}</form>`, `<button class="btn" data-act="closeModal">Cancel</button><button class="btn btn-p" data-act="formOK">${saveText}</button>`, wide);
  ov._fields = fields; ov._cb = cb;
  ov.querySelector('form').addEventListener('submit', e => { e.preventDefault(); A.formOK(null, ov.querySelector('[data-act=formOK]')); });
  return ov;
}
A.formOK = (id, el) => {
  const ov = el.closest('.ov'), form = ov.querySelector('form'), v = {};
  if (!form.reportValidity()) return;
  ov._fields.forEach(f => { const e = form.elements[f.k]; v[f.k] = f.t === 'checkbox' ? e.checked : f.t === 'number' ? num(e.value) : (e.value || '').trim(); });
  const r = ov._cb(v);
  if (typeof r === 'string') return toast(r, 'err');
  ov.remove();
};
function confirmDlg(msg, okText = 'Confirm') {
  return new Promise(res => {
    const ov = modal('Please confirm', `<p>${esc(msg)}</p>`, `<button class="btn" data-act="cfNo">Cancel</button><button class="btn btn-p" data-act="cfYes">${okText}</button>`);
    ov.querySelector('[data-act=cfNo]').dataset.act = 'closeModal';
    ov.addEventListener('click', e => { const a = e.target.closest('[data-act]'); if (!a) return; if (a.dataset.act === 'cfYes') { ov.remove(); res(true); e.stopPropagation(); } else if (a.dataset.act === 'closeModal') res(false); }, true);
  });
}
const tbl = (heads, rows, empty = 'No records found') => rows.length
  ? `<div class="tw"><table><thead><tr>${heads.map(h => `<th ${h.startsWith('>') ? 'class="r"' : ''}>${h.startsWith('!') ? h.slice(1) : esc(h.replace(/^>/, ''))}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : `<div class="empty">${esc(empty)}</div>`;
const hdr = (t, right = '') => `<div class="hdr"><h1>${t}</h1><span class="sp"></span>${right}</div>`;
const sel = (name, opts, val, attrs = '') => `<select ${attrs} data-in="${name}">${opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${v == val ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
const methods = () => S().payMethods.split(',').map(s => s.trim()).filter(Boolean);
function toCSV(rows) { return rows.map(r => r.map(c => { c = c == null ? '' : String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(',')).join('\r\n'); }
function download(name, text, mime = 'text/csv') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + text], { type: mime })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
function parseCSV(t) {
  const rows = []; let row = [], c = '', q = false; t = t.replace(/^\ufeff/, '');
  for (let i = 0; i < t.length; i++) { const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(c); c = ''; }
    else if (ch === '\n') { row.push(c); rows.push(row); row = []; c = ''; } else if (ch !== '\r') c += ch; }
  if (c || row.length) { row.push(c); rows.push(row); } return rows.filter(r => r.some(x => x.trim()));
}
function pickFile(accept, cb) { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => { const f = i.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => cb(r.result, f); r.readAsText(f); }; i.click(); }
function applyTheme() { document.documentElement.style.setProperty('--acc', S().accent); document.documentElement.style.setProperty('--acc2', S().accent); document.body.classList.toggle('dark', !!S().dark); }

/* ---------- accounting ---------- */
function stats(from, to) {
  const inR = d => d >= from && d <= to; let net = 0, gross = 0, disc = 0, tax = 0, cogs = 0, count = 0; const meth = {};
  db.sales.filter(s => s.status === 'done' && inR(s.day)).forEach(s => {
    count++; gross += s.itemsGross; disc += s.lineDisc + s.billDisc; tax += s.tax; net += s.total - s.tax;
    s.items.forEach(i => cogs += i.cost * i.qty); s.pays.forEach(p => meth[p.method] = (meth[p.method] || 0) + p.amount);
  });
  let rNet = 0, rCost = 0, rCount = 0;
  db.returns.filter(r => inR(r.day)).forEach(r => { rCount++; rNet += r.refund - r.tax; r.items.forEach(i => { if (i.restock) rCost += i.cost * i.qty; }); });
  const exp = db.expenses.filter(e => !e.void && inR(e.date)).reduce((a, e) => a + e.amount, 0);
  const netSales = r2(net - rNet), cogsNet = r2(cogs - rCost), gp = r2(netSales - cogsNet);
  return { count, gross: r2(gross), disc: r2(disc), tax: r2(tax), returns: r2(rNet), rCount, netSales, cogs: cogsNet, gp, exp: r2(exp), net: r2(gp - exp), meth };
}
function stockValue() { return r2(db.products.filter(p => p.active !== false).reduce((a, p) => a + stockOf(p) * p.cost, 0)); }
function receipt(s) {
  if (S().invoiceStyle !== 'receipt') return businessInvoiceHTML(s);     // one business invoice design (see pages2.js)
  const w = S().receiptSize, sheet = w === 'A4' || w === 'Letter', autoW = w === 'auto', customW = Math.max(30, Math.min(300, num(S().receiptCustomW || 80)));
  const width = autoW ? '100%' : w === 'A4' ? '190mm' : w === 'Letter' ? '200mm' : w === '58' ? '54mm' : w === 'custom' ? `${Math.max(20, customW - 6)}mm` : '74mm';
  const narrow = w === '58' || (w === 'custom' && customW <= 62), pageSize = sheet ? w : autoW ? 'auto' : `${w === 'custom' ? customW : w}mm auto`;
  const fs = Math.round((sheet ? 13 : narrow ? 9 : 10) * Math.max(60, Math.min(200, num(S().receiptFontPct || 100))) / 10) / 10;
  const feedTop = Math.max(0, num(S().receiptFeedTop || 0)), feedBottom = Math.max(0, num(S().receiptFeedBottom || 0));
  const padding = Math.max(0, num(S().receiptPadding ?? 2)), offsetX = num(S().receiptOffsetX || 0), offsetY = num(S().receiptOffsetY || 0), autoAlign = S().receiptAutoAlign !== false;
  const c = s.customerId ? cust(s.customerId) : null;
  const rows = s.items.map(i => sheet
    ? `<tr><td class="item-name">${esc(i.name)}${i.imei ? `<br><small>IMEI/SN: ${esc(i.imei)}</small>` : ''}</td><td class="num">${i.qty}</td><td class="num">${money(i.price)}</td><td class="num">${money(i.qty * i.price - i.disc)}</td></tr>`
    : `<tr><td class="item-name">${esc(i.name)}${i.imei ? `<br><small>IMEI/SN: ${esc(i.imei)}</small>` : ''}${S().warranty && i.warrantyM ? `<br><small>Warranty: ${i.warrantyM} months</small>` : ''}<br><small>${i.qty} × ${money(i.price)}</small></td><td class="num">${money(i.qty * i.price - i.disc)}</td></tr>`).join('');
  const receiptCss = `@page{size:${pageSize};margin:${padding}mm}.receipt{box-sizing:border-box;width:${width};max-width:100%;overflow:hidden;overflow-wrap:anywhere;line-height:1.25}.receipt *{box-sizing:border-box;max-width:100%}.receipt-head{text-align:center;overflow-wrap:anywhere}.receipt-logo{display:block;width:${sheet ? 90 : 48}px;height:${sheet ? 90 : 48}px;max-width:100%;object-fit:contain;margin:0 auto 4px}.receipt-business{font-size:${fs + 3}px;font-weight:bold;line-height:1.15;overflow-wrap:anywhere}.receipt table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:${fs}px}.receipt th,.receipt td{padding:2px 1px;vertical-align:top;overflow-wrap:anywhere;word-break:normal}.receipt th:first-child,.receipt td:first-child{text-align:left}.receipt th:last-child,.receipt td:last-child{width:39%;text-align:right}.receipt .num{text-align:right;font-variant-numeric:tabular-nums;white-space:normal}.receipt .totline{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px;align-items:start}.receipt .totline>*{min-width:0;overflow-wrap:anywhere}.receipt hr{border:0;border-top:1px solid #888;margin:6px 0}.receipt small{font-size:.85em}`;
  return `<style>${receiptCss}</style><div class="receipt" style="margin:${autoAlign ? '0 auto' : '0'};position:relative;left:${offsetX}mm;top:${offsetY}mm;font-size:${fs}px;padding:${feedTop}mm 0 ${feedBottom}mm">
<div class="receipt-head">${S().logoData ? `<img class="receipt-logo" src="${esc(S().logoData)}" alt="">` : ''}<div class="receipt-business">${esc(S().business)}</div>
<div>${esc(S().address)}</div><div>Tel: ${esc(S().phone)}</div>${S().email ? `<div>${esc(S().email)}</div>` : ''}</div><hr>
<div>Invoice: <b>${esc(s.no)}</b>${s.status === 'void' ? ' <b>(VOID)</b>' : ''}</div><div>Date: ${dt(s.at)}</div><div>Cashier: ${esc(s.user)}</div>${c ? `<div>Customer: ${esc(c.name)} ${esc(c.phone || '')}</div>` : ''}<hr>
<table><thead><tr>${sheet ? '<th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th>' : '<th>Item / Qty × Price</th><th class="num">Total</th>'}</tr></thead><tbody>${rows}</tbody></table><hr>
<div class="totline"><span>Subtotal</span><span class="num">${money(s.itemsGross)}</span></div>
${s.lineDisc + s.billDisc ? `<div class="totline"><span>Discount</span><span class="num">-${money(s.lineDisc + s.billDisc)}</span></div>` : ''}
${(s.chargeLines || (s.tax ? [{name:'Tax', amount:s.tax}] : [])).map(x => `<div class="totline"><span>${esc(x.name)}</span><span class="num">${money(x.amount)}</span></div>`).join('')}
<div class="totline" style="font-weight:bold;font-size:${fs + 3}px"><span>TOTAL</span><span class="num">${money(s.total)}</span></div>
${s.pays.map(p => `<div class="totline"><span>${esc(p.method)}</span><span class="num">${money(p.amount)}</span></div>`).join('')}
${s.change ? `<div class="totline"><span>Change</span><span class="num">${money(s.change)}</span></div>` : ''}
${s.total - s.paid > 0.005 ? `<div class="totline" style="font-weight:bold"><span>Balance due</span><span class="num">${money(s.total - s.paid)}</span></div>` : ''}<hr>
<div class="receipt-head" style="font-size:${fs - 1}px">${esc(S().returnPolicy)}<br>${esc(S().warranty)}<br><b>${esc(S().footer)}</b></div></div>`;
}
