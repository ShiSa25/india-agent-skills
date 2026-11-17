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
