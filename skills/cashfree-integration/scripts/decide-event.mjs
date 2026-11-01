#!/usr/bin/env node
/** node scripts/decide-event.mjs --json '{"signatureVerified":true,"version":"2025-01-01","idempotencyKey":"...","paymentStatus":"SUCCESS"}' */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { UsageError, decideCashfreeEvent, failure, finish, parseJsonArg } from './cashfree.mjs';

const usage = 'Usage: node scripts/decide-event.mjs --json \'{"signatureVerified":true,"version":"2025-01-01","idempotencyKey":"...","paymentStatus":"SUCCESS"}\'';

if (invokedDirectly()) {
  try {
    const input = parseJsonArg(process.argv.slice(2), usage);
    const result = decideCashfreeEvent(input);
    finish(result.valid ? 0 : 1, result);
  } catch (error) {
    finish(2, failure(error instanceof UsageError ? error.message : error.message));
  }
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}
