#!/usr/bin/env node
/**
 * Validate schema 1.1 e-invoice JSON. Never calls an IRP.
 *   node scripts/validate-einvoice.mjs --json '{"einvoice":{...},"aato":"120000000.00","asOf":"2026-05-02"}'
 * Exit 0 when valid, 1 when invalid, 2 on a usage error.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { disclaimer } from './_lib/disclaimer.mjs';
import { loadDomain } from './_lib/rules.mjs';
import { validateEinvoice } from './einvoice.mjs';

const LIMIT = 10 * 1024;

if (invokedDirectly()) {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) finish(2, failure('Usage: node scripts/validate-einvoice.mjs --json \'<payload>\''));
    else {
      const result = validateEinvoice(parsed.input);
      finish(result.valid ? 0 : 1, result);
    }
  } catch (error) {
    finish(2, failure(error.message));
  }
}

function parseArgs(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return { help: true };
  const index = argv.indexOf('--json');
  if (index === -1) throw new Error('Pass the e-invoice with --json.');
  const value = argv[index + 1];
  if (value === undefined) throw new Error('--json needs a value.');
  if (argv.some((arg, i) => arg.startsWith('--') && i !== index) || index + 2 < argv.length) {
    throw new Error('Unexpected argument.');
  }
  if (Buffer.byteLength(value, 'utf8') > LIMIT) throw new Error('Input exceeds the 10 KB limit.');
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('--json value is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON must be an object.');
  return { input: parsed };
}

function failure(message) {
  return {
    valid: false,
    errors: [{ path: '', msg: message }],
    warnings: [],
    confirm: false,
    applicability: null,
    disclaimer: safeDisclaimer(),
    irpSubmitted: false,
  };
}

function safeDisclaimer() {
  try {
    return disclaimer(loadDomain('gst').asOf);
  } catch {
    return disclaimer('2026-11-01');
  }
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
