/**
 * DPDP readiness checklist and personal-data field scanner.
 * Dates are YYYY-MM-DD. Day counts use a civil day number, never Date.parse
 * of a date-only string.
 */
import { disclaimer, CONFIRM_SENTENCE } from './_lib/disclaimer.mjs';
import { istDate, parseIsoDate } from './_lib/fy.mjs';
import { loadDomain, needsConfirm, ruleById } from './_lib/rules.mjs';
import { formatMoney, prepareText, usage } from './guard.mjs';

const ITEM_PREFIX = 'dpdp.item.';
const PHASE_PREFIX = 'dpdp.phase.';
const PENALTY_PREFIX = 'dpdp.penalty.';
const FIELD_PREFIX = 'dpdp.field.';

const SQL_TYPES = new Set([
  'int', 'integer', 'bigint', 'smallint', 'serial', 'bigserial',
  'varchar', 'char', 'text', 'boolean', 'bool', 'date', 'datetime',
  'timestamp', 'numeric', 'decimal', 'float', 'double', 'json', 'jsonb',
  'uuid', 'bytea', 'blob', 'clob', 'nvarchar', 'nchar', 'citext', 'string',
  'number', 'real',
]);

const SKIP_NAME = new Set([
  'model', 'enum', 'datasource', 'generator', 'type', 'import', 'export',
  'create', 'table', 'constraint', 'primary', 'foreign', 'key', 'unique',
  'index', 'references', 'not', 'null', 'default', 'alter', 'add', 'drop',
  'interface', 'class', 'function', 'const', 'let', 'var', 'return',
]);

const WORD_SUFFIX = new Set(['', 's', 'number', 'no', 'num', 'id', 'code', 'address']);

/**
 * @param {object|string} input
 */
export function checkDpdp(input) {
  const body = typeof input === 'string' ? { source: input } : input;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw usage('Pass a JSON object or a source string.');
  }
  const domain = loadDomain('dpdp');
  const asOf = body.asOf === undefined ? istDate() : body.asOf;
  if (typeof asOf !== 'string') throw usage('asOf must be YYYY-MM-DD.');
  try {
    parseIsoDate(asOf);
  } catch {
    throw usage('asOf must be a real YYYY-MM-DD date.');
  }

  const errors = [];
  const warnings = [];
  let sourceText = '';
  if (body.source !== undefined) {
    const prepared = prepareText(body.source, 'source');
    if (!prepared.ok) errors.push(prepared.error);
    else {
      sourceText = prepared.text;
      if (prepared.changed) warnings.push('Input was trimmed or NFKC-normalised.');
    }
  }
  const columns = readColumns(body.columns, errors);
  const kind = body.kind === undefined ? 'auto' : body.kind;
  if (!['auto', 'prisma', 'sql', 'ts'].includes(kind)) {
    throw usage('kind must be auto, prisma, sql, or ts.');
  }

  const used = [];
  const phases = phaseRows(asOf, used);
  const checklist = itemRows(asOf, used);
  const penalties = penaltyRows(asOf, used);
  const facts = factRows(asOf, used);
  const findings = errors.length > 0 ? [] : scan(sourceText, columns, kind, asOf, used);

  const confirm = needsConfirm(used);
  if (confirm) warnings.push(CONFIRM_SENTENCE);

  const high = findings.filter((finding) => finding.severity === 'high');
  const payload = {
    valid: errors.length === 0 && high.length === 0,
    asOf,
    rulesAsOf: domain.asOf,
    phases,
    checklist,
    penalties,
    facts,
    findings,
    errors,
    warnings,
    confirm,
    disclaimer: disclaimer(domain.asOf),
  };
  payload.markdown = renderMarkdown(payload);
  return payload;
}

