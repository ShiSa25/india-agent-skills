/**
 * Fail if a Verhoeff-valid 12-digit number appears outside the synthetic allow-list.
 * Findings are printed masked (last 4 digits only).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verhoeffValid } from '../lib/verhoeff.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const allowFile = join(root, 'tools', 'aadhaar-allowlist.txt');
const allowed = new Set(
  readFileSync(allowFile, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[0-9]{12}$/.test(line)),
);

const skipDir = new Set(['.git', 'node_modules', 'vendor', '_lib', '_rules']);
const textExt = new Set(['.md', '.mjs', '.js', '.json', '.yml', '.yaml', '.txt', '.html']);
const findings = [];

walk(root);
if (findings.length > 0) {
  for (const finding of findings) console.error(finding);
  process.exit(1);
}
console.log(`scan-aadhaar: 0 unmasked numbers outside ${allowed.size} synthetic fixtures`);

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skipDir.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (full === allowFile) continue;
    const dot = entry.name.lastIndexOf('.');
    const ext = dot === -1 ? '' : entry.name.slice(dot);
    if (!textExt.has(ext)) continue;
    if (!statSync(full).isFile()) continue;
    const text = readFileSync(full, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      for (const match of line.matchAll(/(?<!\d)(\d{12})(?!\d)/g)) note(full, index, match[1]);
      for (const match of line.matchAll(/(?<!\d)(\d{4}) (\d{4}) (\d{4})(?!\d)/g)) {
        note(full, index, `${match[1]}${match[2]}${match[3]}`);
      }
    });
  }
}

function note(file, index, digits) {
  if (!verhoeffValid(digits) || allowed.has(digits)) return;
  const masked = `XXXX XXXX ${digits.slice(-4)}`;
  findings.push(`${relative(root, file)}:${index + 1} unmasked Aadhaar-like value ${masked}`);
}
