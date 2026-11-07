'use strict';
/* APP SHELL: boot, first-run setup, login, navigation, global events */
const NAV = [['dashboard', 'Dashboard', '📊', 'mgr'], ['pos', 'Point of Sale', '🛒', 'all'], ['sales', 'Sales & Returns', '🧾', 'all'], ['invoice', 'Invoice', '📄', 'mgr'], ['products', 'Products', '📦', 'mgr'], ['barcodes', 'Barcode Labels', '🏷️', 'mgr'], ['inventory', 'Inventory', '📋', 'mgr'], ['purchases', 'Purchases', '🚚', 'mgr'], ['suppliers', 'Suppliers', '🏭', 'mgr'], ['customers', 'Customers', '👥', 'all'], ['expenses', 'Expenses', '💸', 'mgr'], ['register', 'Cash Register', '💵', 'all'], ['reports', 'Reports', '📈', 'mgr'], ['taxes', 'VAT', '🧮', 'mgr'], ['users', 'Users', '🔐', 'owner'], ['attendance', 'Attendance', '🗓️', 'mgr'], ['settings', 'Settings & Backup', '⚙️', 'owner']];
let current = 'dashboard', failCount = 0, lockUntil = 0;
let licenseInfo = null;
function licenseScreen() {
  $('#app').innerHTML = `<div class="login"><div class="card"><img ${S().logoData ? `src="${esc(S().logoData)}"` : ''} alt="Business logo"><h2>License required</h2><p class="mut">${licenseInfo?.type === 'trial' ? 'Your 24-hour trial has ended.' : 'Enter a license key to continue using POS.'}</p><form id="licenseForm"><input id="licenseKey" autocomplete="off" placeholder="License key" required><button class="btn btn-p btn-lg" type="submit">Unlock system</button></form></div></div>`;
  $('#licenseForm').onsubmit = async e => { e.preventDefault(); const r = await window.posApi.activateLicense($('#licenseKey').value); if (!r.ok) return toast(r.error, 'err'); licenseInfo = r.status; if (db.users.length) loginScreen(); else setupScreen(); toast(licenseInfo.type === 'permanent' ? 'System permanently unlocked' : licenseInfo.type === 'monthly' ? 'System unlocked for 30 days' : 'System unlocked for 7 days'); };
}
async function refreshLicense() {
  // License checks are provided by Electron's preload bridge. The Vercel site
  // runs in a regular browser, where that bridge is intentionally unavailable.
  const api = window.posApi;
  if (!api || typeof api.licenseStatus !== 'function') return true;
  licenseInfo = await api.licenseStatus();
  if (licenseInfo?.initialized && !licenseInfo.active) { me = null; licenseScreen(); return false; }
  return true;
}
const allowed = n => n[3] === 'all' || (n[3] === 'mgr' && ['manager', 'owner'].includes(me.role)) || (n[3] === 'owner' && me.role === 'owner');

function nav(name) {
  const n = NAV.find(x => x[0] === name); if (!n || !allowed(n)) name = 'pos';
  current = name; document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', a.dataset.id === name));
  Promise.resolve(P[name]()).catch(e => { console.error(e); $('#view').innerHTML = `<div class="card">Error: ${esc(e.message)}</div>`; });
}
A.nav = id => nav(id);

function shell() {
  applyTheme();
  document.title = 'POS';
  $('#app').innerHTML = `<div class="shell"><aside class="side"><div class="brand"><img ${S().logoData ? `src="${esc(S().logoData)}"` : ''} alt="Business logo"><div><b>${esc(S().business)}</b><small>${esc(S().tagline || '')}</small></div></div>
<nav class="nav">${NAV.filter(allowed).map(n => `<a data-act="nav" data-id="${n[0]}"><span>${n[2]}</span> <span>${n[1]}</span></a>`).join('')}</nav>
<div class="me"><b>${esc(me.name)}</b> (${me.role})<br><button class="btn btn-s" data-act="attendanceSelf" ${attendanceSelfAction() === 'Attendance recorded' ? 'disabled' : ''}>${attendanceSelfAction()}</button><br><a style="cursor:pointer;color:var(--acc)" data-act="logout">Log out</a><br><small style="display:block;margin-top:10px;color:#8b93a3">Developed by ZenStack360</small></div></aside>
<div class="main"><div class="top"><button class="btn btn-p" data-act="nav" data-id="pos">🛒 New Sale</button><input id="gs" placeholder="Global search: product, IMEI, invoice… (Ctrl+K)" style="width:340px" data-in="gsearch"><span class="sp"></span><span class="clock" id="clock"></span><button class="btn btn-s" data-act="lock">🔒 Lock</button></div><div class="view" id="view"></div></div></div>`;
  const tick = () => { const c = $('#clock'); if (c) c.textContent = new Date().toLocaleString(); }; tick(); setInterval(tick, 30000);
  nav(me.role === 'cashier' ? 'pos' : 'dashboard');
  if (S().customerDisplay && window.posApi) window.posApi.openCustomerDisplay();
  syncBranding();
}

