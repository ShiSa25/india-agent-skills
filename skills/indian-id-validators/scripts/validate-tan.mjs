#!/usr/bin/env node
/**
 *   node scripts/validate-tan.mjs --json 'AAAA00000A'
 *   node scripts/validate-tan.mjs --json '{"tan":"AAAA00000A"}'
 */
import { parsePayload, runMain, safeDisclaimer, usage } from './cli.mjs';
import { validateTan } from './ids.mjs';

await runMain(import.meta.url, {
  usageText: 'Usage: node scripts/validate-tan.mjs --json <TAN>',
  failure,
  async execute(parsed) {
    const input = coerce(parsePayload(parsed.value));
    return validateTan(input.value, { onDate: input.onDate });
  },
});

function coerce(value) {
  if (typeof value === 'string') return { value };
  if (value && typeof value === 'object' && typeof value.tan === 'string') {
    return { value: value.tan, onDate: typeof value.onDate === 'string' ? value.onDate : undefined };
  }
  throw usage('JSON must be a TAN string or an object with a tan string.');
}

function failure(message) {
  return {
    valid: false,
    normalized: '',
    jurisdiction: '',
    nameInitial: '',
    serial: '',
    checkDigitChecked: false,
    errors: [message],
    warnings: [],
    confirm: false,
    disclaimer: safeDisclaimer(),
  };
}
