#!/usr/bin/env node
/**
 * Validate one GSTIN.
 *   node scripts/validate-gstin.mjs --json '27AAACR5055K1Z7'
 *   node scripts/validate-gstin.mjs --json '{"gstin":"27AAACR5055K1Z7"}'
 * Exit 0 when valid, 1 when invalid, 2 on a usage error. JSON on stdout.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { disclaimer } from './_lib/disclaimer.mjs';
import { validateGstin } from './_lib/gstin.mjs';
import { loadDomain } from './_lib/rules.mjs';

if (invokedDirectly()) {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) finish(2, failure('Usage: node scripts/validate-gstin.mjs --json <GSTIN>'));
    else {
      const result = validateGstin(parsed.input);
      finish(result.valid ? 0 : 1, result);
    }
  } catch (error) {
    finish(2, failure(error.message));
  }
}

export function parseArgs(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return { help: true };
  const index = argv.indexOf('--json');
  if (index === -1) throw usage('Pass the GSTIN with --json.');
  const value = argv[index + 1];
  if (value === undefined) throw usage('--json needs a value.');
  const unknown = argv.some((arg, i) => arg.startsWith('--') && i !== index);
  if (unknown || index + 2 < argv.length) throw usage('Unexpected argument.');
  return { input: coerce(value) };
}

function coerce(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('"')) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw usage('--json value is not valid JSON.');
    }
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object' && typeof parsed.gstin === 'string') return parsed.gstin;
    throw usage('JSON must be a GSTIN string or an object with a gstin string.');
  }
  return value;
}

function failure(message) {
  return {
    valid: false,
    normalized: '',
    type: 'unknown',
    stateCode: '',
    stateName: '',
    pan: null,
    tan: null,
    errors: [message],
    warnings: [],
    confirm: false,
    disclaimer: safeDisclaimer(),
  };
}

function safeDisclaimer() {
  try {
    const gst = loadDomain('gst');
    const ids = loadDomain('ids');
    return disclaimer(gst.asOf <= ids.asOf ? gst.asOf : ids.asOf);
  } catch {
    return disclaimer('2026-11-01');
  }
}

function usage(message) {
  const error = new Error(message);
  error.usage = true;
  return error;
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
