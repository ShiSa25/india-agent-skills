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
    const ok = decideCashfreeEvent({
      ...base,
      paymentStatus: 'SUCCESS',
      paymentAmount: '170.00',
      expectedAmount: '170.00',
    });
    const kelvin = decideCashfreeEvent({ ...base, paymentStatus: 'SUCCES\u212A' });
    assert.equal(kelvin.fulfil, false);
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
    const recovered = decideCashfreeEvent({
      ...base,
      paymentStatus: 'SUCCESS',
      priorStatus: 'FAILED',
      paymentAmount: '170.00',
      expectedAmount: '170.00',
    });
    assert.equal(recovered.fulfil, true);
    const late = decideCashfreeEvent({ ...base, paymentStatus: 'FAILED', priorStatus: 'SUCCESS' });
    assert.equal(late.fulfil, false);
    assert.equal(late.action, 'ignore_late');
    assert.equal(late.priorStatus, 'SUCCESS');
    const again = decideCashfreeEvent({
      ...base,
      idempotencyKey: 'second-success',
      paymentStatus: 'SUCCESS',
      priorStatus: 'SUCCESS',
      paymentAmount: '99.00',
      expectedAmount: '1.00',
    });
    assert.equal(again.action, 'amount_mismatch');
    assert.equal(again.valid, false);
    assert.equal(again.fulfil, false);
    assert.equal(again.storeKey, false);
    assert.equal(again.httpStatus, 400);
    const sameAmount = decideCashfreeEvent({
      ...base,
      idempotencyKey: 'second-success-ok',
      paymentStatus: 'SUCCESS',
      priorStatus: 'SUCCESS',
      paymentAmount: '170.00',
      expectedAmount: '170.00',
    });
    assert.equal(sameAmount.action, 'already_fulfilled');
    assert.equal(sameAmount.fulfil, false);
    const token = jsonDecimalToken('{"payment_amount":1.00,"payment_amount":2.00}', 'payment_amount');
    assert.equal(token, null);
    const ambiguous = decideCashfreeEvent({
      ...base,
      idempotencyKey: 'ambiguous-amount',
      paymentStatus: 'SUCCESS',
      paymentAmount: token,
      expectedAmount: '1.00',
    });
    assert.equal(ambiguous.fulfil, false);
    assert.equal(ambiguous.valid, false);
    assert.equal(ambiguous.action, 'amount_mismatch');
    assert.equal(ambiguous.storeKey, false);
  });

  test('needs_amount and amount_mismatch do not store the idempotency key', () => {
    const missing = decideCashfreeEvent({ ...base, idempotencyKey: 'retry-missing', paymentStatus: 'SUCCESS' });
    const mismatch = decideCashfreeEvent({
      ...base,
      idempotencyKey: 'retry-mismatch',
      paymentStatus: 'SUCCESS',
      paymentAmount: '170.00',
      expectedAmount: '1.00',
    });
    for (const decision of [missing, mismatch]) {
      assert.equal(decision.storeKey, false, decision.action);
      assert.equal(decision.httpStatus, 400, decision.action);
      assert.equal(decision.fulfil, false, decision.action);
      assert.ok(
        decision.warnings.includes('Do not store the idempotency key. Return non-2xx so Cashfree can retry.'),
        decision.action,
      );
    }
    const recorded = decideCashfreeEvent({ ...base, idempotencyKey: 'retry-failed', paymentStatus: 'FAILED' });
    assert.equal(recorded.action, 'record');
    assert.equal(recorded.storeKey, true);
    assert.equal(recorded.httpStatus, 200);
  });

  test('version 2026-01-01 is accepted and 2023-08-01 is not', () => {
    const versions = ruleById('cashfree', 'cashfree.webhook.versions', ON);
    assert.deepEqual(versions.value, ['2025-01-01', '2026-01-01']);
    assert.equal(decideCashfreeEvent({
      ...base,
      version: '2026-01-01',
      paymentStatus: 'SUCCESS',
      paymentAmount: '170.00',
      expectedAmount: '170.00',
    }).fulfil, true);
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
    assert.equal(jsonDecimalToken('{"payment_amount":1e2}', 'payment_amount'), null);
    assert.equal(jsonDecimalToken('{"payment_amount":1E+2}', 'payment_amount'), null);
    assert.equal(jsonDecimalToken('{"payment_amount":\n\t170.00}', 'payment_amount'), '170.00');
    assert.equal(
      jsonDecimalToken('{"description":"payment_amount:999","payment_amount":1.00}', 'payment_amount'),
      '1.00',
    );
    assert.equal(
      jsonDecimalToken('{"description":"payment_amount":999,"payment_amount":1.00}', 'payment_amount'),
      null,
    );
    assert.equal(jsonDecimalToken('{"data":{"payment_amount":50.00},"payment_amount":1.00}', 'payment_amount'), null);
    assert.equal(jsonDecimalToken('{"data":{"payment":{"payment_amount":170.00}}}', 'payment_amount'), '170.00');
  });

  test('escaped keys, stray colons, and depth fail closed', () => {
    const escaped = '{"payment_amoun\\u0074":170.00}';
    assert.equal(JSON.parse(escaped).payment_amount, 170);
    assert.equal(jsonDecimalToken(escaped, 'payment_amount'), '170.00');
    assert.equal(jsonDecimalToken('{"pay\\u006dent_amount":170.00}', 'payment_amount'), '170.00');

    assert.equal(jsonDecimalToken('{"payment_amount":1.00:170.00}', 'payment_amount'), null);
    assert.equal(jsonDecimalToken('{"payment_amount":170.00:170.00}', 'payment_amount'), null);
    assert.equal(jsonDecimalToken('{"payment_amount":1.00:1e2}', 'payment_amount'), null);
    assert.equal(jsonDecimalToken('{"payment_amount":1.00:{"payment_amount":170.00}}', 'payment_amount'), null);
    assert.equal(jsonDecimalToken('{"a":1:2,"payment_amount":170.00}', 'payment_amount'), null);

    const equal = '{"payment_amount":170.00,"payment_amount":170.00}';
    assert.equal(jsonDecimalToken(equal, 'payment_amount'), null);
    const equalEscaped = '{"payment_amount":170.00,"payment_amoun\\u0074":170.00}';
    assert.equal(JSON.parse(equalEscaped).payment_amount, 170);
    assert.equal(jsonDecimalToken(equalEscaped, 'payment_amount'), null);
    const duplicate = decideCashfreeEvent({
      ...base,
      idempotencyKey: 'equal-payment-amount',
      paymentStatus: 'SUCCESS',
      paymentAmount: jsonDecimalToken(equalEscaped, 'payment_amount'),
      expectedAmount: '170.00',
    });
    assert.equal(duplicate.action, 'amount_mismatch');
    assert.equal(duplicate.valid, false);
    assert.equal(duplicate.fulfil, false);

    assert.equal(jsonDecimalToken(nestObjects(32, '{"payment_amount":170.00}'), 'payment_amount'), '170.00');
    assert.equal(jsonDecimalToken(nestObjects(33, '{"payment_amount":170.00}'), 'payment_amount'), null);
    const sibling = `{"payment_amount":170.00,"nested":${nestObjects(40, '1')}}`;
    assert.equal(jsonDecimalToken(sibling, 'payment_amount'), null);
    let deep = null;
    assert.doesNotThrow(() => {
      deep = jsonDecimalToken(nestObjects(8000, '{"payment_amount":170.00}'), 'payment_amount');
    });
    assert.equal(deep, null);
    const overDepth = decideCashfreeEvent({
      ...base,
      idempotencyKey: 'over-depth',
      paymentStatus: 'SUCCESS',
      paymentAmount: deep,
      expectedAmount: '170.00',
    });
    assert.equal(overDepth.action, 'amount_mismatch');
    assert.equal(overDepth.fulfil, false);
  });

  test('a non-decimal payment_amount does not fulfil', () => {
    const bodies = [
      '{"payment_amount":170.00,"payment_amount":null}',
      '{"payment_amount":170.00,"payment_amount":{}}',
      '{"payment_amount":{"payment_amount":170.00}}',
      '{"payment_amount":170.00,"payment_amount":false}',
      '{"payment_amount":170.00,"payment_amount":true}',
      '{"payment_amount":170.00,"payment_amount":"170.00"}',
      '{"payment_amount":170.00,"payment_amount":[170.00]}',
      '{"payment_amount":170.00,"note":"x":"payment_amount":1.00}',
      '{"payment_amount":170.00,"note":1:true}',
      '{"payment_amount":170.00,"note":1:false}',
      '{"payment_amount":170.00,"note":1:null}',
    ];
    for (const [index, raw] of bodies.entries()) {
      const token = jsonDecimalToken(raw, 'payment_amount');
      assert.equal(token, null, raw);
      const decision = decideCashfreeEvent({
        ...base,
        idempotencyKey: `non-decimal-${index}`,
        paymentStatus: 'SUCCESS',
        paymentAmount: token,
        expectedAmount: '170.00',
      });
      assert.equal(decision.action, 'amount_mismatch', raw);
      assert.equal(decision.valid, false, raw);
      assert.equal(decision.fulfil, false, raw);
    }
    assert.equal(jsonDecimalToken('{"payment_amount":170.00,"other":171}', 'payment_amount'), '170.00');
    assert.equal(JSON.parse('{"payment_amount":170.00}').payment_amount, 170);
  });

  test('more than two decimal places is amount_mismatch and does not throw', () => {
    for (const paymentAmount of ['170.000', '0.0001']) {
      let decision;
      assert.doesNotThrow(() => {
        decision = decideCashfreeEvent({
          ...base,
          idempotencyKey: `decimals-${paymentAmount}`,
          paymentStatus: 'SUCCESS',
          paymentAmount,
          expectedAmount: '170.00',
        });
      });
      assert.equal(decision.action, 'amount_mismatch', paymentAmount);
      assert.equal(decision.fulfil, false, paymentAmount);
      assert.equal(decision.valid, false, paymentAmount);
      assert.ok(decision.errors.length > 0, paymentAmount);
    }
  });

  test('omitting the expected or payment amount does not fulfil', () => {
    const both = decideCashfreeEvent({ ...base, idempotencyKey: 'omit-both', paymentStatus: 'SUCCESS' });
    assert.equal(both.action, 'needs_amount');
    assert.equal(both.fulfil, false);
    assert.equal(both.valid, false);
    assert.equal(both.storeKey, false);
    assert.equal(both.httpStatus, 400);
    assert.match(both.errors[0], /expectedAmount|paymentAmount/);
    const expectedOnly = decideCashfreeEvent({
      ...base,
      idempotencyKey: 'omit-payment',
      paymentStatus: 'SUCCESS',
      expectedAmount: '170.00',
    });
    assert.equal(expectedOnly.action, 'needs_amount');
    assert.equal(expectedOnly.fulfil, false);
    const paymentOnly = decideCashfreeEvent({
      ...base,
      idempotencyKey: 'omit-expected',
      paymentStatus: 'SUCCESS',
      paymentAmount: '170.00',
    });
    assert.equal(paymentOnly.action, 'needs_amount');
    assert.equal(paymentOnly.fulfil, false);
    assert.equal(paymentOnly.priorStatus, 'none');
  });

  test('signed zero does not fulfil', () => {
    for (const paymentAmount of ['-0', '-0.00', '-0.0']) {
      const decision = decideCashfreeEvent({
        ...base,
        idempotencyKey: `negzero-${paymentAmount}`,
        paymentStatus: 'SUCCESS',
        paymentAmount,
        expectedAmount: '0.00',
      });
      assert.equal(decision.action, 'amount_mismatch', paymentAmount);
      assert.equal(decision.fulfil, false, paymentAmount);
      assert.equal(decision.valid, false, paymentAmount);
    }
  });

  test('a top-level JSON array is not an amount token and does not fulfil', () => {
    const raw = '[{"payment_amount":170.00}]';
    const token = jsonDecimalToken(raw, 'payment_amount');
    assert.equal(token, null);
    const decision = decideCashfreeEvent({
      ...base,
      idempotencyKey: 'top-level-array',
      paymentStatus: 'SUCCESS',
      paymentAmount: token,
      expectedAmount: '170.00',
    });
    assert.equal(decision.fulfil, false);
    assert.equal(decision.action, 'amount_mismatch');
  });

  test('the replay window cannot be widened and the amount must match', () => {
    assert.throws(
      () => verifyCashfreeWebhook({
        rawBody: BODY,
        timestamp: DOC_TS,
        signature: sign(DOC_TS, BODY),
        secret: SECRET,
        nowMs: Number(DOC_TS),
        toleranceSec: 301,
      }),
      /cannot exceed 300/,
    );
    const mismatch = decideCashfreeEvent({
      ...base,
      paymentStatus: 'SUCCESS',
      paymentAmount: '170.00',
      expectedAmount: '1.00',
    });
    assert.equal(mismatch.fulfil, false);
    assert.equal(mismatch.action, 'amount_mismatch');
    assert.equal(mismatch.priorStatus, 'none');
    const matched = decideCashfreeEvent({
      ...base,
      paymentStatus: 'SUCCESS',
      paymentAmount: '170.00',
      expectedAmount: '170',
    });
    assert.equal(matched.fulfil, true);
    assert.equal(matched.warnings.some((warning) => warning.includes('expectedAmount')), false);
  });
});

