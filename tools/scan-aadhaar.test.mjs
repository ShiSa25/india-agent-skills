import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verhoeffCheckDigit } from '../lib/verhoeff.mjs';
import { findingsInText, loadAllowlist } from './scan-aadhaar.mjs';

const allowed = loadAllowlist('234123412346\n999999999999\n123456789010\n');

test('allow-listed specimens and non-Verhoeff runs are ignored', () => {
  const text = '234123412346 2341-2341-2346 123456789012';
  assert.deepEqual(findingsInText(text, 'fixture.txt', allowed), []);
});

test('a hyphenated, dotted, or zero-width number outside the allow-list is masked', () => {
  const body = '73412341234';
  const number = `${body}${verhoeffCheckDigit(body)}`;
  assert.equal(number.length, 12);
  const grouped = `${number.slice(0, 4)}-${number.slice(4, 8)}-${number.slice(8)}`;
  const dotted = `${number.slice(0, 4)}.${number.slice(4, 8)}.${number.slice(8)}`;
  const hidden = `${number.slice(0, 4)}\u200b${number.slice(4)}`;
  for (const sample of [number, grouped, dotted, hidden]) {
    const findings = findingsInText(sample, 'app.log', allowed);
    assert.equal(findings.length, 1, sample);
    assert.equal(findings[0].includes(number), false);
    assert.match(findings[0], new RegExp(`XXXX XXXX ${number.slice(-4)}`));
  }
});

test('the file path is redacted when it contains the number', () => {
  const body = '83412341234';
  const number = `${body}${verhoeffCheckDigit(body)}`;
  const findings = findingsInText('no digits here', `${number}.txt`, allowed);
  assert.equal(findings.length, 1);
  assert.equal(JSON.stringify(findings).includes(number), false);
  assert.match(findings[0], /XXXX-XXXX-/);
});

test('a 16-digit grouped run is not reported as a 12-digit Aadhaar', () => {
  assert.deepEqual(findingsInText('card 1234-1234-1234-1234', 'card.txt', allowed), []);
});
