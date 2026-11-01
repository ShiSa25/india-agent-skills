#!/usr/bin/env node
/** node scripts/to-subunits.mjs --json '{"amount":"299.00","currency":"INR"}' */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { UsageError, explainSubunits, failure, finish, parseJsonArg } from './razorpay.mjs';

const usage = 'Usage: node scripts/to-subunits.mjs --json \'{"amount":"299.00","currency":"INR"}\'';

if (invokedDirectly()) {
  try {
    const input = parseJsonArg(process.argv.slice(2), usage);
    const result = explainSubunits(input);
    finish(result.valid ? 0 : 1, result);
  } catch (error) {
    finish(2, failure('razorpay', error instanceof UsageError ? error.message : error.message));
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
