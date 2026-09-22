import { Hono } from "hono";
import type { AppEnv, InviteRow, RequestRow } from "./types";
import { sendEmail, REPLY_TO } from "./email";
import { adminReplyEmail, declinedEmail } from "./email/templates";
import { createInvite, normalizeEmail } from "./invites";
import { checkUsernameFormat } from "./username";
import { ledgerStatements } from "./credits";
import config from "../config.json";

// Everything here runs after the session check and requires isAdmin, which
// index.ts derives from the ADMIN_EMAILS var. Non-admins get a 404 rather
// than a 403 so the admin area's existence isn't confirmed.
export const admin = new Hono<AppEnv>();

admin.use("*", async (c, next) => {
  if (!c.get("isAdmin")) return c.json({ error: "not found" }, 404);
  await next();
});

const TYPES = new Set(["access", "feedback", "support"]);
const STATUSES = new Set(["open", "approved", "declined", "replied", "closed"]);

// Requests inbox, newest first, optional ?type= and ?status= filters.
admin.get("/requests", async (c) => {
  const type = c.req.query("type");
  const status = c.req.query("status");
  const where: string[] = [];
  const binds: string[] = [];
  if (type && TYPES.has(type)) {
    where.push("r.type = ?");
    binds.push(type);
  }
  if (status && STATUSES.has(status)) {
    where.push("r.status = ?");
    binds.push(status);
  }
  const sql = `SELECT r.*, h.username AS handled_by_username, h.email AS handled_by_email
    FROM requests r LEFT JOIN user h ON h.id = r.handled_by
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY r.created_at DESC LIMIT 200`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all<RequestRow & { handled_by_username: string | null; handled_by_email: string | null }>();
  return c.json(results);
});

async function loadRequest(c: { env: AppEnv["Bindings"] }, id: string): Promise<RequestRow | null> {
  return c.env.DB.prepare("SELECT * FROM requests WHERE id = ?").bind(id).first<RequestRow>();
}

async function markHandled(c: { env: AppEnv["Bindings"] }, id: string, status: string, adminId: string, extra: { admin_note?: string; reply?: string } = {}) {
  await c.env.DB.prepare(
    "UPDATE requests SET status = ?, handled_at = ?, handled_by = ?, admin_note = COALESCE(?, admin_note), reply = COALESCE(?, reply) WHERE id = ?"
  )
    .bind(status, Date.now(), adminId, extra.admin_note ?? null, extra.reply ?? null, id)
    .run();
}

// Approve an access request: creates an invite (no count spent), emails it.
admin.post("/requests/:id/approve", async (c) => {
  const req = await loadRequest(c, c.req.param("id"));
  if (!req) return c.json({ error: "not found" }, 404);
  if (req.type !== "access") return c.json({ error: "only access requests can be approved" }, 400);
  const body = await c.req.json().catch(() => ({}));

  const result = await createInvite(c.env, { email: req.email, inviterId: null, inviterName: null });
  if (!result.ok) return c.json({ error: result.reason }, 400);
  await recordSender(c.env, result.invite.id, c.get("userId"));
  await markHandled(c, req.id, "approved", c.get("userId"), { admin_note: typeof body?.note === "string" ? body.note : undefined });
  return c.json({ ok: true });
});

