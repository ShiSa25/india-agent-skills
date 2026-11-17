import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ruleById } from '../scripts/_lib/rules.mjs';
import { CONFIRM_SENTENCE } from '../scripts/_lib/disclaimer.mjs';
import {
  UsageError,
  decideRazorpayEvent,
  explainPaymentSignature,
  explainSubunits,
  explainWebhook,
  jsonIntegerToken,
  planRazorpayWebhook,
  razorpayPaymentId,
  subunitString,
  toSubunits,
  verifyPaymentSignature,
  verifyWebhook,
} from '../scripts/razorpay.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(here, '..');
const repoRoot = join(here, '..', '..', '..');
const ON = '2026-11-01';

const ORDER = 'order_9A33XWu170gUtm';
const PAYMENT = 'pay_29QQoUBi66xm2f';
const KEY = 'key_secret';
const CHECKOUT_HEX = '7920f7497f3db0d8c993fa160dc7e0a1ebf7424a95a786c40c62c6059f80d04d';
const RAW = '{"entity":"event","event":"payment.captured"}\n';
const WEBHOOK_SECRET = 'whsec_test';
const WEBHOOK_HEX = '00941bc52ad7dbe75c5886b3ed820bb858e86a49781f36c55b04277dc9af7c9c';

function checkoutHex(orderId, paymentId, secret) {
  return createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
}

describe('checkout signature', () => {
  test('official sample ids match a node:crypto HMAC', () => {
    const hex = checkoutHex(ORDER, PAYMENT, KEY);
    assert.equal(hex, CHECKOUT_HEX);
    const result = explainPaymentSignature({
      orderId: ORDER,
      paymentId: PAYMENT,
      signature: hex,
      secret: KEY,
    });
    assert.equal(verifyPaymentSignature({ orderId: ORDER, paymentId: PAYMENT, signature: hex, secret: KEY }), true);
    assert.equal(result.valid, true);
    assert.equal(result.confirm, false);
    assert.equal(result.errors.length, 0);
    assert.match(result.disclaimer, /not tax, legal or financial advice/);
    assert.equal(result.disclaimer.includes(CONFIRM_SENTENCE), false);
  });

  test('a changed payment id fails', () => {
    const result = explainPaymentSignature({
      orderId: ORDER,
      paymentId: 'pay_other',
      signature: CHECKOUT_HEX,
      secret: KEY,
    });
    assert.equal(result.valid, false);
    assert.equal(result.errors[0], 'signature mismatch');
  });

  test('a fullwidth hex digit is not normalised into a match', () => {
    const signature = CHECKOUT_HEX.replace('0', '\uFF10');
    assert.notEqual(signature, CHECKOUT_HEX);
    assert.equal(
      verifyPaymentSignature({ orderId: ORDER, paymentId: PAYMENT, signature, secret: KEY }),
      false,
    );
  });

  test('uppercase hex fails and is not normalised', () => {
    assert.equal(
      verifyPaymentSignature({
        orderId: ORDER,
        paymentId: PAYMENT,
        signature: CHECKOUT_HEX.toUpperCase(),
        secret: KEY,
      }),
      false,
    );
  });

  test('a different length does not throw', () => {
    assert.doesNotThrow(() =>
      verifyPaymentSignature({ orderId: ORDER, paymentId: PAYMENT, signature: 'abcd', secret: KEY }),
    );
    assert.equal(
      verifyPaymentSignature({ orderId: ORDER, paymentId: PAYMENT, signature: 'abcd', secret: KEY }),
      false,
    );
  });

  test('client order id must match the server id', () => {
    const result = explainPaymentSignature({
      orderId: ORDER,
      clientOrderId: 'order_spoofed',
      paymentId: PAYMENT,
      signature: CHECKOUT_HEX,
      secret: KEY,
    });
    assert.equal(result.valid, false);
    assert.match(result.errors[0], /server/);
  });

  test('zero-width and oversized ids are rejected', () => {
    const hidden = explainPaymentSignature({
      orderId: `${ORDER}\u200b`,
      paymentId: PAYMENT,
      signature: CHECKOUT_HEX,
      secret: KEY,
    });
    assert.equal(hidden.valid, false);
    assert.match(hidden.errors[0], /control/);
    const huge = explainPaymentSignature({
      orderId: 'o'.repeat(10 * 1024 + 1),
      paymentId: PAYMENT,
      signature: CHECKOUT_HEX,
      secret: KEY,
    });
    assert.equal(huge.valid, false);
    assert.match(huge.errors[0], /10 KB/);
  });
});

