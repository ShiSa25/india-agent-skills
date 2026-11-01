#!/usr/bin/env node
/**
 * Build and parse unsigned upi://pay links, and draw a QR SVG.
 *   node scripts/upi-link.mjs --json '{"pa":"merchant@upi","pn":"Shiv & Co","am":"499.00"}'
 *   node scripts/upi-link.mjs --json '{"op":"parse","link":"upi://pay?pa=merchant%40upi&pn=Shop&cu=INR&mode=00"}'
 *   node scripts/upi-link.mjs --json '{"op":"qr","pa":"merchant@upi","pn":"Shop"}'
 * Exit 0 when the link is usable, 1 when it is not, 2 on a usage error.
 * Signing and orgid are out of scope. Amounts above a published ceiling warn and still build.
 */
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CONFIRM_SENTENCE, disclaimer } from './_lib/disclaimer.mjs';
import { formatMinor, parseAmount } from './_lib/money.mjs';
import { compileAnchored, loadDomain, needsConfirm, ruleById } from './_lib/rules.mjs';
import { qrcodegen } from './_lib/vendor/qrcodegen.mjs';

const CONTROLS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/u;
const MAX_BYTES = 10240;
const QR_BORDER = 4;
const EXTRA_KEYS = new Set(['dynamic', 'onDate', 'op', 'link', 'qr']);

if (invokedDirectly()) {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) finish(2, failure('Usage: node scripts/upi-link.mjs --json \'{"pa":"merchant@upi","pn":"Shop"}\''));
    else {
      const result = run(parsed.input);
      finish(result.valid ? 0 : 1, result);
    }
  } catch (error) {
    finish(2, failure(error.message));
  }
}

/**
 * @param {object} input
 * @returns {object}
 */
export function buildUpiLink(input) {
  return assemble(input, { fromParse: false });
}

/**
 * @param {string|object} input
 * @returns {object}
 */
export function parseUpiLink(input) {
  const link = typeof input === 'string' ? input : input?.link;
  const onDate = typeof input === 'object' && input ? input.onDate : undefined;
  if (typeof link !== 'string') return failure('Pass a upi://pay link.');
  const extracted = extractLink(link);
  if (extracted.errors.length > 0) return failure(extracted.errors, { warnings: extracted.warnings });
  const built = assemble({ ...extracted.params, onDate }, { fromParse: true, parseNotes: extracted });
  return built;
}

/**
 * QR SVG at ECC M, quiet zone of 4 modules. Deterministic.
 * @param {string} link
 * @returns {string}
 */
export function upiQrSvg(link) {
  if (typeof link !== 'string' || link.length === 0) throw new TypeError('link must be a string');
  if (Buffer.byteLength(link, 'utf8') > MAX_BYTES) throw new Error('Input is longer than 10 KB.');
  const qr = encodeMedium(link);
  const size = qr.size + QR_BORDER * 2;
  let path = '';
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      if (qr.getModule(x, y)) path += `M${x + QR_BORDER} ${y + QR_BORDER}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" data-border="${QR_BORDER}" data-ecc="M"><rect width="${size}" height="${size}" fill="#ffffff"/><path fill="#000000" d="${path}"/></svg>`;
}

export function parseArgs(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return { help: true };
  const index = argv.indexOf('--json');
  if (index === -1) throw usage('Pass the UPI fields or link with --json.');
  const value = argv[index + 1];
  if (value === undefined) throw usage('--json needs a value.');
  const unknown = argv.some((arg, i) => arg.startsWith('--') && i !== index);
  if (unknown || index + 2 < argv.length) throw usage('Unexpected argument.');
  if (Buffer.byteLength(value, 'utf8') > MAX_BYTES) throw usage('Input is longer than 10 KB.');
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('"')) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw usage('--json value is not valid JSON.');
    }
    if (typeof parsed === 'number') throw usage('Pass fields as strings. JSON numbers are rejected.');
    return { input: parsed };
  }
  return { input: value };
}

