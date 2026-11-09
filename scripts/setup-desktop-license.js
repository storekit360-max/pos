'use strict';

// Create the signing pair once on a trusted release machine. Keep the private
// key out of Git and use it only for server configuration and local builds.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const privatePath = path.join(root, 'desktop-license-private.pem');
const publicPath = path.join(root, 'desktop-license-public.pem');

if (fs.existsSync(privatePath)) {
  const derived = crypto.createPublicKey(fs.readFileSync(privatePath)).export({ type: 'spki', format: 'pem' }).toString();
  if (!fs.existsSync(publicPath) || fs.readFileSync(publicPath, 'utf8') !== derived) fs.writeFileSync(publicPath, derived, { mode: 0o644 });
  console.log('Existing desktop signing key found; matching public key is ready.');
} else {
  execFileSync('openssl', ['genpkey', '-algorithm', 'Ed25519', '-out', privatePath], { stdio: 'inherit' });
  const derived = crypto.createPublicKey(fs.readFileSync(privatePath)).export({ type: 'spki', format: 'pem' }).toString();
  fs.writeFileSync(publicPath, derived, { mode: 0o644 });
  try { fs.chmodSync(privatePath, 0o600); } catch (_) {}
  console.log('Desktop license signing pair created. Keep desktop-license-private.pem secret and back it up.');
}

