import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asciiUpper, foldDocumented, hasFoldedLookalike, prepareId } from './textprep.mjs';

test('fullwidth digits fold and compatibility letters do not', () => {
  const digits = foldDocumented('A\uFF11\uFF12');
  assert.equal(digits.text, 'A12');
  assert.equal(digits.fullwidthDigits, true);
  const longS = foldDocumented('A\u017F');
  assert.equal(longS.text, 'A\u017F');
  assert.equal(hasFoldedLookalike(longS.text), true);
  assert.equal(hasFoldedLookalike('José'), false);
  assert.equal(hasFoldedLookalike('Bra\u1E9Eil'), true);
  assert.equal(hasFoldedLookalike('\u00DF'), true);
  const upper = asciiUpper('ab\u0131');
  assert.equal(upper.text, 'AB\u0131');
  const prepared = prepareId('abcp e\uFF11\uFF12\uFF13\uFF14f', { uppercase: true });
  assert.equal(prepared.cleaned, 'ABCPE1234F');
  assert.ok(prepared.warnings.includes('Fullwidth digits were mapped to ASCII.'));
  assert.equal(prepared.warnings.includes('Input was NFKC-normalised.'), false);
  assert.ok(prepared.warnings.includes('Lowercase letters were normalised to uppercase.'));
  assert.ok(prepared.warnings.includes('Spaces or hyphens were removed.'));
});
