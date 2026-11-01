/**
 * Razorpay checkout signature, raw-body webhook signature, subunits, and
 * event decisions. No network. API calls belong to the Razorpay MCP server.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { disclaimer, CONFIRM_SENTENCE } from './_lib/disclaimer.mjs';
import { parseAmount } from './_lib/money.mjs';
import { loadDomain, needsConfirm, ruleById } from './_lib/rules.mjs';

const FIELD_MAX = 10 * 1024;
const BODY_MAX = 1024 * 1024;
const CONTROLS = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;
const HEX_MAC = /^[0-9a-f]{64}$/;
const INTEGER = /^-?[0-9]+$/;

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

export function verifyPaymentSignature(input) {
  return explainPaymentSignature(input).valid;
}

export function verifyWebhook(input) {
  return explainWebhook(input).valid;
}

/**
 * @param {string|bigint} amountStr
 * @param {string} currency
 * @param {{ zeroLastDigit?: boolean, onDate?: string }} [options]
 * @returns {bigint}
 */
export function toSubunits(amountStr, currency, options = {}) {
  const explained = explainSubunits({
    amount: amountStr,
    currency,
    zeroLastDigit: options.zeroLastDigit === true,
    onDate: options.onDate,
  });
  if (!explained.valid) {
    const error = new Error(explained.errors.join('; '));
    error.result = explained;
    throw error;
  }
  return BigInt(explained.subunits);
}

export function explainPaymentSignature(input) {
  const domain = loadDomain('razorpay');
  assertObject(input);
  const orderId = readField(input.orderId, 'orderId');
  const paymentId = readField(input.paymentId, 'paymentId');
  const signature = readField(input.signature, 'signature');
  const secret = readSecret(input.secret);
  const problems = [orderId, paymentId, signature, secret].filter((item) => item.error);
  if (input.clientOrderId !== undefined) {
    const client = readField(input.clientOrderId, 'clientOrderId');
    if (client.error) problems.push(client);
    else if (!orderId.error && client.value !== orderId.value) {
      problems.push({ error: 'orderId must be the id stored on your server. It does not match clientOrderId.' });
    }
  }
  if (!orderId.error && orderId.value.length === 0) problems.push({ error: 'orderId is empty' });
  if (!paymentId.error && paymentId.value.length === 0) problems.push({ error: 'paymentId is empty' });
  if (!orderId.error && orderId.value.includes('|')) problems.push({ error: 'orderId must not contain |' });
  if (!paymentId.error && paymentId.value.includes('|')) problems.push({ error: 'paymentId must not contain |' });
  const algorithm = ruleById('razorpay', 'razorpay.signature.algorithm', domain.asOf);
  if (problems.length > 0) {
    return result(domain, false, [algorithm], {
      errors: problems.map((item) => item.error),
    });
  }
  const payload = `${orderId.value}|${paymentId.value}`;
  const valid = hexMacEqual(payload, signature.value, secret.value);
  return result(domain, valid, [algorithm], {
    errors: valid ? [] : ['signature mismatch'],
  });
}

export function explainWebhook(input) {
  const domain = loadDomain('razorpay');
  assertObject(input);
  const raw = readRaw(input.rawBody);
  const signature = readField(input.signature, 'signature');
  const secret = readSecret(input.secret);
  const algorithm = ruleById('razorpay', 'razorpay.signature.algorithm', domain.asOf);
  const problems = [raw, signature, secret].filter((item) => item.error);
  if (problems.length > 0) {
    return result(domain, false, [algorithm], { errors: problems.map((item) => item.error) });
  }
  const valid = hexMacEqual(raw.value, signature.value, secret.value);
  return result(domain, valid, [algorithm], {
    errors: valid ? [] : ['signature mismatch'],
  });
}

