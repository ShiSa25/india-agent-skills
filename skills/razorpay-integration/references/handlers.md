# Raw-body handlers

Razorpay signs the exact request bytes. Read those bytes and pass them to `verifyWebhook`. Do not pass `JSON.stringify(req.body)`. A missing or non-string signature throws `UsageError`. Catch it and return 400.

The checkout callback is not this path. Checkout verification is `order_id|payment_id` with the key secret. Webhooks use the webhook secret and header `X-Razorpay-Signature`.

The key id may be in the checkout page. The key secret and the webhook secret are server-side only. Do not put them in a browser bundle, a mobile app, or a `NEXT_PUBLIC_`, `VITE_`, or `REACT_APP_` variable, and do not log them.

`amount` in the body is a JSON number. [`examples/apply-webhook.mjs`](../examples/apply-webhook.mjs) is the transaction. It uses a node-pg `PoolClient`: `query` returns `{ rows, rowCount }`. The handler reads `locked.rows[0]` and `seen.rows.map`. It does not treat one result as both a row and a list.

The statements, in order, inside `BEGIN` / `COMMIT`: insert the payment with `ON CONFLICT (id) DO NOTHING` (a missing row is not locked by `FOR UPDATE`), `SELECT ... FOR UPDATE`, read event ids for that payment, `planRazorpayWebhook`, then insert the event id and `UPDATE` the payment. `rowCount` must be 1. A unique violation `23505` rolls back and returns 200 with `ship: false`. The function commits before it returns. The route ships only after that return, and only when `plan.ship` is true.

A second transaction that starts after the first commits does not ship again. Two refunds, one after the other, both stay in `refunded_minor`. The test runs these statements on PGlite, which is one connection, so the second transaction waits until the first commits. That is the limit of this test. A node-pg pool uses the same SQL; `FOR UPDATE` is what blocks the other connection.

Copy the module below without edits. The test fails if this copy drifts.

```javascript
/**
 * node-pg transaction for a Razorpay webhook.
 * `client` is a PoolClient: query() returns { rows, rowCount }.
 * The caller ships only after this function commits, and only when ship is true.
 */
import { planRazorpayWebhook, razorpayPaymentId } from '../scripts/razorpay.mjs';

export const INSERT_PAYMENT =
  "INSERT INTO payments (id, state, captured_minor, refunded_minor) VALUES ($1, 'none', '0', '0') ON CONFLICT (id) DO NOTHING";

export const LOCK_PAYMENT =
  'SELECT state, captured_minor, refunded_minor FROM payments WHERE id = $1 FOR UPDATE';

export const SELECT_EVENTS =
  'SELECT event_id FROM razorpay_events WHERE payment_id = $1';

export const INSERT_EVENT =
  'INSERT INTO razorpay_events (event_id, payment_id) VALUES ($1, $2)';

export const UPDATE_PAYMENT =
  'UPDATE payments SET state = $2, captured_minor = $3, refunded_minor = $4 WHERE id = $1';

export async function applyRazorpayWebhook(client, input) {
  const paymentId = razorpayPaymentId(input.event);
  await client.query('BEGIN');
  try {
    await client.query(INSERT_PAYMENT, [paymentId]);
    const locked = await client.query(LOCK_PAYMENT, [paymentId]);
    const row = locked.rows[0];
    if (!row) {
      throw new Error('payment row was not locked');
    }
    const seen = await client.query(SELECT_EVENTS, [paymentId]);
    const plan = planRazorpayWebhook({
      signatureVerified: input.signatureVerified === true,
      event: input.event,
      eventId: input.eventId,
      rawBody: input.rawBody,
      expectedAmount: input.expectedAmount,
      storedPayment: {
        state: row.state,
        capturedMinor: row.captured_minor,
        refundedMinor: row.refunded_minor,
        seenEventIds: seen.rows.map((item) => item.event_id),
      },
    });
    if (!plan.persist) {
      await client.query('COMMIT');
      return plan;
    }
    try {
      await client.query(INSERT_EVENT, [input.eventId, paymentId]);
    } catch (error) {
      if (error?.code === '23505') {
        await client.query('ROLLBACK');
        return { status: 200, decision: plan.decision, paymentId, persist: false, ship: false, payment: null };
      }
      throw error;
    }
    const updated = await client.query(UPDATE_PAYMENT, [
      paymentId,
      plan.payment.state,
      plan.payment.capturedMinor,
      plan.payment.refundedMinor,
    ]);
    if (updated.rowCount !== 1) {
      throw new Error('payment update did not change one row');
    }
    await client.query('COMMIT');
    return plan;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}
```

