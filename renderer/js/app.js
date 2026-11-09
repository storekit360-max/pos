'use strict';
/* APP SHELL: boot, first-run setup, login, navigation, global events */
const NAV = [['dashboard', 'Dashboard', '📊', 'mgr'], ['pos', 'Point of Sale', '🛒', 'all'], ['sales', 'Sales & Returns', '🧾', 'all'], ['invoice', 'Invoice', '📄', 'mgr'], ['quotations', 'Quotations', '📝', 'mgr'], ['products', 'Products', '📦', 'mgr'], ['barcodes', 'Barcode Labels', '🏷️', 'mgr'], ['inventory', 'Inventory', '📋', 'mgr'], ['purchases', 'Purchases', '🚚', 'mgr'], ['suppliers', 'Suppliers', '🏭', 'mgr'], ['customers', 'Customers', '👥', 'all'], ['expenses', 'Expenses', '💸', 'mgr'], ['register', 'Cash Register', '💵', 'all'], ['reports', 'Reports', '📈', 'mgr'], ['taxes', 'VAT', '🧮', 'mgr'], ['users', 'Users', '🔐', 'owner'], ['attendance', 'Attendance', '🗓️', 'mgr'], ['settings', 'Settings & Backup', '⚙️', 'owner']];
let current = 'dashboard', failCount = 0, lockUntil = 0;
let licenseInfo = null;
async function readApiResponse(response, fallback) {
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; }
  catch { throw Error(response.ok ? 'The live service returned an invalid response. Please try again.' : `${fallback} (HTTP ${response.status}); the live service returned an unexpected response.`); }
  if (!response.ok) throw Error(body.error || `${fallback} (HTTP ${response.status})`);
  return body;
}
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
  if (LIVE_WEB && licenseInfo?.state === 'expired') {
    const view=$('#view');if(view){view.replaceChildren();const card=document.createElement('section'),title=document.createElement('h2'),message=document.createElement('p'),exportButton=document.createElement('button');card.className='card';title.textContent='Subscription expired — read-only access';message.textContent=licenseInfo.message||'Shop data is available for export. Contact support to renew access.';exportButton.type='button';exportButton.className='btn btn-p';exportButton.textContent='Export my data';exportButton.addEventListener('click',()=>A.exportAll?.());card.append(title,message,exportButton);view.append(card);}return;
  }
  Promise.resolve(P[name]()).catch(e => { console.error(e); $('#view').innerHTML = `<div class="card">Error: ${esc(e.message)}</div>`; });
}
A.nav = id => nav(id);

function shell() {
  applyTheme();
  document.title = 'POS';
  $('#app').innerHTML = `<div class="shell"><aside class="side"><div class="brand"><img ${S().logoData ? `src="${esc(S().logoData)}"` : ''} alt="Business logo"><div><b>${esc(S().business)}</b><small>${esc(S().tagline || '')}</small></div></div>
<nav class="nav">${NAV.filter(allowed).map(n => `<a data-act="nav" data-id="${n[0]}"><span>${n[2]}</span> <span>${n[1]}</span></a>`).join('')}</nav>
<div class="me"><b>${esc(me.name)}</b> (${me.role})<br><button class="btn btn-s" data-act="attendanceSelf" ${attendanceSelfAction() === 'Attendance recorded' ? 'disabled' : ''}>${attendanceSelfAction()}</button><br><a style="cursor:pointer;color:var(--acc)" data-act="logout">Log out</a><br><small style="display:block;margin-top:10px;color:#8b93a3">Developed by ZenStack360</small></div></aside>
<div class="main"><div id="licenseNotice"></div><div id="announcementNotices"></div><div class="top"><button class="btn btn-p" data-act="nav" data-id="pos">🛒 New Sale</button><input id="gs" placeholder="Global search: product, IMEI, invoice… (Ctrl+K)" style="width:340px" data-in="gsearch"><span class="sp"></span><span class="clock" id="clock"></span><button class="btn btn-s" data-act="lock">🔒 Lock</button></div><div class="view" id="view"></div></div></div>`;
  renderLiveNotices();
  const tick = () => { const c = $('#clock'); if (c) c.textContent = new Date().toLocaleString(); }; tick(); setInterval(tick, 30000);
  nav(me.role === 'cashier' ? 'pos' : 'dashboard');
  if (S().customerDisplay && window.posApi) window.posApi.openCustomerDisplay();
  syncBranding();
}