function run(input) {
  if (typeof input === 'string') return input.startsWith('upi:') || input.toLowerCase().startsWith('upi:')
    ? parseUpiLink(input)
    : failure('Pass a upi://pay link or an object with pa and pn.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) return failure('Pass a upi://pay link or an object with pa and pn.');
  const op = typeof input.op === 'string' ? input.op : input.link && input.pa === undefined ? 'parse' : 'build';
  if (op !== 'build' && op !== 'parse' && op !== 'qr') return failure('op must be build, parse, or qr.');
  if (input.link !== undefined && input.pa !== undefined) return failure('Pass either link or pa and pn, not both.');
  const wantQr = op === 'qr' || input.qr === true;
  const parsing = op === 'parse' || (op === 'qr' && typeof input.link === 'string');
  const result = parsing ? parseUpiLink(input) : buildUpiLink(input);
  if (!wantQr || !result.valid) return result;
  try {
    return { ...result, qr: qrPackage(result.link) };
  } catch (error) {
    return { ...result, valid: false, qr: null, errors: [...result.errors, error.message] };
  }
}

function assemble(input, { fromParse, parseNotes }) {
  const applied = [];
  const warnings = [];
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return failure('Pass an object with pa and pn.');
  let date;
  try {
    date = resolveDate(input.onDate);
  } catch (error) {
    return failure(error.message);
  }
  const order = take('upi.param.order', date, applied, errors);
  const required = take('upi.param.required', date, applied, errors);
  const currency = take('upi.currency.only', date, applied, errors);
  const modes = take('upi.mode.codes', date, applied, errors);
  const person = take('upi.mcc.person', date, applied, errors);
  const trRule = take('upi.tr.requiredWhen', date, applied, errors);
  const schemes = take('upi.url.schemes', date, applied, errors);
  const maxLength = take('upi.param.maxLength', date, applied, errors);
  const encoding = take('upi.encoding.space', date, applied, errors);
  if (errors.length > 0 || !order) return failure(errors, { applied, warnings });

  if (encodeURIComponent(' ') !== encoding.value) {
    return failure('The bundled space-encoding rule is not %20.', { applied, warnings });
  }

  for (const key of Object.keys(input)) {
    if (EXTRA_KEYS.has(key)) continue;
    if (key === 'sign' || key === 'orgid') {
      errors.push(`${key} is out of scope. Unsigned links are for P2P or personal use. Merchants should use their PSP or payment gateway.`);
    } else if (key === 'purpose') {
      errors.push('purpose is not a v1.6 linking parameter.');
    } else if (!order.value.includes(key)) {
      errors.push(`Unknown field ${key}.`);
    }
  }
  if (input.dynamic !== undefined && typeof input.dynamic !== 'boolean') errors.push('dynamic must be a boolean.');

  const notes = { nfkc: false };
  const raw = {};
  for (const key of order.value) {
    if (input[key] === undefined || input[key] === null) continue;
    if (typeof input[key] !== 'string') {
      errors.push(`${key} must be a string.`);
      continue;
    }
    const cleaned = cleanField(key, input[key], notes, errors);
    if (cleaned !== null) raw[key] = cleaned;
  }
  if (notes.nfkc) warnings.push('Input was NFKC-normalised.');
  if (parseNotes?.warnings) warnings.push(...parseNotes.warnings);

  for (const key of required.value) {
    if (!raw[key]) errors.push(`${key} is required.`);
  }

  if (raw.pa) {
    const vpa = take('upi.vpa.pattern', date, applied, errors);
    if (vpa && !compileAnchored(vpa.value, vpa.id).test(raw.pa)) errors.push('pa does not match the VPA format check.');
  }

  if (raw.cu !== undefined) {
    const upper = raw.cu.toUpperCase();
    if (upper !== raw.cu) warnings.push('cu was uppercased.');
    if (upper !== currency.value) errors.push(`cu must be ${currency.value}.`);
    else raw.cu = upper;
  } else {
    raw.cu = currency.value;
    if (fromParse && parseNotes && !parseNotes.hadCu) warnings.push('cu was omitted; INR was assumed.');
  }

  if (raw.mode !== undefined) {
    const label = modes.value[raw.mode];
    if (!label) errors.push(`mode must be one of ${Object.keys(modes.value).join(', ')}.`);
    else if (label === 'future') warnings.push(`mode ${raw.mode} is marked future use in v1.6.`);
  } else {
    raw.mode = '00';
    if (fromParse && parseNotes && !parseNotes.hadMode) warnings.push('mode was omitted; 00 was written because v1.6 marks mode mandatory.');
  }

  if (raw.mc !== undefined) {
    const mcPattern = take('upi.mc.pattern', date, applied, errors);
    if (mcPattern && !compileAnchored(mcPattern.value, mcPattern.id).test(raw.mc)) {
      errors.push('mc must be a 4-digit merchant code.');
    }
  }

  for (const [key, max] of Object.entries(maxLength.value)) {
    if (raw[key] !== undefined && raw[key].length > max) errors.push(`${key} is longer than ${max} characters.`);
  }

  if (raw.url !== undefined) {
    const lower = raw.url.toLowerCase();
    const ok = schemes.value.some((scheme) => lower.startsWith(`${scheme}://`));
    if (!ok) errors.push('url must start with http:// or https://.');
    if (/\s/u.test(raw.url)) errors.push('url must not contain whitespace.');
  }

  const dynamic = input.dynamic === true;
  const merchant = Boolean(raw.mc) && raw.mc !== person.value;
  if ((merchant || dynamic) && !raw.tr) {
    errors.push(`tr is required for a ${trRule.value === 'merchant-or-dynamic' ? 'merchant or dynamic' : trRule.value} link.`);
  }
  if (dynamic && raw.am === undefined) errors.push('am is required for a dynamic link. If am is absent on a static link, the amount is editable.');

  let exponent = 2;
  let amMinor = null;
  let mamMinor = null;
  if (raw.am !== undefined || raw.mam !== undefined) {
    const decimals = take('upi.amount.maxDecimals', date, applied, errors);
    const positive = take('upi.amount.positive', date, applied, errors);
    if (decimals && positive) {
      exponent = Number(decimals.value);
      if (raw.am !== undefined) amMinor = readMoney('am', raw.am, exponent, positive.value, errors);
      if (raw.mam !== undefined) mamMinor = readMoney('mam', raw.mam, exponent, positive.value, errors);
    }
  }
  if (amMinor !== null && amMinor > 0n) raw.am = formatMinor(amMinor, exponent);
  if (mamMinor !== null && mamMinor > 0n) raw.mam = formatMinor(mamMinor, exponent);
  if (amMinor !== null && mamMinor !== null && mamMinor > amMinor) errors.push('mam cannot be greater than am.');

  const channel = raw.mc && raw.mc !== person.value ? 'p2m' : raw.pa ? 'p2p' : null;
  const judged = amMinor !== null && amMinor > 0n ? amMinor : mamMinor !== null && mamMinor > 0n ? mamMinor : null;
  let limits = null;
  if (errors.length === 0 && judged !== null && channel) {
    const bank = take('upi.limits.bankDiscretion', date, applied, errors);
    const ceiling = ceilingFor(channel, raw.mc, date, applied, errors);
    if (ceiling && bank && errors.length === 0) {
      limits = {
        name: ceiling.name,
        perTransactionPaise: ceiling.perTransaction.toString(),
        perDayPaise: ceiling.perDay === null ? null : ceiling.perDay.toString(),
        exceedsPerTransaction: judged > ceiling.perTransaction,
        bankMaySetLower: true,
      };
      if (ceiling.conditional) {
        warnings.push(
          `MCC ${raw.mc} has a higher ${ceiling.conditional.name} ceiling in OC 185B only with purpose ${ceiling.conditional.purpose}. upi://pay has no purpose parameter, so this link uses the ${inrLabel(ceiling.perTransaction, exponent)} P2M default.`,
        );
        if (judged > BigInt(ceiling.conditional.perTransactionPaise)) {
          warnings.push(`The amount also exceeds that conditional ceiling of ${inrLabel(BigInt(ceiling.conditional.perTransactionPaise), exponent)}.`);
        }
      }
      if (judged > ceiling.perTransaction) {
        const cap = inrLabel(ceiling.perTransaction, exponent);
        if (channel === 'p2p') {
          warnings.push(`Amount is above the ${cap} P2P per-transaction cap. RBI states a per-transaction cap. A link cannot show the rest of the day. ${bank.value}`);
        } else {
          let text = `Amount is above the ${ceiling.name} per-transaction ceiling of ${cap}.`;
          if (ceiling.perDay !== null) {
            text += ` The 24-hour cumulative ceiling is ${inrLabel(ceiling.perDay, exponent)} and cannot be checked from one link.`;
          }
          text += ` ${bank.value}`;
          warnings.push(text);
        }
      } else {
        warnings.push(bank.value);
      }
    }
  }

  if (parseNotes?.signed) {
    warnings.push('sign is present and was not checked. This skill does not verify signatures.');
  }
  if (parseNotes?.hadOrgid) {
    warnings.push('orgid is present and was not checked. Merchant orgid 000000 belongs on a signed intent, which is out of scope.');
  }

  const confirm = needsConfirm(applied);
  if (confirm) warnings.push(CONFIRM_SENTENCE);
  if (errors.length > 0) {
    return {
      valid: false,
      link: '',
      params: raw,
      amountEditable: raw.am === undefined,
      amountPaise: judged === null ? null : judged.toString(),
      channel,
      signed: Boolean(parseNotes?.signed),
      limits,
      qr: null,
      errors,
      warnings,
      confirm,
      disclaimer: payDisclaimer(),
    };
  }

  const notice = take('upi.unsigned.notice', date, applied, errors);
  if (!notice) return failure(errors, { applied, warnings });
  warnings.unshift(notice.value);
  const link = encodeLink(order.value, raw);
  return {
    valid: true,
    link,
    params: raw,
    amountEditable: raw.am === undefined,
    amountPaise: judged === null ? null : judged.toString(),
    channel,
    signed: Boolean(parseNotes?.signed),
    limits,
    qr: null,
    errors: [],
    warnings,
    confirm: needsConfirm(applied),
    disclaimer: payDisclaimer(),
  };
}

function extractLink(link) {
  const warnings = [];
  const errors = [];
  if (Buffer.byteLength(link, 'utf8') > MAX_BYTES) return { errors: ['Input is longer than 10 KB.'], warnings, params: {} };
  if (CONTROLS.test(link)) return { errors: ['Zero-width, bidi, or control characters are not allowed.'], warnings, params: {} };
  const nfkc = link.normalize('NFKC').trim();
  if (nfkc !== link.trim()) warnings.push('Input was NFKC-normalised.');
  if (/\s/u.test(nfkc)) return { errors: ['The link contains whitespace.'], warnings, params: {} };
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]+)(?:\?(.*))?$/.exec(nfkc);
  if (!match || match[1].toLowerCase() !== 'upi' || match[2].toLowerCase() !== 'pay') {
    return { errors: ['Link must be upi://pay.'], warnings, params: {} };
  }
  if (match[1] !== 'upi' || match[2] !== 'pay') warnings.push('Scheme was normalised to upi://pay.');
  const query = match[3] ?? '';
  if (query.includes('#') || query.includes('?')) return { errors: ['The link has an extra ? or a fragment.'], warnings, params: {} };
  const params = {};
  let signed = false;
  let hadOrgid = false;
  let hadCu = false;
  let hadMode = false;
  let lowered = false;
  if (query.length > 0) {
    for (const part of query.split('&')) {
      if (part.length === 0) {
        errors.push('The query has an empty parameter.');
        continue;
      }
      const eq = part.indexOf('=');
      if (eq === -1) {
        errors.push(`Parameter ${part} has no value.`);
        continue;
      }
      const keyRaw = part.slice(0, eq);
      const key = keyRaw.toLowerCase();
      if (key !== keyRaw && !lowered) {
        warnings.push('Parameter names were lowercased.');
        lowered = true;
      }
      if (Object.hasOwn(params, key) || (key === 'sign' && signed) || (key === 'orgid' && hadOrgid)) {
        errors.push(`Duplicate parameter ${key}.`);
        continue;
      }
      let value;
      try {
        if (part.slice(eq + 1).includes('+')) warnings.push('A plus sign was not treated as a space. v1.6 uses %20.');
        value = decodeURIComponent(part.slice(eq + 1));
      } catch {
        errors.push(`Parameter ${key} has invalid percent-encoding.`);
        continue;
      }
      if (CONTROLS.test(value)) {
        errors.push(`Parameter ${key} contains a hidden control character.`);
        continue;
      }
      if (key === 'sign') {
        signed = true;
        continue;
      }
      if (key === 'orgid') {
        hadOrgid = true;
        continue;
      }
      if (key === 'purpose') {
        errors.push('purpose is not a v1.6 linking parameter.');
        continue;
      }
      if (key === 'cu') hadCu = true;
      if (key === 'mode') hadMode = true;
      params[key] = value;
    }
  }
  return { errors, warnings, params, signed, hadOrgid, hadCu, hadMode };
}

