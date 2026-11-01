/**
 * GSTIN format check. Checksum-valid does not mean the GSTIN is registered.
 * Run this. Do not reimplement the checksum in a prompt.
 */
import { CONFIRM_SENTENCE, disclaimer } from './disclaimer.mjs';
import { compileAnchored, loadDomain, needsConfirm, ruleById } from './rules.mjs';

const LIMIT = 10 * 1024;
const ZERO_WIDTH = new Set([
  0x180e, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff,
]);

const CAVEAT_FALLBACK = 'Checksum valid ≠ registered/active; check services.gst.gov.in/services/searchtp';

/**
 * @param {string} gstin
 * @returns {{
 *   valid: boolean,
 *   normalized: string,
 *   type: 'regular'|'tds'|'tcs'|'uin'|'nrtp_oidar'|'unknown',
 *   stateCode: string,
 *   stateName: string,
 *   pan: string|null,
 *   tan: string|null,
 *   errors: string[],
 *   warnings: string[],
 *   confirm: boolean,
 *   disclaimer: string,
 * }}
 */
export function validateGstin(gstin) {
  const pack = loadPack();
  const shell = emptyResult(pack.disclaimerText);
  if (typeof gstin !== 'string') {
    return { ...shell, errors: ['GSTIN must be a string.'] };
  }
  if (Buffer.byteLength(gstin, 'utf8') > LIMIT) {
    return { ...shell, errors: ['Input exceeds the 10 KB limit.'] };
  }
  if (containsBlocked(gstin)) {
    return { ...shell, errors: ['Zero-width or bidi control character rejected.'] };
  }
  const nfkc = gstin.normalize('NFKC');
  if (containsBlocked(nfkc)) {
    return { ...shell, errors: ['Zero-width or bidi control character rejected.'] };
  }

  const warnings = [];
  if (nfkc !== gstin) warnings.push('Input was NFKC-normalised.');
  const trimmed = nfkc.trim();
  if (/[a-z]/.test(trimmed)) warnings.push('Lowercase letters were normalised to uppercase.');
  if (hasSeparator(trimmed)) warnings.push('Spaces or hyphens were removed.');

  let cleaned = '';
  for (const ch of trimmed) {
    if (isSeparator(ch)) continue;
    cleaned += ch.toUpperCase();
  }
  if (cleaned.length === 0) {
    return { ...shell, warnings, errors: ['GSTIN is empty.'] };
  }

  const errors = [];
  const charsetOk = [...cleaned].every((ch) => pack.alphabet.includes(ch));
  if (!charsetOk) {
    errors.push('GSTIN contains a character outside 0-9 and A-Z (Unicode look-alikes are rejected).');
  }
  if (cleaned.length !== pack.length) {
    errors.push(`GSTIN must be ${pack.length} characters.`);
  }

  const state = charsetOk ? lookupState(cleaned, pack) : { stateCode: '', stateName: '', legacy: false, known: false, gstinPrefix: false };
  if (charsetOk && cleaned.length >= 2 && !state.known) {
    errors.push(`Invalid state code ${cleaned.slice(0, 2)}.`);
  } else if (charsetOk && state.known && state.gstinPrefix === false) {
    errors.push(`State code ${state.stateCode} is a place-of-supply code, not a GSTIN prefix.`);
  }
  if (state.legacy && charsetOk && cleaned.length === pack.length) {
    warnings.push(pack.legacyWarning);
  }

  if (!charsetOk || cleaned.length !== pack.length) {
    const shown = presentState(state, cleaned, charsetOk);
    return {
      ...shell,
      normalized: charsetOk ? cleaned : '',
      stateCode: shown.stateCode,
      stateName: shown.stateName,
      errors,
      warnings,
    };
  }

  const expected = checkChar(cleaned.slice(0, pack.length - 1));
  const checksumOk = expected === cleaned[pack.length - 1];
  if (!checksumOk) errors.push(`Checksum does not match (expected ${expected}).`);
  else warnings.push(pack.caveat);

  const classified = classify(cleaned, pack, errors, warnings);
  const shown = presentState(state, cleaned, charsetOk);
  return {
    valid: errors.length === 0,
    normalized: cleaned,
    type: classified.type,
    stateCode: shown.stateCode,
    stateName: shown.stateName,
    pan: classified.pan,
    tan: classified.tan,
    errors,
    warnings,
    confirm: classified.confirm,
    disclaimer: pack.disclaimerText,
  };
}

function presentState(state, cleaned, charsetOk) {
  if (!charsetOk || !/^[0-9]{2}/.test(cleaned)) return { stateCode: '', stateName: '' };
  return {
    stateCode: cleaned.slice(0, 2),
    stateName: state.known ? state.stateName : '',
  };
}

