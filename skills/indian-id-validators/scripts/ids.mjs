/**
 * Format checks for PAN, TAN, IFSC, PIN, and Indian mobile numbers.
 * A matching pattern does not mean the ID was issued or that a branch is live.
 */
import { CONFIRM_SENTENCE, disclaimer } from './_lib/disclaimer.mjs';
import { compileAnchored, loadDomain, needsConfirm, ruleById } from './_lib/rules.mjs';
import { prepare } from './sanitize.mjs';

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export function validatePan(input, options = {}) {
  const { date, text } = context(options);
  const shell = {
    valid: false,
    normalized: '',
    holderType: '',
    holderName: '',
    nameInitial: '',
    checkDigitChecked: false,
    errors: [],
    warnings: [],
    confirm: false,
    disclaimer: text,
  };
  const prepared = prepare(input, { uppercase: true });
  if (prepared.error) return { ...shell, errors: [prepared.error] };
  const patternRule = ruleById('ids', 'ids.pan.pattern', date);
  const holders = ruleById('ids', 'ids.pan.holderTypes', date);
  const check = ruleById('ids', 'ids.pan.checkDigit', date);
  const pattern = compileAnchored(patternRule.value, patternRule.id);
  const warnings = prepared.warnings.slice();
  const cleaned = prepared.cleaned;
  if (cleaned.length === 0) return { ...shell, warnings, errors: ['PAN is empty.'] };

  const errors = [];
  if (!isAzNum(cleaned)) {
    errors.push('PAN contains a character outside 0-9 and A-Z (Unicode look-alikes are rejected).');
    return finish(shell, { warnings, errors, confirm: false });
  }
  const shaped = panShape(cleaned);
  if (!shaped) {
    errors.push('PAN must be 10 characters: five letters, four digits, and a letter.');
  } else if (!pattern.test(cleaned)) {
    const allowed = Object.keys(holders.value).sort().join('');
    errors.push(`Holder type ${cleaned[3]} is not one of ${allowed}.`);
  }
  const confirm = needsConfirm([patternRule, holders, check]);
  pushConfirm(warnings, confirm);
  return finish(shell, {
    valid: errors.length === 0,
    normalized: cleaned,
    holderType: shaped ? cleaned[3] : '',
    holderName: shaped ? holders.value[cleaned[3]] ?? '' : '',
    nameInitial: shaped ? cleaned[4] : '',
    checkDigitChecked: check.value === 'checked',
    errors,
    warnings,
    confirm,
  });
}

export function validateTan(input, options = {}) {
  const { date, text } = context(options);
  const shell = {
    valid: false,
    normalized: '',
    jurisdiction: '',
    nameInitial: '',
    serial: '',
    checkDigitChecked: false,
    errors: [],
    warnings: [],
    confirm: false,
    disclaimer: text,
  };
  const prepared = prepare(input, { uppercase: true });
  if (prepared.error) return { ...shell, errors: [prepared.error] };
  const patternRule = ruleById('ids', 'ids.tan.pattern', date);
  const layout = ruleById('ids', 'ids.tan.layout', date).value;
  const check = ruleById('ids', 'ids.tan.checkDigit', date);
  const pattern = compileAnchored(patternRule.value, patternRule.id);
  const warnings = prepared.warnings.slice();
  const cleaned = prepared.cleaned;
  if (cleaned.length === 0) return { ...shell, warnings, errors: ['TAN is empty.'] };
  const errors = [];
  if (!isAzNum(cleaned)) {
    errors.push('TAN contains a character outside 0-9 and A-Z (Unicode look-alikes are rejected).');
    return finish(shell, { warnings, errors });
  }
  if (!pattern.test(cleaned)) errors.push('TAN must be 4 letters, 5 digits, and a letter.');
  const confirm = needsConfirm([patternRule, check]);
  pushConfirm(warnings, confirm);
  const parts = pattern.test(cleaned) ? splitTan(cleaned, layout) : emptyTanParts();
  return finish(shell, {
    valid: errors.length === 0,
    normalized: cleaned,
    ...parts,
    checkDigitChecked: check.value === 'checked',
    errors,
    warnings,
    confirm,
  });
}

