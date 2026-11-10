#!/usr/bin/env node
/**
 * Format rupees in Indian grouping, in words, and in short form.
 *   node scripts/format-inr.mjs --json '{"rupees":"123456789.50"}'
 *   node scripts/format-inr.mjs --json '{"paise":"12345678901234567890"}'
 *   node scripts/format-inr.mjs --json '"100000"'
 * Exit 0 when the amount is accepted, 1 when it is not, 2 on a usage error.
 * A decimal string is rupees. A bigint is paise. JSON numbers are rejected.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CONFIRM_SENTENCE, disclaimer } from './_lib/disclaimer.mjs';
import { formatMinor, parseAmount } from './_lib/money.mjs';
import { loadDomain, needsConfirm, ruleById } from './_lib/rules.mjs';

const CONTROLS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/u;
const MAX_BYTES = 10240;
const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

if (invokedDirectly()) {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) finish(2, failure('Usage: node scripts/format-inr.mjs --json \'{"rupees":"1234.50"}\''));
    else {
      const result = reportInr(parsed.input);
      finish(result.valid ? 0 : 1, result);
    }
  } catch (error) {
    finish(2, failure(error.message));
  }
}

/**
 * @param {bigint|string} minor Bigint of paise, or a decimal string of rupees.
 * @param {{ symbol?: boolean, paise?: boolean, accounting?: boolean, onDate?: string }} [options]
 * @returns {string}
 */
export function formatINR(minor, options = {}) {
  const result = reportInr(minor, options);
  if (!result.valid) throw new Error(result.errors[0]);
  return result.formatted;
}

/**
 * @param {bigint|string} minor Bigint of paise, or a decimal string of rupees.
 * @param {{ onDate?: string }} [options]
 * @returns {string}
 */
export function toWords(minor, options = {}) {
  const result = reportInr(minor, options);
  if (!result.valid) throw new Error(result.errors[0]);
  return result.words;
}

/**
 * Short form. No rupee sign. 1.2 L, 1.2 Cr, 1.2 L Cr, 1.2 Cr Cr.
 * @param {bigint|string} minor
 * @param {{ onDate?: string }} [options]
 * @returns {string}
 */
export function compact(minor, options = {}) {
  const result = reportInr(minor, options);
  if (!result.valid) throw new Error(result.errors[0]);
  return result.compact;
}

/**
 * @param {bigint|string|object} input
 * @param {{ symbol?: boolean, paise?: boolean, accounting?: boolean, onDate?: string }} [options]
 */
export function reportInr(input, options = {}) {
  const applied = [];
  const warnings = [];
  try {
    const ctx = loadContext(options.onDate ?? objectDate(input), applied);
    const showSymbol = options.symbol !== false && objectFlag(input, 'symbol') !== false;
    const showPaise = options.paise !== false && objectFlag(input, 'showPaise') !== false;
    const accounting = options.accounting === true || objectFlag(input, 'accounting') === true;
    const minor = coerceMinor(input, ctx);
    const negative = minor < 0n;
    const absolute = negative ? -minor : minor;
    const scale = pow10(ctx.exponent);
    const rupees = absolute / scale;
    const paise = absolute % scale;
    const formatted = formatGrouped(rupees, paise, ctx, { showSymbol, showPaise, accounting, negative });
    if (!showPaise && paise !== 0n) warnings.push('Paise were omitted from the display.');
    const words = wordsFor(rupees, paise, negative, ctx, applied, warnings);
    const short = compactFor(absolute, negative, ctx, applied, warnings);
    const confirm = needsConfirm(applied);
    if (confirm) warnings.push(CONFIRM_SENTENCE);
    return {
      valid: true,
      paise: minor.toString(),
      rupees: formatMinor(minor, ctx.exponent),
      formatted,
      words,
      compact: short,
      negative,
      errors: [],
      warnings,
      confirm,
      disclaimer: disclaimer(ctx.asOf),
    };
  } catch (error) {
    return failure(error.message, options.onDate ?? objectDate(input));
  }
}

export function parseArgs(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return { help: true };
  const index = argv.indexOf('--json');
  if (index === -1) throw usage('Pass the amount with --json.');
  const value = argv[index + 1];
  if (value === undefined) throw usage('--json needs a value.');
  const unknown = argv.some((arg, i) => arg.startsWith('--') && i !== index);
  if (unknown || index + 2 < argv.length) throw usage('Unexpected argument.');
  if (Buffer.byteLength(value, 'utf8') > MAX_BYTES) throw usage('Input is longer than 10 KB.');
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('"') || trimmed.startsWith("'")) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw usage('--json value is not valid JSON.');
    }
    if (typeof parsed === 'number') throw usage('Pass rupees or paise as a string, not a JSON number.');
    return { input: parsed };
  }
  return { input: value };
}

