/**
 * MSG91 OTP request builder and a local review of OTP handling.
 * This module never calls the network and never prints an authkey or an OTP.
 */
import { disclaimer, CONFIRM_SENTENCE } from './_lib/disclaimer.mjs';
import { istDate, parseIsoDate } from './_lib/fy.mjs';
import { loadDomain, needsConfirm, ruleById } from './_lib/rules.mjs';
import { prepareText, usage } from './guard.mjs';

/**
 * @param {object} input
 */
export function buildOtpRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw usage('Pass a JSON object.');
  const asOf = readAsOf(input.asOf);
  const domain = loadDomain('trai');
  const used = [];
  const take = (id) => {
    const rule = ruleById('trai', id, asOf);
    used.push(rule);
    return rule;
  };
  const errors = [];
  const warnings = [];
  const urlRule = take('msg91.otp.url');
  const lengthRule = take('msg91.otp.length');
  const expiryRule = take('msg91.otp.expiry');
  const placeholder = take('msg91.otp.placeholder');

  const templateId = typeof input.templateId === 'string' ? input.templateId.trim() : '';
  if (!templateId || !identOk(templateId)) errors.push('templateId must be a non-empty token without spaces.');

  const mobilePrep = prepareText(input.mobile, 'mobile');
  let mobile = '';
  if (!mobilePrep.ok) errors.push(mobilePrep.error);
  else {
    mobile = digitsOnly(mobilePrep.text);
    if (mobile.length === 10 || mobile.length < 11 || mobile.length > 15 || mobile.startsWith('0')) {
      errors.push('mobile must include a country code. A 10-digit national number is not enough. Use 11 to 15 digits.');
    }
  }

  const length = integerField(input.otpLength, lengthRule.value.practice, 'otpLength', errors);
  const expiry = integerField(input.otpExpiryMinutes, expiryRule.value.practiceMax, 'otpExpiryMinutes', errors);
  if (length !== null && (length < lengthRule.value.min || length > lengthRule.value.max)) {
    errors.push(`otpLength must be ${lengthRule.value.min} to ${lengthRule.value.max} on MSG91.`);
  }
  if (expiry !== null && (expiry < expiryRule.value.min || expiry > expiryRule.value.max)) {
    errors.push(`otpExpiryMinutes must be ${expiryRule.value.min} to ${expiryRule.value.max} on MSG91.`);
  }
  if (length !== null && length !== lengthRule.value.practice) {
    warnings.push(`Skill practice is ${lengthRule.value.practice} digits from crypto.randomInt. MSG91's default is ${lengthRule.value.default}.`);
  }
  if (expiry !== null && (expiry < expiryRule.value.practiceMin || expiry > expiryRule.value.practiceMax)) {
    warnings.push(`Skill practice TTL is ${expiryRule.value.practiceMin} to ${expiryRule.value.practiceMax} minutes. MSG91's default is ${expiryRule.value.default} minutes.`);
  }
  warnings.push(`MSG91 defaults are ${lengthRule.value.default} digits and ${expiryRule.value.default} minutes. This skill's practice is ${lengthRule.value.practice} digits and ${expiryRule.value.practiceMin}–${expiryRule.value.practiceMax} minutes. The vendor figures are not a TRAI rule.`);

  if (input.template !== undefined) {
    const template = prepareText(input.template, 'template');
    if (!template.ok) errors.push(template.error);
    else if (!template.text.includes(placeholder.value)) {
      errors.push(`MSG91 OTP templates must contain ${placeholder.value}. That token is not the DLT placeholder {#var#}.`);
    }
  } else {
    warnings.push(`The OTP template registered in MSG91 must contain ${placeholder.value}.`);
  }

  if (input.otp !== undefined) {
    warnings.push('otp was ignored. Omit it so the code is not logged. MSG91 generates and stores it.');
  }

  const body = {};
  if (input.params !== undefined) {
    if (!input.params || typeof input.params !== 'object' || Array.isArray(input.params)) {
      errors.push('params must be an object of Param1, Param2, ... strings.');
    } else {
      for (const [key, value] of Object.entries(input.params)) {
        if (!isParamKey(key)) errors.push(`Unexpected body key ${key}. Use Param1, Param2, and so on.`);
        else if (typeof value !== 'string') errors.push(`${key} must be a string.`);
        else body[key] = value;
      }
    }
  }

  const confirm = needsConfirm(used);
  if (confirm) warnings.push(CONFIRM_SENTENCE);

  const payload = {
    valid: errors.length === 0,
    asOf,
    rulesAsOf: domain.asOf,
    method: 'POST',
    url: urlRule.value,
    query: {
      template_id: templateId,
      mobile,
      otp_length: length === null ? '' : String(length),
      otp_expiry: expiry === null ? '' : String(expiry),
    },
    headers: {
      authkey: input.authkey ? '<redacted>' : '<missing>',
      'Content-Type': 'application/json',
    },
    body,
    practice: {
      digits: lengthRule.value.practice,
      ttlMinutes: { min: expiryRule.value.practiceMin, max: expiryRule.value.practiceMax },
      generator: 'crypto.randomInt',
      neverLogOtp: true,
    },
    errors,
    warnings,
    confirm,
    disclaimer: disclaimer(domain.asOf),
  };
  if (typeof input.authkey === 'string' && input.authkey && JSON.stringify(payload).includes(input.authkey)) {
    throw usage('Refusing to print the authkey.');
  }
  return payload;
}

