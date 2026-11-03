'use strict';

// Rebuild a clean, direct-send folder containing only current installer files.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const client = path.join(root, 'client-ready');
const version = require('../package.json').version;
const guide = path.join(root, 'CLIENT-INSTALL.md');

if (!fs.existsSync(dist)) throw new Error('No dist/ directory. Build the installers first.');

const requested = process.argv[2] || 'all';
const supported = new Set(['all', 'win', 'mac', 'mac-x64', 'current']);
if (!supported.has(requested)) throw new Error(`Unknown build platform: ${requested}`);
const platform = requested === 'current' ? process.platform : requested;
const targets = requested === 'all' ? ['win', 'mac'] : [platform];
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
if (targets.includes('win') && !hasWindows) missing.push('Windows setup installer');
if (targets.includes('mac') && (!hasArmMac || !hasIntelMac)) missing.push('Apple Silicon and Intel Mac DMGs');
if (targets.includes('mac-x64') && !hasIntelMac) missing.push('Intel Mac DMG');
if (missing.length) throw new Error(`Cannot prepare ${version} client files: missing ${missing.join(', ')}. The existing client-ready folder was left untouched.`);

fs.mkdirSync(client, { recursive: true });
// Remove stale installer artifacts only after confirming this release can be staged.
for (const name of fs.readdirSync(client)) if (/\.(exe|dmg|zip)$/i.test(name)) fs.rmSync(path.join(client, name), { force: true });

for (const target of targets) {
  if (target === 'win') {
    requireOne('Windows setup installer', name => /setup.*\.exe$/i.test(name) && !/arm64/i.test(name));
  } else if (target === 'mac' || target === 'mac-x64') {
    if (target === 'mac-x64') {
      requireOne('Intel Mac DMG', name => /\.dmg$/i.test(name) && !/arm64/i.test(name));
    } else {
      requireOne('Apple Silicon Mac DMG', name => /\.dmg$/i.test(name) && /arm64/i.test(name));
      requireOne('Intel Mac DMG', name => /\.dmg$/i.test(name) && !/arm64/i.test(name));
    }
  }
}

// Keep other already-built current-version installers alongside this target,
// so running the Windows and macOS build commands in either order preserves a
// complete client handoff folder.
const windowsSetup = currentFiles.find(name => /setup.*\.exe$/i.test(name) && !/arm64/i.test(name));
if (windowsSetup && !entries.has(windowsSetup)) {
  fs.copyFileSync(path.join(dist, windowsSetup), path.join(client, windowsSetup));
  entries.add(windowsSetup);
}
for (const dmg of currentFiles.filter(name => /\.dmg$/i.test(name))) {
  if (!entries.has(dmg)) {
    fs.copyFileSync(path.join(dist, dmg), path.join(client, dmg));
    entries.add(dmg);
  }
}

fs.copyFileSync(guide, path.join(client, 'CLIENT-INSTALL.md'));
fs.writeFileSync(path.join(client, 'BUILD-INFO.txt'), [
  `The Smart POS ${version}`,
  `Prepared: ${new Date().toISOString()}`,
  '',
  'Direct-send installer files:',
  ...[...entries].sort().map(name => `- ${name}`),
  '',
  'macOS builds are unsigned and may require Control-click → Open on first launch.'
].join('\n'));
console.log(`Prepared ${targets.join(', ')} installer(s) in ${client}`);
