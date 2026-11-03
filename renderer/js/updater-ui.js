'use strict';
/*
 * UPDATE UI (desktop app only; does nothing in the browser version)
 *
 *  - Checks the live server on start-up, every 3 hours, and whenever the internet comes back.
 *  - LIVE UI UPDATE: small verified download of the changed screens. Applied automatically while
 *    nobody is signed in (login screen), otherwise the owner/manager clicks "Restart now".
 *  - INSTALLER UPDATE: only when a new desktop app version is published. The owner clicks
 *    "Install and restart" in Settings > System update.
 */
(function () {
  const api = window.posApi;
  const DEFAULT_URL = 'https://pos360live.vercel.app/updates/latest.json';
  const CHECK_EVERY_MS = 3 * 60 * 60 * 1000;
  const state = { running: false, ui: null, installer: null, installerError: '', uiReady: false, uiError: '', notes: '', dismissed: false, lastResult: null };

  const manifestUrl = () => { try { return (S().updateManifestUrl || '').trim() || DEFAULT_URL; } catch { return DEFAULT_URL; } };
  const canManage = () => typeof me !== 'undefined' && me && ['owner', 'manager'].includes(me.role);
  const signedIn = () => typeof me !== 'undefined' && !!me;
  const appliedKey = 'posUiApplied';
  const alreadyApplied = rev => { try { return sessionStorage.getItem(appliedKey) === rev; } catch { return false; } };

  // ---- core check -----------------------------------------------------------------------
  async function check() {
    if (!api || !api.checkUpdate) return { ok: false, error: 'Updates are available in the installed desktop app' };
    if (state.running) return { ok: false, error: 'An update check is already running' };
    state.running = true; state.uiError = '';
    try {
      const r = await api.checkUpdate(manifestUrl());
      state.lastResult = r;
      if (!r.ok) return r;
      state.installer = r.available ? r : null;
      state.installerError = r.installerError || '';
      state.ui = r.ui || null;
      state.notes = (r.ui && r.ui.notes) || '';
      if (r.ui && r.ui.ready) state.uiReady = true;
      else if (r.ui && r.ui.available && !alreadyApplied(r.ui.revision) && api.downloadUiUpdate) {
        const d = await api.downloadUiUpdate(manifestUrl());
        if (d.ok) state.uiReady = true; else state.uiError = d.error || 'Download failed';
      }
      return r;
    } catch (e) {
      return { ok: false, error: e.message || 'Unknown error' };
    } finally { state.running = false; }
  }

  async function applyNow() {
    if (!state.uiReady) return;
    try { if (typeof flush === 'function') await flush(); } catch { /* data is saved on every change */ }
    try { if (state.ui && state.ui.revision) sessionStorage.setItem(appliedKey, state.ui.revision); } catch { /* ignore */ }
    state.uiReady = false;
    const r = await api.applyUiUpdate();
    if (!r || !r.ok) toast('Update could not be applied: ' + ((r && r.error) || 'unknown error'), 'err');
  }

  // ---- banner ---------------------------------------------------------------------------
  function renderBanner() {
    let el = document.getElementById('updateBanner');
    const show = signedIn() && !state.dismissed && (state.uiReady || (state.installer && canManage()));
    if (!show) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div'); el.id = 'updateBanner';
      el.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:98;background:#111;color:#fff;padding:12px 14px;border-radius:10px;box-shadow:0 8px 24px #0004;border-left:4px solid var(--acc,#f97316);max-width:400px;display:flex;gap:12px;align-items:center;font-size:14px';
      document.body.appendChild(el);
    }
    const message = state.uiReady
      ? `<b>An update is ready.</b><br><span style="opacity:.8">${canManage() ? 'Restart the screens now, or it installs automatically next time the POS opens.' : 'It installs automatically the next time the POS opens.'}</span>`
      : `<b>New POS version ${esc(state.installer.version)} is available.</b><br><span style="opacity:.8">Open Settings → System update to install it.</span>`;
    const action = state.uiReady
      ? (canManage() ? '<button class="btn btn-p" data-act="applyUiUpdate">Restart now</button>' : '')
      : '<button class="btn btn-p" data-act="openUpdateSettings">Open</button>';
    el.innerHTML = `<div style="flex:1">${message}</div>${action}<a data-act="dismissUpdateBanner" style="cursor:pointer;opacity:.6;font-size:18px;line-height:1" title="Hide">×</a>`;
  }

  // ---- Settings > System update card ----------------------------------------------------
  async function refreshStatus() {
    const box = document.getElementById('updateStatus');
    if (!box) return;
    let info = {};
    try { info = (api && api.updateStatus && await api.updateStatus()) || {}; } catch { /* ignore */ }
    const lines = [];
    if (info.shellVersion) lines.push(`Installed app <b>v${esc(info.shellVersion)}</b> · screens <b>${esc(info.uiRevision || '')}</b> (${info.uiSource === 'live' ? 'updated live' : 'from installer'})`);
    const r = state.lastResult;
    if (r && !r.ok) lines.push(`<span style="color:var(--bad)">Last check failed: ${esc(r.error)}</span>`);
    else if (r) {
      if (state.uiReady) lines.push(`<b>✅ Screen update downloaded and verified.</b>${state.notes ? `<br><span class="mut">${esc(state.notes)}</span>` : ''}`);
      else if (state.uiError) lines.push(`<span style="color:var(--bad)">Screen update failed: ${esc(state.uiError)}</span>`);
      else if (state.ui && state.ui.blocked) lines.push(`New screens are published but need desktop app v${esc(state.ui.minShell)} or newer. Install the app update below first.`);
      if (state.installer) lines.push(`<b>Desktop app v${esc(state.installer.version)} is available.</b>${state.installer.notes ? `<br><span class="mut">${esc(state.installer.notes)}</span>` : ''}`);
      else if (state.installerError) lines.push(`<span class="mut">${esc(state.installerError)} Try again later.</span>`);
      if (!state.uiReady && !state.uiError && !state.installer && !(state.ui && state.ui.blocked)) lines.push('✅ You are up to date.');
    }
    box.innerHTML = lines.join('<br>');
    const apply = document.getElementById('applyUiUpdateBtn');
    if (apply) apply.hidden = !state.uiReady;
    const install = document.querySelector('[data-act="installUpdate"]');
    if (install) install.hidden = !state.installer;
  }

  // ---- actions --------------------------------------------------------------------------
  A.checkUpdate = async () => {
    if (!api) return toast('System updates are available in the installed desktop app', 'err');
    const typed = ($('#updateManifestUrl')?.value || '').trim();
    if (typed && typed !== S().updateManifestUrl) { S().updateManifestUrl = typed; save(); }
    const button = $('[data-act="checkUpdate"]');
    if (button) { button.disabled = true; button.textContent = 'Checking…'; }
    const r = await check();
    if (button) { button.disabled = false; button.textContent = 'Check for updates'; }
    state.dismissed = false;
    await refreshStatus(); renderBanner();
    if (!r.ok) return toast(`Update check failed: ${r.error}`, 'err');
    if (state.uiReady) toast('Update downloaded. Click “Restart to apply update”.');
    else if (state.installer) toast(`Version ${state.installer.version} is available`);
    else if (!state.uiError) toast(`You’re up to date (version ${r.currentVersion})`);
  };
  A.applyUiUpdate = async () => { await applyNow(); };
  A.dismissUpdateBanner = () => { state.dismissed = true; renderBanner(); };
  A.openUpdateSettings = () => { if (typeof nav === 'function') nav('settings'); };
  A.installUpdate = async () => {
    const update = state.installer;
    if (!update || !update.release) return toast('Check for updates first', 'err');
    if (!(await confirmDlg('The POS will close, install the new version, and reopen automatically. Your shop data is not touched. Continue?', 'Install'))) return;
    const button = $('[data-act="installUpdate"]'); if (button) { button.disabled = true; button.textContent = 'Downloading…'; }
    try { if (typeof flush === 'function') await flush(); } catch { /* ignore */ }
    let result;
    try { result = await api.downloadUpdate(manifestUrl(), update.release); }
    catch (e) { result = { ok: false, error: e.message || 'Unknown error' }; }
    if (button) { button.disabled = false; button.textContent = 'Install and restart'; }
    if (!result.ok) return toast(`Update download failed: ${result.error}`, 'err');
    toast('Update downloaded and verified. The POS is now installing and will restart automatically.');
  };

  // ---- schedule -------------------------------------------------------------------------
  async function autoCheck() {
    if (navigator.onLine === false) return;
    await check();
    if (state.uiReady && !signedIn()) return applyNow(); // nobody is mid-sale on the login screen
    renderBanner(); refreshStatus();
  }
  function start() {
    if (!api || !api.checkUpdate) return;
    if (api.uiBootOk) api.uiBootOk(); // tells the app these screens started fine (crash-loop guard)
    setTimeout(autoCheck, 8000);
    setInterval(autoCheck, CHECK_EVERY_MS);
    window.addEventListener('online', () => setTimeout(autoCheck, 3000));
    setInterval(() => { if (state.uiReady && !signedIn()) applyNow(); else renderBanner(); }, 15000);
  }

  window.updateUi = { start, check, refreshStatus };
})();
