#!/usr/bin/env node
/**
 * Format-only IFSC check. This file does not call the network.
 *   node scripts/validate-ifsc.mjs --json 'SBIN0001234'
 */
import { parsePayload, runMain, safeDisclaimer, usage } from './cli.mjs';
import { validateIfsc } from './ids.mjs';

await runMain(import.meta.url, {
  usageText: 'Usage: node scripts/validate-ifsc.mjs --json <IFSC>',
  failure,
  async execute(parsed) {
    const input = coerce(parsePayload(parsed.value));
    return validateIfsc(input.value, { onDate: input.onDate });
  },
});

function coerce(value) {
  if (typeof value === 'string') return { value };
  if (value && typeof value === 'object' && typeof value.ifsc === 'string') {
    return { value: value.ifsc, onDate: typeof value.onDate === 'string' ? value.onDate : undefined };
  }
  throw usage('JSON must be an IFSC string or an object with an ifsc string.');
}

function failure(message) {
  return {
    valid: false,
    normalized: '',
    bankCode: '',
    branchCode: '',
    formatValid: false,
    lookedUp: false,
    found: null,
    bank: null,
    branch: null,
    city: null,
    state: null,
    errors: [message],
    warnings: [],
    confirm: false,
    disclaimer: safeDisclaimer(),
  };
}
