import { Hono } from "hono";
import type { AppEnv, Env, InviteRow } from "./types";
import { sendEmail } from "./email";
import { inviteEmail } from "./email/templates";
import config from "../config.json";

const EXPIRY_MS = config.invite_expiry_days * 24 * 60 * 60 * 1000;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  // Deliberately loose: the mail provider is the real validator.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// The gate used by both sign-in paths (worker/src/auth.ts): an email may sign
// in if it already has an account or holds an unexpired pending invite.
export async function pendingInviteFor(env: Env, email: string): Promise<InviteRow | null> {
  return env.DB.prepare(
    "SELECT * FROM invites WHERE email = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 1"
  )
    .bind(email, Date.now())
    .first<InviteRow>();
}

// An invite this person sent that address before, which ran out unanswered.
// (Call it once pendingInviteFor has come back empty: then any invite of
// theirs still marked pending has expired.) Inviting again renews this one
// rather than spending another of their invites.
export async function lapsedInviteFrom(env: Env, inviterId: string, email: string): Promise<InviteRow | null> {
  return env.DB.prepare("SELECT * FROM invites WHERE email = ? AND inviter_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1")
    .bind(email, inviterId)
    .first<InviteRow>();
}

export async function hasAccount(env: Env, email: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 AS one FROM user WHERE lower(email) = ?").bind(email).first();
  return row !== null;
}

// Creates an invite and sends the email. inviterId null means an admin
// approval; then no count is spent. Returns a reason string on refusal.
export async function createInvite(
  env: Env,
  opts: { email: string; inviterId: string | null; inviterName: string | null; sharedChat?: boolean }
): Promise<{ ok: true; invite: InviteRow } | { ok: false; reason: string }> {
  if (await hasAccount(env, opts.email)) return { ok: false, reason: "that address already has access" };
  if (await pendingInviteFor(env, opts.email)) return { ok: false, reason: "that address already has an invite waiting" };

  const now = Date.now();
  let invite: InviteRow = {
    id: crypto.randomUUID(),
    token: newToken(),
    email: opts.email,
    inviter_id: opts.inviterId,
    status: "pending",
    created_at: now,
    expires_at: now + EXPIRY_MS,
    accepted_at: null,
  };

  if (opts.inviterId) {
    // Bounds how much mail one account can cause, since withdrawing refunds
    // the count and an invite could otherwise be re-sent without limit.
    const recent = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM invites WHERE inviter_id = ? AND created_at > ?"
    )
      .bind(opts.inviterId, Date.now() - 24 * 60 * 60 * 1000)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) >= config.daily_invite_cap) return { ok: false, reason: "that's a lot of invites for one day; try again tomorrow" };
  }

  // Invited them before and it lapsed: the same invite and the same link,
  // good for another stretch, and the count already spent on it covers it.
  // created_at moves so the daily cap above still counts the mail it sends.
  const lapsed = opts.inviterId ? await lapsedInviteFrom(env, opts.inviterId, opts.email) : null;
  if (lapsed) {
    invite = { ...lapsed, created_at: now, expires_at: now + EXPIRY_MS };
    await env.DB.prepare("UPDATE invites SET created_at = ?, expires_at = ? WHERE id = ?").bind(invite.created_at, invite.expires_at, invite.id).run();
  } else if (opts.inviterId) {

    // Spend one invite atomically: the UPDATE only matches while there are
    // invites left, so two quick clicks can't overspend.
    const spend = await env.DB.prepare(
      "UPDATE user SET invites_remaining = invites_remaining - 1 WHERE id = ? AND invites_remaining > 0"
    )
      .bind(opts.inviterId)
      .run();
    if (!spend.meta.changes) return { ok: false, reason: "no invites left" };
  }

  if (!lapsed) {
    await env.DB.prepare(
      "INSERT INTO invites (id, token, email, inviter_id, status, created_at, expires_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)"
    )
      .bind(invite.id, invite.token, invite.email, invite.inviter_id, invite.created_at, invite.expires_at)
      .run();
  }

  const mail = inviteEmail({
    inviterName: opts.inviterName,
    url: `${env.BASE_URL}/invite/${invite.token}`,
    expiresDays: config.invite_expiry_days,
    sharedChat: opts.sharedChat,
    baseUrl: env.BASE_URL,
  });
  await sendEmail(env, { to: invite.email, ...mail });
  return { ok: true, invite };
}

// Called from the user.create.after hook: the invite is used up and the new
// user records who brought them in.
export async function acceptInvite(env: Env, userId: string, email: string): Promise<void> {
  const invite = await pendingInviteFor(env, email);
  if (!invite) return;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE invites SET status = 'accepted', accepted_at = ? WHERE id = ?").bind(now, invite.id),
    // An invite from Lechuga hangs the new account under the admin who sent it.
    env.DB.prepare("UPDATE user SET invited_by = ?, invites_remaining = ? WHERE id = ?").bind(
      invite.inviter_id ?? invite.sent_by ?? null,
      config.default_invites,
      userId
    ),
  ]);
}

function publicInvite(i: InviteRow) {
  const { token: _token, ...rest } = i;
  return { ...rest, expired: i.status === "pending" && i.expires_at <= Date.now() };
}

// Signed-in routes: my invites.
export const invites = new Hono<AppEnv>();

invites.get("/", async (c) => {
  const userId = c.get("userId");
  const [{ results }, me] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM invites WHERE inviter_id = ? ORDER BY created_at DESC")
      .bind(userId)
      .all<InviteRow>(),
    c.env.DB.prepare("SELECT invites_remaining FROM user WHERE id = ?")
      .bind(userId)
      .first<{ invites_remaining: number }>(),
  ]);
  return c.json({ remaining: me?.invites_remaining ?? 0, invites: results.map(publicInvite) });
});

invites.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = normalizeEmail(body?.email);
  if (!email) return c.json({ error: "that doesn't look like an email address" }, 400);
  if (email === c.get("userEmail").toLowerCase()) return c.json({ error: "that's you" }, 400);

  const result = await createInvite(c.env, {
    email,
    inviterId: c.get("userId"),
    inviterName: c.get("username") ?? c.get("userName") ?? null,
  });
  if (!result.ok) return c.json({ error: result.reason }, 400);
  return c.json({ invite: publicInvite(result.invite) });
});

// Revoke one of my pending invites; the count comes back.
invites.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const revoked = await c.env.DB.prepare(
    "UPDATE invites SET status = 'revoked' WHERE id = ? AND inviter_id = ? AND status = 'pending'"
  )
    .bind(c.req.param("id"), userId)
    .run();
  if (!revoked.meta.changes) return c.json({ error: "not found" }, 404);
  await c.env.DB.prepare("UPDATE user SET invites_remaining = invites_remaining + 1 WHERE id = ?").bind(userId).run();
  return c.json({ ok: true });
});

// Public: what the /invite/<token> page shows before sign-in. The token is
// unguessable, so this reveals nothing to anyone who doesn't hold the link.
export const inviteLookup = new Hono<AppEnv>();

inviteLookup.get("/:token", async (c) => {
  const invite = await c.env.DB.prepare("SELECT * FROM invites WHERE token = ?")
    .bind(c.req.param("token"))
    .first<InviteRow>();
  if (!invite) return c.json({ error: "not found" }, 404);
  const state =
    invite.status !== "pending" ? invite.status : invite.expires_at <= Date.now() ? "expired" : "pending";
  return c.json({ email: invite.email, state });
});