export function validateIfsc(input, options = {}) {
  const { date, text } = context(options);
  const caveat = ruleById('ids', 'ids.ifsc.caveat', date);
  const shell = {
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
    errors: [],
    warnings: [],
    confirm: false,
    disclaimer: text,
  };
  const prepared = prepare(input, { uppercase: true });
  if (prepared.error) return { ...shell, errors: [prepared.error] };
  const patternRule = ruleById('ids', 'ids.ifsc.pattern', date);
  const layout = ruleById('ids', 'ids.ifsc.layout', date).value;
  const pattern = compileAnchored(patternRule.value, patternRule.id);
  const warnings = prepared.warnings.slice();
  const cleaned = prepared.cleaned;
  if (cleaned.length === 0) return { ...shell, warnings, errors: ['IFSC is empty.'] };
  const errors = [];
  if (!isAzNum(cleaned)) {
    errors.push('IFSC contains a character outside 0-9 and A-Z (Unicode look-alikes are rejected).');
    return finish(shell, { warnings, errors });
  }
  if (!pattern.test(cleaned)) {
    if (cleaned.length === 11 && cleaned[layout.bank] !== layout.reserved) {
      errors.push('The 5th character of an IFSC must be 0.');
    } else {
      errors.push('IFSC must be 4 letters, then 0, then 6 letters or digits.');
    }
  }
  const formatValid = errors.length === 0;
  if (formatValid) warnings.push(caveat.value);
  const confirm = needsConfirm([patternRule, caveat]);
  pushConfirm(warnings, confirm);
  return finish(shell, {
    valid: formatValid,
    normalized: cleaned,
    bankCode: formatValid ? cleaned.slice(0, layout.bank) : '',
    branchCode: formatValid ? cleaned.slice(cleaned.length - layout.branch) : '',
    formatValid,
    errors,
    warnings,
    confirm,
  });
}

export function validatePin(input, options = {}) {
  const { date, text } = context(options);
  const shell = {
    valid: false,
    normalized: '',
    prefix: '',
    zoneDigit: '',
    zone: '',
    states: [],
    stateCode: '',
    stateMatch: 'not-checked',
    errors: [],
    warnings: [],
    confirm: false,
    disclaimer: text,
  };
  const prepared = prepare(input, { uppercase: false });
  if (prepared.error) return { ...shell, errors: [prepared.error] };
  const patternRule = ruleById('ids', 'ids.pin.pattern', date);
  const zoneRule = ruleById('ids', 'ids.pin.zones', date);
  const rangeRule = ruleById('ids', 'ids.pin.stateRanges', date);
  const pattern = compileAnchored(patternRule.value, patternRule.id);
  const warnings = prepared.warnings.slice();
  const cleaned = prepared.cleaned;
  if (cleaned.length === 0) return { ...shell, warnings, errors: ['PIN is empty.'] };
  if (!pattern.test(cleaned)) {
    return finish(shell, {
      warnings,
      errors: ['PIN must be 6 digits and the first digit cannot be 0.'],
      confirm: needsConfirm([patternRule]),
    });
  }

  const prefixNumber = Number(cleaned.slice(0, 3));
  const zoneDigit = cleaned[0];
  const zone = zoneName(zoneDigit, zoneRule.value);
  const listed = statesFor(prefixNumber, rangeRule.value);
  const claimed = normaliseState(options.stateCode, rangeRule.value);
  const warningsOut = warnings.slice();
  let stateMatch = 'not-checked';
  if (needsConfirm(zoneRule)) {
    warningsOut.push(`First-digit zone "${zone}" is UNVERIFIED. ${CONFIRM_SENTENCE}`);
  }
  if (claimed.provided) {
    const cross = crossCheck(cleaned.slice(0, 3), claimed, listed);
    stateMatch = cross.stateMatch;
    warningsOut.push(...cross.warnings);
  }
  const applied = [patternRule, zoneRule, rangeRule];
  const confirm = needsConfirm(applied);
  pushConfirm(warningsOut, confirm);
  return finish(shell, {
    valid: true,
    normalized: cleaned,
    prefix: cleaned.slice(0, 3),
    zoneDigit,
    zone,
    states: listed.map(presentState),
    stateCode: claimed.provided ? claimed.code : '',
    stateMatch,
    warnings: warningsOut,
    confirm,
  });
}