/**
 * Check character for the first 14 characters.
 * @param {string} first14
 * @returns {string}
 */
export function checkChar(first14) {
  const { alphabet, radix, oddWeight, evenWeight } = checksumParams();
  if (typeof first14 !== 'string' || [...first14].length !== 14) {
    throw new TypeError('checkChar expects 14 characters');
  }
  let sum = 0;
  const chars = [...first14];
  for (let i = 0; i < chars.length; i += 1) {
    const value = alphabet.indexOf(chars[i]);
    if (value === -1) throw new TypeError('character outside the checksum alphabet');
    const weight = (i + 1) % 2 === 1 ? oddWeight : evenWeight;
    const product = value * weight;
    sum += Math.floor(product / radix) + (product % radix);
  }
  return alphabet[(radix - (sum % radix)) % radix];
}

/**
 * Build a checksum-valid synthetic GSTIN. This does not apply PAN, TAN, or
 * state policy; validateGstin does. Defaults are format-valid synthetics.
 * @param {string} stateCode two digits
 * @param {{ type?: string, pan?: string, tan?: string, body?: string, entity?: string, year?: string, country?: string, serial?: string, marker?: string }} [opts]
 */
export function generateSyntheticGstin(stateCode, opts = {}) {
  if (typeof stateCode !== 'string' || !/^[0-9]{2}$/.test(stateCode)) {
    throw new TypeError('stateCode must be two digits');
  }
  const type = opts.type ?? 'regular';
  const entity = opts.entity ?? '1';
  if (!/^[0-9A-Z]$/.test(entity)) throw new TypeError('entity must be one 0-9 or A-Z character');
  let first14;
  if (type === 'regular') {
    const pan = opts.pan ?? 'AABCC1234A';
    if (!/^[0-9A-Z]{10}$/.test(pan)) throw new TypeError('pan must be 10 characters from 0-9A-Z');
    first14 = `${stateCode}${pan}${entity}Z`;
  } else if (type === 'tds') {
    const tan = opts.tan ?? 'AAAA00000A';
    if (!/^[0-9A-Z]{10}$/.test(tan)) throw new TypeError('tan must be 10 characters from 0-9A-Z');
    first14 = `${stateCode}${tan}${entity}D`;
  } else if (type === 'tcs') {
    const body = opts.body ?? opts.pan ?? 'AABCC1234A';
    if (!/^[0-9A-Z]{10}$/.test(body)) throw new TypeError('body must be 10 characters from 0-9A-Z');
    first14 = `${stateCode}${body}${entity}C`;
  } else if (type === 'nrtp_oidar') {
    if (stateCode !== '99') throw new TypeError('NRTP/OIDAR GSTINs use state code 99');
    const year = opts.year ?? '23';
    const country = opts.country ?? 'USA';
    const serial = opts.serial ?? '00001';
    if (!/^[0-9]{2}$/.test(year) || !/^[A-Z]{3}$/.test(country) || !/^[0-9]{5}$/.test(serial)) {
      throw new TypeError('NRTP opts need year YY, country CCC, and a 5-digit serial');
    }
    first14 = `99${year}${country}${serial}OS`;
  } else if (type === 'uin') {
    const year = opts.year ?? '17';
    const country = opts.country ?? 'USA';
    const serial = opts.serial ?? '00001';
    const marker = opts.marker ?? 'UN';
    if (!/^[0-9]{2}$/.test(year) || !/^[A-Z]{3}$/.test(country) || !/^[0-9]{5}$/.test(serial) || !/^[0-9A-Z]{2}$/.test(marker)) {
      throw new TypeError('UIN opts need year YY, country CCC, a 5-digit serial, and a 2-character marker');
    }
    first14 = `${stateCode}${year}${country}${serial}${marker}`;
  } else {
    throw new TypeError(`unknown GSTIN type: ${type}`);
  }
  return first14 + checkChar(first14);
}

