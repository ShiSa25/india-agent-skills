#!/usr/bin/env node
/**
 * Export-of-services checklist for a freelancer invoice.
 *   node scripts/export-checklist.mjs --json '{"invoiceDate":"2026-10-15",...}'
 * Exit 0 when the supply qualifies and no realisation clock is already late,
 * 1 when it does not qualify or a clock is late, 2 on a usage error.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CONFIRM_SENTENCE, disclaimer } from './_lib/disclaimer.mjs';
import { addMonths, addYears, compareIso, fyOf, parseFy, parseIsoDate, formatIsoDate } from './_lib/fy.mjs';
import { loadDomain, needsConfirm, ruleById, rulesOn } from './_lib/rules.mjs';

const MAX_BYTES = 10 * 1024;
const HIDDEN = /[\u200B\u200C\u200D\uFEFF\u2060\u180E\u202A-\u202E\u2066-\u2069]/;
const CURRENCY = /^[A-Z]{3}$/;
const INDIA = new Set(['IN', 'IND', 'INDIA']);
const KEYS = new Set([
  'invoiceDate',
  'currency',
  'clientCountry',
  'supplierInIndia',
  'recipientOutsideIndia',
  'placeOfSupplyOutsideIndia',
  'ownBranch',
  'intermediary',
  'lutFiledFY',
  'paymentReceivedDate',
  'sez',
  'withPaymentOfTax',
  'inrPermittedByRbi',
  'forexReceived',
]);

if (invokedDirectly()) {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) finish(2, failure('Usage: node scripts/export-checklist.mjs --json \'<object>\''));
    else {
      const result = exportChecklist(parsed.input);
      finish(result.valid ? 0 : 1, result);
    }
  } catch (error) {
    finish(2, failure(error.message));
  }
}

/**
 * @param {object} input
 */