function ceilingFor(channel, mc, date, applied, errors) {
  if (channel === 'p2p') {
    const rule = take('upi.p2p.perTransaction', date, applied, errors);
    if (!rule) return null;
    return { name: 'P2P', perTransaction: BigInt(rule.value), perDay: null, conditional: null };
  }
  const table = ruleOrNull('upi.p2m.categories', date);
  const row = table?.value.find((item) => item.mcc.includes(mc));
  if (table) applied.push(table);
  if (row && !row.purpose) {
    return {
      name: row.name,
      perTransaction: BigInt(row.perTransactionPaise),
      perDay: row.perDayPaise == null ? null : BigInt(row.perDayPaise),
      conditional: null,
    };
  }
  const fallback = take('upi.p2m.default.perTransaction', date, applied, errors);
  if (!fallback) return null;
  return {
    name: 'P2M',
    perTransaction: BigInt(fallback.value),
    perDay: null,
    conditional: row && row.purpose ? row : null,
  };
}

function encodeLink(order, params) {
  const parts = [];
  for (const key of order) {
    if (params[key] !== undefined) parts.push(`${key}=${encodeURIComponent(params[key])}`);
  }
  return `upi://pay?${parts.join('&')}`;
}

function encodeMedium(text) {
  const segments = qrcodegen.QrSegment.makeSegments(text);
  const qr = qrcodegen.QrCode.encodeSegments(segments, qrcodegen.QrCode.Ecc.MEDIUM, 1, 40, -1, false);
  if (qr.errorCorrectionLevel.formatBits !== qrcodegen.QrCode.Ecc.MEDIUM.formatBits) {
    throw new Error('QR was not encoded at ECC M.');
  }
  return qr;
}

