#!/usr/bin/env node
/**
 * TDS on a freelancer payment.
 *   node scripts/tds.mjs --json '{"paymentDate":"2026-06-01",...}'
 * Exit 0 when a section applies (tax may be zero because of a threshold),
 * 1 when no section in this skill covers the payment, 2 on a usage error.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CONFIRM_SENTENCE, disclaimer } from './_lib/disclaimer.mjs';
import { parseIsoDate } from './_lib/fy.mjs';
import { formatMinor, parseAmount, pct } from './_lib/money.mjs';
import { loadDomain, needsConfirm, ruleById, rulesOn } from './_lib/rules.mjs';

const MAX_BYTES = 10 * 1024;
const HIDDEN = /[\u200B\u200C\u200D\uFEFF\u2060\u180E\u202A-\u202E\u2066-\u2069]/;
const PAYER = new Set(['individual', 'huf', 'other']);
const PAYEE = new Set(['individual', 'huf', 'other']);
const CATEGORY = new Set(['professional', 'technical', 'contractor', 'director', 'call_centre', 'film_royalty', 'royalty']);
const KEYS = new Set([
  'paymentDate',
  'payerType',
  'payeeType',
  'category',
  'amountMinor',
  'ytdMinor',
  'ytdTaxedMinor',
  'panAvailable',
  'auditRequired',
]);

if (invokedDirectly()) {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) finish(2, failure('Usage: node scripts/tds.mjs --json \'<object>\''));
    else {
      const result = tds(parsed.input);
      finish(result.valid ? 0 : 1, result);
    }
  } catch (error) {
    finish(2, failure(error.message));
  }
}

/**
 * @param {object} input
 */
export function tds(input) {
  const spec = readInput(input);
  const on = spec.paymentDate;
  const newAct = rulesOn('tds', on).some((rule) => rule.id === 'tds.393.6i.label');
  const oldAct = rulesOn('tds', on).some((rule) => rule.id === 'tds.1961.194c.label');
  if (!newAct && !oldAct) {
    throw usage('paymentDate is outside 2025-04-01 to the open 2025 Act period this skill covers.');
  }

  const applied = [];
  const take = (id) => {
    const rule = ruleById('tds', id, on);
    applied.push(rule);
    return rule;
  };

  const nonFiler = take('tds.206ab.apply');
  const prefix = newAct ? 'tds.393' : 'tds.1961';
  if (spec.category === 'director' && spec.payerType !== 'other') {
    throw usage('director remuneration is deducted by the company. payerType must be other.');
  }
  const auditedIndividual = spec.payerType === 'individual' || spec.payerType === 'huf';
  const useResidual = auditedIndividual && spec.auditRequired === false;
  const row = useResidual ? selectResidual(spec, prefix, take) : selectMain(spec, prefix, newAct, take);

  const warnings = [];
  if (nonFiler.value !== false) warnings.push('A non-filer higher rate is configured and this skill does not compute it.');
  warnings.push('s.206AB, the old non-filer higher rate, is not applied. That omission is not confirmed from the full Act text.');

  if (!row.covered) {
    const confirm = true;
    warnings.push(CONFIRM_SENTENCE);
    return {
      valid: false,
      tdsMinor: '0',
      tds: '0.00',
      taxableMinor: '0',
      rateBp: 0,
      section: null,
      oldSection: null,
      paymentCode: null,
      thresholdHit: false,
      act: newAct ? 'Income-tax Act, 2025' : 'Income-tax Act, 1961',
      warnings,
      confirm,
      confirmReasons: [row.reason, ...unverifiedNotes(applied)],
      disclaimer: packDisclaimer(),
    };
  }

  const amount = spec.amountMinor;
  const ytd = spec.ytdMinor;
  const ytdTaxed = spec.ytdTaxedMinor;
  // Threshold sees the whole year. The base sees only rupees not yet taxed, plus this bill.
  const untaxed = ytd + amount;
  const yearTotal = untaxed + ytdTaxed;
  let thresholdHit = false;
  let taxable = 0n;
  if (row.director) {
    thresholdHit = amount > row.directorThreshold;
    taxable = thresholdHit ? amount : 0n;
  } else {
    const singleHit = row.singleThreshold !== null && amount > row.singleThreshold;
    const aggregateHit = row.aggregateThreshold !== null && yearTotal > row.aggregateThreshold;
    thresholdHit = singleHit || aggregateHit;
    if (thresholdHit) taxable = aggregateHit ? untaxed : amount;
  }

  let rateBp = row.rateBp;
  if (!spec.panAvailable && thresholdHit) {
    const floor = take(newAct ? 'tds.397.noPan.rateBp' : 'tds.1961.206aa.rateBp');
    if (newAct) take('tds.397.noPan.fivePercentSections');
    if (rateBp < floor.value) rateBp = floor.value;
  }

  const tdsMinor = thresholdHit ? pct(taxable, rateBp) : 0n;
  if (thresholdHit && taxable > amount) {
    const scope = ytdTaxed > 0n ? 'untaxed FY total' : 'whole FY aggregate';
    warnings.push(
      `TDS is on the ${scope} of ${rupees(taxable)}, not only on this payment of ${rupees(amount)}. Deposit the tax even when it is more than the amount being paid out.`,
    );
  }
  if (row.director && (ytd > 0n || ytdTaxed > 0n)) {
    warnings.push('Director remuneration has no threshold. Tax is on this payment only. Earlier director payments are not added again.');
  }

  let paymentCode = null;
  if (newAct && row.codeKey) {
    const map = take('tds.paymentCode.map');
    paymentCode = map.value[row.codeKey] ?? null;
  } else if (!newAct) {
    warnings.push('Payment codes 1023 to 1028 are 2025-Act return codes and are not applied on the 1961 path.');
  }

  const confirm = needsConfirm(applied) || !newAct;
  const confirmReasons = unverifiedNotes(applied);
  if (!newAct) confirmReasons.push('Payment is before 1 Apr 2026. Sections and rates are the 1961 labels and were not re-read from the bare 1961 Act.');
  if (confirm && !warnings.includes(CONFIRM_SENTENCE)) warnings.push(CONFIRM_SENTENCE);

  return {
    valid: true,
    tdsMinor: tdsMinor.toString(),
    tds: formatMinor(tdsMinor),
    taxableMinor: taxable.toString(),
    rateBp,
    section: row.section,
    oldSection: row.oldSection,
    paymentCode,
    thresholdHit,
    act: newAct ? 'Income-tax Act, 2025' : 'Income-tax Act, 1961',
    warnings,
    confirm,
    confirmReasons,
    disclaimer: packDisclaimer(),
  };
}

