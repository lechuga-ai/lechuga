import { Hono } from "hono";
import type { AppEnv, Env } from "./types";
import { applyOnce } from "./credits";
import { verifyWebhook } from "./stripe";
import config from "../config.json";

// Only the fields read below; Stripe sends far more.
type CheckoutSession = {
  id: string;
  mode: "payment" | "subscription" | "setup";
  payment_status: string;
  customer: string | null;
  metadata: { user_id?: string; pack?: string } | null;
};
type Invoice = { id: string; customer: string | null; amount_paid: number; billing_reason: string | null };
type Subscription = { customer: string };
type Charge = {
  id: string;
  customer: string | null;
  amount: number;
  amount_refunded: number;
  metadata: { user_id?: string; credits?: string } | null;
};
type StripeEvent = { id: string; type: string; data: { object: unknown } };

async function userIdForCustomer(env: Env, customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const row = await env.DB.prepare("SELECT id FROM user WHERE stripe_customer_id = ?").bind(customerId).first<{ id: string }>();
  return row?.id ?? null;
}

// A finished Checkout. A pack is credited here, keyed by the session id. A
// subscription only flips the status: its credits come from invoice.paid, the
// same way every later renewal's do.
async function checkoutCompleted(env: Env, session: CheckoutSession) {
  const userId = session.metadata?.user_id;
  if (!userId) return;
  if (session.mode === "subscription") {
    await env.DB.prepare("UPDATE user SET subscription_status = 'active' WHERE id = ?").bind(userId).run();
    return;
  }
  if (session.mode !== "payment" || session.payment_status !== "paid") return;
  // The amount comes from config, not from the request, so nothing a
  // customer can touch decides how many credits a pack is worth.
  const pack = config.credit_packs.find((p) => p.id === session.metadata?.pack);
  if (!pack) return;
  await applyOnce(env, { userId, delta: pack.credits, reason: "purchase", ref: session.id, paidCents: pack.usd * 100 });
}

// First payment and every renewal of the subscription. Adding to the balance
// each time is all "rollover" is: nothing ever expires.
async function invoicePaid(env: Env, invoice: Invoice) {
  if (!invoice.billing_reason?.startsWith("subscription") || invoice.amount_paid <= 0) return;
  const userId = await userIdForCustomer(env, invoice.customer);
  if (!userId) return;
  await applyOnce(env, {
    userId,
    delta: config.subscription.credits,
    reason: "subscription",
    ref: invoice.id,
    paidCents: invoice.amount_paid,
  });
  await env.DB.prepare("UPDATE user SET subscription_status = 'active' WHERE id = ?").bind(userId).run();
}

// Cancelled (the portal cancels immediately). Credits stay.
async function subscriptionDeleted(env: Env, subscription: Subscription) {
  await env.DB.prepare("UPDATE user SET subscription_status = 'cancelled' WHERE stripe_customer_id = ?")
    .bind(subscription.customer)
    .run();
}

// Takes back credits in proportion to the money refunded. A charge can be
// refunded in several parts, and the event carries the running total, so each
// row covers only what earlier refund rows for this charge haven't already.
async function chargeRefunded(env: Env, charge: Charge) {
  const userId = charge.metadata?.user_id ?? (await userIdForCustomer(env, charge.customer));
  if (!userId || charge.amount <= 0) return;
  // Packs carry their credit count on the charge (set at checkout). A
  // subscription charge doesn't, so it falls back to the monthly grant.
  const granted = Number(charge.metadata?.credits) || config.subscription.credits;
  const owed = Math.round((granted * charge.amount_refunded) / charge.amount);
  const prior = await env.DB.prepare(
    "SELECT COALESCE(SUM(delta), 0) AS total, COALESCE(SUM(paid_cents), 0) AS cents FROM credit_ledger WHERE reason = 'refund' AND ref LIKE ?"
  )
    .bind(`${charge.id}:%`)
    .first<{ total: number; cents: number }>();
  const delta = -owed - (prior?.total ?? 0);
  if (delta >= 0) return;
  await applyOnce(env, {
    userId,
    delta,
    reason: "refund",
    ref: `${charge.id}:${charge.amount_refunded}`,
    // Money back out, less what earlier refund rows for this charge recorded.
    paidCents: -charge.amount_refunded - (prior?.cents ?? 0),
  });
}

// Public: Stripe calls this, not a signed-in user, so it's registered before
// the session check in index.ts. The signature is what proves who's calling.
export const billingWebhook = new Hono<AppEnv>();

billingWebhook.post("/", async (c) => {
  if (!c.env.STRIPE_WEBHOOK_SECRET) return c.json({ error: "billing isn't set up here" }, 503);
  const body = await c.req.text();
  if (!(await verifyWebhook(c.env.STRIPE_WEBHOOK_SECRET, c.req.header("stripe-signature"), body))) {
    return c.json({ error: "bad signature" }, 400);
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(body) as StripeEvent;
  } catch {
    return c.json({ error: "not JSON" }, 400);
  }
  const object = event.data?.object;
  if (!object) return c.json({ error: "no event object" }, 400);
  // A thrown error becomes a 500, and Stripe retries for up to three days.
  // Every handler is safe to run again, so that's the right outcome.
  switch (event.type) {
    case "checkout.session.completed":
      await checkoutCompleted(c.env, object as CheckoutSession);
      break;
    case "invoice.paid":
      await invoicePaid(c.env, object as Invoice);
      break;
    case "customer.subscription.deleted":
      await subscriptionDeleted(c.env, object as Subscription);
      break;
    case "charge.refunded":
      await chargeRefunded(c.env, object as Charge);
      break;
  }
  return c.json({ received: true });
});