function qrPackage(link) {
  const qr = encodeMedium(link);
  const svg = upiQrSvg(link);
  return {
    svg,
    sha256: createHash('sha256').update(svg).digest('hex'),
    version: qr.version,
    size: qr.size,
    ecc: 'M',
    border: QR_BORDER,
  };
}

function readMoney(field, raw, exponent, mustBePositive, errors) {
  const cleaned = raw.replaceAll(',', '').replaceAll(' ', '').replace(/^₹/, '');
  let minor;
  try {
    minor = parseAmount(cleaned, exponent);
  } catch (error) {
    errors.push(`${field}: ${error.message}`);
    return null;
  }
  if (mustBePositive && minor <= 0n) {
    errors.push(`${field} must be greater than zero.`);
    return null;
  }
  return minor;
}

function cleanField(key, value, notes, errors) {
  if (Buffer.byteLength(value, 'utf8') > MAX_BYTES) {
    errors.push(`${key} is longer than 10 KB.`);
    return null;
  }
  const nfkc = value.normalize('NFKC');
  if (nfkc !== value) notes.nfkc = true;
  if (CONTROLS.test(nfkc)) {
    errors.push(`${key} contains a zero-width, bidi, or control character.`);
    return null;
  }
  const trimmed = nfkc.trim();
  if (trimmed.length === 0) {
    errors.push(`${key} is empty.`);
    return null;
  }
  if (trimmed.toLowerCase() === 'null') {
    errors.push(`${key} must not be the string null. Omit the field instead.`);
    return null;
  }
  return trimmed;
}