/** Gregorian civil day count. Difference is the number of midnights between two dates. */
export function civilDayNumber(iso) {
  const { y, m, d } = parseIsoDate(iso);
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

export function daysUntil(onDate, commencement) {
  return civilDayNumber(commencement) - civilDayNumber(onDate);
}

export function inForcePhrase(label, commencement, onDate) {
  const delta = daysUntil(onDate, commencement);
  if (delta > 0) return `${label} in force in ${delta} days`;
  if (delta === 0) return `${label} in force`;
  return `${label} in force since ${commencement}`;
}

/** @param {string} name */
export function identifierWords(name) {
  const parts = [];
  let cur = '';
  const chars = [...name.normalize('NFKC')];
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i];
    const isUpper = c >= 'A' && c <= 'Z';
    const isLower = c >= 'a' && c <= 'z';
    const isDigit = c >= '0' && c <= '9';
    if (!isUpper && !isLower && !isDigit) {
      if (cur) parts.push(cur);
      cur = '';
      continue;
    }
    const prev = i > 0 ? chars[i - 1] : '';
    const next = i + 1 < chars.length ? chars[i + 1] : '';
    const prevLower = prev >= 'a' && prev <= 'z';
    const prevUpper = prev >= 'A' && prev <= 'Z';
    const nextLower = next >= 'a' && next <= 'z';
    if (cur && isUpper && (prevLower || (prevUpper && nextLower && cur.length > 1))) {
      parts.push(cur);
      cur = c;
      continue;
    }
    cur += c;
  }
  if (cur) parts.push(cur);
  return parts.map((part) => part.toLowerCase());
}

function phaseRows(asOf, used) {
  return rowsWithPrefix(PHASE_PREFIX, asOf, used).map((rule) => ({
    id: rule.id,
    label: rule.value.label,
    commencement: rule.value.commencement,
    summary: rule.value.summary,
    phrase: inForcePhrase(rule.value.label, rule.value.commencement, asOf),
    inForce: daysUntil(asOf, rule.value.commencement) <= 0,
    verified: rule.verified,
  }));
}

function itemRows(asOf, used) {
  return rowsWithPrefix(ITEM_PREFIX, asOf, used).map((rule) => {
    const penalty = ruleById('dpdp', rule.value.penaltyId, asOf);
    used.push(penalty);
    const delta = daysUntil(asOf, rule.value.commencement);
    return {
      id: rule.id,
      title: rule.value.title,
      act: rule.value.act,
      rules: rule.value.rules,
      commencement: rule.value.commencement,
      status: delta > 0 ? 'not-yet-in-force' : 'in-force',
      phrase: inForcePhrase(rule.value.title, rule.value.commencement, asOf),
      penalty: formatMoney(penalty),
      penaltySection: penalty.value.section,
      note: rule.note,
      verified: rule.verified,
    };
  });
}

function penaltyRows(asOf, used) {
  return rowsWithPrefix(PENALTY_PREFIX, asOf, used).map((rule) => ({
    id: rule.id,
    label: rule.value.label,
    section: rule.value.section,
    maximum: formatMoney(rule),
    verified: rule.verified,
    note: rule.note,
  }));
}

function factRows(asOf, used) {
  const take = (id) => {
    const rule = ruleById('dpdp', id, asOf);
    used.push(rule);
    return rule;
  };
  const threshold = take('dpdp.retention.user-threshold');
  return {
    childYears: take('dpdp.child.age').value,
    breachBoardHours: take('dpdp.breach.board.hours').value,
    grievanceDays: take('dpdp.grievance.days').value,
    retentionPurposeYears: take('dpdp.retention.purpose.years').value,
    retentionLogYears: take('dpdp.retention.logs.years').value,
    erasureNoticeHours: take('dpdp.retention.notice.hours').value,
    sdfAuditMonths: take('dpdp.sdf.audit.months').value,
    consentManagerNetWorth: formatMoney(take('dpdp.consent-manager.net-worth')),
    userThreshold: threshold.value,
    userThresholdVerified: threshold.verified,
  };
}

