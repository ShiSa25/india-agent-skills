import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  generateSynthetic,
  leadingDigitFinding,
  normalizeDigits,
  verhoeffCheckDigit,
  verhoeffValid,
} from './verhoeff.mjs';

test('Wikipedia worked example and SPEC specimens', () => {
  assert.equal(verhoeffCheckDigit('236'), '3');
  assert.equal(verhoeffValid('2363'), true);
  assert.equal(verhoeffValid('12340'), true);
  for (const number of ['234123412346', '999999999999', '123456789010']) {
    assert.equal(verhoeffValid(number), true, number);
  }
});

test('flipping any digit of a specimen fails', () => {
  const number = '234123412346';
  for (let i = 0; i < number.length; i += 1) {
    for (let digit = 0; digit <= 9; digit += 1) {
      if (String(digit) === number[i]) continue;
      const flipped = `${number.slice(0, i)}${digit}${number.slice(i + 1)}`;
      assert.equal(verhoeffValid(flipped), false);
    }
  }
});

test('spaces normalise, and only a leading 0 or 1 is the unpublished warning', () => {
  assert.equal(normalizeDigits('2341 2341 2346'), '234123412346');
  assert.equal(verhoeffValid(normalizeDigits('2341 2341 2346')), true);
  assert.equal(leadingDigitFinding('234123412346'), null);
  assert.equal(leadingDigitFinding('999999999999'), null);
  const finding = leadingDigitFinding('123456789010');
  assert.equal(finding.confirm, true);
  assert.match(finding.warning, /Confirm with the official source/);
});

test('generateSynthetic is deterministic and avoids a leading 0 or 1', () => {
  const first = generateSynthetic('phase-0');
  assert.equal(first, generateSynthetic('phase-0'));
  assert.equal(first.length, 12);
  assert.equal(verhoeffValid(first), true);
  assert.equal(leadingDigitFinding(first), null);
});
