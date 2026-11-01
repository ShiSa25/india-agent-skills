#!/usr/bin/env node
/** node scripts/verify-payment-signature.mjs --json '{"orderId","paymentId","signature","secret"}' */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { UsageError, explainPaymentSignature, failure, finish, parseJsonArg } from './razorpay.mjs';

const usage = 'Usage: node scripts/verify-payment-signature.mjs --json \'{"orderId":"...","paymentId":"...","signature":"...","secret":"..."}\'';

if (invokedDirectly()) {
  try {
    const input = parseJsonArg(process.argv.slice(2), usage);
    const result = explainPaymentSignature(input);
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