export function exportChecklist(input) {
  const spec = readInput(input);
  const applied = [];
  const take = (rule) => {
    applied.push(rule);
    return rule;
  };

  const conditions = take(ruleById('gst', 'gst.export.service.conditions', spec.invoiceDate)).value;
  const inrWarning = take(ruleById('gst', 'gst.export.inrWarning', spec.invoiceDate)).value;
  const intermediaryWarning = take(ruleById('gst', 'gst.igst.intermediary.warning', spec.invoiceDate)).value;
  const otherExceptions = take(ruleById('gst', 'gst.igst.s13.otherExceptions', spec.invoiceDate)).value;
  take(ruleById('gst', 'gst.igst.placeOfSupply.general', spec.invoiceDate));
  const lutForm = take(ruleById('gst', 'gst.lut.form', spec.invoiceDate)).value;
  take(ruleById('gst', 'gst.lut.tiedToInvoiceFy', spec.invoiceDate));
  const zeroRated = take(ruleById('gst', 'gst.zeroRated.options', spec.invoiceDate)).value;
  const oneYear = take(ruleById('gst', 'gst.rule96a.oneYear', spec.invoiceDate));
  take(ruleById('gst', 'gst.rule96a.useLaterOfFema', spec.invoiceDate));
  const taxPaymentDays = take(ruleById('gst', 'gst.rule96a.taxPaymentDays', spec.invoiceDate)).value;
  take(ruleById('gst', 'gst.rule96a.appliesToSez', spec.invoiceDate));

  const items = [];
  const warnings = [];
  const fy = fyOf(spec.invoiceDate);

  let placeOutside = spec.placeOfSupplyOutsideIndia;
  let intermediaryBlocks = false;
  const omitted = ruleOrNull('gst', 'gst.igst.intermediary.omitted', spec.invoiceDate);
  const supplierPos = ruleOrNull('gst', 'gst.igst.intermediary.placeOfSupply', spec.invoiceDate);
  if (omitted) take(omitted);
  if (supplierPos) take(supplierPos);

  if (spec.intermediary) {
    warnings.push(intermediaryWarning);
    if (supplierPos && !omitted) {
      intermediaryBlocks = true;
      if (spec.supplierInIndia) placeOutside = false;
      items.push({
        id: 'intermediary',
        status: 'fail',
        text: `${intermediaryWarning}. Until 29 Mar 2026, IGST s.13(8)(b) puts an intermediary's place of supply at the supplier's location. ${otherExceptions}`,
      });
    } else {
      items.push({
        id: 'intermediary',
        status: 'info',
        text: `${intermediaryWarning}. From 30 Mar 2026, Finance Act 2026 s.157 omits IGST s.13(8)(b), so s.13(2) looks to the recipient unless another exception applies. ${otherExceptions}`,
      });
    }
  } else {
    items.push({
      id: 'intermediary',
      status: 'pass',
      text: `Not marked as an intermediary. ${otherExceptions}`,
    });
  }

  let recipientOutside = spec.recipientOutsideIndia;
  if (recipientOutside && INDIA.has(spec.clientCountry) && !spec.sez) {
    recipientOutside = false;
    warnings.push('clientCountry is India and this is not an SEZ supply, so the recipient is not outside India.');
  }

  const inr = spec.currency === 'INR';
  let forexOk = false;
  if (spec.forexReceived === false) {
    forexOk = false;
  } else if (inr) {
    warnings.push(inrWarning);
    forexOk = spec.inrPermittedByRbi === true;
  } else {
    forexOk = spec.forexReceived !== false;
  }

  const answers = [spec.supplierInIndia, recipientOutside, placeOutside, forexOk, !spec.ownBranch];
  const ids = ['s2-6-i', 's2-6-ii', 's2-6-iii', 's2-6-iv', 's2-6-v'];
  for (let i = 0; i < conditions.length; i += 1) {
    let text = conditions[i];
    if (i === 2 && intermediaryBlocks) {
      text = `${text} The intermediary rule above treats the place of supply as the supplier's location.`;
    }
    if (i === 3 && inr) text = `${text} ${inrWarning}`;
    if (i === 3 && spec.forexReceived !== true && !spec.paymentReceivedDate) {
      text = `${text} Receipt is still open: s.2(6)(iv) is satisfied only when the payment has actually been received.`;
    }
    if (i === 4 && spec.ownBranch) {
      text = `${text} The client is marked as the supplier's own foreign branch or another establishment of the same person, so this is not an export.`;
    }
    items.push({ id: ids[i], status: answers[i] ? 'pass' : 'fail', text });
  }

  const isExport = answers.every(Boolean);
  const isSez = spec.sez && spec.supplierInIndia;
  if (spec.sez) {
    items.push({
      id: 'sez',
      status: isSez ? 'pass' : 'fail',
      text: isSez
        ? 'Marked as a supply to an SEZ developer or SEZ unit. IGST s.16 zero-rates that supply. It is still not an export of services unless all five s.2(6) conditions pass. Rule 96A(6) applies the realisation clock when the supply is made without payment of IGST.'
        : 'Marked as SEZ, but the supplier is not in India, so this skill does not treat it as a zero-rated SEZ supply.',
    });
  }

  const qualifies = isExport || isSez;
  let lutRequired = false;
  let lutFiled = null;
  if (qualifies && !spec.withPaymentOfTax) {
    if (spec.lutFiledFY) {
      lutFiled = parseFy(spec.lutFiledFY).display;
      lutRequired = lutFiled !== fy;
    } else {
      lutRequired = true;
    }
    items.push({
      id: 'lut',
      status: lutRequired ? 'fail' : 'pass',
      text: lutRequired
        ? `Form ${lutForm} is required for FY ${fy} if you supply without paying IGST. ${lutFiled ? `The LUT on file is for ${lutFiled}.` : 'No LUT financial year was given.'} An LUT is not what makes a supply an export. Without it you pay IGST and claim the refund.`
        : `Form ${lutForm} for FY ${fy} covers this invoice. It lets you supply without paying IGST. It is not itself a condition of export.`,
    });
  } else if (qualifies && spec.withPaymentOfTax) {
    items.push({
      id: 'lut',
      status: 'info',
      text: `With payment of IGST, Form ${lutForm} is not the route. ${zeroRated[1]}.`,
    });
  }

  let fema = null;
  let gstOneYear = null;
  let receiptDeadline = null;
  let taxPayDeadline = null;
  let femaLate = false;
  let ruleLate = false;
  if (qualifies) {
    fema = femaClock(spec, take, warnings);
    gstOneYear = addYears(spec.invoiceDate, oneYear.value);
    const later = compareIso(gstOneYear, fema.deadline) >= 0 ? gstOneYear : fema.deadline;
    if (!spec.withPaymentOfTax) {
      receiptDeadline = later;
      taxPayDeadline = addDays(receiptDeadline, taxPaymentDays);
    }
    items.push({
      id: 'rule96a',
      status: 'info',
      text: spec.withPaymentOfTax
        ? `The one-year Rule 96A limb would be ${gstOneYear}. You are paying IGST, so the LUT/bond clock in Rule 96A(1) is not the clock you are on. FEMA is separate.`
        : `Rule 96A(1)(b): payment must be received by the later of one year from the invoice (${gstOneYear}) and the FEMA period (${fema.deadline}). That date is ${receiptDeadline}. If it is missed, IGST and interest are payable within ${taxPaymentDays} days, by ${taxPayDeadline}. A Commissioner or an RBI extension can move this date.`,
    });
    items.push({
      id: 'fema',
      status: 'info',
      text: fema.text,
    });
    items.push({
      id: 'zero-rated',
      status: 'info',
      text: `IGST s.16 zero-rates this supply. Either: ${zeroRated[0]}; or: ${zeroRated[1]}.`,
    });

    const fira = take(ruleById('fema', 'fema.proof.fira', spec.invoiceDate));
    const ebrc = take(ruleById('fema', 'fema.proof.ebrc', spec.invoiceDate));
    items.push({ id: 'fira', status: 'info', text: fira.value });
    items.push({ id: 'ebrc', status: 'info', text: ebrc.value });

    if (spec.paymentReceivedDate) {
      femaLate = compareIso(spec.paymentReceivedDate, fema.deadline) > 0;
      ruleLate = receiptDeadline !== null && compareIso(spec.paymentReceivedDate, receiptDeadline) > 0;
      if (compareIso(spec.paymentReceivedDate, spec.invoiceDate) < 0) {
        warnings.push('paymentReceivedDate is before the invoice date. Treat it as an advance only if the bank advice matches this invoice.');
      }
      items.push({
        id: 'payment-timing',
        status: femaLate || ruleLate ? 'fail' : 'pass',
        text: timingText(spec.paymentReceivedDate, fema, receiptDeadline, femaLate, ruleLate),
      });
    }
  }

  const confirm = needsConfirm(applied);
  const confirmReasons = applied
    .filter((rule) => rule.verified === false)
    .map((rule) => `${rule.id}: ${rule.note}`);
  if (confirm && !warnings.includes(CONFIRM_SENTENCE)) warnings.push(CONFIRM_SENTENCE);

  const valid = qualifies && !femaLate && !ruleLate;
  return {
    valid,
    qualifies,
    isExport,
    fy,
    lutRequired,
    lutFiledFY: lutFiled,
    gstRealisationDeadline: qualifies ? gstOneYear : null,
    rule96aReceiptDeadline: receiptDeadline,
    rule96aTaxPaymentDeadline: taxPayDeadline,
    femaRealisationDeadline: fema ? fema.deadline : null,
    femaMonths: fema ? fema.months : null,
    femaInstrument: fema ? fema.instrument : null,
    femaAlso: fema ? fema.also : [],
    items,
    warnings,
    confirm,
    confirmReasons,
    disclaimer: packDisclaimer(),
  };
}

