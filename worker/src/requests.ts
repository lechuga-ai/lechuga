import { Hono } from "hono";
import type { AppEnv, RequestRow, RequestType } from "./types";
import { sendEmail } from "./email";
import { requestReceivedEmail } from "./email/templates";
import { normalizeEmail } from "./invites";
import { verifyTurnstile } from "./turnstile";
import config from "../config.json";

const MAX_BODY = 2000;
const MAX_ACCESS_BODY = 500;

// Both public forms write to the admin inbox, and the access one also sends
// an email to whatever address it's given. Turnstile and the WAF rule slow a
// flood; this ends it: past limits.public_requests_per_day rows from people
// without an account (UTC day, both forms together), the forms say so and
// point at the email address instead.
async function publicFormsFull(env: AppEnv["Bindings"]): Promise<boolean> {
  const startOfDay = new Date().setUTCHours(0, 0, 0, 0);
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE user_id IS NULL AND created_at >= ?")
    .bind(startOfDay)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= config.limits.public_requests_per_day;
}
const FULL_MESSAGE = "we've had more of these today than we can read. Write to hello@lechuga.ai instead.";

function clean(raw: unknown, max: number): string {
  return typeof raw === "string" ? raw.trim().slice(0, max) : "";
}

// Public: the "request access" form on the sign-in page. Turnstile-checked
// here because Better Auth's captcha plugin only covers its own routes.
export const accessRequests = new Hono<AppEnv>();

accessRequests.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ok = await verifyTurnstile(c.env, c.req.header("x-captcha-response") ?? null, c.req.header("cf-connecting-ip") ?? null);
  if (!ok) return c.json({ error: "the bot check didn't pass, reload and try again" }, 400);

  const email = normalizeEmail(body?.email);
  if (!email) return c.json({ error: "that doesn't look like an email address" }, 400);
  const text = clean(body?.body, MAX_ACCESS_BODY);

  // One open request per address. A repeat looks identical from outside
  // (same "got it" reply) but stores nothing and sends no second email, so
  // the form can't be used to mail someone over and over.
  const open = await c.env.DB.prepare("SELECT 1 AS one FROM requests WHERE type = 'access' AND email = ? AND status = 'open'")
    .bind(email)
    .first();
  if (open) return c.json({ ok: true });
  if (await publicFormsFull(c.env)) return c.json({ error: FULL_MESSAGE }, 429);

  await c.env.DB.prepare(
    "INSERT INTO requests (id, type, email, body, status, created_at) VALUES (?, 'access', ?, ?, 'open', ?)"
  )
    .bind(crypto.randomUUID(), email, text, Date.now())
    .run();

  // Confirmation is best effort; the request is stored either way.
  c.executionCtx.waitUntil(
    sendEmail(c.env, { to: email, ...requestReceivedEmail() }).catch((err) => console.error("request email failed", err))
  );
  return c.json({ ok: true });
});

// Public: the Feedback form on /help, for visitors with no account.
// Signed-in people use `notes` below instead, which ties the note to them.
export const feedbackRequests = new Hono<AppEnv>();

feedbackRequests.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ok = await verifyTurnstile(c.env, c.req.header("x-captcha-response") ?? null, c.req.header("cf-connecting-ip") ?? null);
  if (!ok) return c.json({ error: "the bot check didn't pass, reload and try again" }, 400);

  const text = clean(body?.body, MAX_BODY);
  if (!text) return c.json({ error: "the note is empty" }, 400);
  if (await publicFormsFull(c.env)) return c.json({ error: FULL_MESSAGE }, 429);
  // Optional: an empty string satisfies the column and just means anonymous.
  const email = normalizeEmail(body?.email) ?? "";

  await c.env.DB.prepare(
    "INSERT INTO requests (id, type, email, body, status, created_at) VALUES (?, 'feedback', ?, ?, 'open', ?)"
  )
    .bind(crypto.randomUUID(), email, text, Date.now())
    .run();
  return c.json({ ok: true });
});

// Signed in: feedback and support notes from the account menu.
export const notes = new Hono<AppEnv>();

notes.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const type: RequestType = body?.type === "support" ? "support" : "feedback";
  const text = clean(body?.body, MAX_BODY);
  if (!text) return c.json({ error: "the note is empty" }, 400);

  await c.env.DB.prepare(
    "INSERT INTO requests (id, type, email, username, user_id, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)"
  )
    .bind(crypto.randomUUID(), type, c.get("userEmail").toLowerCase(), c.get("username"), c.get("userId"), text, Date.now())
    .run();
  return c.json({ ok: true });
});

export type { RequestRow };
