import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadAllDomains, needsConfirm, ruleById } from './rules.mjs';

test('rules load and date windows are honoured', () => {
  const domains = loadAllDomains();
  assert.ok(domains.some((domain) => domain.domain === 'gst'));
  const length = ruleById('gst', 'gst.gstin.length', '2026-11-01');
  assert.equal(length.value, 15);
  assert.equal(needsConfirm(ruleById('gst', 'gst.gstin.marker.tcs', '2026-11-01')), true);
  assert.equal(needsConfirm(ruleById('gst', 'gst.gstin.marker.regular', '2026-11-01')), false);
  assert.throws(() => ruleById('gst', 'gst.gstin.length', '2017-06-30'), /no rule/);
});