function femaClock(spec, take, warnings) {
  const rows = rulesOn('fema', spec.invoiceDate).filter(
    (rule) => rule.value && typeof rule.value.months === 'number' && typeof rule.value.currency === 'string',
  );
  for (const row of rows) take(row);
  const inrRows = rows.filter((rule) => rule.value.currency === 'INR');
  const forexRows = rows.filter((rule) => rule.value.currency === 'forex');
  let pool = spec.currency === 'INR' && inrRows.length > 0 ? inrRows : forexRows;
  if (spec.currency === 'INR' && inrRows.length === 0) {
    warnings.push('No separate INR realisation period is in force on this invoice date. The foreign-exchange period is shown. Permission for the rupee payment is still a separate GST condition.');
  }
  if (pool.length !== 1) {
    throw usage(`expected one FEMA realisation row on ${spec.invoiceDate} and found ${pool.length}`);
  }
  const clock = rulesOn('fema', spec.invoiceDate).filter((rule) => rule.id.startsWith('fema.services.clock.'));
  for (const rule of clock) take(rule);

  const chosen = pool[0];
  const deadline = addMonths(spec.invoiceDate, chosen.value.months);
  const also = [];
  const window = ruleOrNull('fema', 'fema.services.gazetteDay.uncertain', spec.invoiceDate);
  if (window) {
    take(window);
    for (const months of window.value.months) {
      if (months === chosen.value.months) continue;
      also.push({
        months,
        deadline: addMonths(spec.invoiceDate, months),
        instrument: 'gazette-day uncertainty around FEMA 23(R)/(7)/2025-RB',
      });
    }
  }
  const clockNote = clock.some((rule) => rule.verified === false)
    ? ' The invoice date is used as the start. For a service invoice before 1 Oct 2026 that reading is not confirmed for non-software services.'
    : ' The clock starts on the invoice date.';
  const alsoText = also.length
    ? ` Also computed: ${also.map((row) => `${row.months} months → ${row.deadline}`).join('; ')}.`
    : '';
  return {
    months: chosen.value.months,
    deadline,
    instrument: chosen.value.instrument,
    also,
    text: `FEMA realisation: ${chosen.value.months} months under ${chosen.value.instrument}, deadline ${deadline}.${clockNote}${alsoText} An authorised dealer can extend the period. This is not the GST one-year limb.`,
  };
}

