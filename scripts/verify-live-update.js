'use strict';

const crypto = require('crypto');

const DEFAULT_MANIFEST = 'https://pos360live.vercel.app/updates/latest.json';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function revisionOf(files) {
  const lines = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(file => `${file.path}:${file.sha256}`)
    .join('\n');
  return sha256(lines).slice(0, 12);
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const manifestUrl = new URL(process.argv[2] || DEFAULT_MANIFEST);
  manifestUrl.searchParams.set('t', String(Date.now()));
  const manifestBytes = await download(manifestUrl);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const ui = manifest && manifest.ui;
  if (!ui || typeof ui.revision !== 'string' || !Array.isArray(ui.files) || typeof ui.minShell !== 'string') {
    throw new Error('Manifest must contain ui.revision, ui.files[], and ui.minShell');
  }

  let failed = false;
  console.log(`Live UI verification: revision ${ui.revision}, minShell ${ui.minShell}`);
  console.log('RESULT  FILE                                      SIZE                 SHA-256');
  for (const file of ui.files) {
    let result = 'FAIL';
    let detail = '';
    try {
      if (!file || typeof file.path !== 'string' || !Number.isInteger(file.size) || typeof file.sha256 !== 'string') {
        throw new Error('invalid manifest file entry');
      }
      const fileUrl = new URL(file.path.replace(/^\/+/, ''), `${manifestUrl.origin}/`);
      fileUrl.searchParams.set('v', ui.revision);
      const bytes = await download(fileUrl);
      const actualHash = sha256(bytes);
      const sizeOk = bytes.length === file.size;
      const hashOk = actualHash === file.sha256;
      result = sizeOk && hashOk ? 'PASS' : 'FAIL';
      detail = `${bytes.length}/${file.size} bytes  ${actualHash}${hashOk ? '' : ` expected ${file.sha256}`}`;
      if (!sizeOk) detail += ' (size mismatch)';
    } catch (error) {
      detail = error.message;
    }
    if (result !== 'PASS') failed = true;
    console.log(`${result.padEnd(6)}  ${file && file.path ? file.path.padEnd(40) : '(invalid path)'.padEnd(40)}  ${detail}`);
  }

  const computedRevision = revisionOf(ui.files);
  const revisionOk = computedRevision === ui.revision;
  console.log(`REVISION ${revisionOk ? 'PASS' : 'FAIL'}  manifest=${ui.revision} computed=${computedRevision}`);
  if (!revisionOk) failed = true;
  console.log(failed ? 'FAIL: one or more live UI checks failed.' : 'PASS: all live UI files and revision verified.');
  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
