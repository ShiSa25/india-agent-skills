/**
 * Fail if a Verhoeff-valid 12-digit number appears outside the synthetic allow-list.
 * Grouped separators, Unicode digits, and zero-width marks are folded first.
 * Findings are printed masked (last 4 digits only), including in the file path.
 */
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { aadhaarCandidates, redactVerhoeffNumbers, verhoeffValid } from '../lib/verhoeff.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const allowFile = join(root, 'tools', 'aadhaar-allowlist.txt');
const skipDir = new Set(['.git', 'node_modules', 'vendor', '_lib', '_rules']);
const textExt = new Set([
  '.md', '.mjs', '.js', '.cjs', '.json', '.yml', '.yaml', '.txt', '.html', '.ts', '.tsx', '.sql',
  '.prisma', '.log', '.csv', '.py', '.java', '.kt', '.go', '.rb', '.php', '.xml', '.env',
]);

export function loadAllowlist(text) {
  return new Set(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^[0-9]{12}$/.test(line)),
  );
}

/**
 * @param {string} text
 * @param {string} label
 * @param {Set<string>} allowed
 */
export function findingsInText(text, label, allowed) {
  const findings = [];
  const safeLabel = redactVerhoeffNumbers(label);
  const lines = text.split('\n');
  lines.forEach((line, index) => noteCandidates(line, `${safeLabel}:${index + 1}`, allowed, findings));
  noteCandidates(label, `${safeLabel}:path`, allowed, findings);
  return findings;
}

function noteCandidates(text, where, allowed, findings) {
  for (const hit of aadhaarCandidates(text)) {
    if (hit.digits.length !== 12 || (hit.groups !== 1 && hit.groups !== 3)) continue;
    if (!verhoeffValid(hit.digits) || allowed.has(hit.digits)) continue;
    const masked = `XXXX XXXX ${hit.digits.slice(-4)}`;
    findings.push(`${where} unmasked Aadhaar-like value ${masked}`);
  }
}

function isTextFile(name) {
  if (name === '.env' || name.endsWith('.log')) return true;
  const dot = name.lastIndexOf('.');
  const ext = dot === -1 ? '' : name.slice(dot);
  return textExt.has(ext);
}

function main() {
  const allowed = loadAllowlist(readFileSync(allowFile, 'utf8'));
  const findings = [];
  walk(root, allowed, findings);
  if (findings.length > 0) {
    for (const finding of findings) console.error(finding);
    process.exit(1);
  }
  console.log(`scan-aadhaar: 0 unmasked numbers outside ${allowed.size} synthetic fixtures`);
}

function walk(dir, allowed, findings) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skipDir.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, allowed, findings);
      continue;
    }
    if (full === allowFile) continue;
    if (!entry.isFile() || !isTextFile(entry.name)) continue;
    const info = statSync(full);
    if (!info.isFile() || info.size > 2 * 1024 * 1024) continue;
    const text = readFileSync(full, 'utf8');
    if (text.includes('\0')) continue;
    findings.push(...findingsInText(text, relative(root, full), allowed));
  }
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) main();
