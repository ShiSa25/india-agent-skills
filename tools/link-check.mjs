/**
 * Fetch https links from the docs and rules this pack publishes.
 * Exit 1 only for HTTP 404 and 410. Transport errors (TLS, DNS, connect,
 * abort timeout), 5xx, 429, 403, and any other non-success status are
 * printed as WARN and do not fail the process. Not part of `npm test`
 * (that suite is offline).
 *
 * URLs inside Markdown code spans or fenced code are skipped, so an API
 * endpoint shown as a sample is not fetched. Hosts under `.example` and
 * `example.com` are skipped everywhere. Bare copies of non-browsable
 * endpoints are skipped only when they are on BARE_ENDPOINTS.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['README.md', 'docs', 'skills', 'rules', 'CONTRIBUTING.md', 'DISCLAIMER.md', 'SECURITY.md', 'AGENTS.md', 'CLAUDE.md', 'CODE_OF_CONDUCT.md', '.github'];

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

/** https only, no userinfo, no loopback, link-local, or private address literal. */
export function isSafeProbeUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  return !isBlockedHost(parsed.hostname);
}

export function isBlockedHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }
  const kind = isIP(host);
  if (kind === 4) return isPrivateV4(host);
  if (kind === 6) return isPrivateV6(host);
  return false;
}

/**
 * Classify one probe. `error` set means the fetch threw (TLS, DNS, connect, abort).
 * Only 404 and 410 are fatal.
 * @param {string} url
 * @param {{ status?: number, error?: string }} outcome
 * @returns {{ kind: 'ok' | 'warn' | 'fail', line: string }}
 */
export function classifyLink(url, outcome = {}) {
  if (outcome.error) return { kind: 'warn', line: `WARN ${url} (${outcome.error})` };
  const status = outcome.status;
  if (status === 404 || status === 410) return { kind: 'fail', line: `${status} ${url}` };
  if (typeof status === 'number' && status >= 200 && status < 400) return { kind: 'ok', line: '' };
  return { kind: 'warn', line: `WARN ${status} ${url}` };
}

/** @param {{ kind: string, line: string }[]} results */
export function summarizeLinkResults(results) {
  const failures = [];
  const warnings = [];
  for (const result of results) {
    if (result.kind === 'fail') failures.push(result.line);
    else if (result.kind === 'warn') warnings.push(result.line);
  }
  return { failures, warnings, exitCode: failures.length > 0 ? 1 : 0 };
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
  if (!isSafeProbeUrl(url)) return classifyLink(url, { error: 'blocked-url' });
  let current = url;
  for (let hop = 0; hop < 5; hop += 1) {
    let last = 'fetch failed';
    let response;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        response = await fetch(current, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(20000),
          headers: { 'user-agent': 'india-agent-skills-link-check' },
        });
        last = '';
        break;
      } catch (error) {
        last = error.cause?.code || error.message;
      }
    }
    if (!response) return classifyLink(url, { error: last });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return classifyLink(url, { status: response.status });
      let next;
      try {
        next = new URL(location, current).href;
      } catch {
        return classifyLink(url, { error: 'blocked-redirect' });
      }
      if (!isSafeProbeUrl(next)) return classifyLink(url, { error: 'blocked-redirect' });
      current = next;
      continue;
    }
    return classifyLink(url, { status: response.status });
  }
  return classifyLink(url, { error: 'too many redirects' });
}

function isPrivateV4(host) {
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && parts[2] === 2) return true;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateV6(host) {
  const lower = host.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateV4(mapped[1]) : true;
  }
  return false;
}

async function run() {
  const urls = new Set();
  for (const entry of roots) {
    const full = join(root, entry);
    if (!existsSync(full)) continue;
    collectFile(full, urls);
  }
  const list = [...urls].sort();
  const results = [];
  let cursor = 0;
  async function next() {
    while (cursor < list.length) {
      const url = list[cursor];
      cursor += 1;
      results.push(await probe(url));
    }
  }
  await Promise.all(Array.from({ length: 3 }, () => next()));
  const { failures, warnings, exitCode } = summarizeLinkResults(results);
  for (const warning of warnings) console.warn(warning);
  if (exitCode !== 0) {
    for (const failure of failures) console.error(failure);
    process.exit(exitCode);
  }
  console.log(`link-check: ${list.length} urls, ${warnings.length} warnings`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await run();
