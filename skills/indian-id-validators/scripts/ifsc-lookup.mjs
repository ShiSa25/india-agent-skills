#!/usr/bin/env node
/**
 * Opt-in IFSC directory lookup. Format check never calls the network.
 *   node scripts/ifsc-lookup.mjs --json 'SBIN0001234'
 *   node scripts/ifsc-lookup.mjs --lookup --json 'SBIN0001234'
 * The only host is https://ifsc.razorpay.com. Tests pass fetchImpl and do not call it.
 */
import { validateIfsc } from './ids.mjs';
import { CONFIRM_SENTENCE } from './_lib/disclaimer.mjs';
import { loadDomain, needsConfirm, ruleById } from './_lib/rules.mjs';
import { parsePayload, runMain, safeDisclaimer, usage } from './cli.mjs';

await runMain(import.meta.url, {
  allowLookup: true,
  usageText: 'Usage: node scripts/ifsc-lookup.mjs --lookup --json <IFSC>',
  failure,
  async execute(parsed) {
    const input = coerce(parsePayload(parsed.value));
    return lookupIfsc(input.ifsc, { lookup: parsed.lookup, onDate: input.onDate });
  },
});

/**
 * @param {string} input
 * @param {{ lookup?: boolean, fetchImpl?: typeof fetch, onDate?: string }} [options]
 */
export async function lookupIfsc(input, options = {}) {
  const format = validateIfsc(input, { onDate: options.onDate });
  if (!options.lookup) return format;
  if (!format.formatValid) return format;

  const date = options.onDate ?? loadDomain('ids').asOf;
  const hostRule = ruleById('ids', 'ids.ifsc.lookupHost', date);
  const host = String(hostRule.value).replace(/\/$/, '');
  const url = `${host}/${format.normalized}`;
  if (url !== `https://ifsc.razorpay.com/${format.normalized}`) {
    return {
      ...format,
      valid: false,
      lookedUp: false,
      errors: ['IFSC lookup host is not https://ifsc.razorpay.com.'],
      confirm: true,
      warnings: [...format.warnings, CONFIRM_SENTENCE],
    };
  }

  const doFetch = options.fetchImpl ?? globalThis.fetch;
  let response;
  try {
    response = await doFetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { accept: 'application/json' },
    });
  } catch {
    return lookupFailed(format, 'IFSC lookup failed before a response arrived.');
  }
  if (response.status === 404) {
    const warnings = [...format.warnings, `IFSC was not found at ${host}. ${CONFIRM_SENTENCE}`];
    return {
      ...format,
      valid: false,
      lookedUp: true,
      found: false,
      errors: ['IFSC was not found in the directory.'],
      warnings,
      confirm: true,
    };
  }
  if (!response.ok) return lookupFailed(format, `IFSC lookup returned HTTP ${response.status}.`);
  let body;
  try {
    body = await response.json();
  } catch {
    return lookupFailed(format, 'IFSC lookup did not return JSON.');
  }
  if (!body || typeof body !== 'object') return lookupFailed(format, 'IFSC lookup did not return JSON.');
  const warnings = format.warnings.slice();
  const confirm = true;
  if (needsConfirm(hostRule)) warnings.push(`Directory lookup is UNVERIFIED. ${CONFIRM_SENTENCE}`);
  return {
    ...format,
    valid: true,
    lookedUp: true,
    found: true,
    bank: textOrNull(body.BANK),
    branch: textOrNull(body.BRANCH),
    city: textOrNull(body.CITY),
    state: textOrNull(body.STATE),
    warnings,
    confirm,
  };
}

function lookupFailed(format, message) {
  const warnings = format.warnings.slice();
  if (!warnings.some((warning) => warning.includes(CONFIRM_SENTENCE))) warnings.push(CONFIRM_SENTENCE);
  return {
    ...format,
    valid: false,
    lookedUp: true,
    found: null,
    errors: [message],
    warnings,
    confirm: true,
  };
}

function textOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function coerce(value) {
  if (typeof value === 'string') return { ifsc: value };
  if (value && typeof value === 'object' && typeof value.ifsc === 'string') {
    return { ifsc: value.ifsc, onDate: typeof value.onDate === 'string' ? value.onDate : undefined };
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