function timingText(paid, fema, receiptDeadline, femaLate, ruleLate) {
  if (!femaLate && !ruleLate) {
    return `Payment on ${paid} is on or before the FEMA deadline ${fema.deadline}${receiptDeadline ? ` and the Rule 96A receipt deadline ${receiptDeadline}` : ''}.`;
  }
  const parts = [];
  if (femaLate) parts.push(`after the FEMA deadline ${fema.deadline}`);
  if (ruleLate) parts.push(`after the Rule 96A receipt deadline ${receiptDeadline}`);
  return `Payment on ${paid} is ${parts.join(' and ')}.`;
}

function ruleOrNull(domain, id, onDate) {
  try {
    return ruleById(domain, id, onDate);
  } catch {
    return null;
  }
}

function readInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw usage('JSON must be an object.');
  for (const key of Object.keys(input)) {
    if (!KEYS.has(key)) throw usage(`Unknown field ${key}.`);
  }
  const invoiceDate = requireDate(input.invoiceDate, 'invoiceDate');
  const currency = requireCurrency(input.currency);
  const clientCountry = requireCountry(input.clientCountry);
  const supplierInIndia = requireBool(input.supplierInIndia, 'supplierInIndia');
  const recipientOutsideIndia = requireBool(input.recipientOutsideIndia, 'recipientOutsideIndia');
  const placeOfSupplyOutsideIndia = requireBool(input.placeOfSupplyOutsideIndia, 'placeOfSupplyOutsideIndia');
  const ownBranch = requireBool(input.ownBranch, 'ownBranch');
  const intermediary = requireBool(input.intermediary, 'intermediary');
  const sez = input.sez === undefined ? false : requireBool(input.sez, 'sez');
  const withPaymentOfTax = input.withPaymentOfTax === undefined ? false : requireBool(input.withPaymentOfTax, 'withPaymentOfTax');
  const inrPermittedByRbi = input.inrPermittedByRbi === undefined || input.inrPermittedByRbi === null
    ? null
    : requireBool(input.inrPermittedByRbi, 'inrPermittedByRbi');
  const forexReceived = input.forexReceived === undefined || input.forexReceived === null
    ? null
    : requireBool(input.forexReceived, 'forexReceived');
  let lutFiledFY = null;
  if (input.lutFiledFY !== undefined && input.lutFiledFY !== null) {
    if (typeof input.lutFiledFY !== 'string') throw usage('lutFiledFY must be a string.');
    lutFiledFY = clean(input.lutFiledFY);
    try {
      parseFy(lutFiledFY);
    } catch {
      throw usage('lutFiledFY must be YYYY-YY or YYYY-YYYY.');
    }
  }
  let paymentReceivedDate = null;
  if (input.paymentReceivedDate !== undefined && input.paymentReceivedDate !== null) {
    paymentReceivedDate = requireDate(input.paymentReceivedDate, 'paymentReceivedDate');
  }
  return {
    invoiceDate,
    currency,
    clientCountry,
    supplierInIndia,
    recipientOutsideIndia,
    placeOfSupplyOutsideIndia,
    ownBranch,
    intermediary,
    sez,
    withPaymentOfTax,
    inrPermittedByRbi,
    forexReceived,
    lutFiledFY,
    paymentReceivedDate,
  };
}

