import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addMonths, fyBounds, fyOf, fyOfInstant, istDate, parseFy } from './fy.mjs';

test('financial year boundaries', () => {
  assert.equal(fyOf('2026-03-31'), '2025-26');
  assert.equal(fyOf('2026-04-01'), '2026-27');
  assert.equal(fyOf('2024-02-29'), '2023-24');
  assert.throws(() => fyOf('2026-02-29'), /calendar day/);
  assert.deepEqual(parseFy('2025-26'), parseFy('2025-2026'));
  assert.equal(parseFy('2025-26').display, '2025-26');
  assert.equal(parseFy('2025-2026').portal, '2025-2026');
  assert.throws(() => parseFy('2025-27'), /follow the start year/);
  assert.deepEqual(fyBounds('2025-26'), { start: '2025-04-01', end: '2026-03-31' });
});

test('addMonths clamps to the end of the month', () => {
  assert.equal(addMonths('2026-05-31', 9), '2027-02-28');
  assert.equal(addMonths('2024-05-31', 9), '2025-02-28');
  assert.equal(addMonths('2023-05-31', 9), '2024-02-29');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
});

test('IST is UTC+05:30 and date-only strings are not parsed with Date', () => {
  const beforeMidnight = new Date(Date.UTC(2026, 2, 31, 18, 29, 59));
  const atMidnight = new Date(Date.UTC(2026, 2, 31, 18, 30, 0));
  assert.equal(istDate(beforeMidnight), '2026-03-31');
  assert.equal(istDate(atMidnight), '2026-04-01');
  assert.equal(fyOfInstant(atMidnight), '2026-27');
  const source = readFileSync(new URL('./fy.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /new Date\(['"]\d{4}-/);
});
