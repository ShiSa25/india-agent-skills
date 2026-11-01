/**
 * Cashfree webhook v2025-01-01 signature, replay window, and fulfilment.
 * No network. API calls belong to the Cashfree MCP server.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { disclaimer, CONFIRM_SENTENCE } from './_lib/disclaimer.mjs';
import { parseAmount } from './_lib/money.mjs';
import { loadDomain, needsConfirm, ruleById } from './_lib/rules.mjs';

const FIELD_MAX = 10 * 1024;
const BODY_MAX = 1024 * 1024;
const CONTROLS = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;
const HEX_DIGEST = /^[0-9a-fA-F]{64}$/;
const STANDARD_B64 = /^[A-Za-z0-9+/]{43}=$/;
const TIMESTAMP = /^[0-9]{1,16}$/;

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

export function verifyCashfreeWebhook(input) {
  const domain = loadDomain('cashfree');
  assertObject(input);
  const onDate = input.onDate === undefined ? domain.asOf : readDate(input.onDate);
  const algorithm = ruleById('cashfree', 'cashfree.webhook.algorithm', onDate);
  const toleranceRule = ruleById('cashfree', 'cashfree.webhook.replayToleranceSeconds', onDate);
  const thresholdRule = ruleById('cashfree', 'cashfree.webhook.millisecondThreshold', onDate);
  const raw = readRaw(input.rawBody);
  const timestamp = readExact(input.timestamp, 'timestamp');
  const signature = readField(input.signature, 'signature');
  const secret = readSecret(input.secret);
  const problems = [raw, timestamp, signature, secret].filter((item) => item.error);
  if (problems.length > 0) {
    return pack(domain, [algorithm], {
      valid: false,
      reason: problems[0].error,
      errors: problems.map((item) => item.error),
    });
  }
  if (HEX_DIGEST.test(signature.value) || !STANDARD_B64.test(signature.value)) {
    return pack(domain, [algorithm], {
      valid: false,
      reason: 'expected base64',
      errors: ['expected base64'],
    });
  }
  const payload = signedPayload(timestamp.value, raw.value);
  const expected = createHmac('sha256', secret.value).update(payload).digest();
  const provided = Buffer.from(signature.value, 'base64');
  if (provided.length !== expected.length || !timingSafeEqual(expected, provided)) {
    return pack(domain, [algorithm], {
      valid: false,
      reason: 'tampered',
      errors: ['signature mismatch'],
    });
  }
  const cap = toleranceRule.value;
  if (typeof cap !== 'number' || !Number.isInteger(cap) || cap < 0) {
    throw new UsageError('replay tolerance rule is not a non-negative integer');
  }
  const toleranceSec = input.toleranceSec === undefined ? cap : input.toleranceSec;
  if (typeof toleranceSec !== 'number' || !Number.isInteger(toleranceSec) || toleranceSec < 0) {
    throw new UsageError('toleranceSec must be a non-negative integer');
  }
  if (toleranceSec > cap) {
    throw new UsageError(`toleranceSec cannot exceed ${cap}. Do not copy it from the webhook body.`);
  }
  if (input.nowMs === undefined) throw new UsageError('nowMs is required');
  const now = clockMs(input.nowMs);
  if (!TIMESTAMP.test(timestamp.value)) {
    return pack(domain, [algorithm, toleranceRule, thresholdRule], {
      valid: false,
      reason: 'bad_timestamp',
      errors: ['timestamp must be a decimal integer string'],
    });
  }
  const instant = timestampToMs(timestamp.value, BigInt(thresholdRule.value));
  const toleranceMs = BigInt(toleranceSec) * 1000n;
  const delta = now - instant;
  if (delta > toleranceMs) {
    return pack(domain, [algorithm, toleranceRule, thresholdRule], {
      valid: false,
      reason: 'stale',
      errors: ['timestamp is outside the replay window'],
      timestampUnit: instant === BigInt(timestamp.value) ? 'ms' : 's',
    });
  }
  if (-delta > toleranceMs) {
    return pack(domain, [algorithm, toleranceRule, thresholdRule], {
      valid: false,
      reason: 'future',
      errors: ['timestamp is outside the replay window'],
      timestampUnit: instant === BigInt(timestamp.value) ? 'ms' : 's',
    });
  }
  return pack(domain, [algorithm, toleranceRule, thresholdRule], {
    valid: true,
    reason: 'ok',
    errors: [],
    timestampUnit: instant === BigInt(timestamp.value) ? 'ms' : 's',
    toleranceSec,
  });
}

export function jsonDecimalToken(rawBody, field) {
  const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
  if (typeof text !== 'string') throw new UsageError('rawBody must be a string or a Buffer');
  if (!/^[A-Za-z0-9_]{1,64}$/.test(field)) throw new UsageError('field must be an identifier');
  const needle = `"${field}":`;
  const at = text.indexOf(needle);
  if (at === -1) return null;
  let i = at + needle.length;
  while (text[i] === ' ') i += 1;
  const start = i;
  if (text[i] === '-') i += 1;
  if (!isDigit(text[i])) return null;
  while (isDigit(text[i])) i += 1;
  if (text[i] === '.') {
    i += 1;
    const fraction = i;
    while (isDigit(text[i])) i += 1;
    if (i === fraction) return null;
  }
  if (text[i] === 'e' || text[i] === 'E') return null;
  return text.slice(start, i);
}

export function decideCashfreeEvent(input) {
  const domain = loadDomain('cashfree');
  assertObject(input);
  const onDate = input.onDate === undefined ? domain.asOf : readDate(input.onDate);
  const versions = ruleById('cashfree', 'cashfree.webhook.versions', onDate);
  const headerRule = ruleById('cashfree', 'cashfree.webhook.idempotencyHeader', onDate);
  const fulfilRule = ruleById('cashfree', 'cashfree.fulfil.statuses', onDate);
  const rules = [versions, headerRule, fulfilRule];
  if (input.signatureVerified !== true) {
    return decision(domain, rules, {
      valid: false,
      httpStatus: 400,
      action: 'reject_signature',
      fulfil: false,
      duplicate: false,
      storeKey: false,
      errors: ['verify the signature before deciding the event'],
    });
  }
  const version = readField(input.version, 'version');
  const key = readField(input.idempotencyKey, 'idempotencyKey');
  const status = readField(input.paymentStatus, 'paymentStatus');
  const problems = [version, key, status].filter((item) => item.error);
  if (problems.length > 0) {
    return decision(domain, rules, {
      valid: false,
      httpStatus: 400,
      action: 'reject',
      fulfil: false,
      duplicate: false,
      storeKey: false,
      errors: problems.map((item) => item.error),
    });
  }
  if (!versions.value.includes(version.value)) {
    return decision(domain, rules, {
      valid: false,
      httpStatus: 400,
      action: 'unexpected_version',
      fulfil: false,
      duplicate: false,
      storeKey: false,
      errors: [`x-webhook-version ${version.value} is not a supported signature version`],
    });
  }
  if (key.value.length === 0) {
    return decision(domain, rules, {
      valid: false,
      httpStatus: 400,
      action: 'missing_idempotency_key',
      fulfil: false,
      duplicate: false,
      storeKey: false,
      errors: [`${headerRule.value} is required`],
    });
  }
  const seen = readSeen(input.seenKeys);
  const prior = input.priorStatus === undefined ? 'none' : input.priorStatus;
  if (!['none', 'SUCCESS', 'FAILED', 'PENDING', 'NOT_ATTEMPTED'].includes(prior)) {
    throw new UsageError('priorStatus is not a known payment status');
  }
  if (seen.has(key.value)) {
    return decision(domain, rules, {
      valid: true,
      httpStatus: 200,
      action: 'duplicate',
      fulfil: false,
      duplicate: true,
      storeKey: false,
      priorStatus: prior,
      paymentStatus: status.value,
      idempotencyHeader: headerRule.value,
      errors: [],
      warnings: ['duplicate x-idempotency-key; return 200 and do not repeat the side effect'],
    });
  }
  const success = fulfilRule.value.includes(status.value);
  const already = prior === 'SUCCESS';
  let action = 'record';
  let fulfil = false;
  let valid = true;
  let httpStatus = 200;
  let next = status.value;
  const errors = [];
  const warnings = [];
  if (success && already) {
    action = 'already_fulfilled';
    warnings.push('payment is already SUCCESS; do not ship again');
  } else if (success) {
    const amountCheck = comparePaymentAmount(input);
    if (amountCheck === 'mismatch') {
      action = 'amount_mismatch';
      valid = false;
      next = prior;
      errors.push('paymentAmount does not match expectedAmount. Do not ship.');
    } else {
      action = 'fulfil';
      fulfil = true;
      next = 'SUCCESS';
      if (amountCheck === 'missing') {
        warnings.push('expectedAmount was not passed. Compare payment_amount from the verified raw body with the order amount stored on your server before shipping.');
      }
    }
  } else if (already) {
    action = 'ignore_late';
    next = 'SUCCESS';
    warnings.push('a SUCCESS payment is not undone by a later non-success status');
  } else {
    action = 'record';
    warnings.push('only payment_status SUCCESS is fulfilment');
  }
  return decision(domain, rules, {
    valid,
    httpStatus,
    action,
    fulfil,
    duplicate: false,
    storeKey: true,
    priorStatus: next,
    paymentStatus: status.value,
    idempotencyHeader: headerRule.value,
    errors,
    warnings,
  });
}

function comparePaymentAmount(input) {
  const payment = input.paymentAmount;
  const expected = input.expectedAmount;
  if (payment === undefined && expected === undefined) return 'missing';
  if (payment === undefined || expected === undefined) {
    throw new UsageError('Pass both paymentAmount and expectedAmount, or neither. Use decimal strings.');
  }
  let left;
  let right;
  try {
    left = parseAmount(requireDecimal(payment, 'paymentAmount'));
    right = parseAmount(requireDecimal(expected, 'expectedAmount'));
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(error.message);
  }
  return left === right ? 'match' : 'mismatch';
}

function requireDecimal(value, label) {
  if (typeof value === 'number') throw new UsageError(`${label} must be a decimal string, not a JSON number`);
  if (typeof value !== 'string') throw new UsageError(`${label} must be a decimal string`);
  return value.trim();
}

function signedPayload(timestamp, rawBody) {
  const prefix = Buffer.from(timestamp, 'utf8');
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  return Buffer.concat([prefix, body]);
}

function timestampToMs(timestamp, threshold) {
  const value = BigInt(timestamp);
  if (value > threshold) return value;
  return value * 1000n;
}

function clockMs(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^[0-9]{1,16}$/.test(value)) return BigInt(value);
  throw new UsageError('nowMs must be an integer epoch millisecond value');
}

function isDigit(char) {
  return char !== undefined && char >= '0' && char <= '9';
}

function readExact(value, label) {
  if (typeof value !== 'string') throw new UsageError(`${label} must be a string`);
  if (Buffer.byteLength(value) > FIELD_MAX) return { error: `${label} exceeds 10 KB` };
  if (CONTROLS.test(value)) return { error: `${label} contains a disallowed control character` };
  return { value };
}

function readSecret(value) {
  if (typeof value !== 'string') throw new UsageError('secret must be a string');
  if (Buffer.byteLength(value) > FIELD_MAX) return { error: 'secret exceeds 10 KB' };
  if (CONTROLS.test(value)) return { error: 'secret contains a disallowed control character' };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { error: 'secret is empty' };
  return { value: trimmed };
}

function readField(value, label) {
  if (typeof value !== 'string') throw new UsageError(`${label} must be a string`);
  if (Buffer.byteLength(value) > FIELD_MAX) return { error: `${label} exceeds 10 KB` };
  if (CONTROLS.test(value)) return { error: `${label} contains a disallowed control character` };
  const normalized = value.normalize('NFKC').trim();
  if (CONTROLS.test(normalized)) return { error: `${label} contains a disallowed control character` };
  return { value: normalized };
}

function readRaw(rawBody) {
  if (typeof rawBody === 'string') {
    if (Buffer.byteLength(rawBody) > BODY_MAX) return { error: 'raw body exceeds 1 MB' };
    return { value: rawBody };
  }
  if (Buffer.isBuffer(rawBody)) {
    if (rawBody.length > BODY_MAX) return { error: 'raw body exceeds 1 MB' };
    return { value: rawBody };
  }
  throw new UsageError('rawBody must be a string or a Buffer. Do not pass a parsed object.');
}

function readSeen(value) {
  if (value === undefined) return new Set();
  if (!Array.isArray(value)) throw new UsageError('seenKeys must be an array of strings');
  for (const item of value) {
    if (typeof item !== 'string') throw new UsageError('seenKeys must be an array of strings');
  }
  return new Set(value);
}

function readDate(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) {
    throw new UsageError('onDate must be YYYY-MM-DD');
  }
  return value;
}

function assertObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new UsageError('input must be an object');
}

function pack(domain, rules, fields) {
  const confirm = needsConfirm(rules);
  const warnings = [...(fields.warnings ?? [])];
  if (confirm && !warnings.includes(CONFIRM_SENTENCE)) warnings.push(CONFIRM_SENTENCE);
  return {
    valid: fields.valid,
    reason: fields.reason,
    errors: fields.errors ?? [],
    warnings,
    confirm,
    disclaimer: disclaimer(domain.asOf),
    timestampUnit: fields.timestampUnit ?? null,
    toleranceSec: fields.toleranceSec ?? null,
  };
}

function decision(domain, rules, fields) {
  const confirm = needsConfirm(rules);
  const warnings = [...(fields.warnings ?? [])];
  if (confirm && !warnings.includes(CONFIRM_SENTENCE)) warnings.push(CONFIRM_SENTENCE);
  return {
    valid: fields.valid,
    httpStatus: fields.httpStatus,
    action: fields.action,
    fulfil: fields.fulfil,
    duplicate: fields.duplicate,
    storeKey: fields.storeKey,
    priorStatus: fields.priorStatus ?? 'none',
    paymentStatus: fields.paymentStatus ?? '',
    idempotencyHeader: fields.idempotencyHeader ?? '',
    errors: fields.errors ?? [],
    warnings,
    confirm,
    disclaimer: disclaimer(domain.asOf),
  };
}

export function parseJsonArg(argv, usageText) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) throw new UsageError(usageText);
  const index = argv.indexOf('--json');
  if (index === -1 || argv[index + 1] === undefined) throw new UsageError(usageText);
  const unknown = argv.some((arg, i) => arg.startsWith('--') && i !== index);
  if (unknown || index + 2 < argv.length) throw new UsageError(usageText);
  let parsed;
  try {
    parsed = JSON.parse(argv[index + 1]);
  } catch {
    throw new UsageError('--json value is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UsageError('--json value must be an object');
  }
  return parsed;
}

export function finish(code, payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`, () => {
    process.exit(code);
  });
}

export function failure(message) {
  let asOf = '2026-11-01';
  try {
    asOf = loadDomain('cashfree').asOf;
  } catch {
    asOf = '2026-11-01';
  }
  return {
    valid: false,
    reason: 'usage',
    errors: [message],
    warnings: [],
    confirm: false,
    disclaimer: disclaimer(asOf),
  };
}