describe('webhook raw body', () => {
  test('pinned hex over the raw bytes', () => {
    const hex = createHmac('sha256', WEBHOOK_SECRET).update(RAW).digest('hex');
    assert.equal(hex, WEBHOOK_HEX);
    assert.equal(verifyWebhook({ rawBody: RAW, signature: hex, secret: WEBHOOK_SECRET }), true);
    assert.equal(verifyWebhook({ rawBody: Buffer.from(RAW), signature: hex, secret: WEBHOOK_SECRET }), true);
  });

  test('whitespace and re-stringified JSON fail', () => {
    const hex = WEBHOOK_HEX;
    const parsed = JSON.parse(RAW);
    const restrung = JSON.stringify(parsed);
    assert.notEqual(restrung, RAW);
    assert.equal(verifyWebhook({ rawBody: restrung, signature: hex, secret: WEBHOOK_SECRET }), false);
    assert.equal(verifyWebhook({ rawBody: RAW.replace('\n', ' '), signature: hex, secret: WEBHOOK_SECRET }), false);
  });

  test('a parsed object is a usage error', () => {
    assert.throws(
      () => verifyWebhook({ rawBody: { event: 'payment.captured' }, signature: WEBHOOK_HEX, secret: WEBHOOK_SECRET }),
      UsageError,
    );
  });

  test('short signature returns false', () => {
    assert.equal(explainWebhook({ rawBody: RAW, signature: 'aa', secret: WEBHOOK_SECRET }).valid, false);
  });
});

describe('subunits', () => {
  test('INR paise and the ₹1 minimum', () => {
    assert.equal(toSubunits('299.00', 'INR'), 29900n);
    assert.equal(toSubunits('1', 'INR'), 100n);
    assert.equal(toSubunits('₹1,299.50', 'INR'), 129950n);
    const below = explainSubunits({ amount: '0.99', currency: 'INR' });
    assert.equal(below.valid, false);
    assert.match(below.errors[0], /minimum of 100/);
    assert.equal(explainSubunits({ amount: '100', currency: 'inr' }).subunits, '10000');
    assert.throws(() => toSubunits('1\u00B2.00', 'INR'));
    const roman = explainSubunits({ amount: '10.00', currency: '\u2160NR' });
    assert.equal(roman.valid, false);
    assert.notEqual(roman.subunits, '1000');
  });

  test('JPY is zero-decimal and KWD 1.005 is rejected', () => {
    assert.equal(toSubunits('295', 'JPY'), 295n);
    const fraction = explainSubunits({ amount: '295.0', currency: 'JPY' });
    assert.equal(fraction.valid, false);
    assert.match(fraction.errors[0], /decimal/);
    const kwd = explainSubunits({ amount: '1.005', currency: 'KWD' });
    assert.equal(kwd.valid, false);
    assert.match(kwd.errors[0], /subunit 0/);
    assert.throws(() => toSubunits('1.005', 'KWD'), /subunit 0/);
  });

  test('three-decimal currencies reject or zero the last digit', () => {
    for (const currency of ['KWD', 'BHD', 'OMR', 'IQD']) {
      assert.equal(explainSubunits({ amount: '295.991', currency }).valid, false);
      const adjusted = explainSubunits({ amount: '295.991', currency, zeroLastDigit: true });
      assert.equal(adjusted.valid, true);
      assert.equal(adjusted.subunits, '295990');
      assert.match(adjusted.warnings[0], /last subunit digit/);
    }
    assert.equal(toSubunits('1.010', 'KWD'), 1010n);
    assert.equal(toSubunits('99.990', 'BHD'), 99990n);
  });

  test('other published minima, exponent notation, and an unknown code', () => {
    const usd = explainSubunits({ amount: '0.49', currency: 'USD' });
    assert.equal(usd.valid, false);
    assert.equal(usd.confirm, true);
    assert.ok(usd.warnings.includes(CONFIRM_SENTENCE));
    assert.equal(toSubunits('0.50', 'USD'), 50n);
    assert.equal(toSubunits('0.30', 'GBP'), 30n);
    assert.equal(explainSubunits({ amount: '1e2', currency: 'INR' }).valid, false);
    assert.equal(explainSubunits({ amount: '-1.00', currency: 'INR' }).valid, false);
    assert.equal(explainSubunits({ amount: '1.00', currency: 'XYZ' }).valid, false);
    assert.equal(toSubunits(100n, 'INR'), 100n);
  });

  test('exponents come from razorpay.json', () => {
    const table = ruleById('razorpay', 'razorpay.currency.exponents', ON);
    const codes = Object.values(table.value).flat();
    assert.equal(new Set(codes).size, codes.length);
    assert.ok(table.value['2'].includes('INR'));
    assert.ok(table.value['0'].includes('JPY'));
    assert.deepEqual(table.value['3'], ['BHD', 'IQD', 'JOD', 'KWD', 'OMR', 'TND']);
    assert.equal(ruleById('razorpay', 'razorpay.amount.minimumSubunits', ON).value.INR, 100);
    const checkoutMinima = ruleById('razorpay', 'razorpay.amount.checkoutMinimumSubunits', ON);
    assert.equal(checkoutMinima.value.USD, 50);
    assert.equal(checkoutMinima.verified, false);
  });
});

