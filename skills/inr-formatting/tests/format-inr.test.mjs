import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CONFIRM_SENTENCE } from '../scripts/_lib/disclaimer.mjs';
import { compact, formatINR, reportInr, toWords } from '../scripts/format-inr.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(here, '..');
const repoRoot = join(here, '..', '..', '..');
const BIG = 12345678901234567890n;
const WORDS_12_CRORE = 'Rupees Twelve Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine and Fifty Paise Only';
const WORDS_BIG = 'Rupees One Thousand Two Hundred Thirty-Four Crore Fifty-Six Lakh Seventy-Eight Thousand Nine Hundred One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight and Ninety Paise Only';

describe('SPEC vectors', () => {
  test('zero, one lakh, one crore, and the paise sentence', () => {
    assert.equal(formatINR('0'), '₹0.00');
    assert.equal(toWords('0'), 'Rupees Zero Only');
    assert.equal(formatINR(0n), '₹0.00');

    assert.equal(formatINR('100000'), '₹1,00,000.00');
    assert.equal(toWords('100000'), 'Rupees One Lakh Only');
    assert.equal(compact('100000'), '1 L');

    assert.equal(formatINR('10000000'), '₹1,00,00,000.00');
    assert.equal(toWords('10000000'), 'Rupees One Crore Only');
    assert.equal(compact('10000000'), '1 Cr');

    assert.equal(formatINR('123456789.50'), '₹12,34,56,789.50');
    assert.equal(toWords('123456789.50'), WORDS_12_CRORE);
    assert.equal(compact('123456789.50'), '12.35 Cr');
  });

  test('short forms and a value past crore of crore', () => {
    assert.equal(compact('120000'), '1.2 L');
    assert.equal(compact('12000000'), '1.2 Cr');
    assert.equal(compact('100500'), '1.01 L');
    assert.equal(compact('-120000'), '-1.2 L');

    const big = reportInr(BIG);
    assert.equal(big.valid, true);
    assert.equal(big.formatted, '₹1,23,45,67,89,01,23,45,678.90');
    assert.equal(big.words, WORDS_BIG);
    assert.equal(big.compact, '1,234.57 Cr Cr');
    assert.equal(big.confirm, true);
    assert.ok(big.warnings.includes(CONFIRM_SENTENCE));
    assert.ok(big.warnings.some((warning) => warning.includes('Arab is not used')));
    assert.equal(toWords('100000000000000'), 'Rupees One Crore Crore Only');
    assert.equal(toWords('1000000000'), 'Rupees One Hundred Crore Only');
    assert.equal(toWords('10000000000'), 'Rupees One Thousand Crore Only');
    assert.equal(toWords('1000000000000'), 'Rupees One Lakh Crore Only');
  });

  test('negatives, accounting parentheses, and display flags', () => {
    assert.equal(formatINR('-0.50'), '-₹0.50');
    assert.equal(toWords('-0.50'), 'Minus Rupees Zero and Fifty Paise Only');
    assert.equal(formatINR('-1234.00', { accounting: true }), '(₹1,234.00)');
    assert.equal(formatINR('-1234', { symbol: false }), '-1,234.00');
    assert.equal(formatINR('-1234', { symbol: false, accounting: true }), '(1,234.00)');
    assert.equal(formatINR('1234.50', { paise: false }), '₹1,234');
    const hidden = reportInr('1234.50', { paise: false });
    assert.ok(hidden.warnings.some((warning) => warning.includes('Paise were omitted')));
    assert.equal(formatINR('1234', { symbol: false, paise: false }), '1,234');
  });

  test('exponent notation is rejected and strings are rupees', () => {
    assert.throws(() => formatINR('1e5'), /exponent/);
    assert.throws(() => formatINR('1E5'), /exponent/);
    assert.throws(() => formatINR(1.5), /decimal string/);
    assert.equal(formatINR(100n), '₹1.00');
    assert.equal(formatINR('100'), '₹100.00');
    const mismatch = reportInr({ rupees: '1.00', paise: '50' });
    assert.equal(mismatch.valid, false);
    assert.ok(mismatch.errors.some((error) => error.includes('do not match')));
  });
});