// Decline, optionally emailing a short message.
admin.post("/requests/:id/decline", async (c) => {
  const req = await loadRequest(c, c.req.param("id"));
  if (!req) return c.json({ error: "not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (message) await sendEmail(c.env, { to: req.email, replyTo: REPLY_TO, ...declinedEmail({ message }) });
  await markHandled(c, req.id, "declined", c.get("userId"), { reply: message || undefined });
  return c.json({ ok: true });
});

// Reply by email from hello@lechuga.ai; the text is kept on the request.
admin.post("/requests/:id/reply", async (c) => {
  const req = await loadRequest(c, c.req.param("id"));
  if (!req) return c.json({ error: "not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) return c.json({ error: "the reply is empty" }, 400);
  const subject = typeof body?.subject === "string" ? body.subject : "";
  await sendEmail(c.env, { to: req.email, replyTo: REPLY_TO, ...adminReplyEmail({ subject, body: text }) });
  await markHandled(c, req.id, "replied", c.get("userId"), { reply: text });
  return c.json({ ok: true });
});

admin.post("/requests/:id/close", async (c) => {
  const req = await loadRequest(c, c.req.param("id"));
  if (!req) return c.json({ error: "not found" }, 404);
  await markHandled(c, req.id, "closed", c.get("userId"));
  return c.json({ ok: true });
});

// Everyone's invite counts plus every invite, for the tree of who invited whom.
admin.get("/invites", async (c) => {
  const [users, invites] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id, email, name, username, invites_remaining, invited_by, createdAt AS created_at FROM user ORDER BY createdAt ASC"
    ).all<{ id: string; email: string; name: string; username: string | null; invites_remaining: number; invited_by: string | null; created_at: string }>(),
    c.env.DB.prepare("SELECT id, email, inviter_id, sent_by, status, created_at, expires_at, accepted_at FROM invites ORDER BY created_at DESC").all<Omit<InviteRow, "token"> & { sent_by: string | null }>(),
  ]);
  return c.json({ users: users.results, invites: invites.results });
});

// Which admin an invite from Lechuga came from (migration 0008). Written
// apart from the invite itself so the accounts' own invite path never
// depends on the column.
async function recordSender(env: AppEnv["Bindings"], inviteId: string, adminId: string) {
  await env.DB.prepare("UPDATE invites SET sent_by = ? WHERE id = ?").bind(adminId, inviteId).run();
}

// An invite from us rather than from an account: nobody's count is spent, and
// the list shows which admin sent it, the same as an approved request.
admin.post("/invites", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = normalizeEmail(body?.email);
  if (!email) return c.json({ error: "that doesn't look like an email address" }, 400);
  const result = await createInvite(c.env, { email, inviterId: null, inviterName: null });
  if (!result.ok) return c.json({ error: result.reason }, 400);
  await recordSender(c.env, result.invite.id, c.get("userId"));
  return c.json({ ok: true });
});

// Set one user's remaining invites. The global default lives in config.json.
admin.put("/users/:id/invites", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const n = Number(body?.invites_remaining);
  if (!Number.isInteger(n) || n < 0 || n > 1000) return c.json({ error: "a whole number from 0 to 1000" }, 400);
  const r = await c.env.DB.prepare("UPDATE user SET invites_remaining = ? WHERE id = ?").bind(n, c.req.param("id")).run();
  if (!r.meta.changes) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// Admins can change a username; users cannot (plan v3, step 6).
admin.put("/users/:id/username", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const check = checkUsernameFormat(typeof body?.username === "string" ? body.username : "");
  if (!check.ok) return c.json({ error: check.reason }, 400);
  const taken = await c.env.DB.prepare("SELECT id FROM user WHERE lower(username) = ? AND id != ?")
    .bind(check.username, c.req.param("id"))
    .first();
  if (taken) return c.json({ error: "that one's taken" }, 409);
  const r = await c.env.DB.prepare("UPDATE user SET username = ?, username_set_at = ? WHERE id = ?")
    .bind(check.username, Date.now(), c.req.param("id"))
    .run();
  if (!r.meta.changes) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// The Accounts tab: everyone who has signed up, with what they hold, what
// they've used, what that cost us at Cloudflare, what they've paid, and what
// we've given them. All of it is summed from credit_ledger, so it survives
// deleted chats; a deleted account takes its rows with it, so totals cover
// current accounts only. cost_usd and paid_cents exist since migration 0007.
admin.get("/accounts", async (c) => {
  const startOfDay = new Date().setUTCHours(0, 0, 0, 0);
  const [users, models, trials, last24h] = await Promise.all([
    c.env.DB.prepare(
      `SELECT u.id, u.email, u.username, u.createdAt AS created_at, u.balance, u.subscription_status, u.suspended_at,
         COALESCE(SUM(CASE WHEN l.reason = 'message' THEN 1 END), 0) AS replies,
         COALESCE(SUM(CASE WHEN l.reason = 'message' THEN -l.delta END), 0) AS credits_spent,
         COALESCE(SUM(l.prompt_tokens), 0) AS prompt_tokens,
         COALESCE(SUM(l.completion_tokens), 0) AS completion_tokens,
         COALESCE(SUM(l.cost_usd), 0) AS cost_usd,
         COALESCE(SUM(l.paid_cents), 0) AS paid_cents,
         COALESCE(SUM(CASE WHEN l.reason IN ('signup_bonus', 'manual') THEN l.delta END), 0) AS credits_given,
         MAX(CASE WHEN l.reason = 'message' THEN l.created_at END) AS last_reply_at
       FROM user u LEFT JOIN credit_ledger l ON l.user_id = u.id
       GROUP BY u.id ORDER BY u.createdAt DESC`
    ).all(),
    c.env.DB.prepare(
      `SELECT model, COUNT(*) AS replies, SUM(-delta) AS credits_spent, COALESCE(SUM(cost_usd), 0) AS cost_usd,
         COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, COALESCE(SUM(completion_tokens), 0) AS completion_tokens
       FROM credit_ledger WHERE reason = 'message' GROUP BY model ORDER BY credits_spent DESC`
    ).all(),
    c.env.DB.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(created_at >= ?), 0) AS today FROM trial_uses")
      .bind(startOfDay)
      .first<{ total: number; today: number }>(),
    // The AI Gateway's spend limit is a sliding 24 hours, so this is too.
    // It's our own count of what this tier's account replies cost: the
    // gateway's figure also includes the other tiers, free chats and titles.
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(l.cost_usd), 0) AS cost_usd, COUNT(*) AS replies,
         (SELECT COUNT(*) FROM trial_uses WHERE created_at >= ?1) AS trials
       FROM credit_ledger l WHERE l.reason = 'message' AND l.created_at >= ?1`
    )
      .bind(Date.now() - 24 * 60 * 60 * 1000)
      .first<{ cost_usd: number; replies: number; trials: number }>(),
  ]);
  return c.json({
    users: users.results,
    models: models.results,
    trials: trials ?? { total: 0, today: 0 },
    gateway: {
      last24h: last24h ?? { cost_usd: 0, replies: 0, trials: 0 },
      cap_usd: config.costs.gateway_daily_cap_usd,
      dashboard: `https://dash.cloudflare.com/${c.env.AI_GATEWAY_ACCOUNT_ID}/ai/ai-gateway/gateways/${c.env.AI_GATEWAY_ID}`,
    },
  });
});

