'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const privatePath = path.join(root, 'desktop-license-private.pem');
const publicPath = path.join(root, 'desktop-license-public.pem');
const sourcePath = path.join(root, 'main.js');

if (!fs.existsSync(privatePath)) throw new Error('Missing desktop-license-private.pem. Run `npm run license:setup` once.');
const publicPem = crypto.createPublicKey(fs.readFileSync(privatePath)).export({ type: 'spki', format: 'pem' }).toString();
fs.writeFileSync(publicPath, publicPem, { mode: 0o644 });
const body = publicPem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
const source = fs.readFileSync(sourcePath, 'utf8');
const pattern = /(const desktopLicensePublicKey = `-----BEGIN PUBLIC KEY-----\n)[^`]+(\n-----END PUBLIC KEY-----`)/;
if (!pattern.test(source)) throw new Error('Could not find desktopLicensePublicKey in main.js.');
const updated = source.replace(pattern, `$1${body}$2`);
if (updated !== source) fs.writeFileSync(sourcePath, updated);
console.log('Desktop app public key is synchronized with the local signing key.');
