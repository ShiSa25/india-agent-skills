#!/usr/bin/env node
/**
 * DPDP checklist and personal-data scan.
 *   node scripts/dpdp-check.mjs --json '{"asOf":"2026-11-01","source":"model User { aadhaarNumber String }"}'
 * Exit 0 when there is no high-severity finding, 1 when there is, 2 on a usage error.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { disclaimer } from './_lib/disclaimer.mjs';
import { loadDomain } from './_lib/rules.mjs';
import { checkDpdp } from './dpdp.mjs';
import { usage } from './guard.mjs';

if (invokedDirectly()) {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) finish(2, failure('Usage: node scripts/dpdp-check.mjs --json <object>'));
    else {
      const result = checkDpdp(parsed.input);
      finish(result.valid ? 0 : 1, result);
    }
  } catch (error) {
    finish(2, failure(error.message));
  }
}

export function parseArgs(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return { help: true };
  const index = argv.indexOf('--json');
  if (index === -1) throw usage('Pass input with --json.');
  const value = argv[index + 1];
  if (value === undefined) throw usage('--json needs a value.');
  const unknown = argv.some((arg, i) => arg.startsWith('--') && i !== index);
  if (unknown || index + 2 < argv.length) throw usage('Unexpected argument.');
  return { input: coerce(value) };
}

function coerce(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('"') || trimmed.startsWith('[')) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw usage('--json value is not valid JSON.');
    }
    if (typeof parsed === 'string') return { source: parsed };
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    throw usage('JSON must be an object or a source string.');
  }
  return { source: value };
}

function failure(message) {
  let text = disclaimer('2026-11-01');
  try {
    text = disclaimer(loadDomain('dpdp').asOf);
  } catch {
    /* rules copy missing */
  }
  return {
    valid: false,
    asOf: '',
    phases: [],
    checklist: [],
    penalties: [],
    facts: null,
    findings: [],
    errors: [message],
    warnings: [],
    confirm: false,
    disclaimer: text,
    markdown: '',
  };
}

function finish(code, payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`, () => {
    process.exit(code);
  });
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}