describe('grouping, words, and input cleaning', () => {
  test('Indian grouping does not use Intl', () => {
    const source = readFileSync(join(skillRoot, 'scripts', 'format-inr.mjs'), 'utf8');
    assert.equal(source.includes('Intl'), false);
    assert.equal(source.includes('toLocaleString'), false);
    assert.equal(formatINR('1234567'), '₹12,34,567.00');
    assert.equal(formatINR('-1234567.50'), '-₹12,34,567.50');
    assert.equal(toWords('101'), 'Rupees One Hundred One Only');
    assert.equal(toWords('1001'), 'Rupees One Thousand One Only');
    assert.equal(toWords('101000'), 'Rupees One Lakh One Thousand Only');
    assert.equal(toWords('1.01'), 'Rupees One and One Paisa Only');
    assert.equal(toWords('99'), 'Rupees Ninety-Nine Only');
    assert.equal(toWords('990000000'), 'Rupees Ninety-Nine Crore Only');
    const below = reportInr('990000000');
    assert.equal(below.warnings.some((warning) => warning.includes('Arab')), false);
  });

  test('commas, the rupee sign, and fullwidth digits', () => {
    assert.equal(formatINR('1,23,456.78'), '₹1,23,456.78');
    assert.equal(formatINR('₹1,234.50'), '₹1,234.50');
    assert.equal(formatINR('\uFF11\uFF12\uFF13\uFF14.50'), '₹1,234.50');
  });

  test('a negative written the way formatINR writes it is read back', () => {
    assert.equal(formatINR('-₹1,234.50'), '-₹1,234.50');
    assert.equal(formatINR('₹-1,234.50'), '-₹1,234.50');
    assert.equal(formatINR(formatINR('-1234567.50')), '-₹12,34,567.50');
    assert.equal(reportInr('-₹0.50').paise, '-50');
    assert.equal(reportInr('-₹-1').valid, false);
    assert.equal(reportInr('--₹1').valid, false);
  });

  test('a small amount does not confirm, and one lakh does because of the short form', () => {
    const zero = reportInr('0');
    assert.equal(zero.confirm, false);
    assert.equal(zero.compact, '0.00');
    assert.match(zero.disclaimer, /not tax, legal or financial advice/);
    const lakh = reportInr('100000');
    assert.equal(lakh.confirm, true);
    assert.ok(lakh.warnings.some((warning) => warning.includes('abbreviations')));
    assert.ok(lakh.warnings.includes(CONFIRM_SENTENCE));
  });
});

describe('shipped copy and evals', () => {
  test('skill copies match the repo sources', () => {
    for (const name of ['disclaimer.mjs', 'money.mjs', 'rules.mjs']) {
      assert.equal(
        readFileSync(join(repoRoot, 'lib', name), 'utf8'),
        readFileSync(join(skillRoot, 'scripts', '_lib', name), 'utf8'),
      );
    }
    assert.equal(
      readFileSync(join(repoRoot, 'rules', 'inr.json'), 'utf8'),
      readFileSync(join(skillRoot, 'scripts', '_rules', 'inr.json'), 'utf8'),
    );
  });

  test('evals.json expectations match the script', () => {
    const evals = JSON.parse(readFileSync(join(repoRoot, 'evals', 'inr-formatting', 'evals.json'), 'utf8'));
    assert.equal(evals.skill, 'inr-formatting');
    for (const item of evals.evals) {
      const input = item.expect.paise ? { paise: item.expect.paise } : item.expect.rupees;
      const result = reportInr(input);
      assert.equal(result.valid, item.expect.valid, item.id);
      for (const key of ['formatted', 'words', 'compact', 'confirm']) {
        if (item.expect[key] !== undefined) assert.equal(result[key], item.expect[key], `${item.id} ${key}`);
      }
      if (item.expect.errorIncludes) {
        assert.ok(result.errors.some((error) => error.includes(item.expect.errorIncludes)), item.id);
      }
    }
  });
});

describe('CLI', () => {
  test('valid, invalid, and usage exit codes', () => {
    const valid = run(['--json', '{"rupees":"100000"}']);
    assert.equal(valid.status, 0);
    assert.equal(valid.json.formatted, '₹1,00,000.00');
    assert.equal(valid.json.words, 'Rupees One Lakh Only');

    const paise = run(['--json', '{"paise":"12345678901234567890"}']);
    assert.equal(paise.status, 0);
    assert.equal(paise.json.words, WORDS_BIG);

    const invalid = run(['--json', '"1e5"']);
    assert.equal(invalid.status, 1);
    assert.equal(invalid.json.valid, false);

    const usage = run([]);
    assert.equal(usage.status, 2);

    const bare = run(['--json', '100']);
    assert.equal(bare.status, 0);
    assert.equal(bare.json.formatted, '₹100.00');

    const number = run(['--json', '{"rupees":100}']);
    assert.equal(number.status, 1);
    assert.ok(number.json.errors.some((error) => error.includes('string')));
  });
});

function run(args) {
  const result = spawnSync(process.execPath, [join(skillRoot, 'scripts', 'format-inr.mjs'), ...args], {
    encoding: 'utf8',
  });
  assert.equal(result.error, undefined);
  let json = null;
  if (result.stdout) json = JSON.parse(result.stdout);
  return { ...result, json };
}