describe('events', () => {
  const base = { signatureVerified: true, eventId: 'evt_1', seenEventIds: [] };

  test('fulfil only on captured or order.paid', () => {
    const fulfil = ruleById('razorpay', 'razorpay.fulfil.events', ON);
    assert.deepEqual(fulfil.value, ['payment.captured', 'order.paid']);
    const authorized = decideRazorpayEvent({ ...base, event: 'payment.authorized' });
    assert.equal(authorized.fulfil, false);
    assert.equal(authorized.action, 'record_authorized');
    assert.equal(authorized.httpStatus, 200);
    assert.match(authorized.warnings[0], /12/);
    assert.match(authorized.warnings[0], /4320/);
    const captured = decideRazorpayEvent({
      ...base,
      event: 'payment.captured',
      amountMinor: '50000',
      expectedMinor: '50000',
    });
    assert.equal(captured.fulfil, true);
    assert.equal(captured.capturedMinor, '50000');
    const paid = decideRazorpayEvent({
      ...base,
      event: 'order.paid',
      state: 'authorized',
      amountMinor: '50000',
      expectedMinor: '50000',
    });
    assert.equal(paid.fulfil, true);
    assert.equal(decideRazorpayEvent({ ...base, event: 'payment.captured', state: 'captured' }).fulfil, false);
    const repeat = decideRazorpayEvent({
      ...base,
      eventId: 'evt_repeat',
      event: 'payment.captured',
      state: 'captured',
      capturedMinor: '50000',
      amountMinor: '100',
    });
    assert.equal(repeat.action, 'amount_mismatch');
    assert.equal(repeat.valid, false);
    assert.equal(repeat.fulfil, false);
    assert.equal(repeat.capturedMinor, '50000');
    assert.equal(repeat.storeEventId, false);
    assert.equal(repeat.httpStatus, 400);
    const same = decideRazorpayEvent({
      ...base,
      eventId: 'evt_same',
      event: 'payment.captured',
      state: 'captured',
      capturedMinor: '50000',
      amountMinor: '50000',
    });
    assert.equal(same.action, 'already_fulfilled');
    assert.equal(same.capturedMinor, '50000');
    assert.equal(same.fulfil, false);
    const omitted = decideRazorpayEvent({
      ...base,
      eventId: 'evt_omit_captured',
      event: 'payment.captured',
      state: 'captured',
      capturedMinor: '50000',
    });
    assert.equal(omitted.action, 'already_fulfilled');
    assert.equal(omitted.httpStatus, 200);
    assert.equal(omitted.fulfil, false);
    assert.equal(omitted.capturedMinor, '50000');
    const mismatch = decideRazorpayEvent({
      ...base,
      event: 'payment.captured',
      amountMinor: '50000',
      expectedMinor: '100',
    });
    assert.equal(mismatch.fulfil, false);
    assert.equal(mismatch.action, 'amount_mismatch');
    assert.equal(mismatch.storeEventId, false);
    assert.equal(mismatch.httpStatus, 400);
    const matched = decideRazorpayEvent({
      ...base,
      event: 'payment.captured',
      amountMinor: '50000',
      expectedMinor: '50000',
    });
    assert.equal(matched.fulfil, true);
    assert.equal(matched.warnings.length, 0);
  });

  test('duplicate event id returns 200 and does not fulfil again', () => {
    const header = ruleById('razorpay', 'razorpay.webhook.eventIdHeader', ON);
    assert.equal(header.value, 'x-razorpay-event-id');
    const again = decideRazorpayEvent({
      ...base,
      event: 'payment.captured',
      seenEventIds: ['evt_1'],
      state: 'captured',
    });
    assert.equal(again.duplicate, true);
    assert.equal(again.fulfil, false);
    assert.equal(again.storeEventId, false);
    assert.equal(again.httpStatus, 200);
    assert.equal(again.ackWithinSeconds, 5);
    assert.equal(again.retryHours, 24);
  });

  test('out-of-order capture, failure, and late authorize', () => {
    const capturedFirst = decideRazorpayEvent({
      ...base,
      event: 'payment.captured',
      state: 'none',
      amountMinor: '50000',
      expectedMinor: '50000',
    });
    assert.equal(capturedFirst.fulfil, true);
    const lateAuth = decideRazorpayEvent({
      ...base,
      eventId: 'evt_2',
      event: 'payment.authorized',
      state: 'captured',
    });
    assert.equal(lateAuth.fulfil, false);
    assert.equal(lateAuth.state, 'captured');
    const retry = decideRazorpayEvent({
      ...base,
      eventId: 'evt_3',
      event: 'payment.captured',
      state: 'failed',
      amountMinor: '50000',
      expectedMinor: '50000',
    });
    assert.equal(retry.fulfil, true);
    const lateFail = decideRazorpayEvent({
      ...base,
      eventId: 'evt_4',
      event: 'payment.failed',
      state: 'captured',
    });
    assert.equal(lateFail.action, 'ignore_late');
    assert.equal(lateFail.state, 'captured');
  });

  test('partial refunds use captured minus refunded', () => {
    const ok = decideRazorpayEvent({
      ...base,
      event: 'refund.processed',
      state: 'captured',
      capturedMinor: '10000',
      refundedMinor: '4000',
      amountMinor: '6000',
      paymentCaptured: true,
    });
    assert.equal(ok.valid, true);
    assert.equal(ok.action, 'refund');
    assert.equal(ok.refundedMinor, '10000');
    assert.equal(ok.state, 'refunded');
    const over = decideRazorpayEvent({
      ...base,
      eventId: 'evt_over',
      event: 'refund.processed',
      state: 'captured',
      capturedMinor: '10000',
      refundedMinor: '4000',
      amountMinor: '6001',
      paymentCaptured: true,
    });
    assert.equal(over.valid, false);
    assert.match(over.errors[0], /exceeds captured minus refunded/);
    const early = decideRazorpayEvent({
      ...base,
      eventId: 'evt_early',
      event: 'refund.processed',
      state: 'authorized',
      amountMinor: '100',
      paymentCaptured: true,
    });
    assert.equal(early.httpStatus, 500);
    assert.equal(early.storeEventId, false);
    assert.equal(early.action, 'retry');
  });

  test('auto-refund, refund.failed, and refund.created do not fulfil', () => {
    const auto = decideRazorpayEvent({
      ...base,
      event: 'refund.processed',
      state: 'authorized',
      paymentCaptured: false,
      amountMinor: '100',
    });
    assert.equal(auto.action, 'auto_refund');
    assert.equal(auto.fulfil, false);
    assert.equal(auto.httpStatus, 200);
    const failed = decideRazorpayEvent({
      ...base,
      eventId: 'evt_rf',
      event: 'refund.failed',
      state: 'captured',
      capturedMinor: '10000',
      refundedMinor: '1000',
    });
    assert.equal(failed.refundedMinor, '1000');
    assert.equal(failed.action, 'refund_failed');
    const created = decideRazorpayEvent({ ...base, eventId: 'evt_rc', event: 'refund.created', state: 'captured' });
    assert.equal(created.action, 'refund_pending');
    assert.equal(created.refundedMinor, '0');
  });

  test('omitting expectedMinor does not fulfil or record a zero capture', () => {
    const captured = decideRazorpayEvent({ ...base, event: 'payment.captured', amountMinor: '50000' });
    assert.equal(captured.action, 'needs_amount');
    assert.equal(captured.fulfil, false);
    assert.equal(captured.valid, false);
    assert.equal(captured.storeEventId, false);
    assert.equal(captured.httpStatus, 400);
    assert.ok(captured.warnings.includes('Do not store the event id. Return non-2xx so Razorpay can retry.'));
    assert.equal(captured.state, 'none');
    assert.equal(captured.capturedMinor, '0');
    assert.match(captured.errors[0], /expectedMinor/);
    const paid = decideRazorpayEvent({
      ...base,
      eventId: 'evt_paid_omit',
      event: 'order.paid',
      state: 'authorized',
    });
    assert.equal(paid.action, 'needs_amount');
    assert.equal(paid.fulfil, false);
    assert.equal(paid.state, 'authorized');
    assert.equal(paid.capturedMinor, '0');
    assert.match(paid.errors[0], /capturedMinor 0|amountMinor/);
  });

  test('signed zero does not fulfil', () => {
    const row = decideRazorpayEvent({
      ...base,
      event: 'payment.captured',
      amountMinor: '-0',
      expectedMinor: '0',
    });
    assert.equal(row.action, 'amount_mismatch');
    assert.equal(row.fulfil, false);
    assert.equal(row.valid, false);
    assert.equal(row.storeEventId, false);
    assert.equal(row.httpStatus, 400);
    assert.notEqual(row.state, 'captured');
    const both = decideRazorpayEvent({
      ...base,
      eventId: 'evt_neg_both',
      event: 'order.paid',
      amountMinor: '-0',
      expectedMinor: '-0',
    });
    assert.equal(both.fulfil, false);
    assert.equal(both.action, 'amount_mismatch');
  });

  test('a JSON number of subunits is a usage error', () => {
    assert.throws(
      () => decideRazorpayEvent({ ...base, event: 'payment.captured', amountMinor: 100 }),
      UsageError,
    );
  });

  test('signature must be verified first', () => {
    const blocked = decideRazorpayEvent({ ...base, signatureVerified: false, event: 'payment.captured' });
    assert.equal(blocked.httpStatus, 400);
    assert.equal(blocked.fulfil, false);
  });
});