## Express

Register this route before `express.json()`. `express.raw` leaves `req.body` as a Buffer. `pg` is the app's dependency. This skill does not import it.

```javascript
import express from 'express';
import pg from 'pg';
import { UsageError, verifyWebhook } from './razorpay.mjs';
import { applyRazorpayWebhook } from './examples/apply-webhook.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const app = express();

app.post('/razorpay/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const rawBody = req.body;
  let ok;
  try {
    ok = verifyWebhook({
      rawBody,
      signature: req.get('x-razorpay-signature'),
      secret: process.env.RAZORPAY_WEBHOOK_SECRET,
    });
  } catch (error) {
    if (error instanceof UsageError) return res.status(400).end();
    throw error;
  }
  if (!ok) return res.status(400).end();
  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).end();
  }
  const client = await pool.connect();
  try {
    const plan = await applyRazorpayWebhook(client, {
      signatureVerified: true,
      event,
      eventId: req.get('x-razorpay-event-id') ?? '',
      rawBody,
      expectedAmount: lookupStoredOrderAmount(event?.payload?.payment?.entity?.order_id),
    });
    if (plan.ship) ship(plan.paymentId);
    return res.status(plan.status).end();
  } finally {
    client.release();
  }
});

app.use(express.json());
```

## Next.js route handler

Call `req.text()` before any `req.json()`. The string is the raw body.

```javascript
import pg from 'pg';
import { UsageError, verifyWebhook } from '../../../scripts/razorpay.mjs';
import { applyRazorpayWebhook } from '../../../examples/apply-webhook.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export const runtime = 'nodejs';

export async function POST(req) {
  const rawBody = await req.text();
  let ok;
  try {
    ok = verifyWebhook({
      rawBody,
      signature: req.headers.get('x-razorpay-signature'),
      secret: process.env.RAZORPAY_WEBHOOK_SECRET,
    });
  } catch (error) {
    if (error instanceof UsageError) return new Response(null, { status: 400 });
    throw error;
  }
  if (!ok) return new Response(null, { status: 400 });
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response(null, { status: 400 });
  }
  const client = await pool.connect();
  try {
    const plan = await applyRazorpayWebhook(client, {
      signatureVerified: true,
      event,
      eventId: req.headers.get('x-razorpay-event-id') ?? '',
      rawBody,
      expectedAmount: lookupStoredOrderAmount(event?.payload?.payment?.entity?.order_id),
    });
    if (plan.ship) ship(plan.paymentId);
    return new Response(null, { status: plan.status });
  } finally {
    client.release();
  }
}
```

## Fastify

Replace the default JSON parser so the Buffer is kept on `req.rawBody`. Sign that Buffer.

```javascript
import pg from 'pg';
import { UsageError, verifyWebhook } from './razorpay.mjs';
import { applyRazorpayWebhook } from './examples/apply-webhook.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  req.rawBody = body;
  try {
    done(null, JSON.parse(body.toString('utf8')));
  } catch (error) {
    error.statusCode = 400;
    done(error, undefined);
  }
});

fastify.post('/razorpay/webhook', async (req, reply) => {
  let ok;
  try {
    ok = verifyWebhook({
      rawBody: req.rawBody,
      signature: req.headers['x-razorpay-signature'],
      secret: process.env.RAZORPAY_WEBHOOK_SECRET,
    });
  } catch (error) {
    if (error instanceof UsageError) return reply.code(400).send();
    throw error;
  }
  if (!ok) return reply.code(400).send();
  const client = await pool.connect();
  try {
    const plan = await applyRazorpayWebhook(client, {
      signatureVerified: true,
      event: req.body,
      eventId: req.headers['x-razorpay-event-id'] ?? '',
      rawBody: req.rawBody,
      expectedAmount: lookupStoredOrderAmount(req.body?.payload?.payment?.entity?.order_id),
    });
    if (plan.ship) ship(plan.paymentId);
    return reply.code(plan.status).send();
  } finally {
    client.release();
  }
});
```
