/**
 * TRAI DLT template linter. Operator limits are warnings with source "operator".
 * No network. Times are IST HH:MM strings, not Date parses of YYYY-MM-DD.
 */
import { disclaimer, CONFIRM_SENTENCE } from './_lib/disclaimer.mjs';
import { istDate, parseIsoDate } from './_lib/fy.mjs';
import { loadDomain, needsConfirm, ruleById } from './_lib/rules.mjs';
import { prepareText, usage } from './guard.mjs';

const CATEGORIES = new Map([
  ['transactional', 'transactional'],
  ['service-implicit', 'service-implicit'],
  ['service-explicit', 'service-explicit'],
  ['service_implicit', 'service-implicit'],
  ['service_explicit', 'service-explicit'],
  ['promotional', 'promotional'],
  ['government', 'government'],
]);

const VAR = '{#var#}';
const URL_PREFIXES = ['https://', 'http://', 'www.'];

/**
 * @param {object} input
 */
export function lintDlt(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw usage('Pass a JSON object.');
  const domain = loadDomain('trai');
  const asOf = input.asOf === undefined ? istDate() : input.asOf;
  if (typeof asOf !== 'string') throw usage('asOf must be YYYY-MM-DD.');
  try {
    parseIsoDate(asOf);
  } catch {
    throw usage('asOf must be a real YYYY-MM-DD date.');
  }

  const errors = [];
  const warnings = [];
  const used = [];
  const take = (id) => {
    const rule = ruleById('trai', id, asOf);
    used.push(rule);
    return rule;
  };

  const templatePrep = prepareText(input.template, 'template');
  const messagePrep = input.message === undefined ? null : prepareText(input.message, 'message');
  if (!templatePrep.ok) errors.push(issue('template', templatePrep.error, 'skill'));
  if (messagePrep && !messagePrep.ok) errors.push(issue('message', messagePrep.error, 'skill'));
  if (templatePrep.changed || messagePrep?.changed) {
    warnings.push(issue('normalised', 'Input was trimmed or NFKC-normalised.', 'skill'));
  }

  const category = normaliseCategory(input.category);
  if (!category) errors.push(issue('category', 'category must be transactional, service-implicit, service-explicit, promotional, or government.', 'skill'));

  const headerPrep = prepareText(input.header, 'header');
  if (!headerPrep.ok) errors.push(issue('header', headerPrep.error, 'skill'));
  const header = headerPrep.ok ? headerPrep.text.toUpperCase() : '';
  const template = templatePrep.ok ? templatePrep.text : '';
  const message = messagePrep && messagePrep.ok ? messagePrep.text : '';

  const tokenRule = take('trai.sms.variable.token');
  const maxCount = take('trai.sms.variable.max-count');
  const maxChars = take('trai.sms.variable.max-chars');
  const notLast = take('trai.sms.variable.not-last');
  const brandRule = take('trai.sms.brand.required');
  const urlRule = take('trai.sms.url.whitelist');
  const callbackRule = take('trai.sms.callback.whitelist');
  const chainRule = take('trai.sms.chain.reject');
  const lengthRule = take('trai.sms.header.length');
  const suffixRule = take('trai.sms.header.suffix');
  const minutesRule = take('trai.sms.category.transactional-minutes');
  const hoursRule = take('trai.sms.promotional.hours');
  const optOutRule = take('trai.sms.promotional.opt-out');
  const registeredRule = take('trai.sms.template.registered');

  if (templatePrep.ok && !template) errors.push(issue('template', 'template is empty.', 'skill'));
  if (headerPrep.ok && !header) errors.push(issue('header', 'header is empty.', 'skill'));

  if (template && header && category) {
    checkHeader(header, category, asOf, lengthRule, suffixRule, errors, warnings);
    checkRegistration(input, asOf, registeredRule, chainRule, errors, warnings);
    checkVariables(template, input.variables, tokenRule, maxCount, maxChars, notLast, messagePrep, message, errors, warnings);
    checkBrand(template, input.brandName, brandRule, errors);
    checkLinks(message || template, input.whitelist, input.callbackWhitelist, asOf, urlRule, callbackRule, errors, warnings);
    checkCategoryTiming(category, input, asOf, minutesRule, hoursRule, optOutRule, template, warnings);
  }

  const confirm = needsConfirm(used);
  if (confirm) warnings.push(issue('confirm', CONFIRM_SENTENCE, 'skill'));

  return {
    valid: errors.length === 0,
    asOf,
    rulesAsOf: domain.asOf,
    category: category ?? '',
    header,
    errors,
    warnings,
    confirm,
    disclaimer: disclaimer(domain.asOf),
  };
}