describe('handlers and evals', () => {
  test('Express, Next.js, and Fastify read the raw body', () => {
    const text = readFileSync(join(skillRoot, 'references', 'handlers.md'), 'utf8');
    const skill = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8');
    const skillExpress = skill.slice(skill.indexOf('Express, registered'), skill.indexOf('Next.js route handler'));
    assert.match(skillExpress, /jsonDecimalToken\(/);
    assert.match(skillExpress, /decideCashfreeEvent\(/);
    const skillToken = skillExpress.indexOf('jsonDecimalToken(');
    const skillDecide = skillExpress.indexOf('decideCashfreeEvent(');
    const skillGuard = skillExpress.indexOf("decision.action === 'amount_mismatch'");
    const skillFulfil = skillExpress.indexOf('!decision.fulfil');
    const skillSuccess = skillExpress.lastIndexOf('status(200)');
    assert.ok(skillToken > 0 && skillDecide > skillToken && skillGuard > skillDecide);
    assert.ok(skillFulfil > skillGuard && skillSuccess > skillFulfil);
    assert.match(text, /express\.raw\(\{ type: 'application\/json' \}\)/);
    assert.match(text, /await req\.text\(\)/);
    assert.match(text, /parseAs: 'buffer'/);
    assert.match(text, /Do not pass `JSON\.stringify\(req\.body\)`/);
    assert.match(text, /x-webhook-timestamp/);
    assert.match(text, /server-side only/);
    assert.match(text, /Return 200 only after/);
    const next = text.slice(text.indexOf('## Next.js'), text.indexOf('## Fastify'));
    const parsed = next.indexOf('JSON.parse(rawBody)');
    const rejected = next.indexOf('status: 400', parsed);
    const fulfilled = next.lastIndexOf('status: 200');
    assert.ok(parsed > 0);
    assert.ok(rejected > parsed);
    assert.ok(fulfilled > rejected);
    assert.doesNotMatch(text, /result\.reason/);
    assert.doesNotMatch(text, /res\.status\(200\)\.end\(\);\n  const event/);
    assert.doesNotMatch(text, /\.update\(JSON\.stringify/);
    const tokenAt = next.indexOf('jsonDecimalToken(');
    const decideAt = next.indexOf('decideCashfreeEvent(');
    const guardAt = next.indexOf("decision.action === 'amount_mismatch'");
    const successAt = next.lastIndexOf('status: 200');
    assert.ok(tokenAt > 0);
    assert.ok(decideAt > tokenAt);
    assert.ok(guardAt > decideAt);
    assert.ok(successAt > guardAt);
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
      JSON.stringify({
        ...baseInput(),
        paymentStatus: 'SUCCESS',
        paymentAmount: '170.00',
        expectedAmount: '170.00',
      }),
    ]);
    assert.equal(decision.status, 0);
    assert.equal(JSON.parse(decision.stdout).fulfil, true);
  });
});

function nestObjects(depth, leaf) {
  let body = leaf;
  for (let i = 1; i < depth; i += 1) body = `{"a":${body}}`;
  return body;
}

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