function selectMain(spec, prefix, newAct, take) {
  if (spec.category === 'contractor') {
    const label = take(`${prefix}.${newAct ? '6i' : '194c'}.label`).value;
    const rateId = spec.payeeType === 'other'
      ? `${prefix}.${newAct ? '6i' : '194c'}.rate.otherBp`
      : `${prefix}.${newAct ? '6i' : '194c'}.rate.individualBp`;
    const rateBp = take(rateId).value;
    if (newAct) take('tds.393.base');
    return {
      covered: true,
      director: false,
      rateBp,
      singleThreshold: minor(take(`${prefix}.${newAct ? '6i' : '194c'}.threshold.singleMinor`).value),
      aggregateThreshold: minor(take(`${prefix}.${newAct ? '6i' : '194c'}.threshold.aggregateMinor`).value),
      directorThreshold: 0n,
      section: label.section,
      oldSection: label.oldSection,
      codeKey: `contractor.${spec.payeeType}`,
    };
  }

  const feeId = newAct ? '6iii' : '194j';
  const technical = take(`${prefix}.${feeId}.technicalCategories`).value;
  if (!technical.includes(spec.category) && !['professional', 'royalty', 'director'].includes(spec.category)) {
    return { covered: false, reason: `${spec.category} is not a serial 6(i) or 6(iii) category.` };
  }
  const label = take(`${prefix}.${feeId}.label`).value;
  const director = spec.category === 'director';
  const rateId = technical.includes(spec.category)
    ? `${prefix}.${feeId}.rate.technicalBp`
    : `${prefix}.${feeId}.rate.professionalBp`;
  if (newAct) take('tds.393.base');
  return {
    covered: true,
    director,
    rateBp: take(rateId).value,
    singleThreshold: null,
    aggregateThreshold: director ? null : minor(take(`${prefix}.${feeId}.threshold.aggregateMinor`).value),
    directorThreshold: minor(take(`${prefix}.${feeId}.threshold.directorMinor`).value),
    section: label.section,
    oldSection: label.oldSection,
    codeKey: spec.category,
  };
}

function selectResidual(spec, prefix, take) {
  const newAct = prefix === 'tds.393';
  const id = newAct ? '6ii' : '194m';
  const categories = take(`${prefix}.${id}.categories`).value;
  if (!categories.includes(spec.category)) {
    return {
      covered: false,
      reason: `An individual or HUF who is not required to deduct under the contractor or fee rows does not deduct under serial 6(ii) / s.194M on category ${spec.category}. That row covers contract work and professional fees, not this category.`,
    };
  }
  const label = take(`${prefix}.${id}.label`).value;
  if (newAct) take('tds.393.base');
  return {
    covered: true,
    director: false,
    rateBp: take(`${prefix}.${id}.rateBp`).value,
    singleThreshold: null,
    aggregateThreshold: minor(take(`${prefix}.${id}.threshold.aggregateMinor`).value),
    directorThreshold: 0n,
    section: label.section,
    oldSection: label.oldSection,
    codeKey: null,
  };
}

function unverifiedNotes(applied) {
  return applied.filter((rule) => rule.verified === false).map((rule) => `${rule.id}: ${rule.note}`);
}

function minor(value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw usage('a threshold rule is not a non-negative integer of paise');
  }
  return BigInt(value);
}

