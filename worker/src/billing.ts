import { Hono, type Context } from "hono";
import type { AppEnv } from "./types";
import { creditsEnforced } from "./credits";
import { priceIdFor, stripe, StripeError } from "./stripe";
import config from "../config.json";

// Every route here runs after the session check in index.ts. Stripe's hosted
// pages take the card; nothing about a card ever reaches this worker. Credits
// are added by billing-webhook.ts when Stripe reports the payment, never here.
export const billing = new Hono<AppEnv>();

type BillingRow = { balance: number; stripe_customer_id: string | null; subscription_status: "active" | "cancelled" | null };

async function billingRow(c: Context<AppEnv>): Promise<BillingRow | null> {
  return c.env.DB.prepare("SELECT balance, stripe_customer_id, subscription_status FROM user WHERE id = ?")
    .bind(c.get("userId"))
    .first<BillingRow>();
}

// One Stripe Customer per user, created the first time they head to checkout.
async function customerFor(c: Context<AppEnv>, row: BillingRow): Promise<string> {
  if (row.stripe_customer_id) return row.stripe_customer_id;
  const customer = await stripe<{ id: string }>(c.env, "POST", "/customers", {
    email: c.get("userEmail"),
    metadata: { user_id: c.get("userId"), username: c.get("username") ?? "" },
  });
  // Two quick clicks could both get here; the first id written is kept.
  await c.env.DB.prepare("UPDATE user SET stripe_customer_id = ? WHERE id = ? AND stripe_customer_id IS NULL")
    .bind(customer.id, c.get("userId"))
    .run();
  return (await billingRow(c))?.stripe_customer_id ?? customer.id;
}

function stripeFailure(c: Context<AppEnv>, err: unknown) {
  console.error("stripe call failed", err);
  // Stripe's own wording (a missing key permission, say) helps an admin and
  // nobody else.
  const detail = c.get("isAdmin") && err instanceof StripeError ? err.message : undefined;
  return c.json({ error: "the payment page isn't reachable right now", detail }, 502);
}

// What the billing page shows.
billing.get("/", async (c) => {
  const [row, history] = await Promise.all([
    billingRow(c),
    // Everything that changed the balance other than replies: purchases,
    // the monthly plan, refunds, starter credits, gifts. Newest first. An
    // admin's note on a gift is for our records and isn't sent.
    c.env.DB.prepare(
      "SELECT id, reason, delta, paid_cents, created_at FROM credit_ledger WHERE user_id = ? AND reason != 'message' ORDER BY created_at DESC LIMIT 100"
    )
      .bind(c.get("userId"))
      .all<{ id: string; reason: string; delta: number; paid_cents: number | null; created_at: number }>(),
  ]);
  return c.json({
    history: history.results,
    balance: row?.balance ?? 0,
    subscriptionStatus: row?.subscription_status ?? null,
    hasCustomer: Boolean(row?.stripe_customer_id),
    // False where there's no Stripe key: the page shows the balance and no
    // buy buttons.
    purchasesOpen: creditsEnforced(c.env),
    packs: config.credit_packs,
    subscription: config.subscription,
    costs: config.costs,
  });
});

// {item: "leaf" | "head" | "monthly"} -> the URL of a Stripe Checkout page.
billing.post("/checkout", async (c) => {
  if (!creditsEnforced(c.env)) return c.json({ error: "purchases aren't open here yet" }, 503);
  const body = await c.req.json().catch(() => ({}));
  const pack = config.credit_packs.find((p) => p.id === body?.item);
  const monthly = body?.item === config.subscription.id;
  if (!pack && !monthly) return c.json({ error: "unknown item" }, 400);

  const row = await billingRow(c);
  if (!row) return c.json({ error: "not found" }, 404);
  if (monthly && row.subscription_status === "active") return c.json({ error: "you're already subscribed" }, 409);

  try {
    const meta = { user_id: c.get("userId"), pack: pack?.id ?? config.subscription.id };
    const session = await stripe<{ url: string }>(c.env, "POST", "/checkout/sessions", {
      mode: monthly ? "subscription" : "payment",
      customer: await customerFor(c, row),
      client_reference_id: c.get("userId"),
      line_items: [{ price: await priceIdFor(c.env, meta.pack), quantity: 1 }],
      success_url: `${c.env.BASE_URL}/billing?checkout=success`,
      cancel_url: `${c.env.BASE_URL}/billing`,
      metadata: meta,
      // Managed Payments: Stripe is the seller of record and handles sales
      // tax and VAT, for an extra fee. Stripe refuses the checkout unless the
      // products carry a tax code, so config.json only says true once they
      // do (OFFLINE-CHECKLIST 35b). Said explicitly either way rather than
      // left to the account's default.
      managed_payments: { enabled: config.stripe_managed_payments ? "true" : "false" },
      // Copied by Stripe onto the charge, which is how a later refund knows
      // whose credits to take back and how many the pack was worth.
      ...(pack ? { payment_intent_data: { metadata: { ...meta, credits: pack.credits } } } : {}),
    });
    return c.json({ url: session.url });
  } catch (err) {
    return stripeFailure(c, err);
  }
});

// Stripe's own page for cancelling the subscription and seeing receipts.
billing.post("/portal", async (c) => {
  if (!creditsEnforced(c.env)) return c.json({ error: "purchases aren't open here yet" }, 503);
  const row = await billingRow(c);
  if (!row?.stripe_customer_id) return c.json({ error: "nothing to manage yet" }, 400);
  try {
    const session = await stripe<{ url: string }>(c.env, "POST", "/billing_portal/sessions", {
      customer: row.stripe_customer_id,
      return_url: `${c.env.BASE_URL}/billing`,
    });
    return c.json({ url: session.url });
  } catch (err) {
    return stripeFailure(c, err);
  }
});