function checkHeader(header, category, asOf, lengthRule, suffixRule, errors, warnings) {
  if ([...header].length > lengthRule.value) {
    errors.push(issue('header-length', `Header is longer than ${lengthRule.value} characters.`, 'trai'));
  }
  if (!headerCharsOk(header)) {
    errors.push(issue('header-charset', 'Header must be letters and digits, with at most one hyphen.', 'trai'));
  }
  const suffix = suffixRule.value[category];
  const inForce = asOf >= suffixRule.value.enforceFrom;
  if (header.endsWith(suffix)) return;
  const text = `Header for ${category} uses suffix ${suffix}.`;
  if (inForce) errors.push(issue('header-suffix', text, 'trai'));
  else warnings.push(issue('header-suffix', `${text} That suffix is not in force until ${suffixRule.value.enforceFrom}.`, 'trai'));
}

function checkRegistration(input, asOf, registeredRule, chainRule, errors, warnings) {
  if (input.templateRegistered === false && asOf >= registeredRule.value.enforceFrom) {
    errors.push(issue('template-unregistered', 'Content templates must be registered on DLT.', 'trai'));
  } else if (input.templateRegistered !== true) {
    warnings.push(issue('template-unregistered', 'templateRegistered was not set. Commercial templates must be registered on DLT.', 'trai'));
  }
  if (input.chainRegistered === false && asOf >= chainRule.value.enforceFrom) {
    errors.push(issue('chain-unregistered', 'Unregistered PE-TM chains are rejected.', 'trai'));
  } else if (input.chainRegistered === false) {
    warnings.push(issue('chain-unregistered', `PE-TM chain rejection starts on ${chainRule.value.enforceFrom}.`, 'trai'));
  } else if (input.chainRegistered !== true) {
    warnings.push(issue('chain-unregistered', 'chainRegistered was not set. From 11 December 2024 an undeclared PE-TM chain is rejected.', 'trai'));
  }
}

function checkVariables(template, variables, tokenRule, maxCount, maxChars, notLast, messagePrep, message, errors, warnings) {
  if (tokenRule.value !== VAR) {
    warnings.push(issue('variable-token', `Rules file token is ${tokenRule.value}.`, 'operator'));
  }
  warnUnknownPlaceholders(template, warnings);
  const count = countToken(template, VAR);
  if (count > maxCount.value) {
    warnings.push(issue('variable-count', `Template has ${count} ${VAR} placeholders. Operator guidance allows ${maxCount.value}.`, 'operator'));
  }
  if (notLast.value === true && variableIsLastWord(template)) {
    warnings.push(issue('variable-last', `${VAR} is the last word of the template.`, 'operator'));
  }
  const values = variables === undefined ? [] : variables;
  if (variables !== undefined && !Array.isArray(values)) {
    errors.push(issue('variables', 'variables must be an array of strings.', 'skill'));
    return;
  }
  const rendered = renderTemplate(template, values.map((value) => (typeof value === 'string' ? value : '')));
  if (variables !== undefined && values.some((value) => typeof value !== 'string')) {
    errors.push(issue('variables', 'Each variable must be a string.', 'skill'));
  }
  if (rendered.error) errors.push(issue('variables', rendered.error, 'operator'));
  for (const value of values) {
    if (typeof value !== 'string') continue;
    if ([...value].length > maxChars.value) {
      warnings.push(issue('variable-length', `Variable is ${[...value].length} characters. Operator guidance allows ${maxChars.value}.`, 'operator'));
    }
  }
  if (messagePrep && messagePrep.ok) {
    if (!rendered.error && rendered.text !== message) {
      errors.push(issue('template-mismatch', 'Rendered message does not match the template exactly.', 'operator'));
    }
  } else if (messagePrep === null) {
    warnings.push(issue('template-mismatch', 'message was omitted, so the exact-match check was skipped.', 'operator'));
  }
}