export function parseArgs(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return { help: true };
  const index = argv.indexOf('--json');
  if (index === -1) throw usage('Pass the invoice with --json.');
  const value = argv[index + 1];
  if (value === undefined) throw usage('--json needs a value.');
  const unknown = argv.some((arg, i) => arg.startsWith('--') && i !== index);
  if (unknown || index + 2 < argv.length) throw usage('Unexpected argument.');
  guardRaw(value);
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw usage('--json value is not valid JSON.');
  }
  return { input: parsed };
}

function guardRaw(value) {
  if (typeof value !== 'string') throw usage('input must be a string');
  if (Buffer.byteLength(value, 'utf8') > MAX_BYTES) throw usage('input is over 10 KB');
  if (HIDDEN.test(value)) throw usage('input contains a zero-width or bidi control character');
}

function requireDate(value, name) {
  if (typeof value !== 'string') throw usage(`${name} must be a YYYY-MM-DD string.`);
  const cleaned = clean(value);
  try {
    parseIsoDate(cleaned);
  } catch {
    throw usage(`${name} must be a real YYYY-MM-DD date.`);
  }
  return cleaned;
}

function requireCurrency(value) {
  if (typeof value !== 'string') throw usage('currency must be a 3-letter code.');
  const cleaned = clean(value).toUpperCase();
  if (!CURRENCY.test(cleaned)) throw usage('currency must be a 3-letter code.');
  return cleaned;
}

function requireCountry(value) {
  if (typeof value !== 'string') throw usage('clientCountry must be a string.');
  const cleaned = clean(value).toUpperCase();
  if (cleaned.length < 2 || cleaned.length > 64) throw usage('clientCountry is empty or too long.');
  return cleaned;
}

function requireBool(value, name) {
  if (typeof value !== 'boolean') throw usage(`${name} must be true or false.`);
  return value;
}

function clean(value) {
  const cleaned = value.normalize('NFKC').trim();
  if (HIDDEN.test(cleaned)) throw usage('input contains a zero-width or bidi control character');
  return cleaned;
}

function addDays(iso, days) {
  const count = ruleInteger(days, 'days');
  const { y, m, d } = parseIsoDate(iso);
  const utc = new Date(Date.UTC(y, m - 1, d + count));
  return formatIsoDate({ y: utc.getUTCFullYear(), m: utc.getUTCMonth() + 1, d: utc.getUTCDate() });
}

function ruleInteger(value, name) {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw usage(`${name} rule is not an integer`);
  return value;
}

function packDisclaimer() {
  try {
    const dates = [loadDomain('gst').asOf, loadDomain('fema').asOf].sort();
    return disclaimer(dates[0]);
  } catch {
    return disclaimer('2026-11-01');
  }
}

function failure(message) {
  return {
    valid: false,
    qualifies: false,
    isExport: false,
    fy: null,
    lutRequired: false,
    lutFiledFY: null,
    gstRealisationDeadline: null,
    rule96aReceiptDeadline: null,
    rule96aTaxPaymentDeadline: null,
    femaRealisationDeadline: null,
    femaMonths: null,
    femaInstrument: null,
    femaAlso: [],
    items: [],
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