function scan(sourceText, columns, kind, asOf, used) {
  const fields = rowsWithPrefix(FIELD_PREFIX, asOf, used);
  const candidates = [];
  if (sourceText) {
    const cleaned = stripComments(sourceText);
    if (kind === 'auto' || kind === 'prisma') candidates.push(...prismaNames(cleaned));
    if (kind === 'auto' || kind === 'sql') candidates.push(...sqlNames(cleaned));
    if (kind === 'auto' || kind === 'ts') candidates.push(...tsNames(cleaned));
    candidates.push(...quotedNames(cleaned));
  }
  for (const name of columns) {
    candidates.push({ name, line: null, where: 'column' });
  }
  const findings = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const words = identifierWords(candidate.name);
    for (const field of fields) {
      if (!fieldMatches(words, field.value)) continue;
      const key = `${candidate.line}:${candidate.name}:${field.value.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        name: safeLabel(candidate.name),
        line: candidate.line,
        where: candidate.where,
        kind: field.value.kind,
        severity: field.value.severity,
        items: field.value.items.map((token) => `${ITEM_PREFIX}${token}`),
        verified: field.verified,
      });
    }
  }
  findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
  return findings;
}

function fieldMatches(words, spec) {
  const joined = words.join(' ');
  const compact = words.join('');
  for (const phrase of spec.phrases ?? []) {
    if (joined.includes(phrase) || compact === phrase.replaceAll(' ', '')) return true;
  }
  for (const token of spec.words ?? []) {
    const needle = token.toLowerCase();
    for (const word of words) {
      if (word === needle) return true;
      if (word.startsWith(needle) && WORD_SUFFIX.has(word.slice(needle.length))) return true;
    }
  }
  return false;
}

function prismaNames(source) {
  const found = [];
  source.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('@@') || trimmed.startsWith('@')) return;
    if (trimmed.includes(':') || trimmed.includes('(')) return;
    const name = leadingIdent(trimmed);
    if (!name || SKIP_NAME.has(name.toLowerCase())) return;
    const rest = trimmed.slice(name.length).trim();
    const typeName = leadingIdent(rest);
    if (!typeName) return;
    found.push({ name, line: index + 1, where: 'prisma' });
  });
  return found;
}

function sqlNames(source) {
  const found = [];
  source.split('\n').forEach((line, index) => {
    const trimmed = line.trim().replace(/,$/, '');
    const name = leadingIdent(trimmed);
    if (!name || SKIP_NAME.has(name.toLowerCase())) return;
    const rest = trimmed.slice(name.length).trim();
    const typeName = leadingIdent(rest).toLowerCase();
    if (!SQL_TYPES.has(typeName)) return;
    found.push({ name, line: index + 1, where: 'sql' });
  });
  return found;
}

function tsNames(source) {
  const found = [];
  source.split('\n').forEach((line, index) => {
    let trimmed = line.trim();
    if (trimmed.startsWith('readonly ')) trimmed = trimmed.slice('readonly '.length).trim();
    const name = leadingIdent(trimmed);
    if (!name || SKIP_NAME.has(name.toLowerCase())) return;
    let rest = trimmed.slice(name.length).trim();
    if (rest.startsWith('?')) rest = rest.slice(1).trim();
    if (!rest.startsWith(':')) return;
    found.push({ name, line: index + 1, where: 'ts' });
  });
  return found;
}

function quotedNames(source) {
  const found = [];
  const lines = source.split('\n');
  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li];
    let i = 0;
    while (i < line.length) {
      const quote = line[i];
      if (quote !== '"' && quote !== "'" && quote !== '`') {
        i += 1;
        continue;
      }
      let j = i + 1;
      let body = '';
      while (j < line.length && line[j] !== quote) {
        body += line[j];
        j += 1;
      }
      if (j < line.length && isIdent(body)) found.push({ name: body, line: li + 1, where: 'quoted' });
      i = j + 1;
    }
  }
  return found;
}

function rowsWithPrefix(prefix, asOf, used) {
  return loadDomain('dpdp').rules.filter((rule) => rule.id.startsWith(prefix)).map((rule) => {
    const live = ruleById('dpdp', rule.id, asOf);
    used.push(live);
    return live;
  });
}

function readColumns(value, errors) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push('columns must be an array of strings.');
    return [];
  }
  const names = [];
  for (const item of value) {
    const prepared = prepareText(item, 'column');
    if (!prepared.ok) errors.push(prepared.error);
    else if (prepared.text) names.push(prepared.text);
  }
  return names;
}