export function validateMobile(input, options = {}) {
  const { date, text } = context(options);
  const shell = {
    valid: false,
    normalized: '',
    e164: '',
    errors: [],
    warnings: [],
    confirm: false,
    disclaimer: text,
  };
  const prepared = prepare(input, { uppercase: false });
  if (prepared.error) return { ...shell, errors: [prepared.error] };
  const country = ruleById('ids', 'ids.mobile.countryCode', date);
  const trunk = ruleById('ids', 'ids.mobile.trunkPrefix', date);
  const lengthRule = ruleById('ids', 'ids.mobile.nsnLength', date);
  const patternRule = ruleById('ids', 'ids.mobile.pattern', date);
  const tollRule = ruleById('ids', 'ids.mobile.tollFreePrefix', date);
  const pattern = compileAnchored(patternRule.value, patternRule.id);
  const warnings = prepared.warnings.slice();
  const cleaned = prepared.cleaned;
  if (cleaned.length === 0) return { ...shell, warnings, errors: ['Mobile number is empty.'] };
  if (!/^\+?[0-9]+$/.test(cleaned)) {
    return finish(shell, {
      warnings,
      errors: ['Mobile number contains a character that is not a digit or a leading +.'],
    });
  }

  const stripped = stripPrefix(cleaned, country.value, trunk.value, lengthRule.value);
  if (stripped.error) return finish(shell, { warnings, errors: [stripped.error] });
  const body = stripped.body;
  if (body.startsWith(tollRule.value) || cleaned.replace(/^\+/, '').startsWith(tollRule.value)) {
    const confirm = needsConfirm(tollRule);
    warnings.push(
      `Numbers beginning with ${tollRule.value} are treated as toll-free and rejected. That prefix is UNVERIFIED.`,
    );
    return finish(shell, { normalized: body, warnings, errors: ['Toll-free numbers are not mobile numbers.'], confirm });
  }
  if (body.length !== lengthRule.value) {
    return finish(shell, {
      normalized: '',
      warnings,
      errors: [
        `A mobile number is ${lengthRule.value} digits after removing +${country.value}, ${country.value}, or a single leading ${trunk.value}.`,
      ],
      confirm: needsConfirm([country, trunk, lengthRule]),
    });
  }
  if (!pattern.test(body)) {
    const confirm = needsConfirm(patternRule);
    const landline = stripped.sawTrunk
      ? ' After the trunk prefix this is not a mobile number. Landlines are rejected.'
      : '';
    return finish(shell, {
      normalized: body,
      warnings,
      errors: [`Not a mobile number. The core must match ${patternRule.value}.${landline}`],
      confirm,
    });
  }
  const confirm = needsConfirm(patternRule);
  if (confirm) {
    warnings.push(`The mobile pattern ${patternRule.value} is UNVERIFIED. ${CONFIRM_SENTENCE}`);
  }
  return finish(shell, {
    valid: true,
    normalized: body,
    e164: `+${country.value}${body}`,
    warnings,
    confirm,
  });
}

function stripPrefix(cleaned, country, trunk, nsnLength) {
  let body = cleaned;
  let sawTrunk = false;
  if (body.startsWith('+')) {
    const prefix = `+${country}`;
    if (!body.startsWith(prefix)) {
      return { error: `Only the India prefix +${country}, ${country}, or trunk ${trunk} is accepted.` };
    }
    body = body.slice(prefix.length);
    if (body.startsWith(trunk)) {
      sawTrunk = true;
      body = body.slice(trunk.length);
    }
    return { body, sawTrunk };
  }
  if (body.startsWith(trunk)) {
    sawTrunk = true;
    body = body.slice(trunk.length);
    if (body.startsWith(country) && body.length === country.length + nsnLength) {
      body = body.slice(country.length);
    }
    return { body, sawTrunk };
  }
  if (body.startsWith(country) && body.length === country.length + nsnLength) {
    body = body.slice(country.length);
  }
  return { body, sawTrunk };
}

