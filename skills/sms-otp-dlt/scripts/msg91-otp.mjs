#!/usr/bin/env node
/**
 * Build an MSG91 SendOTP request, or review a snippet. No network.
 *   node scripts/msg91-otp.mjs --json '{"templateId":"tpl","mobile":"919800000000"}'
 *   node scripts/msg91-otp.mjs --json '{"action":"review","code":"..."}'
 * Exit 0 when valid, 1 when invalid, 2 on a usage error.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { disclaimer } from './_lib/disclaimer.mjs';
import { loadDomain } from './_lib/rules.mjs';
import { usage } from './guard.mjs';
import { buildOtpRequest, reviewOtp } from './otp.mjs';

if (invokedDirectly()) {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) finish(2, failure('Usage: node scripts/msg91-otp.mjs --json <object>'));
    else {
      const result = parsed.input.action === 'review' ? reviewOtp(parsed.input) : buildOtpRequest(parsed.input);
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
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw usage('--json value is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw usage('JSON must be an object.');
  return parsed;
}

function failure(message) {
  let text = disclaimer('2026-11-01');
  try {
    text = disclaimer(loadDomain('trai').asOf);
  } catch {
    /* rules copy missing */
  }
  return { valid: false, errors: [message], warnings: [], confirm: false, disclaimer: text };
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