function syncBranding() {
  document.title = 'POS';
  const brand = document.querySelector('.brand');
  if (brand) {
    const img = brand.querySelector('img'), name = brand.querySelector('b'), tagline = brand.querySelector('small');
    if (S().logoData) img.src = S().logoData; else img.removeAttribute('src'); name.textContent = S().business || 'POS'; tagline.textContent = S().tagline || '';
  }
  if (S().customerDisplay && window.posApi) window.posApi.updateCustomerDisplay({ business: S().business, description: S().description, tagline: S().tagline, logo: S().logoData, footer: S().footer, accent: S().accent, currency: S().currency });
}
I.gsearch = (v, el) => {
  clearTimeout(I._g); I._g = setTimeout(() => { const q = v.trim().toLowerCase(); if (q.length < 2) return;
    const ps = db.products.filter(p => (p.name + p.sku + p.barcode + p.devs.map(d => d.imei + d.imei2).join()).toLowerCase().includes(q)).slice(0, 6), ss = db.sales.filter(s => s.no.toLowerCase().includes(q) || s.items.some(i => (i.imei || '').includes(q))).slice(0, 5), cs = db.customers.filter(c => (c.name + c.phone).toLowerCase().includes(q)).slice(0, 4);
    document.querySelectorAll('.ov.gs').forEach(o => o.remove());
    const ov = modal('Search: ' + v, `${ps.map(p => `<div class="tot"><span>📦 ${esc(p.name)} <small class="mut">stock ${stockOf(p)}</small></span><button class="btn btn-s" data-act="gsGo" data-id="products|${esc(p.sku)}">Open</button></div>`).join('')}${ss.map(s => `<div class="tot"><span>🧾 ${esc(s.no)} ${money(s.total)}</span><button class="btn btn-s" data-act="viewSale" data-id="${s.id}">View</button></div>`).join('')}${cs.map(c => `<div class="tot"><span>👤 ${esc(c.name)}</span><button class="btn btn-s" data-act="stmtCus" data-id="${c.id}">History</button></div>`).join('')}${ps.length + ss.length + cs.length ? '' : '<div class="empty">No matches</div>'}`);
    ov.classList.add('gs'); el.focus(); }, 300);
};
A.gsGo = id => { const [pg, q] = id.split('|'); pf.q = q; document.querySelectorAll('.ov').forEach(o => o.remove()); nav(pg); };
A.logout = () => { me = null; flush(); loginScreen(); };
A.lock = A.logout;

function loginScreen() {
  $('#app').innerHTML = `<div class="login"><div class="card"><img ${S().logoData ? `src="${esc(S().logoData)}"` : ''} alt="Business logo"><h2 style="margin:4px 0">${esc(S().business)}</h2><p class="mut">${esc(S().tagline || '')}</p><form id="lf"><input id="lu" placeholder="Username" autocomplete="username" autofocus><input id="lp" type="password" placeholder="Password" autocomplete="current-password"><button class="btn btn-p btn-lg" type="submit">Sign in</button></form></div></div>`;
  $('#lf').onsubmit = async e => { e.preventDefault();
    if (Date.now() < lockUntil) return toast(`Too many attempts. Wait ${Math.ceil((lockUntil - Date.now()) / 1000)}s`, 'err');
    const u = db.users.find(x => x.username === $('#lu').value.trim().toLowerCase() && x.active), h = u && await hashPw(u.username, $('#lp').value);
    if (u && h === u.hash) { if (!(await refreshLicense())) return; failCount = 0; me = u; log('login', u.username); save(); shell(); }
    else { if (++failCount >= 5) { lockUntil = Date.now() + 30000; failCount = 0; } toast('Invalid username or password', 'err'); } };
}

