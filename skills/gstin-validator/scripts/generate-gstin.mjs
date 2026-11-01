#!/usr/bin/env node
/**
 * Mint a checksum-valid synthetic GSTIN and validate it.
 *   node scripts/generate-gstin.mjs --json '{"stateCode":"29"}'
 *   node scripts/generate-gstin.mjs --json '{"stateCode":"27","type":"tds","tan":"AAAA00000A"}'
 * Exit 0 when the result is valid, 1 when it is not, 2 on a usage error.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { disclaimer } from './_lib/disclaimer.mjs';
import { generateSyntheticGstin, validateGstin } from './_lib/gstin.mjs';
import { loadDomain } from './_lib/rules.mjs';

if (invokedDirectly()) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) finish(2, failure('Usage: node scripts/generate-gstin.mjs --json \'{"stateCode":"29"}\''));
    else {
      const gstin = generateSyntheticGstin(opts.stateCode, opts);
      const result = validateGstin(gstin);
      finish(result.valid ? 0 : 1, result);
    }
  } catch (error) {
    finish(2, failure(error.message));
  }
}

export function parseArgs(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return { help: true };
  const index = argv.indexOf('--json');
  if (index === -1) throw new Error('Pass options with --json.');
  const value = argv[index + 1];
  if (value === undefined) throw new Error('--json needs a value.');
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('--json value is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.stateCode !== 'string') {
    throw new Error('JSON needs a stateCode string.');
  }
  return parsed;
}

function failure(message) {
  let text = 'Rules are as of 2026-11-01.';
  try {
    const gst = loadDomain('gst');
    const ids = loadDomain('ids');
    text = disclaimer(gst.asOf <= ids.asOf ? gst.asOf : ids.asOf);
  } catch {
    text = disclaimer('2026-11-01');
  }
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
    disclaimer: text,
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