function checkBrand(template, brandName, brandRule, errors) {
  if (brandRule.value !== true) return;
  if (typeof brandName !== 'string' || brandName.trim().length < 2) {
    errors.push(issue('brand', 'brandName is required in the template.', 'operator'));
    return;
  }
  if (!template.toLowerCase().includes(brandName.trim().toLowerCase())) {
    errors.push(issue('brand', 'Brand name is not present in the template.', 'operator'));
  }
}

function checkLinks(text, whitelist, callbackWhitelist, asOf, urlRule, callbackRule, errors, warnings) {
  const allowed = new Set(asStrings(whitelist).map((item) => item.toLowerCase()));
  const urls = findUrls(text);
  const urlInForce = asOf >= urlRule.value.enforceFrom;
  for (const url of urls) {
    const key = url.toLowerCase().replace(/\/$/, '');
    const listed = allowed.has(url.toLowerCase()) || allowed.has(key);
    if (listed) continue;
    const message = `URL is not in the whitelist set: ${url}`;
    if (urlInForce) errors.push(issue('url-not-whitelisted', message, 'trai'));
    else warnings.push(issue('url-not-whitelisted', `${message}. Whitelisting of URLs, APKs, and OTT links starts on ${urlRule.value.enforceFrom}.`, 'trai'));
  }
  const callbacks = findCallbacks(text, urlSpans(text));
  const allowedCallbacks = new Set(asStrings(callbackWhitelist).map(lastTen));
  for (const number of callbacks) {
    if (allowedCallbacks.has(number)) continue;
    warnings.push(issue(
      'callback-not-whitelisted',
      `Callback number ${number} is not in callbackWhitelist. Press release 53/2024 included callback numbers, but the 30 August 2024 direction deferred that date. 1 October 2024 is the URL, APK, and OTT date, not a confirmed callback reject date.`,
      'trai',
    ));
  }
}

function checkCategoryTiming(category, input, asOf, minutesRule, hoursRule, optOutRule, template, warnings) {
  if (category === 'transactional' && asOf >= minutesRule.value.enforceFrom && input.minutesSinceTransaction !== undefined) {
    const minutes = input.minutesSinceTransaction;
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 0) {
      warnings.push(issue('transactional-window', 'minutesSinceTransaction must be a non-negative integer.', 'skill'));
    } else if (minutes > minutesRule.value.minutes) {
      warnings.push(issue('transactional-window', `Transactional messages are limited to ${minutesRule.value.minutes} minutes after the customer-initiated transaction. Later notices are service messages.`, 'trai'));
    }
  }
  if (category !== 'promotional') return;
  const time = readIstTime(input);
  if (!time) {
    warnings.push(issue('promotional-hours', 'sentAtIst is missing, so the 10:00–21:00 IST default window was not checked.', 'skill'));
    return;
  }
  const start = hoursRule.value.start;
  const end = hoursRule.value.end;
  if (time < start || time >= end) {
    warnings.push(issue(
      'promotional-hours',
      `Promotional messages are restricted to ${start}–${end} IST by default. Schedule II marks the bands outside that window default OFF unless the recipient has switched them on. UNVERIFIED against the gazette imprint; the consolidated text says the gazette prevails.`,
      'trai',
    ));
  }
  if (optOutRule.value === true && asOf >= optOutRule.effectiveFrom && !hasOptOut(template)) {
    warnings.push(issue('promotional-opt-out', 'Promotional messages must give an opt-out in the same message, as specified by TRAI. No obvious opt-out text was found.', 'trai'));
  }
}

function normaliseCategory(value) {
  if (typeof value !== 'string') return '';
  return CATEGORIES.get(value.trim().toLowerCase()) ?? '';
}

function headerCharsOk(header) {
  let hyphens = 0;
  if (!header) return false;
  for (const char of header) {
    const ok = (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char === '-';
    if (!ok) return false;
    if (char === '-') hyphens += 1;
  }
  return hyphens <= 1 && !header.startsWith('-') && !header.endsWith('-');
}

function countToken(text, token) {
  let count = 0;
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf(token, i);
    if (at === -1) break;
    count += 1;
    i = at + token.length;
  }
  return count;
}

function variableIsLastWord(template) {
  const at = template.lastIndexOf(VAR);
  if (at === -1) return false;
  const after = template.slice(at + VAR.length);
  for (const char of after) {
    const lower = char.toLowerCase();
    if ((lower >= 'a' && lower <= 'z') || (char >= '0' && char <= '9')) return false;
  }
  return true;
}