function inrLabel(paise, exponent) {
  const digits = paise.toString().padStart(exponent + 1, '0');
  const whole = groupIndian(digits.slice(0, -exponent));
  return `₹${whole}.${digits.slice(-exponent)}`;
}

function groupIndian(digits) {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  const groups = [];
  for (let i = head.length; i > 0; i -= 2) groups.push(head.slice(Math.max(0, i - 2), i));
  groups.reverse();
  return [...groups, tail].join(',');
}

function take(id, date, applied, errors) {
  try {
    const rule = ruleById('upi', id, date);
    applied.push(rule);
    return rule;
  } catch (error) {
    errors.push(error.message);
    return null;
  }
}

function ruleOrNull(id, date) {
  try {
    return ruleById('upi', id, date);
  } catch (error) {
    if (String(error.message).startsWith('no rule ')) return null;
    throw error;
  }
}

function resolveDate(onDate) {
  const domain = loadDomain('upi');
  const date = onDate ?? domain.asOf;
  if (typeof date !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
    throw new Error('onDate must be YYYY-MM-DD.');
  }
  return date;
}

function payDisclaimer() {
  try {
    return disclaimer(loadDomain('upi').asOf);
  } catch {
    return disclaimer('2026-11-01');
  }
}

function failure(message, extra = {}) {
  const errors = Array.isArray(message) ? message : [message];
  const applied = extra.applied ?? [];
  const warnings = [...(extra.warnings ?? [])];
  const confirm = needsConfirm(applied);
  if (confirm && !warnings.includes(CONFIRM_SENTENCE)) warnings.push(CONFIRM_SENTENCE);
  return {
    valid: false,
    link: '',
    params: {},
    amountEditable: null,
    amountPaise: null,
    channel: null,
    signed: false,
    limits: null,
    qr: null,
    errors,
    warnings,
    confirm,
    disclaimer: payDisclaimer(),
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