export function explainSubunits(input) {
  const domain = loadDomain('razorpay');
  assertObject(input);
  const onDate = input.onDate === undefined ? domain.asOf : readDate(input.onDate);
  const exponents = ruleById('razorpay', 'razorpay.currency.exponents', onDate);
  const trailing = ruleById('razorpay', 'razorpay.currency.trailingZero', onDate);
  const minima = ruleById('razorpay', 'razorpay.amount.minimumSubunits', onDate);
  const checkoutMinima = ruleById('razorpay', 'razorpay.amount.checkoutMinimumSubunits', onDate);
  const rules = [exponents, trailing, minima, checkoutMinima];
  const code = readField(input.currency, 'currency');
  if (code.error) return result(domain, false, rules, { errors: [code.error], subunits: null, subunitsText: null });
  const currency = code.value.toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return result(domain, false, rules, {
      errors: ['currency must be a 3-letter ISO code'],
      subunits: null,
      subunitsText: null,
    });
  }
  const exponent = exponentOf(exponents.value, currency);
  if (exponent === null) {
    return result(domain, false, rules, {
      errors: [`${currency} is not in the Razorpay currency table`],
      subunits: null,
      subunitsText: null,
    });
  }
  let minor;
  try {
    minor = amountToMinor(input.amount, exponent);
  } catch (error) {
    if (error instanceof UsageError) throw error;
    return result(domain, false, rules, { errors: [error.message], subunits: null, subunitsText: null });
  }
  if (minor < 0n) {
    return result(domain, false, rules, {
      errors: ['amount must be a non-negative integer of subunits'],
      subunits: null,
      subunitsText: null,
    });
  }
  const warnings = [];
  if (exponent === 3 && trailing.value === true && minor % 10n !== 0n) {
    if (input.zeroLastDigit === true) {
      minor -= minor % 10n;
      warnings.push('last subunit digit set to 0 for a three-decimal currency');
    } else {
      return result(domain, false, rules, {
        errors: ['three-decimal currency amount must end in subunit 0'],
        warnings,
        subunits: null,
        subunitsText: null,
      });
    }
  }
  const minimum = minima.value[currency] ?? checkoutMinima.value[currency];
  if (minimum !== undefined && minor < BigInt(minimum)) {
    return result(domain, false, rules, {
      errors: [`amount is below the minimum of ${minimum} subunits for ${currency}`],
      warnings,
      subunits: null,
      subunitsText: null,
    });
  }
  if (minor === 0n) warnings.push('amount is zero');
  return result(domain, true, rules, {
    errors: [],
    warnings,
    subunits: minor,
    subunitsText: minor.toString(),
    currency,
    exponent,
  });
}

