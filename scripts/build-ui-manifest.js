'use strict';

/*
 * Runs automatically on every Vercel deploy (see "buildCommand" in vercel.json).
 *
 * It fingerprints every file in renderer/ and writes a "ui" section into
 * public/updates/latest.json. Installed desktop apps compare that fingerprint with the one they
 * are running, download only the files that changed, verify them, and apply them.
 *
 * You never edit the "ui" section by hand. Deploying the site IS publishing the daily update.
 * The installer section ("version" + "platforms") is left exactly as `npm run release:stage` wrote it.
 */
const fs = require('fs');
const path = require('path');
const { hashTree, revisionOf } = require('../updater');

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'renderer');
const manifestFile = path.join(root, 'public', 'updates', 'latest.json');
const pkg = require('../package.json');

let manifest = { version: '0.0.0', notes: '', platforms: {} };
try {
  const existing = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (existing && /^\d+\.\d+\.\d+$/.test(String(existing.version || ''))) manifest = existing;
} catch { /* first deploy: start from an empty installer section */ }

const files = hashTree(rendererDir);
const message = String(process.env.VERCEL_GIT_COMMIT_MESSAGE || '').split('\n')[0].trim();
manifest.ui = {
  revision: revisionOf(files),
  // Oldest desktop app that can run these screens. Raise "uiMinShell" in package.json whenever
  // the screens need a NEW main.js / preload.js feature (a new window.posApi call, for example).
  minShell: pkg.uiMinShell || pkg.version,
  notes: message || 'Improvements and fixes.',
  builtAt: new Date().toISOString(),
  files
};

fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`UI revision ${manifest.ui.revision}: ${files.length} files, requires desktop app >= ${manifest.ui.minShell}`);
