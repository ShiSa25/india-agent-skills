/**
 * Fetch https links from the docs and rules this pack publishes.
 * 401, 403, and 429 count as reachable. 404, 410, and 5xx fail.
 * A few government hosts time out or present a private CA from CI; those are
 * warnings (SOFT_HOSTS), not failures. Not part of `npm test` (that suite is offline).
 *
 * URLs inside Markdown code spans or fenced code are skipped, so an API
 * endpoint shown as a sample is not fetched. Hosts under `.example` and
 * `example.com` are skipped everywhere. Bare copies of non-browsable
 * endpoints are skipped only when they are on BARE_ENDPOINTS.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['README.md', 'docs', 'skills', 'rules', 'CONTRIBUTING.md', 'DISCLAIMER.md', 'SECURITY.md', 'AGENTS.md', 'CLAUDE.md', 'CODE_OF_CONDUCT.md', '.github'];

// Portals that CI networks often cannot finish a TLS handshake with.
// An HTTP 404 from them still fails. A timeout or unknown CA is a warning.
const SOFT_HOSTS = new Set(['www.cbic.gov.in', 'einvoice1.gst.gov.in', 'docs.ewaybillgst.gov.in']);

// Non-browsable endpoints. A bare URL (JSON rule, prose outside a code span)
// is not fetched. The same URLs inside code spans are already ignored.
const BARE_ENDPOINTS = [
  'https://mcp.razorpay.com/',
  'https://mcp.cashfree.com/',
  'https://control.msg91.com/',
];

export function extractDocUrls(text) {
  const visible = stripFencedCode(text).replace(/`[^`\n]*`/g, '');
  const urls = new Set();
  for (const match of visible.matchAll(/https:\/\/[^\s)\]"'<>]+/g)) {
    const url = cleanUrl(match[0]);
    if (!keepUrl(url)) continue;
    urls.add(url);
  }
  return [...urls];
}

export function cleanUrl(raw) {
  return raw.replace(/[`.,;:)>]+$/, '');
}

export function isExampleHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/\.$/, '');
  return host === 'example.com' || host.endsWith('.example.com') || host === 'example' || host.endsWith('.example');
}

export function isBareEndpoint(url) {
  return BARE_ENDPOINTS.some((prefix) => url === prefix || url.startsWith(prefix));
}

function keepUrl(url) {
  if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(url)) return false;
  if (url.includes('localhost') || url.includes('{')) return false;
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (isExampleHost(host)) return false;
  if (isBareEndpoint(url)) return false;
  return true;
}

function stripFencedCode(text) {
  return text.replace(/```[\s\S]*?```/g, '\n').replace(/~~~[\s\S]*?~~~/g, '\n');
}

function collectFile(full, urls) {
  const stat = statSync(full);
  if (stat.isDirectory()) {
    if (full.endsWith('/vendor') || full.endsWith('/_lib') || full.endsWith('/node_modules')) return;
    for (const name of readdirSync(full)) collectFile(join(full, name), urls);
    return;
  }
  if (!/\.(md|json|yml|yaml|mjs|txt)$/.test(full)) return;
  if (full.endsWith('qrcodegen.mjs')) return;
  for (const url of extractDocUrls(readFileSync(full, 'utf8'))) urls.add(url);
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

async function run() {
  const urls = new Set();
  for (const entry of roots) {
    const full = join(root, entry);
    if (!existsSync(full)) continue;
    collectFile(full, urls);
  }
  const list = [...urls].sort();
  const failures = [];
  const warnings = [];
  let cursor = 0;
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
  await Promise.all(Array.from({ length: 3 }, () => next()));
  for (const warning of warnings) console.warn(warning);
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    process.exit(1);
  }
  console.log(`link-check: ${list.length} urls, ${warnings.length} transport warnings`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await run();