export function decideRazorpayEvent(input) {
  const domain = loadDomain('razorpay');
  assertObject(input);
  const onDate = input.onDate === undefined ? domain.asOf : readDate(input.onDate);
  const fulfilRule = ruleById('razorpay', 'razorpay.fulfil.events', onDate);
  const refundRule = ruleById('razorpay', 'razorpay.refund.events', onDate);
  const retryRule = ruleById('razorpay', 'razorpay.webhook.retryHours', onDate);
  const ackRule = ruleById('razorpay', 'razorpay.webhook.ackTimeoutSeconds', onDate);
  const minTimeout = ruleById('razorpay', 'razorpay.capture.timeoutMinMinutes', onDate);
  const defaultTimeout = ruleById('razorpay', 'razorpay.capture.timeoutDefaultMinutes', onDate);
  const eventIdRule = ruleById('razorpay', 'razorpay.webhook.eventIdHeader', onDate);
  const rules = [fulfilRule, refundRule, retryRule, ackRule, minTimeout, defaultTimeout, eventIdRule];
  if (input.signatureVerified !== true) {
    return decision(domain, rules, {
      valid: false,
      httpStatus: 400,
      action: 'reject_signature',
      fulfil: false,
      duplicate: false,
      storeEventId: false,
      errors: ['verify the raw-body signature before deciding the event'],
    });
  }
  const eventId = readField(input.eventId, 'eventId');
  const eventName = readField(input.event, 'event');
  if (eventId.error || eventName.error) {
    return decision(domain, rules, {
      valid: false,
      httpStatus: 400,
      action: 'reject',
      fulfil: false,
      duplicate: false,
      storeEventId: false,
      errors: [eventId.error, eventName.error].filter(Boolean),
    });
  }
  if (eventId.value.length === 0) {
    return decision(domain, rules, {
      valid: false,
      httpStatus: 400,
      action: 'reject',
      fulfil: false,
      duplicate: false,
      storeEventId: false,
      errors: ['eventId is empty'],
    });
  }
  const seen = readSeen(input.seenEventIds);
  const state = input.state === undefined ? 'none' : input.state;
  if (!['none', 'authorized', 'failed', 'captured', 'refunded'].includes(state)) {
    throw new UsageError('state must be none, authorized, failed, captured, or refunded');
  }
  const base = {
    event: eventName.value,
    eventIdHeader: eventIdRule.value,
    retryHours: retryRule.value,
    ackWithinSeconds: ackRule.value,
    state,
    capturedMinor: minorText(input.capturedMinor, '0'),
    refundedMinor: minorText(input.refundedMinor, '0'),
  };
  if (seen.has(eventId.value)) {
    return decision(domain, rules, {
      ...base,
      valid: true,
      httpStatus: 200,
      action: 'duplicate',
      fulfil: false,
      duplicate: true,
      storeEventId: false,
      errors: [],
      warnings: ['duplicate x-razorpay-event-id; return 200 and do not repeat the side effect'],
    });
  }
  const captured = BigInt(base.capturedMinor);
  const refunded = BigInt(base.refundedMinor);
  if (fulfilRule.value.includes(eventName.value)) {
    const amount = optionalMinor(input.amountMinor, 'amountMinor');
    const nextCaptured = amount === null ? captured : amount;
    const already = state === 'captured' || state === 'refunded';
    return decision(domain, rules, {
      ...base,
      valid: true,
      httpStatus: 200,
      action: already ? 'already_fulfilled' : 'fulfil',
      fulfil: !already,
      duplicate: false,
      storeEventId: true,
      state: state === 'refunded' ? 'refunded' : 'captured',
      capturedMinor: nextCaptured.toString(),
      errors: [],
      warnings: already ? ['payment is already fulfilled; do not ship again'] : [],
    });
  }
  if (eventName.value === 'payment.authorized') {
    const late = state === 'captured' || state === 'refunded';
    return decision(domain, rules, {
      ...base,
      valid: true,
      httpStatus: 200,
      action: late ? 'ignore_late' : 'record_authorized',
      fulfil: false,
      duplicate: false,
      storeEventId: true,
      state: late ? state : 'authorized',
      errors: [],
      warnings: [
        `Do not fulfil on payment.authorized. Uncaptured payments are auto-refunded after the capture timeout (minimum ${minTimeout.value} minutes, default ${defaultTimeout.value} minutes). Direct settlement merchants are auto-captured anyway; still wait for payment.captured or order.paid.`,
      ],
    });
  }
  if (eventName.value === 'payment.failed') {
    const late = state === 'captured' || state === 'refunded';
    return decision(domain, rules, {
      ...base,
      valid: true,
      httpStatus: 200,
      action: late ? 'ignore_late' : 'record_failed',
      fulfil: false,
      duplicate: false,
      storeEventId: true,
      state: late ? state : 'failed',
      errors: [],
      warnings: late ? ['a captured payment is not undone by a later payment.failed'] : [],
    });
  }
  if (eventName.value === 'refund.processed') {
    return decideRefundProcessed(domain, rules, input, base, state, captured, refunded);
  }
  if (eventName.value === 'refund.failed') {
    return decision(domain, rules, {
      ...base,
      valid: true,
      httpStatus: 200,
      action: 'refund_failed',
      fulfil: false,
      duplicate: false,
      storeEventId: true,
      errors: [],
      warnings: ['refund.failed does not change the refunded total'],
    });
  }
  if (eventName.value === 'refund.created') {
    return decision(domain, rules, {
      ...base,
      valid: true,
      httpStatus: 200,
      action: 'refund_pending',
      fulfil: false,
      duplicate: false,
      storeEventId: true,
      errors: [],
      warnings: ['refund.created does not move the refunded total; wait for refund.processed'],
    });
  }
  return decision(domain, rules, {
    ...base,
    valid: true,
    httpStatus: 200,
    action: 'ignore',
    fulfil: false,
    duplicate: false,
    storeEventId: true,
    errors: [],
    warnings: [`no fulfilment rule for ${eventName.value}`],
  });
}

function decideRefundProcessed(domain, rules, input, base, state, captured, refunded) {
  if (input.paymentCaptured === false) {
    return decision(domain, rules, {
      ...base,
      valid: true,
      httpStatus: 200,
      action: 'auto_refund',
      fulfil: false,
      duplicate: false,
      storeEventId: true,
      errors: [],
      warnings: ['auto-refund of an uncaptured payment; do not fulfil and do not treat it as a captured refund'],
    });
  }
  if (state !== 'captured' && state !== 'refunded') {
    return decision(domain, rules, {
      ...base,
      valid: true,
      httpStatus: 500,
      action: 'retry',
      fulfil: false,
      duplicate: false,
      storeEventId: false,
      errors: [],
      warnings: ['refund.processed arrived before capture; return non-2xx and do not store the event id yet'],
    });
  }
  const amount = optionalMinor(input.amountMinor, 'amountMinor');
  if (amount === null) throw new UsageError('amountMinor is required for refund.processed of a captured payment');
  if (amount <= 0n) {
    return decision(domain, rules, {
      ...base,
      valid: false,
      httpStatus: 400,
      action: 'reject_refund',
      fulfil: false,
      duplicate: false,
      storeEventId: false,
      errors: ['refund amount must be a positive number of subunits'],
    });
  }
  if (amount > captured - refunded) {
    return decision(domain, rules, {
      ...base,
      valid: false,
      httpStatus: 200,
      action: 'reject_refund',
      fulfil: false,
      duplicate: false,
      storeEventId: true,
      errors: ['refund exceeds captured minus refunded'],
    });
  }
  const nextRefunded = refunded + amount;
  return decision(domain, rules, {
    ...base,
    valid: true,
    httpStatus: 200,
    action: 'refund',
    fulfil: false,
    duplicate: false,
    storeEventId: true,
    state: nextRefunded === captured ? 'refunded' : 'captured',
    refundedMinor: nextRefunded.toString(),
    errors: [],
  });
}