function classify(cleaned, pack, errors, warnings) {
  const marker = cleaned[13];
  const entity = cleaned[12];
  const body = cleaned.slice(2, 12);
  let type = 'unknown';
  let pan = null;
  let tan = null;
  let confirm = false;

  if (cleaned.startsWith(pack.nrtpPrefix) && cleaned.slice(12, 14) === pack.nrtpSuffix && pack.uinPattern.test(cleaned)) {
    type = 'nrtp_oidar';
  } else if (pack.uinPattern.test(cleaned)) {
    type = 'uin';
  } else if (marker === pack.markerTds) {
    type = 'tds';
    tan = body;
    if (!pack.tanPattern.test(body)) errors.push('TAN segment does not match AAAA99999A.');
    if (!pack.entityAlphabet.includes(entity)) errors.push('Entity character must be 1-9 or A-Z, not 0.');
  } else if (marker === pack.markerTcs) {
    type = 'tcs';
    if (needsConfirm(pack.tcsRule)) {
      confirm = true;
      warnings.push(pack.tcsRule.note);
      if (!warnings.some((warning) => warning.includes(CONFIRM_SENTENCE))) warnings.push(CONFIRM_SENTENCE);
    }
    if (!pack.entityAlphabet.includes(entity)) errors.push('Entity character must be 1-9 or A-Z, not 0.');
  } else if (marker === pack.markerRegular) {
    type = 'regular';
    pan = body;
    if (!pack.panPattern.test(body)) errors.push('PAN segment does not match the PAN format.');
    if (!pack.entityAlphabet.includes(entity)) errors.push('Entity character must be 1-9 or A-Z, not 0.');
  } else {
    errors.push('GSTIN shape is not regular, TDS, TCS, UIN, or NRTP/OIDAR.');
  }
  return { type, pan, tan, confirm };
}

function lookupState(cleaned, pack) {
  if (!/^[0-9]{2}/.test(cleaned)) {
    return { stateCode: '', stateName: '', legacy: false, known: false, gstinPrefix: false };
  }
  const stateCode = cleaned.slice(0, 2);
  const row = pack.states.find((item) => item.code === stateCode);
  if (!row) return { stateCode, stateName: '', legacy: false, known: false, gstinPrefix: false };
  return {
    stateCode,
    stateName: row.name,
    legacy: row.legacy === true,
    known: true,
    gstinPrefix: row.gstinPrefix !== false,
  };
}

function loadPack() {
  const gst = loadDomain('gst');
  const ids = loadDomain('ids');
  const onDate = gst.asOf <= ids.asOf ? gst.asOf : ids.asOf;
  const statesRule = ruleById('gst', 'gst.stateCodes', onDate);
  const checksum = ruleById('gst', 'gst.gstin.checksum', onDate).value;
  const tcsRule = ruleById('gst', 'gst.gstin.marker.tcs', onDate);
  return {
    disclaimerText: disclaimer(onDate),
    length: ruleById('gst', 'gst.gstin.length', onDate).value,
    alphabet: checksum.alphabet,
    states: statesRule.value,
    legacyWarning: ruleById('gst', 'gst.gstin.legacyWarning', onDate).value,
    caveat: ruleById('gst', 'gst.gstin.registrationCaveat', onDate).value || CAVEAT_FALLBACK,
    entityAlphabet: ruleById('gst', 'gst.gstin.entityAlphabet', onDate).value,
    markerRegular: ruleById('gst', 'gst.gstin.marker.regular', onDate).value,
    markerTds: ruleById('gst', 'gst.gstin.marker.tds', onDate).value,
    markerTcs: tcsRule.value,
    tcsRule,
    nrtpPrefix: ruleById('gst', 'gst.gstin.nrtpPrefix', onDate).value,
    nrtpSuffix: ruleById('gst', 'gst.gstin.nrtpSuffix', onDate).value,
    uinPattern: compileAnchored(ruleById('gst', 'gst.gstin.uinPattern', onDate).value, 'gst.gstin.uinPattern'),
    panPattern: compileAnchored(ruleById('ids', 'ids.pan.pattern', onDate).value, 'ids.pan.pattern'),
    tanPattern: compileAnchored(ruleById('ids', 'ids.tan.pattern', onDate).value, 'ids.tan.pattern'),
  };
}

function checksumParams() {
  const gst = loadDomain('gst');
  const value = ruleById('gst', 'gst.gstin.checksum', gst.asOf).value;
  return {
    alphabet: value.alphabet,
    radix: value.radix,
    oddWeight: value.oddWeight,
    evenWeight: value.evenWeight,
  };
}

function emptyResult(disclaimerText) {
  return {
    valid: false,
    normalized: '',
    type: 'unknown',
    stateCode: '',
    stateName: '',
    pan: null,
    tan: null,
    errors: [],
    warnings: [],
    confirm: false,
    disclaimer: disclaimerText,
  };
}

function containsBlocked(value) {
  for (const ch of value) {
    const cp = ch.codePointAt(0);
    if (ZERO_WIDTH.has(cp)) return true;
    if (cp >= 0x202a && cp <= 0x202e) return true;
    if (cp >= 0x2066 && cp <= 0x2069) return true;
  }
  return false;
}

function isSeparator(ch) {
  return ch === ' ' || ch === '-' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

function hasSeparator(value) {
  for (const ch of value) if (isSeparator(ch)) return true;
  return false;
}
