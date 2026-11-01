/**
 * Every rules/*.json file matches schema 1, every rule has an https source,
 * and no URL in the file is plain http.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAllDomains } from '../lib/rules.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'rules');
const errors = [];

let domains;
try {
  domains = loadAllDomains();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const files = readdirSync(root).filter((name) => name.endsWith('.json')).sort();
if (files.length === 0) errors.push('rules/ has no JSON files');

for (const name of files) {
  const text = readFileSync(join(root, name), 'utf8');
  if (text.includes('http://')) errors.push(`${name} contains an http:// URL`);
  for (const match of text.matchAll(/https?:\/\/[^\s"']+/g)) {
    const url = match[0].replace(/[),.;]+$/, '');
    if (!url.startsWith('https://')) errors.push(`${name} has a non-https URL: ${url}`);
  }
}

for (const domain of domains) {
  if (typeof domain.asOf !== 'string') errors.push(`${domain.domain}: missing asOf`);
  for (const rule of domain.rules) {
    if (!rule.source) errors.push(`${rule.id}: missing source`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log(`check-rules: ${domains.length} files, ${domains.reduce((n, d) => n + d.rules.length, 0)} rules`);