function renderLiveNotices() {
  if (!LIVE_WEB) return;
  const target=$('#licenseNotice');if(target){target.replaceChildren();if(licenseInfo?.state==='grace'||licenseInfo?.state==='expired'){const p=document.createElement('p');p.className='card';p.setAttribute('role',licenseInfo.state==='expired'?'alert':'status');p.textContent=licenseInfo.message|| (licenseInfo.state==='expired'?'Subscription expired. Data is read-only; export it and contact support to renew.':`Subscription grace period: ${licenseInfo.daysLeft||0} days left.`);target.append(p);}}
  const area=$('#announcementNotices');if(!area)return;area.replaceChildren();for(const a of licenseInfo?.announcements||[]){const key=`smartpos-announcement:${a.title}:${a.startsAt}`;if(sessionStorage.getItem(key))continue;const p=document.createElement('p'),text=document.createElement('span'),b=document.createElement('button');p.className='card';p.setAttribute('role','status');text.textContent=`${a.title}: ${a.body} `;b.type='button';b.className='btn btn-s';b.textContent='Dismiss';b.setAttribute('aria-label',`Dismiss announcement ${a.title}`);b.addEventListener('click',()=>{sessionStorage.setItem(key,'1');p.remove();});p.append(text,b);area.append(p);}
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
A.logout = async () => { await flush(); if (LIVE_WEB) { try { await fetch('/api/auth?mode=logout',{method:'POST',credentials:'same-origin'}); } catch (_) {} } me = null; loginScreen(); };
A.lock = A.logout;

function loginScreen() {
  if (LIVE_WEB) return liveAuthScreen('login');
  $('#app').innerHTML = `<div class="login"><div class="card"><img ${S().logoData ? `src="${esc(S().logoData)}"` : ''} alt="Business logo"><h2 style="margin:4px 0">${esc(S().business)}</h2><p class="mut">${esc(S().tagline || '')}</p>${LIVE_WEB && cloudLastError ? `<p class="mut" role="alert">${esc(cloudLastError)}</p>` : ''}<form id="lf"><input id="lu" placeholder="Username" autocomplete="username" autofocus required><input id="lp" type="password" placeholder="Password" autocomplete="current-password" required><button class="btn btn-p btn-lg" type="submit">Sign in to existing account</button></form>${LIVE_WEB ? '<p class="mut" style="margin-top:14px;font-size:13px">Use an existing live POS account. Accounts and shop data are shared across browsers on this deployed site.</p>' : ''}</div></div>`;
  $('#lf').onsubmit = async e => { e.preventDefault();
    if (Date.now() < lockUntil) return toast(`Too many attempts. Wait ${Math.ceil((lockUntil - Date.now()) / 1000)}s`, 'err');
    if (LIVE_WEB) {
      try {
        const r = await fetch('/api/auth?mode=login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({username:$('#lu').value.trim().toLowerCase(),password:$('#lp').value})});
        const result = await readApiResponse(r, 'Sign-in failed'); licenseInfo=result.license||null;
        const cloud = await fetch('/api/data',{credentials:'same-origin'}), response = await readApiResponse(cloud, 'Could not load cloud data');
        cloudRevision = response.revision; cloudBaseData=JSON.parse(JSON.stringify(response.data)); cloudMutationId=''; db = response.data; const df=defaults(); db.settings=Object.assign(df.settings,db.settings); for(const k in df)if(!(k in db))db[k]=df[k]; db.counters=Object.assign(df.counters,db.counters); localStorage.setItem(LS_KEY,JSON.stringify(db));
        me=result.user; log('login',me.username); await flush(); shell(); return;
      } catch (err) { toast(err.message || 'Live sign-in failed','err'); return; }
    }
    const u = db.users.find(x => x.username === $('#lu').value.trim().toLowerCase() && x.active), h = u && await hashPw(u.username, $('#lp').value);
    if (u && h === u.hash) { if (!(await refreshLicense())) return; failCount = 0; me = u; log('login', u.username); save(); shell(); }
    else { if (++failCount >= 5) { lockUntil = Date.now() + 30000; failCount = 0; } toast('Invalid username or password', 'err'); } };
}

function setupScreen() {
  const s = S();
  $('#app').innerHTML = `<div class="login"><div class="card" style="width:520px;text-align:left"><div style="text-align:center"><h2 style="margin:4px 0">Welcome – First-time setup</h2><p class="mut">Create an owner account to get started.</p></div><form id="sf" class="fg">
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

let liveSetupRequired = null, liveRegistrationOpen = false;

async function liveSignIn(username, password) {
  const r = await fetch('/api/auth?mode=login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({username,password})});
  const result = await readApiResponse(r, 'Sign-in failed');
  const cloud = await fetch('/api/data',{credentials:'same-origin'}), response = await readApiResponse(cloud, 'Could not load cloud data');
  cloudRevision = response.revision; cloudBaseData = JSON.parse(JSON.stringify(response.data)); cloudMutationId = ''; db = response.data;
  const df = defaults(); db.settings = Object.assign(df.settings, db.settings); for (const k in df) if (!(k in db)) db[k] = df[k]; db.counters = Object.assign(df.counters, db.counters);
  localStorage.setItem(LS_KEY, JSON.stringify(db));
  me = result.user; licenseInfo=result.license||null; log('login', me.username); await flush(); shell();
}

function liveAuthScreen(view, opts = {}) {
  const s = S(), isSetup = view === 'setup', isRegister = view === 'register';
  const tab = (id, label) => `<button type="button" role="tab" aria-selected="${view === id}" data-view="${id}" class="btn ${view === id ? 'btn-p' : ''}" style="flex:1">${label}</button>`;
  const alertBox = cloudLastError ? `<p class="mut" role="alert" style="font-size:13px">${esc(cloudLastError)} <a href="#" id="liveRetry">Retry</a></p>` : (licenseInfo?.state === 'suspended' || licenseInfo?.state === 'cancelled' || licenseInfo?.state === 'deleted') ? `<p class="mut" role="alert" style="font-size:13px">${esc(licenseInfo.message || 'This shop account is suspended. Contact support.')}</p>` : '';
  let panel;
  if (!isSetup && !isRegister) {
    panel = `<form id="lf"><input id="lu" placeholder="Username" autocomplete="username" required><input id="lp" type="password" placeholder="Password" autocomplete="current-password" required><button class="btn btn-p btn-lg" type="submit">Sign in</button></form>${liveSetupRequired ? '<p class="mut" style="margin-top:14px;font-size:13px;text-align:center">No account exists yet. <a href="#" data-view="setup">Create the owner account</a></p>' : liveRegistrationOpen ? '<p class="mut" style="margin-top:14px;font-size:13px;text-align:center">New to this shop? <a href="#" data-view="register">Create an account</a></p>' : ''}`;
  } else if (isRegister) {
    panel = `<form id="liveRegister" class="fg"><p class="mut full" style="margin:0;font-size:13px;text-align:center">Create your staff account for ${esc(s.business || 'this shop')}.</p><label class="f full"><span>Your name *</span><input name="name" autocomplete="name" required></label><label class="f full"><span>Choose a username *</span><input name="username" autocomplete="username" required minlength="3"></label><label class="f"><span>Password * <small>(at least 10 characters)</small></span><input name="password" type="password" autocomplete="new-password" required minlength="10"></label><label class="f"><span>Repeat password *</span><input name="password2" type="password" autocomplete="new-password" required minlength="10"></label><button class="btn btn-p btn-lg full" type="submit">Create account</button></form>`;
  } else if (liveSetupRequired === false) {
    // If an old link or stale UI state opens setup after initialization, show
    // the normal sign-in choice instead of a dead-end owner setup message.
    liveAuthScreen('login', { animate: true });
    return;
  } else {
    panel = `<form id="liveSetup" class="fg">
<p class="mut full" style="margin:0;font-size:13px;text-align:center">Create the owner account for your shop. You only do this once.</p>
<label class="f full"><span>Shop name *</span><input name="business" value="${esc(s.business)}" required></label>
<label class="f"><span>Your name *</span><input name="name" autocomplete="name" required></label><label class="f"><span>Choose a username *</span><input name="username" autocomplete="username" required minlength="3"></label>
<label class="f"><span>Choose a password * <small>(at least 10 characters)</small></span><input name="password" type="password" autocomplete="new-password" required minlength="10"></label><label class="f"><span>Type the password again *</span><input name="password2" type="password" autocomplete="new-password" required minlength="10"></label>
<details class="full"><summary class="mut" style="cursor:pointer;font-size:13px">More shop details (optional)</summary><div class="fg" style="margin-top:8px">${[['phone', 'Phone', s.phone], ['currency', 'Currency symbol', s.currency], ['address', 'Address', s.address]].map(([k, l, v]) => `<label class="f ${k === 'address' ? 'full' : ''}"><span>${l}</span><input name="${k}" value="${esc(v)}"></label>`).join('')}</div></details>
<button class="btn btn-p btn-lg full" type="submit">Create & start</button></form>`;
  }
  $('#app').innerHTML = `<div class="login"><div class="card" style="width:min(480px,100%)"><div style="text-align:center"><img ${s.logoData ? `src="${esc(s.logoData)}"` : ''} alt="Business logo"><h2 style="margin:4px 0">${esc(s.business)}</h2><p class="mut">${esc(s.tagline || '')}</p></div>${alertBox}<div role="tablist" style="display:flex;gap:6px;margin:12px 0">${tab('login', 'Sign in')}${liveSetupRequired ? tab('setup', 'Create shop') : liveRegistrationOpen ? tab('register', 'Create account') : ''}</div><div id="liveAuthPanel" style="text-align:left">${panel}</div></div></div>`;

  document.querySelectorAll('#app [data-view]').forEach(el => { el.onclick = ev => { ev.preventDefault(); if (el.dataset.view !== view || el.tagName === 'A') liveAuthScreen(el.dataset.view, { animate: true }); }; });
  const retry = $('#liveRetry'); if (retry) retry.onclick = ev => { ev.preventDefault(); location.reload(); };
  if (opts.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) $('#liveAuthPanel').animate?.([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' });

  if (!isSetup && !isRegister) {
    if (opts.username) { $('#lu').value = opts.username; $('#lp').focus(); } else $('#lu').focus();
    $('#lf').onsubmit = async e => { e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      try { await liveSignIn($('#lu').value.trim().toLowerCase(), $('#lp').value); }
      catch (err) { toast(err.message || 'Live sign-in failed', 'err'); btn.disabled = false; }
    };
  } else if (isRegister && $('#liveRegister')) {
    $('#liveRegister').elements.name.focus();
    $('#liveRegister').onsubmit = async e => { e.preventDefault(); const f=e.target.elements,btn=e.target.querySelector('button[type=submit]'); if(f.password.value!==f.password2.value)return toast('Passwords do not match','err'); const un=f.username.value.trim().toLowerCase(); if(!/^[a-z0-9._-]{3,40}$/.test(un))return toast('Username must be 3-40 characters: letters, digits, dot, dash or underscore','err'); btn.disabled=true; try { const r=await fetch('/api/auth?mode=register',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({name:f.name.value.trim(),username:un,password:f.password.value})}); await readApiResponse(r,'Account creation failed'); await liveSignIn(un,f.password.value); } catch(err) { toast(err.message||'Account creation failed','err'); btn.disabled=false; } };
  } else if ($('#liveSetup')) {
    $('#liveSetup').elements.business.focus();
    $('#liveSetup').onsubmit = async e => { e.preventDefault(); const f = e.target.elements, btn = e.target.querySelector('button[type=submit]');
      if (f.password.value !== f.password2.value) return toast('Passwords do not match', 'err');
      const un = f.username.value.trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,40}$/.test(un)) return toast('Username must be 3-40 characters: letters, digits, dot, dash or underscore', 'err');
      const body = { business: f.business.value.trim(), phone: f.phone.value.trim(), address: f.address.value.trim(), currency: f.currency.value.trim(), name: f.name.value.trim(), username: un, password: f.password.value };
      btn.disabled = true;
      try {
        const r = await fetch('/api/auth?mode=setup',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)});
        await readApiResponse(r, 'Setup failed');
        liveSetupRequired = false; toast('Owner account created. Sign in to start.'); liveAuthScreen('login', { animate: true, username: un });
      } catch (err) {
        if (/already complete/i.test(err.message || '')) { liveSetupRequired = false; toast('This shop is already set up. Please sign in.'); liveAuthScreen('login', { animate: true }); return; }
        toast(err.message || 'Setup failed', 'err'); btn.disabled = false;
      }
    };
  }
}

function liveSetupScreen() { liveAuthScreen('setup'); }

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
  if (LIVE_WEB) {
    let status, setup, signed;
    try {
      [status, signed] = await Promise.all([
        fetch('/api/auth?mode=status',{credentials:'same-origin'}),
        fetch('/api/auth',{credentials:'same-origin'})
      ]);
      const responses = await Promise.all([
        readApiResponse(status, 'Could not check live account setup'),
        readApiResponse(signed, 'Could not check sign-in status')
      ]);
      setup = responses[0]; signed = responses[1];
    } catch (err) {
      cloudLastError = `Could not connect to the live account service. ${err.message || ''}`.trim();
      db = defaults(); loginScreen(); window.updateUi?.start(); return;
    }
    liveSetupRequired = !!setup.setupRequired; liveRegistrationOpen=!!setup.registrationOpen; licenseInfo=signed.license||setup.license||null;
    if (setup.setupRequired && !signed.authenticated) { liveSetupScreen(); window.updateUi?.start(); return; }
    if (signed.authenticated) {
      const cloud=await fetch('/api/data',{credentials:'same-origin'}), response=await readApiResponse(cloud, 'Could not load cloud data');
      cloudRevision=response.revision; cloudBaseData=JSON.parse(JSON.stringify(response.data)); cloudMutationId=''; db=response.data; const df=defaults(); db.settings=Object.assign(df.settings,db.settings); for(const k in df)if(!(k in db))db[k]=df[k]; db.counters=Object.assign(df.counters,db.counters);
      const cached=JSON.parse(localStorage.getItem(LS_KEY)||'null'),pending=JSON.parse(localStorage.getItem(LS_KEY+':pending')||'null');
      if(pending && pending.revision===cloudRevision && cached){db=cached;cloudMutationId=pending.mutationId||uid();}
      else {localStorage.removeItem(LS_KEY+':pending');localStorage.setItem(LS_KEY,JSON.stringify(db));}
      me=signed.user; licenseInfo=signed.license||null; shell(); if(cloudMutationId)queueCloudSync();
    } else { db = defaults(); loginScreen(); }
    window.updateUi?.start(); return;
  }
  if (!db) { db = defaults(); await flush(); }
  if (window.posApi) { window.posApi.setBackup(cfgForMain()); window.posApi.onBackupError(m => toast('BACKUP FAILED: ' + m, 'err')); }
  applyTheme();
  if (window.posApi) licenseInfo = db.users.length ? await window.posApi.startLicense() : await window.posApi.licenseStatus();
  if (licenseInfo?.initialized && !licenseInfo.active) licenseScreen();
  else if (!db.users.length) setupScreen(); else loginScreen();
  if (window.posApi) setInterval(() => { if (me) refreshLicense(); }, 30000);
  window.updateUi?.start();
  // Confirm the selected screens only after app initialization and initial
  // login/setup/license rendering have completed successfully.
  if (window.posApi?.uiBootOk) await window.posApi.uiBootOk();
})().catch(err => {
  console.error('Application startup failed:', err);
  const root = document.querySelector('#app');
  if (root) root.innerHTML = `<div class="login"><div class="card"><h2>Could not start POS</h2><p class="mut">${esc(err && err.message ? err.message : err)}</p><p>Close the app and start it again. If this keeps happening, share this message with support.</p><button class="btn btn-p" onclick="location.reload()">Retry</button></div></div>`;
});