export function macEqual(expected, provided) {
  if (!Buffer.isBuffer(expected) || !Buffer.isBuffer(provided)) {
    throw new UsageError('MAC comparison needs buffers');
  }
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

function hexMacEqual(payload, signature, secret) {
  if (!HEX_MAC.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const provided = Buffer.from(signature, 'hex');
  return macEqual(expected, provided);
}

function exponentOf(table, currency) {
  for (const [exponent, codes] of Object.entries(table)) {
    if (Array.isArray(codes) && codes.includes(currency)) return Number(exponent);
  }
  return null;
}

function amountToMinor(amount, exponent) {
  if (typeof amount === 'bigint') return amount;
  if (typeof amount !== 'string') throw new UsageError('amount must be a decimal string or a bigint of minor units');
  const field = readField(amount, 'amount');
  if (field.error) throw new UsageError(field.error);
  const stripped = field.value.replaceAll(',', '').replace(/^₹/, '');
  return parseAmount(stripped, exponent);
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
  if (!Array.isArray(value)) throw new UsageError('seenEventIds must be an array of strings');
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string') throw new UsageError('seenEventIds must be an array of strings');
    seen.add(item);
  }
  return seen;
}

function optionalMinor(value, label) {
  if (value === undefined || value === null) return null;
  return requiredMinor(value, label);
}

function requiredMinor(value, label) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') throw new UsageError(`${label} must be an integer string of subunits, not a JSON number`);
  if (typeof value !== 'string' || !INTEGER.test(value.trim())) {
    throw new UsageError(`${label} must be an integer string of subunits`);
  }
  return BigInt(value.trim());
}

function minorText(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return requiredMinor(value, 'minor units').toString();
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

function result(domain, valid, rules, extra) {
  const confirm = needsConfirm(rules);
  const warnings = [...(extra.warnings ?? [])];
  if (confirm && !warnings.includes(CONFIRM_SENTENCE)) warnings.push(CONFIRM_SENTENCE);
  const payload = {
    valid,
    errors: extra.errors ?? [],
    warnings,
    confirm,
    disclaimer: disclaimer(domain.asOf),
  };
  if ('subunits' in extra) {
    payload.subunits = extra.subunits === null || extra.subunits === undefined ? null : extra.subunits.toString();
    payload.subunitsText = extra.subunitsText ?? null;
    payload.currency = extra.currency ?? null;
    payload.exponent = extra.exponent ?? null;
  }
  return payload;
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
    storeEventId: fields.storeEventId,
    event: fields.event ?? '',
    eventIdHeader: fields.eventIdHeader,
    retryHours: fields.retryHours,
    ackWithinSeconds: fields.ackWithinSeconds,
    state: fields.state ?? 'none',
    capturedMinor: fields.capturedMinor ?? '0',
    refundedMinor: fields.refundedMinor ?? '0',
    errors: fields.errors ?? [],
    warnings,
    confirm,
    disclaimer: disclaimer(domain.asOf),
  };
}

export function parseJsonArg(argv, usageText) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    throw new UsageError(usageText);
  }
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
  const body = { ...payload };
  if (typeof body.subunits === 'bigint') body.subunits = body.subunits.toString();
  process.stdout.write(`${JSON.stringify(body)}\n`, () => {
    process.exit(code);
  });
}

export function failure(domainName, message) {
  let asOf = '2026-11-01';
  try {
    asOf = loadDomain(domainName).asOf;
  } catch {
    asOf = '2026-11-01';
  }
  return {
    valid: false,
    errors: [message],
    warnings: [],
    confirm: false,
    disclaimer: disclaimer(asOf),
  };
}
