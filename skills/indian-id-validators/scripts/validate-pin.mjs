#!/usr/bin/env node
/**
 *   node scripts/validate-pin.mjs --json '560001'
 *   node scripts/validate-pin.mjs --json '{"pin":"560001","stateCode":"29"}'
 */
import { parsePayload, runMain, safeDisclaimer, usage } from './cli.mjs';
import { validatePin } from './ids.mjs';

await runMain(import.meta.url, {
  usageText: 'Usage: node scripts/validate-pin.mjs --json <PIN>',
  failure,
  async execute(parsed) {
    const input = coerce(parsePayload(parsed.value));
    return validatePin(input.value, { stateCode: input.stateCode, onDate: input.onDate });
  },
});

function coerce(value) {
  if (typeof value === 'string') return { value };
  if (value && typeof value === 'object' && typeof value.pin === 'string') {
    return {
      value: value.pin,
      stateCode: value.stateCode,
      onDate: typeof value.onDate === 'string' ? value.onDate : undefined,
    };
  }
  throw usage('JSON must be a PIN string or an object with a pin string.');
}

function failure(message) {
  return {
    valid: false,
    normalized: '',
    prefix: '',
    zoneDigit: '',
    zone: '',
    states: [],
    stateCode: '',
    stateMatch: 'not-checked',
    errors: [message],
    warnings: [],
    confirm: false,
    disclaimer: safeDisclaimer(),
  };
}