function loadContext(onDate, applied) {
  const domain = loadDomain('inr');
  const date = onDate ?? domain.asOf;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) throw new Error('onDate must be YYYY-MM-DD.');
  const paiseRule = ruleById('inr', 'inr.paisePerRupee', date);
  const thousand = ruleById('inr', 'inr.thousand.rupees', date);
  const lakh = ruleById('inr', 'inr.lakh.rupees', date);
  const croreLakhs = ruleById('inr', 'inr.crore.lakhs', date);
  const grouping = ruleById('inr', 'inr.grouping', date);
  const names = ruleById('inr', 'inr.scale.names', date);
  applied.push(paiseRule, thousand, lakh, croreLakhs, grouping, names);
  const exponent = exponentOf(paiseRule.value);
  const thousandRupees = BigInt(thousand.value);
  const lakhRupees = BigInt(lakh.value);
  const croreRupees = lakhRupees * BigInt(croreLakhs.value);
  return {
    asOf: domain.asOf,
    date,
    exponent,
    paisePerRupee: BigInt(paiseRule.value),
    first: grouping.value.first,
    then: grouping.value.then,
    names,
    units: [
      { value: thousandRupees, name: names.value[0] },
      { value: lakhRupees, name: names.value[1] },
      { value: croreRupees, name: names.value[2] },
    ],
    hundredCroreRupees: BigInt(croreLakhs.value) * croreRupees,
    lakhRupees,
    croreRupees,
  };
}

function coerceMinor(input, ctx) {
  if (typeof input === 'bigint') return input;
  if (typeof input === 'string') return parseAmount(sanitizeAmount(input), ctx.exponent);
  if (input && typeof input === 'object') {
    const hasRupees = Object.hasOwn(input, 'rupees');
    const hasPaise = Object.hasOwn(input, 'paise') || Object.hasOwn(input, 'minor');
    if (!hasRupees && !hasPaise) throw new Error('Pass rupees or paise.');
    let fromRupees = null;
    let fromPaise = null;
    if (hasRupees) {
      if (typeof input.rupees !== 'string') throw new Error('rupees must be a decimal string.');
      fromRupees = parseAmount(sanitizeAmount(input.rupees), ctx.exponent);
    }
    if (hasPaise) {
      const raw = Object.hasOwn(input, 'paise') ? input.paise : input.minor;
      if (typeof raw !== 'string') throw new Error('paise must be an integer string.');
      const cleaned = sanitizeAmount(raw);
      if (!/^-?\d+$/.test(cleaned)) throw new Error('paise must be an integer string.');
      fromPaise = BigInt(cleaned);
    }
    if (fromRupees !== null && fromPaise !== null && fromRupees !== fromPaise) {
      throw new Error('rupees and paise do not match.');
    }
    return fromPaise ?? fromRupees;
  }
  throw new TypeError('amount must be a decimal string of rupees or a bigint of paise');
}

function sanitizeAmount(input) {
  if (Buffer.byteLength(input, 'utf8') > MAX_BYTES) throw new Error('Input is longer than 10 KB.');
  const normalised = input.normalize('NFKC').trim();
  if (CONTROLS.test(normalised)) throw new Error('Zero-width, bidi, or control characters are not allowed.');
  return normalised.replaceAll(',', '').replaceAll(' ', '').replaceAll('_', '').replace(/^₹/, '');
}

function formatGrouped(rupees, paise, ctx, flags) {
  const whole = groupDigits(rupees.toString(), ctx.first, ctx.then);
  let body = whole;
  if (flags.showPaise) body = `${whole}.${paise.toString().padStart(ctx.exponent, '0')}`;
  if (flags.showSymbol) body = `₹${body}`;
  if (!flags.negative) return body;
  if (flags.accounting) return `(${body})`;
  return `-${body}`;
}

function wordsFor(rupees, paise, negative, ctx, applied, warnings) {
  if (rupees >= ctx.hundredCroreRupees) {
    const convention = ruleById('inr', 'inr.aboveCrore.words', ctx.date);
    applied.push(convention);
    warnings.push('Amounts at or above one hundred crore are spelled by repeating lakh and crore. Arab is not used.');
  }
  const rupeeWords = rupees === 0n ? 'Zero' : spell(rupees, ctx);
  let body;
  if (paise === 0n) body = `Rupees ${rupeeWords} Only`;
  else {
    const unit = paise === 1n ? 'Paisa' : 'Paise';
    body = `Rupees ${rupeeWords} and ${under100(paise)} ${unit} Only`;
  }
  return negative ? `Minus ${body}` : body;
}

function spell(n, ctx) {
  const crore = ctx.units[2];
  if (n >= crore.value) {
    const high = spell(n / crore.value, ctx);
    const low = n % crore.value;
    return low === 0n ? `${high} ${crore.name}` : `${high} ${crore.name} ${spellBelowCrore(low, ctx)}`;
  }
  return spellBelowCrore(n, ctx);
}

function spellBelowCrore(n, ctx) {
  const thousand = ctx.units[0];
  const lakh = ctx.units[1];
  const parts = [];
  const lakhs = n / lakh.value;
  let rest = n % lakh.value;
  if (lakhs > 0n) parts.push(`${under100(lakhs)} ${lakh.name}`);
  const thousands = rest / thousand.value;
  rest %= thousand.value;
  if (thousands > 0n) parts.push(`${under100(thousands)} ${thousand.name}`);
  if (rest > 0n) parts.push(under1000(rest));
  return parts.join(' ');
}

