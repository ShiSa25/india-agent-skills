/**
 * node-pg transaction for a Cashfree webhook.
 * `client` is a PoolClient: query() returns { rows, rowCount }.
 * The caller ships only after this function commits, and only when fulfil is true.
 */
import { decideCashfreeEvent } from '../scripts/cashfree.mjs';

export const INSERT_ORDER =
  "INSERT INTO orders (order_id, prior_status) VALUES ($1, 'none') ON CONFLICT (order_id) DO NOTHING";

export const LOCK_ORDER =
  'SELECT prior_status FROM orders WHERE order_id = $1 FOR UPDATE';

export const SELECT_KEYS =
  'SELECT idempotency_key FROM cashfree_events WHERE order_id = $1';

export const INSERT_KEY =
  'INSERT INTO cashfree_events (idempotency_key, order_id) VALUES ($1, $2)';

export const UPDATE_ORDER =
  'UPDATE orders SET prior_status = $2 WHERE order_id = $1';

export async function applyCashfreeWebhook(client, input) {
  await client.query('BEGIN');
  try {
    await client.query(INSERT_ORDER, [input.orderId]);
    const locked = await client.query(LOCK_ORDER, [input.orderId]);
    const row = locked.rows[0];
    if (!row) {
      throw new Error('order row was not locked');
    }
    const seen = await client.query(SELECT_KEYS, [input.orderId]);
    const decision = decideCashfreeEvent({
      signatureVerified: input.signatureVerified === true,
      version: input.version,
      idempotencyKey: input.idempotencyKey,
      paymentStatus: input.paymentStatus,
      paymentAmount: input.paymentAmount,
      expectedAmount: input.expectedAmount,
      priorStatus: row.prior_status,
      seenKeys: seen.rows.map((item) => item.idempotency_key),
    });
    if (!decision.storeKey) {
      await client.query('COMMIT');
      return decision;
    }
    try {
      await client.query(INSERT_KEY, [input.idempotencyKey, input.orderId]);
    } catch (error) {
      if (error?.code === '23505') {
        await client.query('ROLLBACK');
        return { ...decision, httpStatus: 200, fulfil: false, storeKey: false, action: 'duplicate' };
      }
      throw error;
    }
    const updated = await client.query(UPDATE_ORDER, [input.orderId, decision.priorStatus]);
    if (updated.rowCount !== 1) {
      throw new Error('order update did not change one row');
    }
    await client.query('COMMIT');
    return decision;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}