// Every credit given or taken back by hand, newest first: to whom, how much,
// and the note, which starts with who did it.
admin.get("/grants", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.delta, l.note, l.created_at, u.username, u.email
     FROM credit_ledger l JOIN user u ON u.id = l.user_id
     WHERE l.reason = 'manual' ORDER BY l.created_at DESC LIMIT 200`
  ).all();
  return c.json(results);
});

// One account's most recent ledger rows, for the detail under its row.
admin.get("/users/:id/ledger", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, delta, reason, model, prompt_tokens, completion_tokens, cost_usd, paid_cents, note, created_at FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 100"
  )
    .bind(c.req.param("id"))
    .all();
  return c.json(results);
});

// Give credits (or, with a negative number, take them back). Always with a
// reason, kept on the row along with who did it. Goes through the same
// ledger-and-balance batch as every other change, so nothing drifts.
admin.post("/users/:id/grant", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const credits = Number(body?.credits);
  const max = config.limits.max_manual_grant;
  if (!Number.isInteger(credits) || credits === 0 || Math.abs(credits) > max) {
    return c.json({ error: `a whole number of credits, up to ${max.toLocaleString("en-US")} either way` }, 400);
  }
  const why = typeof body?.note === "string" ? body.note.trim().slice(0, 300) : "";
  if (!why) return c.json({ error: "say why, for the record" }, 400);
  const userId = c.req.param("id");
  const exists = await c.env.DB.prepare("SELECT 1 AS one FROM user WHERE id = ?").bind(userId).first();
  if (!exists) return c.json({ error: "not found" }, 404);

  const by = c.get("username") ? `@${c.get("username")}` : c.get("userEmail");
  await c.env.DB.batch(
    ledgerStatements(c.env, { userId, delta: credits, reason: "manual", ref: crypto.randomUUID(), note: `${by}: ${why}` })
  );
  return c.json({ ok: true });
});

// Suspend or restore an account. Suspended accounts can still sign in, read
// their chats, and delete themselves; chat.ts refuses their messages.
admin.put("/users/:id/suspended", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const userId = c.req.param("id");
  if (body?.suspended && userId === c.get("userId")) return c.json({ error: "that's you" }, 400);
  const r = await c.env.DB.prepare("UPDATE user SET suspended_at = ? WHERE id = ?")
    .bind(body?.suspended ? Date.now() : null, userId)
    .run();
  if (!r.meta.changes) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});
