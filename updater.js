'use strict';
/*
 * LIVE UI UPDATES ("hot updates")
 * --------------------------------
 * The POS screens (renderer/ folder: HTML, CSS, JS) change almost daily, while the
 * Electron shell (main.js, preload.js, Electron itself) changes rarely. This module lets an
 * installed desktop app download ONLY the changed renderer files from the live server,
 * verify every file by SHA-256, and use them on the next load, with no installer, no admin
 * prompt and no antivirus / SmartScreen / Gatekeeper warning.
 *
 * Safety rules:
 *  - Every file is checked against the SHA-256 in the manifest before it is used.
 *  - A new bundle is built in a temp folder and only becomes "pending" when complete.
 *  - A bundle is only valid for the exact desktop-app version it was downloaded for.
 *    Installing a new full installer automatically drops the live bundle.
 *  - If a live bundle fails to load, or the app fails to boot 3 times in a row,
 *    the app silently falls back to the UI bundled inside the installer.
 *
 * This file only uses Node built-ins so scripts/build-ui-manifest.js can share the hashing code.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 300;
const MAX_BOOT_ATTEMPTS = 3;

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

function safeRel(p) {
  if (typeof p !== 'string' || !p || p.length > 200 || p.startsWith('/')) return false;
  return p.split('/').every(s => s && s !== '.' && s !== '..' && /^[A-Za-z0-9._-]+$/.test(s));
}
const absOf = (root, rel) => path.join(root, ...rel.split('/'));

function listFiles(root) {
  const out = [];
  (function walk(dir, rel) {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('.')) continue; // .DS_Store, etc.
      const full = path.join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full, r);
      else if (st.isFile()) out.push(r);
    }
  })(root, '');
  return out.sort();
}
function hashTree(root) {
  return listFiles(root).map(rel => {
    const buf = fs.readFileSync(absOf(root, rel));
    return { path: rel, sha256: sha256(buf), size: buf.length };
  });
}
function revisionOf(files) {
  const lines = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(f => `${f.path}:${f.sha256}`)
    .join('\n');
  return sha256(lines).slice(0, 12);
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function validateUi(ui) {
  if (!ui || typeof ui !== 'object') throw new Error('The manifest has no UI update section');
  if (!/^[A-Za-z0-9._-]{6,64}$/.test(String(ui.revision || ''))) throw new Error('The UI update has an invalid revision');
  if (!Array.isArray(ui.files) || !ui.files.length || ui.files.length > MAX_FILES) throw new Error('The UI update has an invalid file list');
  const minShell = String(ui.minShell || '0.0.0');
  if (!/^\d+\.\d+\.\d+$/.test(minShell)) throw new Error('The UI update has an invalid minimum app version');
  const files = ui.files.map(f => {
    if (!f || !safeRel(f.path) || !/^[a-f0-9]{64}$/i.test(f.sha256 || '') || !Number.isInteger(f.size) || f.size < 0 || f.size > MAX_FILE_BYTES) throw new Error(`The UI update lists an invalid file: ${f && f.path}`);
    return { path: f.path, sha256: f.sha256.toLowerCase(), size: f.size };
  });
  if (!files.some(f => f.path === 'index.html')) throw new Error('The UI update does not include index.html');
  if (/^[a-f0-9]{12}$/.test(ui.revision) && revisionOf(files) !== ui.revision) throw new Error('The UI update revision does not match its files');
  return { revision: String(ui.revision), minShell, notes: String(ui.notes || ''), baseUrl: ui.baseUrl ? String(ui.baseUrl) : '', files };
}

function createUiUpdater({ stateDir, bundledDir, shellVersion, packaged, request, compareVersions }) {
  const activeFile = path.join(stateDir, 'active.json');
  const pendingFile = path.join(stateDir, 'pending.json');
  const historyFile = path.join(stateDir, 'history.json');
  let bundledTree = null;
  let resolved = null;
  let busy = false;

  const bundled = () => bundledTree || (bundledTree = hashTree(bundledDir));
  const bundledRevision = () => revisionOf(bundled());

  // Returns the verified bundle behind an active.json / pending.json record, or null.
  function loadBundle(meta) {
    try {
      if (!meta || meta.shell !== shellVersion || !/^rev-[A-Za-z0-9._-]+$/.test(meta.dir || '')) return null;
      const dir = path.join(stateDir, meta.dir);
      const info = readJson(path.join(dir, 'bundle.json'));
      if (!info || info.revision !== meta.revision || info.shell !== shellVersion || !Array.isArray(info.files)) return null;
      for (const f of info.files) {
        if (!safeRel(f.path)) return null;
        const buf = fs.readFileSync(absOf(dir, f.path));
        if (buf.length !== f.size || sha256(buf) !== f.sha256) return null;
      }
      if (!info.files.some(f => f.path === 'index.html')) return null;
      return { dir, revision: info.revision, notes: String(info.notes || ''), files: info.files };
    } catch { return null; }
  }

  function cleanup() {
    try {
      const keep = new Set([readJson(activeFile)?.dir, readJson(pendingFile)?.dir].filter(Boolean));
      for (const name of fs.readdirSync(stateDir)) {
        if (name.startsWith('rev-') && !keep.has(name)) fs.rmSync(path.join(stateDir, name), { recursive: true, force: true });
      }
    } catch { /* nothing to clean */ }
  }
  function discardActive() {
    try { fs.rmSync(activeFile, { force: true }); } catch { /* ignore */ }
    cleanup();
    resolved = null;
  }
  function promotePending() {
    const pending = readJson(pendingFile);
    if (!pending) return;
    const bundle = loadBundle(pending);
    if (bundle) {
      const activatedAt = Date.now();
      writeJsonAtomic(activeFile, { revision: bundle.revision, dir: pending.dir, shell: shellVersion, activatedAt, attempts: 0, confirmed: false });
    }
    fs.rmSync(pendingFile, { force: true });
    cleanup();
  }

  // Decide which renderer folder the windows load. Called at startup and after "apply".
  function resolveRendererDir() {
    if (resolved) return resolved;
    resolved = { dir: bundledDir, source: 'bundled', revision: null };
    if (!packaged) return resolved;
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      promotePending();
      const active = readJson(activeFile);
      if (active) {
        const bundle = loadBundle(active);
        if (!bundle) { discardActive(); resolved = { dir: bundledDir, source: 'bundled', revision: null }; return resolved; }
        // Crash-loop guard: a live bundle must confirm a successful boot at least once.
        const attempts = (active.attempts || 0) + 1;
        if (!active.confirmed && attempts > MAX_BOOT_ATTEMPTS) { discardActive(); resolved = { dir: bundledDir, source: 'bundled', revision: null }; return resolved; }
        writeJsonAtomic(activeFile, { ...active, attempts });
        resolved = { dir: bundle.dir, source: 'live', revision: bundle.revision };
      }
    } catch (e) {
      console.error('Live UI bundle ignored:', e.message);
      resolved = { dir: bundledDir, source: 'bundled', revision: null };
    }
    return resolved;
  }
  function confirmBoot() {
    const active = readJson(activeFile);
    if (active && resolved && resolved.source === 'live' && active.revision === resolved.revision) {
      if (!active.confirmed) writeJsonAtomic(activeFile, { ...active, confirmed: true, attempts: 0 });
      const bundle = loadBundle(active);
      const history = readJson(historyFile);
      const entries = Array.isArray(history) ? history : [];
      if (bundle && !entries.some(entry => entry.revision === bundle.revision && entry.shell === shellVersion)) {
        entries.unshift({ revision: bundle.revision, shell: shellVersion, activatedAt: active.activatedAt || Date.now(), notes: bundle.notes });
        writeJsonAtomic(historyFile, entries.slice(0, 50));
      }
    }
  }
  function currentRevision() {
    const r = resolveRendererDir();
    return r.source === 'live' ? r.revision : bundledRevision();
  }

  // Compare the manifest's UI section with what this app is running.
  function evaluate(ui) {
    if (!packaged) return { supported: false, available: false, reason: 'Live UI updates apply to the installed app only' };
    if (!ui) return { supported: false, available: false };
    const v = validateUi(ui);
    const current = currentRevision();
    const blocked = compareVersions(v.minShell, shellVersion) > 0;
    const pending = readJson(pendingFile);
    const ready = !!(pending && pending.revision === v.revision && loadBundle(pending));
    return {
      supported: true, revision: v.revision, current, minShell: v.minShell, notes: v.notes,
      blocked, ready: ready && v.revision !== current,
      available: !blocked && !ready && v.revision !== current
    };
  }

  async function fetchFile(url) {
    return request(url, {
      timeout: 30000,
      onResponse: (res, resolve, reject) => {
        const chunks = []; let total = 0;
        res.on('data', c => { total += c.length; if (total > MAX_FILE_BYTES) { res.destroy(new Error('Update file is too large')); return; } chunks.push(c); });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }
    });
  }

  async function download(manifestUrl, uiSection) {
    if (!packaged) throw new Error('Live UI updates apply to the installed app only');
    if (busy) throw new Error('A UI update download is already running');
    busy = true;
    let tmp = '';
    try {
      const v = validateUi(uiSection);
      if (compareVersions(v.minShell, shellVersion) > 0) throw new Error(`This update needs desktop app ${v.minShell} or newer. Install the latest installer first.`);
      const base = v.baseUrl ? new URL(v.baseUrl) : new URL('/', manifestUrl);
      if (base.protocol !== 'https:') throw new Error('UI updates require a secure HTTPS address');
      if (v.revision === currentRevision()) return { revision: v.revision, downloaded: 0, reused: v.files.length, bytes: 0 };

      fs.mkdirSync(stateDir, { recursive: true });
      const dirName = `rev-${v.revision}`;
      const finalDir = path.join(stateDir, dirName);
      tmp = `${finalDir}.tmp-${Date.now()}`;
      fs.rmSync(finalDir, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });

      // Files that did not change are copied from the running bundle instead of downloaded again.
      const reuse = new Map();
      for (const f of bundled()) reuse.set(`${f.path}:${f.sha256}`, absOf(bundledDir, f.path));
      const active = loadBundle(readJson(activeFile));
      if (active) for (const f of active.files) reuse.set(`${f.path}:${f.sha256}`, absOf(active.dir, f.path));

      let downloaded = 0, reused = 0, bytes = 0;
      for (const f of v.files) {
        const dest = absOf(tmp, f.path);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const local = reuse.get(`${f.path}:${f.sha256}`);
        if (local) { fs.writeFileSync(dest, fs.readFileSync(local)); reused++; continue; } // read+write: works for files inside app.asar
        const url = new URL(f.path, base);
        url.searchParams.set('v', v.revision);
        const buf = await fetchFile(url.toString());
        if (buf.length !== f.size || sha256(buf) !== f.sha256) throw new Error(`Downloaded file failed verification: ${f.path}. Try again in a minute.`);
        fs.writeFileSync(dest, buf);
        downloaded++; bytes += buf.length;
      }
      writeJsonAtomic(path.join(tmp, 'bundle.json'), { revision: v.revision, shell: shellVersion, notes: v.notes, files: v.files, createdAt: Date.now() });
      fs.renameSync(tmp, finalDir); tmp = '';
      const meta = { revision: v.revision, dir: dirName, shell: shellVersion };
      if (!loadBundle(meta)) throw new Error('The downloaded UI bundle could not be verified');
      writeJsonAtomic(pendingFile, meta);
      cleanup();
      return { revision: v.revision, downloaded, reused, bytes };
    } finally {
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      busy = false;
    }
  }

  // Validate the pending bundle before the caller requests a full app restart.
  // Promotion happens only in a fresh process during resolveRendererDir().
  function apply() {
    // Do not promote or cache the pending bundle in the process that is about
    // to exit. Startup is the single place that promotes pending -> active.
    // This avoids a relaunch racing the old process's in-memory resolution.
    const pending = readJson(pendingFile);
    const bundle = loadBundle(pending);
    if (!bundle) throw new Error('The downloaded screens could not be verified');
    return { dir: bundle.dir, source: 'live', revision: bundle.revision };
  }

  return { resolveRendererDir, currentRevision, evaluate, download, apply, discardActive, confirmBoot, bundledRevision, history: () => { const entries = readJson(historyFile); return Array.isArray(entries) ? entries : []; }, hasPending: () => !!readJson(pendingFile) };
}

module.exports = { createUiUpdater, hashTree, revisionOf, validateUi, safeRel, sha256 };
