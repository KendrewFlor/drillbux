#!/usr/bin/env node
// Verifies every vendored file against vendor/checksums.sha256 and fails on
// any mismatch, missing file, or unlisted file under vendor/.
// Zero dependencies: uses only Node's built-in crypto and fs.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = join(root, 'vendor');
const manifestPath = join(vendorDir, 'checksums.sha256');

const expected = new Map(
  readFileSync(manifestPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^([a-f0-9]{64})\s+\*?(.+)$/.exec(l);
      if (!m) throw new Error(`Malformed checksum line: ${l}`);
      return [m[2], m[1]];
    }),
);

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

let failed = false;
const seen = new Set();
for (const file of walk(vendorDir)) {
  const rel = relative(vendorDir, file).split('\\').join('/');
  if (rel === 'checksums.sha256' || rel === 'VENDOR.md') continue;
  seen.add(rel);
  const want = expected.get(rel);
  if (!want) { console.error(`✗ unlisted vendored file: vendor/${rel}`); failed = true; continue; }
  const got = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (got !== want) { console.error(`✗ checksum mismatch: vendor/${rel}\n    expected ${want}\n    got      ${got}`); failed = true; }
  else console.log(`✓ vendor/${rel}`);
}
for (const rel of expected.keys()) if (!seen.has(rel)) { console.error(`✗ missing vendored file: vendor/${rel}`); failed = true; }

if (failed) { console.error('\nVendor verification FAILED.'); process.exit(1); }
console.log('\nAll vendored files match their pinned SHA-256.');