function warnUnknownPlaceholders(template, warnings) {
  let i = 0;
  while (i < template.length) {
    const at = template.indexOf('{#', i);
    if (at === -1) break;
    if (!template.startsWith(VAR, at)) {
      warnings.push(issue('variable-token', 'A brace placeholder is not {#var#}. DLT portals treat only {#var#} as a variable.', 'operator'));
      return;
    }
    i = at + VAR.length;
  }
}

function renderTemplate(template, variables) {
  let out = '';
  let i = 0;
  let n = 0;
  while (i < template.length) {
    const at = template.indexOf(VAR, i);
    if (at === -1) {
      out += template.slice(i);
      break;
    }
    out += template.slice(i, at);
    if (n >= variables.length) return { error: 'The template has more {#var#} placeholders than values.' };
    out += variables[n];
    n += 1;
    i = at + VAR.length;
  }
  if (n !== variables.length) return { error: 'More variable values were passed than {#var#} placeholders.' };
  return { text: out };
}

function findUrls(text) {
  const urls = [];
  const lower = text.toLowerCase();
  let i = 0;
  while (i < lower.length) {
    let at = -1;
    for (const prefix of URL_PREFIXES) {
      const found = lower.indexOf(prefix, i);
      if (found !== -1 && (at === -1 || found < at)) at = found;
    }
    if (at === -1) break;
    let end = at;
    while (end < text.length && !isUrlStop(text[end])) end += 1;
    while (end > at && isUrlTrim(text[end - 1])) end -= 1;
    if (end > at) urls.push(text.slice(at, end));
    i = Math.max(end, at + 1);
  }
  return urls;
}

function urlSpans(text) {
  const spans = [];
  const lower = text.toLowerCase();
  let i = 0;
  while (i < lower.length) {
    let at = -1;
    for (const prefix of URL_PREFIXES) {
      const found = lower.indexOf(prefix, i);
      if (found !== -1 && (at === -1 || found < at)) at = found;
    }
    if (at === -1) break;
    let end = at;
    while (end < text.length && !isUrlStop(text[end])) end += 1;
    spans.push([at, end]);
    i = Math.max(end, at + 1);
  }
  return spans;
}

function findCallbacks(text, spans) {
  const found = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] < '0' || text[i] > '9') {
      i += 1;
      continue;
    }
    const start = i;
    let digits = '';
    while (i < text.length && text[i] >= '0' && text[i] <= '9') {
      digits += text[i];
      i += 1;
    }
    if (spans.some(([from, to]) => start >= from && start < to)) continue;
    const ten = callbackTen(digits);
    if (ten) found.push(ten);
  }
  return found;
}

function callbackTen(digits) {
  if (digits.length === 10 && digits[0] >= '6' && digits[0] <= '9') return digits;
  if (digits.length === 12 && digits.startsWith('91')) {
    const ten = digits.slice(2);
    if (ten[0] >= '6' && ten[0] <= '9') return ten;
  }
  return '';
}

function lastTen(value) {
  const digits = [...value].filter((char) => char >= '0' && char <= '9').join('');
  return callbackTen(digits) || digits;
}

function readIstTime(input) {
  if (typeof input.sentAtIst === 'string') return parseHm(input.sentAtIst.trim());
  if (typeof input.sentAt === 'string' && input.sentAt.includes('T') && input.sentAt.includes('+05:30')) {
    const clock = input.sentAt.split('T')[1]?.slice(0, 5);
    return parseHm(clock ?? '');
  }
  return '';
}

function parseHm(value) {
  if (value.length !== 5 || value[2] !== ':') return '';
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(3));
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return '';
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
  if (value !== `${pad(hour)}:${pad(minute)}`) return '';
  return value;
}

function hasOptOut(template) {
  const lower = template.toLowerCase();
  return ['stop', 'opt-out', 'opt out', 'unsubscribe', 'block'].some((word) => lower.includes(word));
}

function asStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string');
}

function issue(code, message, source) {
  return { code, message, source };
}

function isUrlStop(char) {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '<' || char === '>' || char === '"' || char === "'" || char === '`';
}

function isUrlTrim(char) {
  return char === '.' || char === ',' || char === ';' || char === ')' || char === ']';
}

function pad(n) {
  return String(n).padStart(2, '0');
}
