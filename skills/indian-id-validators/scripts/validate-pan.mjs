#!/usr/bin/env node
/**
 *   node scripts/validate-pan.mjs --json 'ABCPE1234F'
 *   node scripts/validate-pan.mjs --json '{"pan":"ABCPE1234F"}'
 */
import { parsePayload, runMain, safeDisclaimer, usage } from './cli.mjs';
import { validatePan } from './ids.mjs';

await runMain(import.meta.url, {
  usageText: 'Usage: node scripts/validate-pan.mjs --json <PAN>',
  failure,
  async execute(parsed) {
    const input = coerce(parsePayload(parsed.value));
    return validatePan(input.value, { onDate: input.onDate });
  },
});

function coerce(value) {
  if (typeof value === 'string') return { value };
  if (value && typeof value === 'object' && typeof value.pan === 'string') {
    return { value: value.pan, onDate: typeof value.onDate === 'string' ? value.onDate : undefined };
  }
  throw usage('JSON must be a PAN string or an object with a pan string.');
}

function failure(message) {
  return {
    valid: false,
    normalized: '',
    holderType: '',
    holderName: '',
    nameInitial: '',
    checkDigitChecked: false,
    errors: [message],
    warnings: [],
    confirm: false,
    disclaimer: safeDisclaimer(),
  };
}
