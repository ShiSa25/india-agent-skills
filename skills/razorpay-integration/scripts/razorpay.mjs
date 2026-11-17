/**
 * Razorpay checkout signature, raw-body webhook signature, subunits, and
 * event decisions. No network. API calls belong to the Razorpay MCP server.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { disclaimer, CONFIRM_SENTENCE } from './_lib/disclaimer.mjs';
import { parseAmount } from './_lib/money.mjs';
import { loadDomain, needsConfirm, ruleById } from './_lib/rules.mjs';
import { asciiUpper, foldDocumented } from './_lib/textprep.mjs';

const FIELD_MAX = 10 * 1024;
const BODY_MAX = 1024 * 1024;
const CONTROLS = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;
const HEX_MAC = /^[0-9a-f]{64}$/;
const INTEGER = /^-?[0-9]+$/;
const AMOUNT_RETRY_WARNING = 'Do not store the event id. Return non-2xx so Razorpay can retry.';

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
  const rulesFor = (currency) => {
    const rules = [exponents, trailing, minima];
    if (currency && Object.hasOwn(checkoutMinima.value, currency)) rules.push(checkoutMinima);
    return rules;
  };
  const code = readField(input.currency, 'currency');
  if (code.error) return result(domain, false, rulesFor(), { errors: [code.error], subunits: null, subunitsText: null });
  const currency = asciiUpper(code.value).text;
  const rules = rulesFor(currency);
  if (!/^[A-Z]{3}$/.test(currency)) {
    return result(domain, false, rulesFor(), {
      errors: ['currency must be a 3-letter ISO code'],
      subunits: null,
      subunitsText: null,
    });
  }
  const exponent = exponentOf(exponents.value, currency);
  if (exponent === null) {
    return result(domain, false, rulesFor(), {
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
    if (signedZeroMinor(input.amountMinor) || signedZeroMinor(input.expectedMinor)) {
      return amountRetryDecision(domain, rules, base, 'amount_mismatch', 'A signed zero amount is invalid. Do not ship.');
    }
    const amount = optionalMinor(input.amountMinor, 'amountMinor');
    const nextCaptured = amount === null ? captured : amount;
    const already = state === 'captured' || state === 'refunded';
    if (!already) {
      const expected = optionalMinor(input.expectedMinor, 'expectedMinor');
      if (amount === null || expected === null) {
        return amountRetryDecision(domain, rules, base, 'needs_amount', 'expectedMinor is required before payment.captured or order.paid can fulfil. Do not ship. Omitting amountMinor must not be stored as capturedMinor 0.');
      }
      if (expected !== nextCaptured) {
        return amountRetryDecision(domain, rules, base, 'amount_mismatch', 'amountMinor does not match expectedMinor. Do not ship.');
      }
      return decision(domain, rules, {
        ...base,
        valid: true,
        httpStatus: 200,
        action: 'fulfil',
        fulfil: true,
        duplicate: false,
        storeEventId: true,
        state: 'captured',
        capturedMinor: nextCaptured.toString(),
        errors: [],
        warnings: [],
      });
    }
    const expected = optionalMinor(input.expectedMinor, 'expectedMinor');
    if ((amount !== null && amount !== captured) || (expected !== null && expected !== captured)) {
      return amountRetryDecision(domain, rules, base, 'amount_mismatch', 'The capture amount does not match the amount already stored. Do not change capturedMinor and do not ship.');
    }
    return decision(domain, rules, {
      ...base,
      valid: true,
      httpStatus: 200,
      action: 'already_fulfilled',
      fulfil: false,
      duplicate: false,
      storeEventId: true,
      state: state === 'refunded' ? 'refunded' : 'captured',
      capturedMinor: captured.toString(),
      errors: [],
      warnings: ['payment is already fulfilled; do not ship again'],
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

const JSON_DEPTH = 32;

/**
 * A non-negative integer of subunits, as a decimal string.
 * A safe integer number is accepted. A fraction, an exponent, a signed zero
 * number, or an integer past Number.MAX_SAFE_INTEGER is rejected.
 * @param {unknown} value
 */
export function subunitString(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^-0+$/.test(text)) return text;
    if (!/^[0-9]+$/.test(text)) throw new UsageError('subunit amount must be a non-negative integer string');
    return text;
  }
  if (typeof value === 'bigint') {
    if (value < 0n) throw new UsageError('subunit amount must be a non-negative integer');
    return value.toString();
  }
  if (typeof value === 'number') {
    if (Object.is(value, -0) || !Number.isSafeInteger(value) || value < 0) {
      throw new UsageError('subunit amount must be a safe non-negative integer');
    }
    return String(value);
  }
  throw new UsageError('subunit amount must be a string or a safe integer');
}

/**
 * The raw integer token at `path` in a JSON text, or null when that path is absent.
 * A fraction, an exponent, a sign, or a second token at the same path is rejected.
 * @param {string|Buffer} rawBody
 * @param {string[]} path
 */
