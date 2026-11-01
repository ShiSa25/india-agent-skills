import assert from 'node:assert/strict';
import { test } from 'node:test';
import { qrcodegen } from './qrcodegen.mjs';

test('vendored Nayuki encoder loads and is deterministic at ECC M', () => {
  const first = qrcodegen.QrCode.encodeText('upi://pay', qrcodegen.QrCode.Ecc.MEDIUM);
  const second = qrcodegen.QrCode.encodeText('upi://pay', qrcodegen.QrCode.Ecc.MEDIUM);
  assert.ok(first.size > 0);
  assert.equal(typeof first.getModule(0, 0), 'boolean');
  let bits = '';
  for (let y = 0; y < first.size; y += 1) {
    for (let x = 0; x < first.size; x += 1) bits += first.getModule(x, y) === second.getModule(x, y) ? '1' : '0';
  }
  assert.equal(bits.includes('0'), false);
});
