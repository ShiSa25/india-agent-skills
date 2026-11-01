#!/usr/bin/env node
/**
 *   node scripts/mask-aadhaar.mjs --json '2341 2341 2346'
 * Prints XXXX XXXX and the last 4 digits. Never prints the full number.
 */
import { maskAadhaar } from './aadhaar.mjs';
import { parsePayload, runMain, safeDisclaimer, usage } from './cli.mjs';

await runMain(import.meta.url, {
  usageText: 'Usage: node scripts/mask-aadhaar.mjs --json <Aadhaar>',
  failure,
  async execute(parsed) {
    const input = coerce(parsePayload(parsed.value));
    return maskAadhaar(input.value, { onDate: input.onDate });
  },
});

function coerce(value) {
  if (typeof value === 'string') return { value };
  if (value && typeof value === 'object' && typeof value.aadhaar === 'string') {
    return { value: value.aadhaar, onDate: typeof value.onDate === 'string' ? value.onDate : undefined };
  }
  throw usage('JSON must be an Aadhaar string or an object with an aadhaar string.');
}

function failure(message) {
  return {
    valid: false,
    kind: '',
    masked: null,
    length: 0,
    errors: [message],
    warnings: [],
    confirm: false,
    disclaimer: safeDisclaimer(),
  };
}