function setupScreen() {
  const s = S();
  $('#app').innerHTML = `<div class="login"><div class="card" style="width:520px;text-align:left"><div style="text-align:center"><h2 style="margin:4px 0">Welcome – First-time setup</h2></div><form id="sf" class="fg">
${[['business', 'Business name', s.business], ['phone', 'Phone', s.phone], ['address', 'Address', s.address], ['currency', 'Currency symbol', s.currency]].map(([k, l, v]) => `<label class="f ${k === 'address' ? 'full' : ''}"><span>${l}</span><input name="${k}" value="${esc(v)}"></label>`).join('')}
<label class="f"><span>Owner name *</span><input name="name" required></label><label class="f"><span>Owner username *</span><input name="username" required></label>
<label class="f"><span>Password * (min 8)</span><input name="pw" type="password" required minlength="8"></label><label class="f"><span>Repeat password *</span><input name="pw2" type="password" required></label>
<button class="btn btn-p btn-lg full" type="submit">Create & start</button></form></div></div>`;
  $('#sf').onsubmit = async e => { e.preventDefault(); const f = e.target.elements;
    if (f.pw.value !== f.pw2.value) return toast('Passwords do not match', 'err');
    ['business', 'phone', 'address', 'currency'].forEach(k => s[k] = f[k].value.trim());
    const un = f.username.value.trim().toLowerCase();
    db.users.push({ id: uid(), name: f.name.value.trim(), username: un, role: 'owner', hash: await hashPw(un, f.pw.value), active: true });
    await flush(); if (window.posApi) licenseInfo = await window.posApi.startLicense(); loginScreen(); toast('Setup complete. Your 24-hour trial has started.'); };
}

/* ---- global events ---- */
document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (el && A[el.dataset.act]) { e.preventDefault(); try { A[el.dataset.act](el.dataset.id, el, e); } catch (err) { console.error(err); toast('Error: ' + err.message, 'err'); } } });
document.addEventListener('input', e => { const el = e.target.closest('[data-in]'); if (el && I[el.dataset.in]) { try { I[el.dataset.in](el.type === 'checkbox' ? el.checked : el.value, el); } catch (err) { console.error(err); } } });
document.addEventListener('change', e => { if (e.target.id === 'bkfreq') { const day = $('#bkdaywrap'); if (day) day.style.display = e.target.value === 'weekly' ? '' : 'none'; } });
document.addEventListener('keydown', e => {
  if (e.target.id === 'scan' && e.key === 'Enter') { e.preventDefault(); scanned(e.target.value); e.target.value = ''; return; }
  if (!me) return;
  if (e.key === 'Escape') closeTop();
  if (e.key === 'F9' && current === 'pos') { e.preventDefault(); A.completeSale(); }
  if (e.key === 'F2') { e.preventDefault(); nav('pos'); }
  if (e.key === 'F4' && current === 'pos') { e.preventDefault(); $('#scan')?.focus(); }
  if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#gs')?.focus(); }
});

(async function boot() {
  await loadDB();
  if (!db) { db = defaults(); await flush(); }
  if (window.posApi) { window.posApi.setBackup(cfgForMain()); window.posApi.onBackupError(m => toast('BACKUP FAILED: ' + m, 'err')); }
  applyTheme();
  if (window.posApi) licenseInfo = db.users.length ? await window.posApi.startLicense() : await window.posApi.licenseStatus();
  if (licenseInfo?.initialized && !licenseInfo.active) licenseScreen();
  else if (!db.users.length) setupScreen(); else loginScreen();
  if (window.posApi) setInterval(() => { if (me) refreshLicense(); }, 30000);
  window.updateUi?.start();
})().catch(err => {
  console.error('Application startup failed:', err);
  const root = document.querySelector('#app');
  if (root) root.innerHTML = `<div class="login"><div class="card"><h2>Could not start POS</h2><p class="mut">${esc(err && err.message ? err.message : err)}</p><p>Close the app and start it again. If this keeps happening, share this message with support.</p><button class="btn btn-p" onclick="location.reload()">Retry</button></div></div>`;
});