function rupees(minorUnits) {
  const negative = minorUnits < 0n;
  const plain = formatMinor(negative ? -minorUnits : minorUnits);
  const [whole, frac] = plain.split('.');
  let grouped = whole;
  if (whole.length > 3) {
    const tail = whole.slice(-3);
    const head = whole.slice(0, -3).replace(/\B(?=(?:\d{2})+$)/g, ',');
    grouped = `${head},${tail}`;
  }
  return `${negative ? '-' : ''}₹${grouped}.${frac}`;
}

function readInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw usage('JSON must be an object.');
  for (const key of Object.keys(input)) {
    if (!KEYS.has(key)) throw usage(`Unknown field ${key}.`);
  }
  const paymentDate = requireDate(input.paymentDate);
  const payerType = requireEnum(input.payerType, PAYER, 'payerType');
  const payeeType = requireEnum(input.payeeType, PAYEE, 'payeeType');
  const category = requireEnum(input.category, CATEGORY, 'category');
  const panAvailable = requireBool(input.panAvailable, 'panAvailable');
  const amountMinor = requireMinor(input.amountMinor, 'amountMinor');
  const ytdMinor = requireMinor(input.ytdMinor, 'ytdMinor');
  const ytdTaxedMinor = input.ytdTaxedMinor === undefined ? 0n : requireMinor(input.ytdTaxedMinor, 'ytdTaxedMinor');
  if (amountMinor < 0n || ytdMinor < 0n || ytdTaxedMinor < 0n) throw usage('amounts cannot be negative.');
  let auditRequired = null;
  if (payerType === 'individual' || payerType === 'huf') {
    if (input.auditRequired === undefined) {
      throw usage('auditRequired must be true or false when the payer is an individual or a HUF. True means they have to deduct under the contractor or fee row. False means the fifty-lakh residual row.');
    }
    auditRequired = requireBool(input.auditRequired, 'auditRequired');
  } else if (input.auditRequired === false) {
    throw usage('auditRequired false is only for an individual or HUF payer. A company or other payer uses the contractor or fee row.');
  }
  return { paymentDate, payerType, payeeType, category, panAvailable, amountMinor, ytdMinor, ytdTaxedMinor, auditRequired };
}

export function parseArgs(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return { help: true };
  const index = argv.indexOf('--json');
  if (index === -1) throw usage('Pass the payment with --json.');
  const value = argv[index + 1];
  if (value === undefined) throw usage('--json needs a value.');
  const unknown = argv.some((arg, i) => arg.startsWith('--') && i !== index);
  if (unknown || index + 2 < argv.length) throw usage('Unexpected argument.');
  if (typeof value !== 'string') throw usage('input must be a string');
  if (Buffer.byteLength(value, 'utf8') > MAX_BYTES) throw usage('input is over 10 KB');
  if (HIDDEN.test(value)) throw usage('input contains a zero-width or bidi control character');
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw usage('--json value is not valid JSON.');
  }
  return { input: parsed };
}

function requireDate(value) {
  if (typeof value !== 'string') throw usage('paymentDate must be a YYYY-MM-DD string.');
  const cleaned = clean(value);
  try {
    parseIsoDate(cleaned);
  } catch {
    throw usage('paymentDate must be a real YYYY-MM-DD date.');
  }
  return cleaned;
}

function requireEnum(value, allowed, name) {
  if (typeof value !== 'string') throw usage(`${name} must be a string.`);
  const cleaned = clean(value).toLowerCase().replaceAll(' ', '_');
  if (!allowed.has(cleaned)) throw usage(`${name} must be one of ${[...allowed].join(', ')}.`);
  return cleaned;
}

function requireBool(value, name) {
  if (typeof value !== 'boolean') throw usage(`${name} must be true or false.`);
  return value;
}

function requireMinor(value, name) {
  if (typeof value === 'number') throw usage(`${name} must be a string of paise, or a decimal rupee string. A JSON number is rejected.`);
  if (typeof value !== 'string') throw usage(`${name} must be a string.`);
  const cleaned = clean(value);
  try {
    if (cleaned.includes('.')) return parseAmount(cleaned);
    if (!/^[0-9]+$/.test(cleaned)) throw new Error('bad');
    return BigInt(cleaned);
  } catch (error) {
    if (error.usage) throw error;
    throw usage(`${name} must be paise as digits, or rupees with a decimal point.`);
  }
}

function clean(value) {
  const cleaned = value.normalize('NFKC').trim();
  if (HIDDEN.test(cleaned)) throw usage('input contains a zero-width or bidi control character');
  return cleaned;
}

function packDisclaimer() {
  try {
    return disclaimer(loadDomain('tds').asOf);
  } catch {
    return disclaimer('2026-11-01');
  }
}

function failure(message) {
  return {
    valid: false,
    tdsMinor: null,
    tds: null,
    taxableMinor: null,
    rateBp: null,
    section: null,
    oldSection: null,
    paymentCode: null,
    thresholdHit: false,
    act: null,
    warnings: [],
    confirm: false,
    confirmReasons: [],
    errors: [message],
    disclaimer: packDisclaimer(),
  };
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
