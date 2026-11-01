# Raw-body handlers

Cashfree signs `x-webhook-timestamp` concatenated with the raw body. Pass those exact values to `verifyCashfreeWebhook`. Do not pass `JSON.stringify(req.body)`. A parsed `payment_amount` of `170.00` can come back as `170` and the signature will not match.

Version `2025-01-01` (and `2026-01-01`) sends `x-idempotency-key`. Deduplicate on that header. Fulfil only when `payment_status` is `SUCCESS`.

## Express

Keep the Buffer from `express.raw` for the signature, and read `x-webhook-timestamp` as the header string.

```javascript
import express from 'express';
import { verifyCashfreeWebhook } from './cashfree.mjs';

const app = express();

app.post('/cashfree/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body;
  const timestamp = req.get('x-webhook-timestamp');
  const result = verifyCashfreeWebhook({
    rawBody,
    timestamp,
    signature: req.get('x-webhook-signature'),
    secret: process.env.CASHFREE_CLIENT_SECRET,
    nowMs: Date.now(),
  });
  if (!result.valid) return res.status(400).end();
  res.status(200).end();
  const event = JSON.parse(rawBody.toString('utf8'));
  void event;
});

app.use(express.json());
```

## Next.js route handler

`await req.text()` is the raw body. Do not call `req.json()` first.

```javascript
import { verifyCashfreeWebhook } from '../../../scripts/cashfree.mjs';

export const runtime = 'nodejs';

export async function POST(req) {
  const rawBody = await req.text();
  const result = verifyCashfreeWebhook({
    rawBody,
    timestamp: req.headers.get('x-webhook-timestamp'),
    signature: req.headers.get('x-webhook-signature'),
    secret: process.env.CASHFREE_CLIENT_SECRET,
    nowMs: Date.now(),
  });
  if (!result.valid) return new Response(result.reason, { status: 400 });
  return new Response(null, { status: 200 });
}
```

## Fastify

```javascript
import { verifyCashfreeWebhook } from './cashfree.mjs';

fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  req.rawBody = body;
  try {
    done(null, JSON.parse(body.toString('utf8')));
  } catch (error) {
    error.statusCode = 400;
    done(error, undefined);
  }
});

fastify.post('/cashfree/webhook', async (req, reply) => {
  const result = verifyCashfreeWebhook({
    rawBody: req.rawBody,
    timestamp: req.headers['x-webhook-timestamp'],
    signature: req.headers['x-webhook-signature'],
    secret: process.env.CASHFREE_CLIENT_SECRET,
    nowMs: Date.now(),
  });
  if (!result.valid) return reply.code(400).send({ reason: result.reason });
  return reply.code(200).send();
});
```
