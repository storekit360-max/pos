'use strict';

// Rebuild a direct-send folder with installers and unpacked applications.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const client = path.join(root, 'client-ready');
const version = require('../package.json').version;
const guide = path.join(root, 'CLIENT-INSTALL.md');
const privateKeyPath = path.join(root, 'desktop-license-private.pem');

if (!fs.existsSync(dist)) throw new Error('No dist/ directory. Build the installers first.');
if (!fs.existsSync(privateKeyPath)) throw new Error('desktop-license-private.pem is required to build a client that accepts superadmin license keys.');
const publicKeyBody = require('crypto').createPublicKey(fs.readFileSync(privateKeyPath)).export({ type: 'spki', format: 'pem' }).toString().replace(/-----[^-]+-----/g, '').replace(/\s/g, '');

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
if (targets.includes('win') && !hasWindows && !fs.existsSync(path.join(dist, 'win-unpacked'))) missing.push('Windows application and setup installer');
if (targets.includes('mac') && ((!hasArmMac && !fs.existsSync(path.join(dist, 'mac-arm64'))) || (!hasIntelMac && !fs.existsSync(path.join(dist, 'mac'))))) missing.push('Apple Silicon and Intel Mac applications');
if (targets.includes('mac-x64') && !hasIntelMac && !fs.existsSync(path.join(dist, 'mac'))) missing.push('Intel Mac application');
if (missing.length) throw new Error(`Cannot prepare ${version} client files: missing ${missing.join(', ')}. The existing client-ready folder was left untouched.`);

fs.mkdirSync(client, { recursive: true });
// Ensure the app source used for these artifacts has the matching issuer key.
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const keyPattern = /(const desktopLicensePublicKey = `-----BEGIN PUBLIC KEY-----\n)[^`]+(\n-----END PUBLIC KEY-----`)/;
if (!keyPattern.test(mainSource)) throw new Error('Could not locate the desktop public key in main.js');
const updatedMain = mainSource.replace(keyPattern, `$1${publicKeyBody}$2`);
fs.writeFileSync(path.join(root, 'main.js'), updatedMain);
// Remove stale installer artifacts only after confirming this release can be staged.
for (const name of fs.readdirSync(client)) {
  const stale = /\.(exe|dmg|zip)$/i.test(name) ||
    ((targets.includes('mac') || targets.includes('mac-x64')) && /^(Apple Silicon|Intel) The Smart POS.*\.app$/.test(name)) ||
    (targets.includes('win') && name === 'Windows Application');
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

// Include unpacked macOS application bundles so the client folder works
// without requiring a zip archive. The package builder creates each bundle in
// dist/mac[-arch]/The Smart POS.app.
if (targets.includes('mac') || targets.includes('mac-x64')) {
  const macBuilds = targets.includes('mac') ? ['mac-arm64', 'mac'] : ['mac'];
  for (const buildDir of macBuilds) {
    const appName = fs.readdirSync(path.join(dist, buildDir)).find(name => name.endsWith('.app'));
    if (!appName) throw new Error(`Missing unpacked macOS app in dist/${buildDir}`);
    const source = path.join(dist, buildDir, appName);
    const destination = path.join(client, `${buildDir === 'mac-arm64' ? 'Apple Silicon' : 'Intel'} ${appName}`);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.cpSync(source, destination, { recursive: true });
    entries.add(path.basename(destination));
  }
}

// Include the unpacked Windows application for direct folder distribution.
if (targets.includes('win') && fs.existsSync(path.join(dist, 'win-unpacked'))) {
  const destination = path.join(client, 'Windows Application');
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(path.join(dist, 'win-unpacked'), destination, { recursive: true });
  entries.add('Windows Application/');
}

// Verify every staged app includes the public key derived from the issuer key.
const expectedKey = publicKeyBody;
for (const appPath of [
  ...fs.readdirSync(client).filter(name => name.endsWith('.app')).map(name => path.join(client, name, 'Contents', 'Resources', 'app.asar')),
  path.join(client, 'Windows Application', 'resources', 'app.asar')
].filter(fs.existsSync)) {
  const asar = fs.readFileSync(appPath).toString('latin1');
  if (!asar.includes(expectedKey)) throw new Error(`Packaged app public key does not match issuer key: ${appPath}`);
}

fs.copyFileSync(guide, path.join(client, 'CLIENT-INSTALL.md'));
fs.writeFileSync(path.join(client, 'BUILD-INFO.txt'), [
  `The Smart POS ${version}`,
  `Prepared: ${new Date().toISOString()}`,
  '',
  'Direct-send applications and installers:',
  ...[...entries].sort().map(name => `- ${name}`),
  '',
  'macOS builds are unsigned and may require Control-click → Open on first launch.'
].join('\n'));
console.log(`Prepared ${targets.join(', ')} installer(s) in ${client}`);