function crossCheck(prefix, claimed, listed) {
  if (!claimed.known) {
    return {
      stateMatch: 'unknown-state',
      warnings: [`State code ${claimed.code} is not in the e-invoice MasterCodes PIN table. The PIN format was still checked.`],
    };
  }
  const names = listed.map((state) => `${state.code} ${state.name}`).join(', ');
  const hit = listed.some((state) => state.code === claimed.code);
  if (!hit) {
    const where = listed.length === 0 ? 'no listed state' : names;
    return {
      stateMatch: 'mismatch',
      warnings: [
        `PIN prefix ${prefix} is not in the MasterCodes range for state ${claimed.code} ${claimed.name}. It is listed for ${where}. A mismatch is only a warning.`,
      ],
    };
  }
  if (listed.length > 1) {
    return {
      stateMatch: 'shared',
      warnings: [
        `PIN prefix ${prefix} is shared by ${names}. A match is not proof of the state.`,
      ],
    };
  }
  return { stateMatch: 'match', warnings: [] };
}

function statesFor(prefix, states) {
  return states.filter((state) =>
    state.ranges.some((range) => prefix >= range[0] && prefix <= range[1]),
  );
}

function presentState(state) {
  return { code: state.code, name: state.name };
}

function normaliseState(input, states) {
  if (input === undefined || input === null || input === '') return { provided: false, code: '', known: false, name: '' };
  const raw = String(input).trim();
  if (!/^[0-9]{1,2}$/.test(raw)) return { provided: true, code: raw, known: false, name: '' };
  const code = raw.padStart(2, '0');
  const found = states.find((state) => state.code === code);
  return { provided: true, code, known: Boolean(found), name: found?.name ?? '' };
}

function zoneName(digit, zones) {
  for (const row of zones) {
    if (row.digits.includes(digit)) return row.zone;
  }
  return '';
}

function splitTan(cleaned, layout) {
  const at = layout.jurisdiction;
  const serialAt = at + layout.nameInitial;
  return {
    jurisdiction: cleaned.slice(0, at),
    nameInitial: cleaned.slice(at, serialAt),
    serial: cleaned.slice(serialAt, serialAt + layout.serial),
  };
}

function emptyTanParts() {
  return { jurisdiction: '', nameInitial: '', serial: '' };
}

function panShape(cleaned) {
  if (cleaned.length !== 10) return false;
  for (let i = 0; i < cleaned.length; i += 1) {
    const letter = cleaned[i] >= 'A' && cleaned[i] <= 'Z';
    const digit = cleaned[i] >= '0' && cleaned[i] <= '9';
    if (i < 5 || i === 9) {
      if (!letter) return false;
    } else if (!digit) return false;
  }
  return true;
}

function isAzNum(value) {
  for (const ch of value) {
    const letter = ch >= 'A' && ch <= 'Z';
    const digit = ch >= '0' && ch <= '9';
    if (!letter && !digit) return false;
  }
  return true;
}

function context(options) {
  const domain = loadDomain('ids');
  const date = typeof options === 'string' ? options : options.onDate ?? domain.asOf;
  if (!DATE.test(date)) throw new TypeError('onDate must be YYYY-MM-DD');
  return { date, text: disclaimer(date) };
}

function pushConfirm(warnings, confirm) {
  if (confirm && !warnings.some((warning) => warning.includes(CONFIRM_SENTENCE))) {
    warnings.push(CONFIRM_SENTENCE);
  }
}

function finish(shell, fields) {
  const confirm = fields.confirm === true;
  const warnings = fields.warnings ?? [];
  if (confirm) pushConfirm(warnings, true);
  return { ...shell, ...fields, warnings, confirm };
}
