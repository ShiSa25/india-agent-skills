#!/usr/bin/env node
/**
 *   node scripts/generate-aadhaar.mjs --json '{"seed":"phase-0"}'
 * Prints a synthetic Verhoeff number for fixtures. It is not an issued Aadhaar.
 */
import { generateAadhaar } from './aadhaar.mjs';
import { parsePayload, runMain, safeDisclaimer, usage } from './cli.mjs';

await runMain(import.meta.url, {
  usageText: 'Usage: node scripts/generate-aadhaar.mjs --json \'{"seed":"example"}\'',
  failure,
  async execute(parsed) {
    const input = coerce(parsePayload(parsed.value));
    return generateAadhaar(input.seed);
  },
});

function coerce(value) {
  if (typeof value === 'string') return { seed: value };
  if (value && typeof value === 'object') {
    if (value.seed === undefined) return { seed: 'india-agent-skills' };
    if (typeof value.seed === 'string' || typeof value.seed === 'number') return { seed: value.seed };
  }
  throw usage('JSON must be a seed string or an object with an optional seed.');
}

function failure(message) {
  return {
    valid: false,
    synthetic: false,
    aadhaar: '',
    masked: null,
    kind: '',
    errors: [message],
    warnings: [],
    confirm: false,
    disclaimer: safeDisclaimer(),
  };
}