describe('handlers and evals', () => {
  test('Express, Next.js, and Fastify read the raw body', () => {
    const text = readFileSync(join(skillRoot, 'references', 'handlers.md'), 'utf8');
    const skill = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8');
    assert.match(text, /express\.raw\(\{ type: 'application\/json' \}\)/);
    assert.match(text, /await req\.text\(\)/);
    assert.match(text, /parseAs: 'buffer'/);
    assert.match(text, /Do not pass `JSON\.stringify\(req\.body\)`/);
    assert.doesNotMatch(text, /\.update\(JSON\.stringify/);
    assert.match(text, /server-side only/);
    assert.match(text, /FOR UPDATE/);
    assert.match(text, /seenEventIds/);
    assert.match(text, /razorpay_events/);
    assert.doesNotMatch(text, /typeof entity\?\.amount === 'string'/);
    assert.doesNotMatch(skill, /typeof entity\?\.amount === 'string'/);
    assert.doesNotMatch(text, /lookupStoredPayment\(paymentId\)/);
    for (const section of [text, skill.slice(skill.indexOf('### Raw body'), skill.indexOf('## Edge cases'))]) {
      assert.match(section, /planRazorpayWebhook\(/);
      assert.match(section, /FOR UPDATE/);
      assert.match(section, /UsageError/);
      assert.match(section, /plan\.ship/);
      assert.match(section, /plan\.status/);
    }
    const skillCode = skill.slice(skill.indexOf('app.post'), skill.indexOf('## Edge cases'));
    const skillLock = skillCode.indexOf('FOR UPDATE');
    const skillPlan = skillCode.indexOf('planRazorpayWebhook(');
    const skillShip = skillCode.indexOf('plan.ship');
    const skillStatus = skillCode.lastIndexOf('plan.status');
    assert.ok(skillLock > 0 && skillPlan > skillLock && skillShip > skillPlan && skillStatus > skillShip);
    for (const [heading, next] of [['## Express', '## Next.js'], ['## Next.js', '## Fastify'], ['## Fastify', '']]) {
      const start = text.indexOf(heading);
      const end = next ? text.indexOf(next) : text.length;
      const section = text.slice(start, end);
      const lockAt = section.indexOf('FOR UPDATE');
      const planAt = section.indexOf('planRazorpayWebhook(');
      const guardAt = section.indexOf("plan.decision?.action === 'amount_mismatch'");
      const shipAt = section.indexOf('plan.ship');
      const statusAt = section.lastIndexOf('plan.status');
      assert.ok(lockAt > 0, heading);
      assert.ok(planAt > lockAt, heading);
      assert.ok(guardAt > planAt, heading);
      assert.ok(shipAt > guardAt, heading);
      assert.ok(statusAt > shipAt, heading);
    }
  });

  test('a missing signature is a usage error and the handler maps it to 400', () => {
    assert.throws(
      () => verifyWebhook({ rawBody: '{}', secret: 'whsec_test' }),
      UsageError,
    );
    assert.equal(webhookStatus({ rawBody: '{}', secret: 'whsec_test' }), 400);
    assert.equal(webhookStatus({ rawBody: '{}', signature: 1, secret: 'whsec_test' }), 400);
  });

  test('a captured payment then order.paid ships once, and a later refund is 200', async () => {
    const store = lockedStore();
    store.orders.set('order_1', 50000);
    const captured = {
      event: 'payment.captured',
      payload: {
        payment: { entity: { id: 'pay_1', amount: 50000, order_id: 'order_1', captured: true } },
      },
    };
    const first = await store.deliver(captured, 'evt_cap');
    assert.equal(first.status, 200);
    assert.equal(first.decision.action, 'fulfil');
    assert.equal(first.ship, true);
    assert.deepEqual(store.shipped, ['evt_cap']);
    assert.equal(store.payments.get('pay_1').state, 'captured');
    assert.equal(store.payments.get('pay_1').capturedMinor, '50000');

    const paid = await store.deliver({ ...captured, event: 'order.paid' }, 'evt_paid');
    assert.equal(paid.status, 200);
    assert.equal(paid.decision.action, 'already_fulfilled');
    assert.equal(paid.ship, false);
    assert.deepEqual(store.shipped, ['evt_cap']);

    const earlyRefund = await store.deliver({
      event: 'refund.processed',
      payload: {
        refund: { entity: { amount: 1000, payment_id: 'pay_2' } },
        payment: { entity: { id: 'pay_2', captured: true } },
      },
    }, 'evt_early');
    assert.equal(earlyRefund.status, 500);
    assert.equal(earlyRefund.persist, false);
    assert.equal(store.payments.has('pay_2'), false);

    const refund = await store.deliver({
      event: 'refund.processed',
      payload: {
        refund: { entity: { amount: 6000, payment_id: 'pay_1' } },
        payment: { entity: { id: 'pay_1', amount: 50000, captured: true, order_id: 'order_1' } },
      },
    }, 'evt_refund');
    assert.equal(refund.status, 200);
    assert.equal(refund.decision.action, 'refund');
    assert.equal(refund.ship, false);
    assert.equal(store.payments.get('pay_1').refundedMinor, '6000');
    assert.deepEqual(store.shipped, ['evt_cap']);

    const again = await store.deliver(captured, 'evt_cap');
    assert.equal(again.status, 200);
    assert.equal(again.decision.action, 'duplicate');
    assert.equal(again.persist, false);
    assert.deepEqual(store.shipped, ['evt_cap']);
  });

  test('overlapping capture and refunds under the row lock ship once and keep both refunds', async () => {
    const store = lockedStore();
    store.orders.set('order_1', 50000);
    const payment = { id: 'pay_1', amount: 50000, order_id: 'order_1', captured: true };
    const captured = { event: 'payment.captured', payload: { payment: { entity: payment } } };
    const paid = { event: 'order.paid', payload: { payment: { entity: payment } } };
    const [cap, orderPaid] = await Promise.all([
      store.deliver(captured, 'evt_cap'),
      store.deliver(paid, 'evt_paid'),
    ]);
    assert.deepEqual(store.shipped, ['evt_cap']);
    assert.equal([cap, orderPaid].filter((item) => item.ship).length, 1);
    assert.equal(store.payments.get('pay_1').state, 'captured');
    const refund = (amount, eventId) => store.deliver({
      event: 'refund.processed',
      payload: {
        refund: { entity: { amount, payment_id: 'pay_1' } },
        payment: { entity: payment },
      },
    }, eventId);
    const [small, large] = await Promise.all([refund(1000, 'evt_r1'), refund(2000, 'evt_r2')]);
    assert.equal(small.status, 200);
    assert.equal(large.status, 200);
    assert.equal(small.ship, false);
    assert.equal(large.ship, false);
    assert.equal(store.payments.get('pay_1').refundedMinor, '3000');
    assert.deepEqual(store.shipped, ['evt_cap']);
  });

  test('a JSON number amount is accepted and an unsafe amount is 400', () => {
    assert.equal(subunitString(50000), '50000');
    assert.equal(subunitString('50000'), '50000');
    assert.throws(() => subunitString(1.5), UsageError);
    assert.throws(() => subunitString(Number.MAX_SAFE_INTEGER + 2), UsageError);
    const raw = '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_1","amount":50000,"order_id":"order_1"}},"order":{"entity":{"amount":1}}}}';
    assert.equal(jsonIntegerToken(raw, ['payload', 'payment', 'entity', 'amount']), '50000');
    assert.equal(
      jsonIntegerToken('{"note":"amount\\": 9","payload":{"payment":{"entity":{"amount":50000}}}}', ['payload', 'payment', 'entity', 'amount']),
      '50000',
    );
    assert.equal(jsonIntegerToken(raw, ['payload', 'order', 'entity', 'amount']), '1');
    assert.throws(() => jsonIntegerToken('{"payload":{"payment":{"entity":{"amount":50000.5}}}}', ['payload', 'payment', 'entity', 'amount']), /integer/);
    assert.throws(() => jsonIntegerToken('{"payload":{"payment":{"entity":{"amount":1e2}}}}', ['payload', 'payment', 'entity', 'amount']), /integer/);
    assert.throws(() => jsonIntegerToken(`${raw} trailing`, ['payload', 'payment', 'entity', 'amount']), /trailing data/);
    assert.equal(jsonIntegerToken(`${raw}  \n`, ['payload', 'payment', 'entity', 'amount']), '50000');
    const event = JSON.parse(raw);
    const plan = planRazorpayWebhook({
      signatureVerified: true,
      event,
      eventId: 'evt_num',
      rawBody: raw,
      storedPayment: null,
      expectedAmount: 50000,
    });
    assert.equal(plan.decision.action, 'fulfil');
    assert.equal(plan.ship, true);
    assert.equal(plan.payment.capturedMinor, '50000');
    assert.deepEqual(plan.payment.seenEventIds, ['evt_num']);
    const fraction = planRazorpayWebhook({
      signatureVerified: true,
      event: { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', amount: 1.5 } } } },
      eventId: 'evt_bad',
      rawBody: '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_1","amount":1.5}}}}',
      storedPayment: null,
      expectedAmount: '2',
    });
    assert.equal(fraction.status, 400);
    assert.equal(fraction.persist, false);
    assert.equal(fraction.ship, false);
    assert.equal(razorpayPaymentId(event), 'pay_1');
  });

  test('evals.json expectations match the scripts', () => {
    const evals = JSON.parse(readFileSync(join(repoRoot, 'evals', 'razorpay-integration', 'evals.json'), 'utf8'));
    assert.equal(evals.skill, 'razorpay-integration');
    for (const item of evals.evals) {
      const result = runExpect(item.expect);
      for (const [key, value] of Object.entries(item.expect)) {
        if (key === 'op' || key === 'input' || key === 'errorIncludes') continue;
        assert.deepEqual(result[key], value, item.id);
      }
      if (item.expect.errorIncludes) {
        assert.ok(result.errors.some((error) => error.includes(item.expect.errorIncludes)), item.id);
      }
    }
  });
});

describe('CLI', () => {
  test('exit codes for subunits, signature, webhook, and usage', () => {
    const subunits = run('to-subunits.mjs', ['--json', '{"amount":"299.00","currency":"INR"}']);
    assert.equal(subunits.status, 0);
    assert.equal(JSON.parse(subunits.stdout).subunits, '29900');

    const badKwd = run('to-subunits.mjs', ['--json', '{"amount":"1.005","currency":"KWD"}']);
    assert.equal(badKwd.status, 1);

    const signature = run('verify-payment-signature.mjs', [
      '--json',
      JSON.stringify({ orderId: ORDER, paymentId: PAYMENT, signature: CHECKOUT_HEX, secret: KEY }),
    ]);
    assert.equal(signature.status, 0);
    assert.equal(JSON.parse(signature.stdout).valid, true);

    const webhook = run('verify-webhook.mjs', [
      '--json',
      JSON.stringify({ rawBody: RAW, signature: WEBHOOK_HEX, secret: WEBHOOK_SECRET }),
    ]);
    assert.equal(webhook.status, 0);

    const usage = run('to-subunits.mjs', []);
    assert.equal(usage.status, 2);
    assert.equal(JSON.parse(usage.stdout).valid, false);

    const decision = run('decide-event.mjs', [
      '--json',
      '{"signatureVerified":true,"eventId":"evt_1","event":"payment.authorized"}',
    ]);
    assert.equal(decision.status, 0);
    assert.equal(JSON.parse(decision.stdout).fulfil, false);
  });
});

function webhookStatus(input) {
  try {
    return verifyWebhook(input) ? 200 : 400;
  } catch (error) {
    if (error instanceof UsageError) return 400;
    throw error;
  }
}

function lockedStore() {
  const payments = new Map();
  const events = new Map();
  const orders = new Map();
  const shipped = [];
  const tails = new Map();

  function deliver(event, eventId) {
    const paymentId = razorpayPaymentId(event) || '_';
    const prev = tails.get(paymentId) ?? Promise.resolve();
    const run = prev.then(() => {
      const seenEventIds = [...events.entries()].filter(([, id]) => id === paymentId).map(([evt]) => evt);
      const row = payments.get(paymentId);
      const plan = planRazorpayWebhook({
        signatureVerified: true,
        event,
        eventId,
        rawBody: JSON.stringify(event),
        storedPayment: {
          state: row?.state,
          capturedMinor: row?.capturedMinor,
          refundedMinor: row?.refundedMinor,
          seenEventIds,
        },
        expectedAmount: event?.payload?.payment?.entity?.order_id === undefined
          ? undefined
          : orders.get(event.payload.payment.entity.order_id),
      });
      if (!plan.persist) return plan;
      events.set(eventId, paymentId);
      payments.set(paymentId, { ...plan.payment });
      return plan;
    });
    tails.set(paymentId, run.then(() => {}, () => {}));
    return run.then((plan) => {
      if (plan.ship) shipped.push(eventId);
      return plan;
    });
  }

  return { payments, orders, shipped, deliver };
}

function runExpect(expect) {
  if (expect.op === 'subunits') return explainSubunits(expect.input);
  if (expect.op === 'signature') return explainPaymentSignature(expect.input);
  if (expect.op === 'webhook') return explainWebhook(expect.input);
  if (expect.op === 'event') return decideRazorpayEvent(expect.input);
  throw new Error(`unknown op ${expect.op}`);
}

function run(script, args) {
  const result = spawnSync(process.execPath, [join(skillRoot, 'scripts', script), ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return result;
}