/**
 * @param {object} input
 */
export function reviewOtp(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw usage('Pass a JSON object.');
  const asOf = readAsOf(input.asOf);
  const domain = loadDomain('trai');
  const used = [];
  const take = (id) => {
    const rule = ruleById('trai', id, asOf);
    used.push(rule);
    return rule;
  };
  const lengthRule = take('msg91.otp.length');
  const expiryRule = take('msg91.otp.expiry');
  const attempts = take('otp.practice.attempt-limit');
  const errors = [];
  const warnings = [];
  const prepared = prepareText(input.code, 'code');
  if (!prepared.ok) {
    errors.push(prepared.error);
  } else {
    const code = prepared.text;
    if (code.includes('Math.random')) errors.push('Generate the OTP with crypto.randomInt, not Math.random.');
    if (!code.includes('randomInt')) warnings.push('OTP generation should call crypto.randomInt.');
    for (const line of code.split('\n')) {
      if (logsOtp(line)) errors.push('The OTP must never be logged.');
    }
    const ttl = assignedNumber(code, ['ttlMinutes', 'otpExpiryMinutes', 'otp_expiry', 'ttl']);
    if (ttl === null) warnings.push(`No TTL was found. Skill practice is ${expiryRule.value.practiceMin} to ${expiryRule.value.practiceMax} minutes.`);
    else if (ttl < expiryRule.value.practiceMin || ttl > expiryRule.value.practiceMax) {
      warnings.push(`TTL ${ttl} is outside the ${expiryRule.value.practiceMin}–${expiryRule.value.practiceMax} minute practice window.`);
    }
    const sixEvident = code.includes('1000000') || code.includes('1_000_000') || code.includes('otpLength = 6') || code.includes('otp_length = 6') || code.includes('otpLength: 6');
    if (!sixEvident) warnings.push(`A ${lengthRule.value.practice}-digit length is not evident.`);
    if ((code.includes('1000000') || code.includes('1_000_000')) && !code.includes('padStart')) {
      warnings.push('randomInt(0, 1000000) can be shorter than 6 digits. Pad the result to 6.');
    }
    const mentionsAttempts = code.includes('maxAttempts') || code.includes('attemptLimit') || code.toLowerCase().includes('attempts');
    if (!mentionsAttempts) {
      warnings.push(`No attempt limit was found. A local default of ${attempts.value} is UNVERIFIED and is not a TRAI figure.`);
    }
  }
  const confirm = needsConfirm(used);
  if (confirm) warnings.push(CONFIRM_SENTENCE);
  return {
    valid: errors.length === 0,
    asOf,
    rulesAsOf: domain.asOf,
    errors,
    warnings,
    confirm,
    disclaimer: disclaimer(domain.asOf),
  };
}

function readAsOf(value) {
  const asOf = value === undefined ? istDate() : value;
  if (typeof asOf !== 'string') throw usage('asOf must be YYYY-MM-DD.');
  try {
    parseIsoDate(asOf);
  } catch {
    throw usage('asOf must be a real YYYY-MM-DD date.');
  }
  return asOf;
}

function integerField(value, fallback, label, errors) {
  if (value === undefined) return fallback;
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && value && [...value].every((char) => char >= '0' && char <= '9')) return Number(value);
  errors.push(`${label} must be an integer.`);
  return null;
}

function digitsOnly(value) {
  return [...value].filter((char) => char >= '0' && char <= '9').join('');
}

function identOk(value) {
  if (value.length > 64) return false;
  for (const char of value) {
    const ok = (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char === '_' || char === '-';
    if (!ok) return false;
  }
  return true;
}

function isParamKey(key) {
  if (!key.startsWith('Param')) return false;
  const rest = key.slice('Param'.length);
  if (!rest) return false;
  for (const char of rest) {
    if (char < '0' || char > '9') return false;
  }
  return true;
}

function logsOtp(line) {
  const lower = line.toLowerCase();
  const logs = lower.includes('console.log') || lower.includes('console.debug') || lower.includes('console.info') || lower.includes('console.warn') || lower.includes('console.error') || lower.includes('logger.');
  if (!logs) return false;
  return hasWord(line, 'otp');
}

function hasWord(line, word) {
  const lower = line.toLowerCase();
  let i = 0;
  while (i < lower.length) {
    const at = lower.indexOf(word, i);
    if (at === -1) return false;
    const before = at === 0 ? '' : lower[at - 1];
    const after = at + word.length >= lower.length ? '' : lower[at + word.length];
    if (!isWord(before) && !isWord(after)) return true;
    i = at + word.length;
  }
  return false;
}

function assignedNumber(code, names) {
  for (const name of names) {
    const at = code.indexOf(name);
    if (at === -1) continue;
    let i = at + name.length;
    while (i < code.length && ' \t:='.includes(code[i])) i += 1;
    let num = '';
    while (i < code.length && code[i] >= '0' && code[i] <= '9') {
      num += code[i];
      i += 1;
    }
    if (num) return Number(num);
  }
  return null;
}

function isWord(char) {
  if (!char) return false;
  const lower = char.toLowerCase();
  return (lower >= 'a' && lower <= 'z') || (char >= '0' && char <= '9') || char === '_';
}