export function jsonIntegerToken(rawBody, path) {
  if (!Array.isArray(path) || path.some((key) => typeof key !== 'string' || key.length === 0)) {
    throw new UsageError('amount path must be an array of strings');
  }
  const text = rawText(rawBody);
  const found = { value: null };
  const end = walkJson(text, 0, [], path, found, 0);
  skipSpace(text, end);
  return found.value;
}

/** Payment id the handler loads and saves. Refund events use `payment_id`. */
export function razorpayPaymentId(event) {
  const name = typeof event?.event === 'string' ? event.event : '';
  const payment = event?.payload?.payment?.entity;
  const refund = event?.payload?.refund?.entity;
  if (name.startsWith('refund.') && typeof refund?.payment_id === 'string') return refund.payment_id;
  if (typeof payment?.id === 'string') return payment.id;
  return '';
}

/**
 * Decide a verified Razorpay webhook from the raw body and the payment row
 * stored for that payment id. A UsageError becomes status 400 with nothing to store.
 * `status` is the decision httpStatus. Ship only when `ship` is true.
 * Persist `payment` in the same transaction as the event id only when `persist` is true.
 * @param {{
 *   event: object,
 *   eventId: string,
 *   rawBody?: string|Buffer,
 *   storedPayment?: { state?: string, capturedMinor?: unknown, refundedMinor?: unknown, seenEventIds?: string[] }|null,
 *   expectedAmount?: unknown,
 *   signatureVerified?: boolean,
 * }} input
 */
export function planRazorpayWebhook(input) {
  try {
    assertObject(input);
    const event = input.event;
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new UsageError('event must be an object');
    const eventName = typeof event.event === 'string' ? event.event : '';
    const payment = event.payload?.payment?.entity;
    const stored = input.storedPayment && typeof input.storedPayment === 'object' ? input.storedPayment : {};
    const amountMinor = webhookAmount(eventName, event, input.rawBody);
    const expectedMinor = input.expectedAmount === undefined || input.expectedAmount === null
      ? undefined
      : subunitString(input.expectedAmount);
    const decision = decideRazorpayEvent({
      signatureVerified: input.signatureVerified === true,
      eventId: input.eventId ?? '',
      event: eventName,
      amountMinor,
      expectedMinor,
      state: stored.state,
      capturedMinor: blankMinor(stored.capturedMinor),
      refundedMinor: blankMinor(stored.refundedMinor),
      seenEventIds: stored.seenEventIds,
      paymentCaptured: typeof payment?.captured === 'boolean' ? payment.captured : undefined,
    });
    const persist = decision.storeEventId === true;
    return {
      status: decision.httpStatus,
      decision,
      paymentId: razorpayPaymentId(event),
      persist,
      ship: persist && decision.fulfil === true,
      payment: {
        state: decision.state,
        capturedMinor: decision.capturedMinor,
        refundedMinor: decision.refundedMinor,
      },
    };
  } catch (error) {
    if (error instanceof UsageError) {
      return { status: 400, decision: null, paymentId: '', persist: false, ship: false, payment: null, error: error.message };
    }
    throw error;
  }
}

function blankMinor(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return subunitString(value);
}

function webhookAmount(eventName, event, rawBody) {
  const refund = eventName.startsWith('refund.');
  const path = refund
    ? ['payload', 'refund', 'entity', 'amount']
    : ['payload', 'payment', 'entity', 'amount'];
  const parsed = refund ? event?.payload?.refund?.entity?.amount : event?.payload?.payment?.entity?.amount;
  if (rawBody !== undefined && rawBody !== null) {
    const token = jsonIntegerToken(rawBody, path);
    if (token === null) {
      if (parsed !== undefined && parsed !== null) throw new UsageError('webhook amount is not a plain integer in the raw body');
      return undefined;
    }
    if (parsed !== undefined && parsed !== null && subunitString(parsed) !== token) {
      throw new UsageError('webhook amount does not match the raw body');
    }
    return token;
  }
  if (parsed === undefined || parsed === null) return undefined;
  return subunitString(parsed);
}

function rawText(rawBody) {
  if (typeof rawBody === 'string') return rawBody;
  if (Buffer.isBuffer(rawBody)) return rawBody.toString('utf8');
  throw new UsageError('rawBody must be a string or a Buffer');
}

function walkJson(text, i, at, path, found, depth) {
  if (depth > JSON_DEPTH) throw new UsageError('JSON nesting is deeper than 32');
  i = skipSpace(text, i);
  const c = text[i];
  if (c === '{') return walkObject(text, i, at, path, found, depth);
  if (c === '[') return walkArray(text, i, at, path, found, depth);
  if (c === '"') return skipJsonString(text, i);
  if (c === 't' || c === 'f' || c === 'n') return skipLiteral(text, i);
  if (c === '-' || isDigitChar(c)) return skipNumber(text, i);
  throw new UsageError('webhook JSON is malformed');
}

