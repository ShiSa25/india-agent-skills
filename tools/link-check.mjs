/**
 * Fetch https links from the docs and rules this pack publishes.
 * 401, 403, and 429 count as reachable. 404, 410, and 5xx fail.
 * A few government hosts time out or present a private CA from CI; those are
 * warnings (SOFT_HOSTS), not failures. Not part of `npm test` (that suite is offline).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['README.md', 'docs', 'skills', 'rules', 'CONTRIBUTING.md', 'DISCLAIMER.md', 'SECURITY.md', 'AGENTS.md', 'CLAUDE.md', 'CODE_OF_CONDUCT.md', '.github'];
const urls = new Set();

for (const entry of roots) {
  const full = join(root, entry);
  if (!existsSync(full)) continue;
  collect(full);
}

// Portals that CI networks often cannot finish a TLS handshake with.
// An HTTP 404 from them still fails. A timeout or unknown CA is a warning.
const SOFT_HOSTS = new Set(['www.cbic.gov.in', 'einvoice1.gst.gov.in', 'docs.ewaybillgst.gov.in']);

const list = [...urls].sort();
const failures = [];
const warnings = [];
let cursor = 0;
const workers = Array.from({ length: 3 }, () => next());
await Promise.all(workers);

for (const warning of warnings) console.warn(warning);
if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
console.log(`link-check: ${list.length} urls, ${warnings.length} transport warnings`);

async function next() {
  while (cursor < list.length) {
    const url = list[cursor];
    cursor += 1;
    const result = await probe(url);
    if (result.ok) continue;
    if (result.transport && SOFT_HOSTS.has(new URL(url).host)) warnings.push(result.detail);
    else failures.push(result.detail);
  }
}

async function probe(url) {
  let last = 'fetch failed';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
        headers: { 'user-agent': 'india-agent-skills-link-check' },
      });
      if (response.status === 404 || response.status === 410 || response.status >= 500) {
        return { ok: false, transport: false, detail: `${response.status} ${url}` };
      }
      return { ok: true };
    } catch (error) {
      last = error.cause?.code || error.message;
    }
  }
  return { ok: false, transport: true, detail: `WARN ${url} (${last})` };
}

function collect(full) {
  const stat = statSync(full);
  if (stat.isDirectory()) {
    if (full.endsWith('/vendor') || full.endsWith('/_lib') || full.endsWith('/node_modules')) return;
    for (const name of readdirSync(full)) collect(join(full, name));
    return;
  }
  if (!/\.(md|json|yml|yaml|mjs|txt)$/.test(full)) return;
  if (full.endsWith('qrcodegen.mjs')) return;
  const text = readFileSync(full, 'utf8');
  for (const match of text.matchAll(/https:\/\/[^\s)\]"'<>]+/g)) {
    const url = match[0].replace(/[.,;]+$/, '');
    if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(url)) continue;
    if (!url.includes('localhost') && !url.includes('example.com') && !url.includes('{')) urls.add(url);
  }
}
