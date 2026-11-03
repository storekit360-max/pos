'use strict';

/*
 * npm run release:stage
 *
 * Writes the INSTALLER section of public/updates/latest.json (version + per-platform URL + SHA-256).
 * (The live-UI section is added separately on every Vercel deploy by scripts/build-ui-manifest.js.)
 *
 * Installers are looked up in dist/ first, then public/updates/.
 *
 * Where the installers are hosted:
 *   A) RECOMMENDED: public HTTPS storage (GitHub Releases, Cloudflare R2, S3...). Vercel limits
 *      file size, and installers are ~80-120 MB.
 *        UPDATE_BASE_URL=https://github.com/<you>/<releases-repo>/releases/download/v1.4.0
 *      Each installer URL becomes <UPDATE_BASE_URL>/<file name>. Upload the files to that location yourself.
 *      Single-file override: UPDATE_URL_WIN32_X64 / UPDATE_URL_DARWIN_ARM64 / UPDATE_URL_DARWIN_X64.
 *   B) Small installers only: leave both unset. Files are copied to public/updates/ and served by Vercel.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const updatesDir = path.join(root, 'public', 'updates');
const pkg = require('../package.json');
const platforms = {};

const isArm = name => /arm64/i.test(name);
const specs = [
  // macOS: prefer .zip. Apps installed before this release can only install a .zip silently.
  ['win32-x64', name => /setup.*\.exe$/i.test(name) && !isArm(name)],
  ['darwin-arm64', name => /\.(zip|dmg)$/i.test(name) && isArm(name)],
  ['darwin-x64', name => /\.(zip|dmg)$/i.test(name) && !isArm(name)]
];
const requiredPlatforms = String(process.env.REQUIRED_UPDATE_PLATFORMS || '').split(',').map(x => x.trim()).filter(Boolean);
const baseUrl = String(process.env.UPDATE_BASE_URL || '').replace(/\/+$/, '');

fs.mkdirSync(updatesDir, { recursive: true });
const locate = matches => {
  const found = new Map();
  for (const dir of [distDir, updatesDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.includes(pkg.version) || !matches(name) || found.has(name)) continue;
      if (fs.statSync(path.join(dir, name)).isFile()) found.set(name, path.join(dir, name));
    }
  }
  return found;
};

for (const [platform, matches] of specs) {
  let files = [...locate(matches)];
  if (platform.startsWith('darwin') && files.some(([name]) => /\.zip$/i.test(name))) files = files.filter(([name]) => /\.zip$/i.test(name));
  if (files.length > 1) throw new Error(`Multiple installers found for ${platform}: ${files.map(([n]) => n).join(', ')}`);
  if (!files.length) continue;
  const [filename, source] = files[0];
  const digest = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  const override = process.env[`UPDATE_URL_${platform.toUpperCase().replace(/-/g, '_')}`];
  let url = override;
  if (!url && baseUrl) url = `${baseUrl}/${encodeURIComponent(filename)}`;
  if (!url) {
    // Served by Vercel itself: the file must live in public/updates/.
    url = filename;
    if (path.dirname(source) !== updatesDir) fs.copyFileSync(source, path.join(updatesDir, filename));
    const mb = fs.statSync(source).size / 1048576;
    if (mb > 90) console.warn(`WARNING: ${filename} is ${mb.toFixed(0)} MB. Vercel may reject files this large. Use UPDATE_BASE_URL with GitHub Releases instead.`);
  }
  platforms[platform] = { url, sha256: digest };
}

const manifest = {
  version: pkg.version,
  notes: process.env.RELEASE_NOTES || 'Bug fixes and improvements.',
  platforms
};
const output = path.join(updatesDir, 'latest.json');
if (!Object.keys(platforms).length) {
  throw new Error(`No ${pkg.version} platform installers found in dist/ or public/updates/. Build the installer(s) first.`);
}
const missingPlatforms = requiredPlatforms.filter(platform => !platforms[platform]);
if (missingPlatforms.length) throw new Error(`Refusing to publish an incomplete release; missing installers for: ${missingPlatforms.join(', ')}`);
const invalidUrls = Object.entries(platforms).filter(([, release]) => !/^https:\/\//i.test(release.url) && /\//.test(release.url));
if (invalidUrls.length) throw new Error(`Installer URLs must be https:// addresses or plain file names: ${invalidUrls.map(([p]) => p).join(', ')}`);
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${output} for ${Object.keys(platforms).join(', ')}`);
for (const [platform, release] of Object.entries(platforms)) console.log(`  ${platform}: ${release.url}`);
if (!baseUrl && !Object.values(platforms).some(r => /^https:/i.test(r.url))) console.log('Installers are referenced by file name and will be served from the Vercel site (public/updates/).');
else console.log('Upload each installer to the URL shown above BEFORE you deploy this manifest.');
