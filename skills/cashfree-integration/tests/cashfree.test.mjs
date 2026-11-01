import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CONFIRM_SENTENCE } from '../scripts/_lib/disclaimer.mjs';
import { ruleById } from '../scripts/_lib/rules.mjs';
import {
  UsageError,
  decideCashfreeEvent,
  jsonDecimalToken,
  verifyCashfreeWebhook,
} from '../scripts/cashfree.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(here, '..');
const repoRoot = join(here, '..', '..', '..');
const ON = '2026-11-01';
const SECRET = 'client_secret';
const DOC_TS = '1617695238078';
const BODY = '{"type":"PAYMENT_SUCCESS_WEBHOOK"}';
const DOC_B64 = 'qYpxv9z56awnigrZ4WIKtxozJ3UJqAaqk4BuDtqCcWU=';

function sign(timestamp, rawBody, secret = SECRET) {
  return createHmac('sha256', secret).update(`${timestamp}${rawBody}`).digest('base64');
}

describe('signature', () => {
  test('doc timestamp and a node:crypto Base64 HMAC', () => {
    const signature = sign(DOC_TS, BODY);
    assert.equal(signature, DOC_B64);
    assert.equal(BigInt(DOC_TS) > 1000000000000n, true);
    const result = verifyCashfreeWebhook({
      rawBody: BODY,
      timestamp: DOC_TS,
      signature,
      secret: SECRET,
      nowMs: Number(DOC_TS),
    });
    assert.equal(result.valid, true);
    assert.equal(result.reason, 'ok');
    assert.equal(result.timestampUnit, 'ms');
    assert.equal(result.toleranceSec, 300);
    assert.equal(result.confirm, true);
    assert.ok(result.warnings.includes(CONFIRM_SENTENCE));
    assert.match(result.disclaimer, /not tax, legal or financial advice/);
    const asBuffer = verifyCashfreeWebhook({
      rawBody: Buffer.from(BODY),
      timestamp: DOC_TS,
      signature,
      secret: SECRET,
      nowMs: DOC_TS,
    });
    assert.equal(asBuffer.valid, true);
  });

  test('tampered body', () => {
    const result = verifyCashfreeWebhook({
      rawBody: `${BODY} `,
      timestamp: DOC_TS,
      signature: DOC_B64,
      secret: SECRET,
      nowMs: Number(DOC_TS),
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'tampered');
    assert.equal(result.confirm, false);
  });

  test('re-stringified JSON fails', () => {
    const raw = '{ "type" : "PAYMENT_SUCCESS_WEBHOOK" }';
    const signature = sign(DOC_TS, raw);
    const restrung = JSON.stringify(JSON.parse(raw));
    assert.notEqual(restrung, raw);
    assert.equal(
      verifyCashfreeWebhook({
        rawBody: restrung,
        timestamp: DOC_TS,
        signature,
        secret: SECRET,
        nowMs: Number(DOC_TS),
      }).valid,
      false,
    );
  });

  test('hex digest is rejected with expected base64', () => {
    const hex = createHmac('sha256', SECRET).update(DOC_TS + BODY).digest('hex');
    assert.equal(hex.length, 64);
    const result = verifyCashfreeWebhook({
      rawBody: BODY,
      timestamp: DOC_TS,
      signature: hex,
      secret: SECRET,
      nowMs: Number(DOC_TS),
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'expected base64');
    const upper = verifyCashfreeWebhook({
      rawBody: BODY,
      timestamp: DOC_TS,
      signature: hex.toUpperCase(),
      secret: SECRET,
      nowMs: Number(DOC_TS),
    });
    assert.equal(upper.reason, 'expected base64');
  });

  test('a parsed object throws and a short signature does not', () => {
    assert.throws(
      () =>
        verifyCashfreeWebhook({
          rawBody: { type: 'PAYMENT_SUCCESS_WEBHOOK' },
          timestamp: DOC_TS,
          signature: DOC_B64,
          secret: SECRET,
          nowMs: Number(DOC_TS),
        }),
      UsageError,
    );
    const odd = verifyCashfreeWebhook({
      rawBody: BODY,
      timestamp: DOC_TS,
      signature: 'abcd',
      secret: SECRET,
      nowMs: Number(DOC_TS),
    });
    assert.equal(odd.valid, false);
    assert.equal(odd.reason, 'expected base64');
  });
});

describe('replay window', () => {
  test('301 seconds is stale and 300 seconds is inside the window', () => {
    const tolerance = ruleById('cashfree', 'cashfree.webhook.replayToleranceSeconds', ON);
    assert.equal(tolerance.value, 300);
    assert.equal(tolerance.verified, true);
    const now = Number(DOC_TS);
    const stale = verifyCashfreeWebhook({
      rawBody: BODY,
      timestamp: DOC_TS,
      signature: DOC_B64,
      secret: SECRET,
      nowMs: now + (tolerance.value + 1) * 1000,
    });
    assert.equal(stale.valid, false);
    assert.equal(stale.reason, 'stale');
    const edge = verifyCashfreeWebhook({
      rawBody: BODY,
      timestamp: DOC_TS,
      signature: DOC_B64,
      secret: SECRET,
      nowMs: now + tolerance.value * 1000,
    });
    assert.equal(edge.valid, true);
    const future = verifyCashfreeWebhook({
      rawBody: BODY,
      timestamp: DOC_TS,
      signature: DOC_B64,
      secret: SECRET,
      nowMs: now - (tolerance.value + 1) * 1000,
    });
    assert.equal(future.reason, 'future');
  });

  test('seconds and milliseconds are detected around 1e12', () => {
    const threshold = ruleById('cashfree', 'cashfree.webhook.millisecondThreshold', ON);
    assert.equal(threshold.verified, false);
    assert.equal(threshold.value, '1000000000000');
    const seconds = '1617695238';
    const signature = sign(seconds, BODY);
    const asSeconds = verifyCashfreeWebhook({
      rawBody: BODY,
      timestamp: seconds,
      signature,
      secret: SECRET,
      nowMs: 1617695238000,
    });
    assert.equal(asSeconds.valid, true);
    assert.equal(asSeconds.timestampUnit, 's');
    assert.equal(asSeconds.confirm, true);
    const boundary = '1000000000000';
    const boundarySig = sign(boundary, BODY);
    const atThreshold = verifyCashfreeWebhook({
      rawBody: BODY,
      timestamp: boundary,
      signature: boundarySig,
      secret: SECRET,
      nowMs: 1000000000000000,
    });
    assert.equal(atThreshold.timestampUnit, 's');
    const above = '1000000000001';
    const aboveSig = sign(above, BODY);
    const asMs = verifyCashfreeWebhook({
      rawBody: BODY,
      timestamp: above,
      signature: aboveSig,
      secret: SECRET,
      nowMs: 1000000000001,
    });
    assert.equal(asMs.timestampUnit, 'ms');
    assert.equal(asMs.valid, true);
  });

  test('the 2025-01-01 sample timestamp is milliseconds', () => {
    const sample = '1746427759733';
    assert.equal(BigInt(sample) > 1000000000000n, true);
    const signature = sign(sample, BODY);
    const result = verifyCashfreeWebhook({
      rawBody: BODY,
      timestamp: sample,
      signature,
      secret: SECRET,
      nowMs: Number(sample),
    });
    assert.equal(result.timestampUnit, 'ms');
    assert.equal(result.valid, true);
  });
});

describe('version, idempotency, and fulfilment', () => {
  const base = {
    signatureVerified: true,
    version: '2025-01-01',
    idempotencyKey: 'n9rn7079wqXcse3GEDEXCYle9ajXmU0SUQY8zrUNAlc=',
    seenKeys: [],
  };

  test('SUCCESS fulfils and other statuses do not', () => {
    const statuses = ruleById('cashfree', 'cashfree.fulfil.statuses', ON);
    assert.deepEqual(statuses.value, ['SUCCESS']);
    const ok = decideCashfreeEvent({ ...base, paymentStatus: 'SUCCESS' });
    assert.equal(ok.fulfil, true);
    assert.equal(ok.httpStatus, 200);
    assert.equal(ok.storeKey, true);
    assert.equal(ok.idempotencyHeader, 'x-idempotency-key');
    for (const paymentStatus of ['FAILED', 'PENDING', 'NOT_ATTEMPTED']) {
      const row = decideCashfreeEvent({ ...base, paymentStatus });
      assert.equal(row.fulfil, false, paymentStatus);
    }
  });

  test('duplicate key and out-of-order statuses', () => {
    const duplicate = decideCashfreeEvent({
      ...base,
      paymentStatus: 'SUCCESS',
      seenKeys: [base.idempotencyKey],
      priorStatus: 'SUCCESS',
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.fulfil, false);
    assert.equal(duplicate.storeKey, false);
    const recovered = decideCashfreeEvent({ ...base, paymentStatus: 'SUCCESS', priorStatus: 'FAILED' });
    assert.equal(recovered.fulfil, true);
    const late = decideCashfreeEvent({ ...base, paymentStatus: 'FAILED', priorStatus: 'SUCCESS' });
    assert.equal(late.fulfil, false);
    assert.equal(late.action, 'ignore_late');
    assert.equal(late.priorStatus, 'SUCCESS');
  });

  test('version 2026-01-01 is accepted and 2023-08-01 is not', () => {
    const versions = ruleById('cashfree', 'cashfree.webhook.versions', ON);
    assert.deepEqual(versions.value, ['2025-01-01', '2026-01-01']);
    assert.equal(decideCashfreeEvent({ ...base, version: '2026-01-01', paymentStatus: 'SUCCESS' }).fulfil, true);
    const old = decideCashfreeEvent({ ...base, version: '2023-08-01', paymentStatus: 'SUCCESS' });
    assert.equal(old.valid, false);
    assert.equal(old.action, 'unexpected_version');
    const missing = decideCashfreeEvent({ ...base, idempotencyKey: '   ', paymentStatus: 'SUCCESS' });
    assert.equal(missing.action, 'missing_idempotency_key');
  });

  test('decimal tokens keep trailing zeros', () => {
    const raw = '{"payment_amount":170.00,"other":170}';
    assert.equal(jsonDecimalToken(raw, 'payment_amount'), '170.00');
    assert.equal(jsonDecimalToken(raw, 'other'), '170');
    assert.equal(JSON.parse(raw).payment_amount, 170);
  });
});

describe('handlers and evals', () => {
  test('Express, Next.js, and Fastify read the raw body', () => {
    const text = readFileSync(join(skillRoot, 'references', 'handlers.md'), 'utf8');
    assert.match(text, /express\.raw\(\{ type: 'application\/json' \}\)/);
    assert.match(text, /await req\.text\(\)/);
    assert.match(text, /parseAs: 'buffer'/);
    assert.match(text, /Do not pass `JSON\.stringify\(req\.body\)`/);
    assert.match(text, /x-webhook-timestamp/);
    assert.doesNotMatch(text, /\.update\(JSON\.stringify/);
  });

  test('evals.json expectations match the script', () => {
    const evals = JSON.parse(readFileSync(join(repoRoot, 'evals', 'cashfree-integration', 'evals.json'), 'utf8'));
    assert.equal(evals.skill, 'cashfree-integration');
    for (const item of evals.evals) {
      const result = runExpect(item.expect);
      for (const [key, value] of Object.entries(item.expect)) {
        if (key === 'op' || key === 'input' || key === 'errorIncludes' || key === 'warningIncludes') continue;
        assert.deepEqual(result[key], value, item.id);
      }
      if (item.expect.errorIncludes) {
        assert.ok(result.errors.some((error) => error.includes(item.expect.errorIncludes)), item.id);
      }
      if (item.expect.warningIncludes) {
        assert.ok(result.warnings.some((warning) => warning.includes(item.expect.warningIncludes)), item.id);
      }
    }
  });
});

describe('CLI', () => {
  test('valid, stale, hex, and usage exit codes', () => {
    const valid = run('verify-webhook.mjs', [
      '--json',
      JSON.stringify({
        rawBody: BODY,
        timestamp: DOC_TS,
        signature: DOC_B64,
        secret: SECRET,
        nowMs: Number(DOC_TS),
      }),
    ]);
    assert.equal(valid.status, 0);
    assert.equal(JSON.parse(valid.stdout).reason, 'ok');

    const stale = run('verify-webhook.mjs', [
      '--json',
      JSON.stringify({
        rawBody: BODY,
        timestamp: DOC_TS,
        signature: DOC_B64,
        secret: SECRET,
        nowMs: Number(DOC_TS) + 301000,
      }),
    ]);
    assert.equal(stale.status, 1);
    assert.equal(JSON.parse(stale.stdout).reason, 'stale');

    const hex = createHmac('sha256', SECRET).update(DOC_TS + BODY).digest('hex');
    const rejected = run('verify-webhook.mjs', [
      '--json',
      JSON.stringify({ rawBody: BODY, timestamp: DOC_TS, signature: hex, secret: SECRET, nowMs: Number(DOC_TS) }),
    ]);
    assert.equal(rejected.status, 1);
    assert.equal(JSON.parse(rejected.stdout).reason, 'expected base64');

    const usage = run('verify-webhook.mjs', []);
    assert.equal(usage.status, 2);

    const decision = run('decide-event.mjs', [
      '--json',
      JSON.stringify({ ...baseInput(), paymentStatus: 'SUCCESS' }),
    ]);
    assert.equal(decision.status, 0);
    assert.equal(JSON.parse(decision.stdout).fulfil, true);
  });
});

function baseInput() {
  return {
    signatureVerified: true,
    version: '2025-01-01',
    idempotencyKey: 'n9rn7079wqXcse3GEDEXCYle9ajXmU0SUQY8zrUNAlc=',
  };
}

function runExpect(expect) {
  if (expect.op === 'webhook') return verifyCashfreeWebhook(expect.input);
  if (expect.op === 'event') return decideCashfreeEvent(expect.input);
  if (expect.op === 'token') return { token: jsonDecimalToken(expect.input.raw, expect.input.field) };
  throw new Error(`unknown op ${expect.op}`);
}

function run(script, args) {
  const result = spawnSync(process.execPath, [join(skillRoot, 'scripts', script), ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return result;
}
