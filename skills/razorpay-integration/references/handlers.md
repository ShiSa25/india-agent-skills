# Raw-body handlers

Razorpay signs the exact request bytes. Read those bytes and pass them to `verifyWebhook`. Do not pass `JSON.stringify(req.body)`. Parsing and stringifying changes spaces, key order, and number text, so a genuine webhook fails.

The checkout callback is not this path. Checkout verification is `order_id|payment_id` with the key secret. Webhooks use the webhook secret and header `X-Razorpay-Signature`.

Return 2xx within 5 seconds. Deduplicate on `x-razorpay-event-id` with a unique constraint in the same transaction as the side effect.

## Express

Register this route before `express.json()`. `express.raw` leaves `req.body` as a Buffer.

```javascript
import express from 'express';
import { verifyWebhook } from './razorpay.mjs';

const app = express();

app.post('/razorpay/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body;
  const ok = verifyWebhook({
    rawBody,
    signature: req.get('x-razorpay-signature'),
    secret: process.env.RAZORPAY_WEBHOOK_SECRET,
  });
  if (!ok) return res.status(400).end();
  res.status(200).end();
  const event = JSON.parse(rawBody.toString('utf8'));
  // Persist x-razorpay-event-id, then fulfil only on payment.captured or order.paid.
  void event;
});

app.use(express.json());
```

## Next.js route handler

Call `req.text()` before any `req.json()`. The string is the raw body.

```javascript
import { verifyWebhook } from '../../../scripts/razorpay.mjs';

export const runtime = 'nodejs';

export async function POST(req) {
  const rawBody = await req.text();
  const ok = verifyWebhook({
    rawBody,
    signature: req.headers.get('x-razorpay-signature'),
    secret: process.env.RAZORPAY_WEBHOOK_SECRET,
  });
  if (!ok) return new Response('invalid signature', { status: 400 });
  const event = JSON.parse(rawBody);
  return new Response(null, { status: 200 });
}
```

## Fastify

Replace the default JSON parser so the Buffer is kept on `req.rawBody`. Sign that Buffer.

```javascript
import { verifyWebhook } from './razorpay.mjs';

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
  const ok = verifyWebhook({
    rawBody: req.rawBody,
    signature: req.headers['x-razorpay-signature'],
    secret: process.env.RAZORPAY_WEBHOOK_SECRET,
  });
  if (!ok) return reply.code(400).send();
  return reply.code(200).send();
});
```
