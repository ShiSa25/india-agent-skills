#!/usr/bin/env node
/**
 *   node scripts/aadhaar-storage.mjs --json '{}'
 * Prints the storage limits from Aadhaar Act s.29 and the UIDAI data-vault circular.
 */
import { storageGuidance } from './aadhaar.mjs';
import { parsePayload, runMain, safeDisclaimer, usage } from './cli.mjs';

await runMain(import.meta.url, {
  usageText: 'Usage: node scripts/aadhaar-storage.mjs --json \'{}\'',
  failure,
  async execute(parsed) {
    const payload = parsePayload(parsed.value);
    if (typeof payload === 'string') return storageGuidance();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw usage('JSON must be an object.');
    }
    return storageGuidance({ onDate: typeof payload.onDate === 'string' ? payload.onDate : undefined });
  },
});

function failure(message) {
  return {
    valid: false,
    section29: '',
    dataVault: '',
    virtualId: '',
    errors: [message],
    warnings: [],
    confirm: false,
    disclaimer: safeDisclaimer(),
  };
}