function walkObject(text, i, at, path, found, depth) {
  i += 1;
  i = skipSpace(text, i);
  if (text[i] === '}') return i + 1;
  while (i < text.length) {
    if (text[i] !== '"') throw new UsageError('webhook JSON is malformed');
    const key = readJsonKey(text, i);
    i = skipSpace(text, key.end);
    if (text[i] !== ':') throw new UsageError('webhook JSON is malformed');
    i = skipSpace(text, i + 1);
    const next = at.concat(key.value);
    if (samePath(next, path)) i = takeIntegerToken(text, i, found);
    else i = walkJson(text, i, next, path, found, depth + 1);
    i = skipSpace(text, i);
    if (text[i] === ',') {
      i = skipSpace(text, i + 1);
      continue;
    }
    if (text[i] === '}') return i + 1;
    throw new UsageError('webhook JSON is malformed');
  }
  throw new UsageError('webhook JSON is malformed');
}

function walkArray(text, i, at, path, found, depth) {
  i += 1;
  i = skipSpace(text, i);
  if (text[i] === ']') return i + 1;
  while (i < text.length) {
    i = walkJson(text, i, at.concat(''), path, found, depth + 1);
    i = skipSpace(text, i);
    if (text[i] === ',') {
      i = skipSpace(text, i + 1);
      continue;
    }
    if (text[i] === ']') return i + 1;
    throw new UsageError('webhook JSON is malformed');
  }
  throw new UsageError('webhook JSON is malformed');
}

function takeIntegerToken(text, i, found) {
  i = skipSpace(text, i);
  const start = i;
  if (text[i] === '-') i += 1;
  if (!isDigitChar(text[i])) throw new UsageError('webhook amount must be an integer');
  while (isDigitChar(text[i])) i += 1;
  if (text[i] === '.' || text[i] === 'e' || text[i] === 'E') {
    throw new UsageError('webhook amount must be an integer');
  }
  const token = text.slice(start, i);
  if (!/^(0|[1-9][0-9]*)$/.test(token)) throw new UsageError('webhook amount must be a non-negative integer');
  if (found.value !== null) throw new UsageError('webhook amount appears twice');
  found.value = token;
  return i;
}

function skipNumber(text, i) {
  if (text[i] === '-') i += 1;
  if (!isDigitChar(text[i])) throw new UsageError('webhook JSON is malformed');
  while (isDigitChar(text[i])) i += 1;
  if (text[i] === '.') {
    i += 1;
    if (!isDigitChar(text[i])) throw new UsageError('webhook JSON is malformed');
    while (isDigitChar(text[i])) i += 1;
  }
  if (text[i] === 'e' || text[i] === 'E') {
    i += 1;
    if (text[i] === '+' || text[i] === '-') i += 1;
    if (!isDigitChar(text[i])) throw new UsageError('webhook JSON is malformed');
    while (isDigitChar(text[i])) i += 1;
  }
  return i;
}

function skipLiteral(text, i) {
  const rest = text.slice(i, i + 5);
  if (rest.startsWith('true')) return i + 4;
  if (rest.startsWith('false')) return i + 5;
  if (rest.startsWith('null')) return i + 4;
  throw new UsageError('webhook JSON is malformed');
}

function skipJsonString(text, i) {
  return readJsonKey(text, i).end;
}

function readJsonKey(text, i) {
  if (text[i] !== '"') throw new UsageError('webhook JSON is malformed');
  i += 1;
  let value = '';
  while (i < text.length) {
    const c = text[i];
    if (c === '"') return { value, end: i + 1 };
    if (c === '\\') {
      const esc = text[i + 1];
      if (esc === 'u') {
        const hex = text.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new UsageError('webhook JSON is malformed');
        value += String.fromCharCode(Number.parseInt(hex, 16));
        i += 6;
        continue;
      }
      const map = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
      if (map[esc] === undefined) throw new UsageError('webhook JSON is malformed');
      value += map[esc];
      i += 2;
      continue;
    }
    if (c !== undefined && c < ' ') throw new UsageError('webhook JSON is malformed');
    value += c;
    i += 1;
  }
  throw new UsageError('webhook JSON is malformed');
}

function samePath(left, right) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false;
  return true;
}

function skipSpace(text, i) {
  while (text[i] === ' ' || text[i] === '\n' || text[i] === '\r' || text[i] === '\t') i += 1;
  return i;
}

function isDigitChar(char) {
  return char !== undefined && char >= '0' && char <= '9';
}

function amountRetryDecision(domain, rules, base, action, error) {
  return decision(domain, rules, {
    ...base,
    valid: false,
    httpStatus: 400,
    action,
    fulfil: false,
    duplicate: false,
    storeEventId: false,
    errors: [error],
    warnings: [AMOUNT_RETRY_WARNING],
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
  const stripped = foldDocumented(field.value).text.replaceAll(',', '').replace(/^₹/, '');
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
  const trimmed = value.trim();
  if (CONTROLS.test(trimmed)) return { error: `${label} contains a disallowed control character` };
  return { value: trimmed };
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

function signedZeroMinor(value) {
  return typeof value === 'string' && /^-0+$/.test(value.trim());
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
