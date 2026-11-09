'use strict';

// Rebuild a direct-send folder with only Windows and macOS installers.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const client = path.join(root, 'client-ready');
const version = require('../package.json').version;
const privateKeyPath = path.join(root, 'desktop-license-private.pem');

if (!fs.existsSync(dist)) throw new Error('No dist/ directory. Build the installers first.');
if (!fs.existsSync(privateKeyPath)) throw new Error('The desktop signing key is missing. Run `npm run license:setup` once, then build again.');
const publicKeyBody = require('crypto').createPublicKey(fs.readFileSync(privateKeyPath)).export({ type: 'spki', format: 'pem' }).toString().replace(/-----[^-]+-----/g, '').replace(/\s/g, '');

const requested = process.argv[2];
const supported = new Set(['win', 'mac', 'mac-x64']);
if (!supported.has(requested)) throw new Error(`Unknown build platform: ${requested}`);
const targets = [requested];
const entries = new Set();

function requireOne(description, matches) {
  const files = fs.readdirSync(dist).filter(name => name.includes(version) && matches(name));
  if (files.length !== 1) {
    throw new Error(`Expected one ${description} for ${version}; found: ${files.join(', ') || 'none'}`);
  }
  const name = files[0];
  fs.copyFileSync(path.join(dist, name), path.join(client, name));
  entries.add(name);
}

// Preserve the delivery folder until matching installers for this version exist.
const currentFiles = fs.readdirSync(dist).filter(name => name.includes(version));
const hasWindows = currentFiles.some(name => /setup.*\.exe$/i.test(name) && !/arm64/i.test(name));
const hasArmMac = currentFiles.some(name => /\.dmg$/i.test(name) && /arm64/i.test(name));
const hasIntelMac = currentFiles.some(name => /\.dmg$/i.test(name) && !/arm64/i.test(name));
const missing = [];
if (targets.includes('win') && !hasWindows) missing.push('Windows setup .exe');
if (targets.includes('mac') && (!hasArmMac || !hasIntelMac)) missing.push('Apple Silicon and Intel Mac .dmg files');
if (targets.includes('mac-x64') && !hasIntelMac) missing.push('Intel Mac .dmg');
if (missing.length) throw new Error(`Cannot prepare ${version} client files: missing ${missing.join(', ')}. The existing client-ready folder was left untouched.`);

fs.mkdirSync(client, { recursive: true });
// Keep previously staged current-version installers for the other OS, while
// removing archives, old versions, unpacked apps, guides, and build notes.
for (const name of fs.readdirSync(client)) {
  const matchingInstaller = name.includes(version) && (/setup.*\.exe$/i.test(name) || /\.dmg$/i.test(name));
  const stale = (!matchingInstaller && /\.(exe|dmg|zip)$/i.test(name)) || name === 'BUILD-INFO.txt' || name === 'CLIENT-INSTALL.md' ||
    /^(Apple Silicon|Intel) The Smart POS.*\.app$/.test(name) || name === 'Windows Application';
  if (stale) fs.rmSync(path.join(client, name), { recursive: true, force: true });
}

for (const target of targets) {
  if (target === 'win') {
    if (hasWindows) requireOne('Windows setup installer', name => /setup.*\.exe$/i.test(name) && !/arm64/i.test(name));
  } else if (target === 'mac' || target === 'mac-x64') {
    if (target === 'mac-x64') {
      if (hasIntelMac) requireOne('Intel Mac DMG', name => /\.dmg$/i.test(name) && !/arm64/i.test(name));
    } else {
      if (hasArmMac) requireOne('Apple Silicon Mac DMG', name => /\.dmg$/i.test(name) && /arm64/i.test(name));
      if (hasIntelMac) requireOne('Intel Mac DMG', name => /\.dmg$/i.test(name) && !/arm64/i.test(name));
    }
  }
}

// Carry over other already-built installers for this version so the folder can
// collect the Windows EXE and Mac DMGs regardless of build order.
for (const name of currentFiles.filter(name => /setup.*\.exe$/i.test(name) || /\.dmg$/i.test(name))) {
  const destination = path.join(client, name);
  if (!fs.existsSync(destination)) fs.copyFileSync(path.join(dist, name), destination);
}

// No unpacked applications, archives, guides, or build notes go into client-ready.
console.log(`Prepared ${targets.join(', ')} installer(s) in ${client}`);
