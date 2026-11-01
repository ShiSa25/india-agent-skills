import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMinor, parseAmount, pct } from './money.mjs';

test('parseAmount accepts decimal strings and minor-unit bigints', () => {
  assert.equal(parseAmount('1234.50'), 123450n);
  assert.equal(parseAmount('0.03'), 3n);
  assert.equal(parseAmount('0.02'), 2n);
  assert.equal(parseAmount('-1000.00'), -100000n);
  assert.equal(parseAmount('-0.00'), 0n);
  assert.equal(parseAmount(123450n), 123450n);
  assert.equal(parseAmount('295.991', 3), 295991n);
  assert.equal(formatMinor(123450n), '1234.50');
  assert.equal(formatMinor(-50n), '-0.50');
  assert.equal(formatMinor(0n), '0.00');
  assert.equal(formatMinor(295990n, 3), '295.990');
});

test('parseAmount rejects floats, exponent notation, and extra decimals', () => {
  assert.throws(() => parseAmount(1.5), /decimal string or a bigint/);
  assert.throws(() => parseAmount('1e5'), /exponent notation/);
  assert.throws(() => parseAmount('1E5'), /exponent notation/);
  assert.throws(() => parseAmount('NaN'), /finite decimal/);
  assert.throws(() => parseAmount('1.234'), /decimal places/);
  assert.throws(() => parseAmount('295.991', 2), /decimal places/);
});

test('pct is half-up and symmetric for credit notes', () => {
  assert.equal(pct(4200000n, 1800), 756000n);
  assert.equal(pct(3n, 1800), 1n);
  assert.equal(pct(2n, 1800), 0n);
  assert.equal(pct(-100000n, 1800), -18000n);
  assert.equal(pct(-3n, 1800), -1n);
  assert.equal(pct(5n, 1000), 1n);
  assert.equal(pct(-5n, 1000), -1n);
  assert.throws(() => pct(1n, 18.5), /basis points/);
  assert.throws(() => pct(100n, -1800), /non-negative/);
  assert.throws(() => pct(-100n, -1n), /non-negative/);
});
