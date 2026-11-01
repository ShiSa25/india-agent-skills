#!/usr/bin/env node
/**
 *   node scripts/validate-mobile.mjs --json '+91 98765-43210'
 *   node scripts/validate-mobile.mjs --json '{"mobile":"+91 98765-43210"}'
 */
import { parsePayload, runMain, safeDisclaimer, usage } from './cli.mjs';
import { validateMobile } from './ids.mjs';

await runMain(import.meta.url, {
  usageText: 'Usage: node scripts/validate-mobile.mjs --json <mobile>',
  failure,
  async execute(parsed) {
    const input = coerce(parsePayload(parsed.value));
    return validateMobile(input.value, { onDate: input.onDate });
  },
});

function coerce(value) {
  if (typeof value === 'string') return { value };
  if (value && typeof value === 'object' && typeof value.mobile === 'string') {
    return { value: value.mobile, onDate: typeof value.onDate === 'string' ? value.onDate : undefined };
  }
  throw usage('JSON must be a mobile string or an object with a mobile string.');
}

function failure(message) {
  return {
    valid: false,
    normalized: '',
    e164: '',
    errors: [message],
    warnings: [],
    confirm: false,
    disclaimer: safeDisclaimer(),
  };
}
