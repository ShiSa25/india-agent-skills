#!/usr/bin/env node
/** node scripts/verify-webhook.mjs --json '{"rawBody","timestamp","signature","secret","nowMs"}' */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { UsageError, failure, finish, parseJsonArg, verifyCashfreeWebhook } from './cashfree.mjs';

const usage = 'Usage: node scripts/verify-webhook.mjs --json \'{"rawBody":"...","timestamp":"...","signature":"...","secret":"...","nowMs":0}\'';

if (invokedDirectly()) {
  try {
    const input = parseJsonArg(process.argv.slice(2), usage);
    const result = verifyCashfreeWebhook(input);
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