function under1000(n) {
  if (n < 100n) return under100(n);
  const head = `${ONES[Number(n / 100n)]} Hundred`;
  const rest = n % 100n;
  return rest === 0n ? head : `${head} ${under100(rest)}`;
}

function under100(n) {
  const value = Number(n);
  if (value < 20) return ONES[value];
  const ten = TENS[Math.floor(value / 10)];
  const one = value % 10;
  return one === 0 ? ten : `${ten}-${ONES[one]}`;
}

function compactFor(absolute, negative, ctx, applied, warnings) {
  const oneLakh = ctx.lakhRupees * ctx.paisePerRupee;
  const oneCrore = ctx.croreRupees * ctx.paisePerRupee;
  const oneLakhCrore = ctx.lakhRupees * oneCrore;
  const oneCroreCrore = ctx.croreRupees * oneCrore;
  let body;
  if (absolute < oneLakh) {
    body = groupDigits(formatMinor(absolute, ctx.exponent), ctx.first, ctx.then);
  } else {
    const suffix = ruleById('inr', 'inr.compact.suffix', ctx.date);
    applied.push(suffix);
    warnings.push('Short forms such as L and Cr are abbreviations, not a statutory format.');
    const tiers = [
      { divisor: ctx.lakhRupees, label: suffix.value.lakh },
      { divisor: ctx.croreRupees, label: suffix.value.crore },
      { divisor: ctx.lakhRupees * ctx.croreRupees, label: suffix.value.lakhCrore },
      { divisor: ctx.croreRupees * ctx.croreRupees, label: suffix.value.croreCrore },
    ];
    let index = 3;
    if (absolute < oneCrore) index = 0;
    else if (absolute < oneLakhCrore) index = 1;
    else if (absolute < oneCroreCrore) index = 2;
    let hundredths = halfUpDiv(absolute, tiers[index].divisor);
    // Rounding to two places can reach the next unit: 99,99,500 rupees is 100.00 L, which is 1 Cr.
    const next = tiers[index + 1];
    if (next && hundredths * tiers[index].divisor >= next.divisor * pow10(2)) {
      index += 1;
      hundredths = halfUpDiv(absolute, next.divisor);
    }
    body = `${trimHundredths(hundredths, ctx)} ${tiers[index].label}`;
  }
  return negative ? `-${body}` : body;
}

function trimHundredths(hundredths, ctx) {
  const scale = pow10(2);
  const whole = hundredths / scale;
  const frac = hundredths % scale;
  const grouped = groupDigits(whole.toString(), ctx.first, ctx.then);
  if (frac === 0n) return grouped;
  const tenth = pow10(1);
  if (frac % tenth === 0n) return `${grouped}.${(frac / tenth).toString()}`;
  return `${grouped}.${frac.toString().padStart(2, '0')}`;
}

function groupDigits(raw, first, then) {
  const negative = raw.startsWith('-');
  const value = negative ? raw.slice(1) : raw;
  const dot = value.indexOf('.');
  const intPart = dot === -1 ? value : value.slice(0, dot);
  const frac = dot === -1 ? '' : value.slice(dot);
  const digits = intPart.replace(/^0+(?=\d)/, '') || '0';
  let grouped = digits;
  if (digits.length > first) {
    const head = digits.slice(0, -first);
    const tail = digits.slice(-first);
    const groups = [];
    for (let i = head.length; i > 0; i -= then) groups.push(head.slice(Math.max(0, i - then), i));
    groups.reverse();
    grouped = [...groups, tail].join(',');
  }
  return `${negative ? '-' : ''}${grouped}${frac}`;
}

function halfUpDiv(numerator, denominator) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

function exponentOf(perMajor) {
  let value = BigInt(perMajor);
  if (value < 1n) throw new Error('paise per rupee must be at least 1');
  let exponent = 0;
  while (value > 1n) {
    if (value % 10n !== 0n) throw new Error('paise per rupee must be a power of ten');
    value /= 10n;
    exponent += 1;
  }
  return exponent;
}

function pow10(exponent) {
  let value = 1n;
  for (let i = 0; i < exponent; i += 1) value *= 10n;
  return value;
}

function objectDate(input) {
  if (input && typeof input === 'object' && typeof input.onDate === 'string') return input.onDate;
  return undefined;
}

function objectFlag(input, key) {
  if (input && typeof input === 'object' && Object.hasOwn(input, key)) return input[key];
  return undefined;
}

function failure(message, onDate) {
  return {
    valid: false,
    paise: null,
    rupees: null,
    formatted: null,
    words: null,
    compact: null,
    negative: null,
    errors: [message],
    warnings: [],
    confirm: false,
    disclaimer: safeDisclaimer(onDate),
  };
}

function safeDisclaimer(onDate) {
  try {
    const domain = loadDomain('inr');
    return disclaimer(domain.asOf);
  } catch {
    return disclaimer(onDate && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(onDate) ? onDate : '2026-11-01');
  }
}

function usage(message) {
  const error = new Error(message);
  error.usage = true;
  return error;
}

function finish(code, payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`, () => {
    process.exit(code);
  });
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}