function renderMarkdown(payload) {
  const lines = [
    '# DPDP readiness checklist',
    '',
    `As of ${payload.asOf}. Rules data as of ${payload.rulesAsOf}.`,
    '',
    '## Phased commencement',
    '',
  ];
  for (const phase of payload.phases) {
    lines.push(`- ${phase.phrase}. ${phase.summary}`);
  }
  lines.push('', '## Checklist', '');
  for (const item of payload.checklist) {
    lines.push(`### ${item.title}`);
    lines.push('');
    lines.push(`- Status: ${item.phrase}.`);
    lines.push(`- Act sections: ${item.act.join(', ')}. Rules: ${item.rules.join(', ')}.`);
    lines.push(`- Schedule maximum if this duty is breached: ${item.penalty} (section ${item.penaltySection}).`);
    lines.push(`- ${item.note}`);
    lines.push('');
  }
  lines.push('## Facts used from the rules file', '');
  lines.push(`- Child: has not completed ${payload.facts.childYears} years.`);
  lines.push(`- Breach report to the Board: ${payload.facts.breachBoardHours} hours for the detailed report. The first intimation is without delay.`);
  lines.push(`- Grievance response: a reasonable period not exceeding ${payload.facts.grievanceDays} days.`);
  lines.push(`- Third Schedule deemed period: ${payload.facts.retentionPurposeYears} years. Minimum logs: ${payload.facts.retentionLogYears} year. Erasure warning: ${payload.facts.erasureNoticeHours} hours.`);
  lines.push(`- Significant Data Fiduciary audit and DPIA: every ${payload.facts.sdfAuditMonths} months.`);
  lines.push(`- Consent Manager net worth: not less than ${payload.facts.consentManagerNetWorth}.`);
  const users = payload.facts.userThreshold;
  lines.push(`- Third Schedule user counts (${payload.facts.userThresholdVerified ? 'verified' : 'UNVERIFIED'}): comparator ${users.comparator}, e-commerce ${users.ecommerceUsers}, online gaming ${users.gamingUsers}, social media ${users.socialUsers}.`);
  lines.push('', '## Schedule penalties (maximum)', '');
  for (const penalty of payload.penalties) {
    lines.push(`- ${penalty.label} (section ${penalty.section}): ${penalty.maximum}.`);
  }
  lines.push('', '## Personal-data findings', '');
  if (payload.findings.length === 0) lines.push('No personal-data field names found.');
  for (const finding of payload.findings) {
    const at = finding.line === null ? 'column list' : `line ${finding.line}`;
    lines.push(`- \`${finding.name}\` (${finding.kind}, ${finding.severity}, ${finding.where}, ${at}) triggers ${finding.items.join(', ')}.`);
  }
  if (payload.errors.length > 0) {
    lines.push('', '## Errors', '');
    for (const error of payload.errors) lines.push(`- ${error}`);
  }
  lines.push('', '## Disclaimer', '', payload.disclaimer);
  if (payload.confirm) lines.push('', payload.warnings.find((warning) => warning === CONFIRM_SENTENCE) ?? CONFIRM_SENTENCE);
  return lines.join('\n');
}

function stripComments(source) {
  let out = '';
  let i = 0;
  let block = false;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (block) {
      if (two === '*/') {
        block = false;
        out += ' ';
        i += 2;
      } else {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }
    if (two === '/*') {
      block = true;
      i += 2;
      continue;
    }
    if (two === '//' || two === '--') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

function safeLabel(name) {
  const cleaned = String(name).replace(/[^A-Za-z0-9_]/g, '').slice(0, 64);
  return cleaned || 'field';
}

function leadingIdent(text) {
  let i = 0;
  if (i < text.length && isIdentStart(text[i])) {
    i += 1;
    while (i < text.length && isIdentPart(text[i])) i += 1;
    return text.slice(0, i);
  }
  return '';
}

function isIdent(value) {
  if (!value || !isIdentStart(value[0])) return false;
  for (let i = 1; i < value.length; i += 1) {
    if (!isIdentPart(value[i])) return false;
  }
  return true;
}

function isIdentStart(char) {
  return (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || char === '_';
}

function isIdentPart(char) {
  return isIdentStart(char) || (char >= '0' && char <= '9');
}
