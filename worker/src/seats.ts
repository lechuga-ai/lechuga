import { Hono } from "hono";
import { hashPassword } from "better-auth/crypto";
import type { AppEnv, Env } from "./types";
import { botAccess, botRoster } from "./bots";
import { checkUsernameFormat, normalizeUsername } from "./username";
import { isSeatEmail, seatEmail } from "./seat-email";
import { hasAccount, normalizeEmail, pendingInviteFor } from "./invites";
import { applyOnce } from "./credits";
import { sendEmail } from "./email";
import { seatUpgradedEmail } from "./email/templates";
import config from "../config.json";

// Seats (migration 0016): an account for someone with no email address,
// made by a bot's owner and tied to that bot. The owner picks a name and a
// username, and gets a code to hand over; the seat signs in with those
// (the sign-in page's third way, through Better Auth's email-and-password
// sign-in on a made-up address, seat-email.ts). The owner can hand out a
// new code at any time and can delete the seat, which takes its sessions
// and its place in the bot with it; its chats stay with the owner, under
// "someone who left".
//
// A seat is a member of the bot like any other, so everything about shared
// bots holds: the owner pays, sees every chat, and is told; nothing about
// the seat is kept. What a seat can't do is in index.ts (seatOf): no bots
// of its own, no invites, no credits, no memory, no sharing.
//
// Making a seat is the owner answering for the person who'll use it. The
// privacy page says so in plain words; the product copy says no more than
// "someone without an email address".

const CODE_MIN = 6;
const CODE_MAX = 20;

export async function seatsOf(env: Env, ownerId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM user WHERE seat_of = ?").bind(ownerId).first<{ n: number }>();
  return row?.n ?? 0;
}

// Eight digits: still something to say out loud and type on a tablet, and
// a hundred million possibilities against someone guessing (the sign-in
// route is also rate limited, auth.ts).
const CODE_DIGITS = 8;
function newCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 10 ** CODE_DIGITS;
  return String(n).padStart(CODE_DIGITS, "0");
}

function cleanCode(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return newCode();
  const code = typeof raw === "string" ? raw.trim() : "";
  return code.length >= CODE_MIN && code.length <= CODE_MAX ? code : null;
}

export const seats = new Hono<AppEnv>();

// Make one, in the bot, from a username. Answers with the code, once: it's
// stored hashed.
seats.post("/:id/seats", async (c) => {
  const userId = c.get("userId");
  if (c.get("seatOf")) return c.json({ error: "not found" }, 404);
  const access = await botAccess(c.env, c.req.param("id"), userId, c.get("seatOf") !== null);
  if (!access) return c.json({ error: "not found" }, 404);
  if (access.role !== "owner") return c.json({ error: "only the bot's owner can add someone this way" }, 403);
  const bot = access.bot;

  const body = await c.req.json().catch(() => ({}));
  // The username is the name: they show as @username, like anyone who
  // leaves the profile name empty. A name may still be given.
  const name = typeof body?.name === "string" ? body.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  const check = checkUsernameFormat(typeof body?.username === "string" ? body.username : "");
  if (!check.ok) return c.json({ error: check.reason }, 400);
  const code = cleanCode(body?.code);
  if (!code) return c.json({ error: `a code is ${CODE_MIN} to ${CODE_MAX} characters` }, 400);

  if ((await seatsOf(c.env, userId)) >= config.limits.seats_per_account) {
    return c.json({ error: `that's ${config.limits.seats_per_account} already, the most one account can have at a time; remove one to make another` }, 400);
  }
  const taken = await c.env.DB.prepare("SELECT 1 AS one FROM user WHERE lower(username) = ?").bind(normalizeUsername(check.username)).first();
  if (taken) return c.json({ error: "that one's taken" }, 409);

  const seatId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const now = Date.now();
  const hashed = await hashPassword(code);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt, username, username_set_at, invites_remaining, terms_accepted_at, terms_version, seat_of)
         VALUES (?, ?, ?, 1, NULL, ?, ?, ?, ?, 0, ?, ?, ?)`
      ).bind(seatId, name, seatEmail(check.username), nowIso, nowIso, check.username, now, now, config.terms_version, userId),
      c.env.DB.prepare(
        "INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)"
      ).bind(crypto.randomUUID(), seatId, seatId, hashed, nowIso, nowIso),
      c.env.DB.prepare("INSERT INTO bot_members (bot_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)").bind(bot.id, seatId, userId, now),
    ]);
  } catch (err) {
    console.error("seat creation failed", err);
    return c.json({ error: "that one's taken" }, 409);
  }
  return c.json({ roster: await botRoster(c.env, bot, true), seat: { id: seatId, username: check.username, name }, code });
});

// A new code, shown once.
seats.post("/:id/seats/:userId/code", async (c) => {
  const userId = c.get("userId");
  const access = await botAccess(c.env, c.req.param("id"), userId, c.get("seatOf") !== null);
  if (!access || access.role !== "owner") return c.json({ error: "not found" }, 404);
  const seatId = c.req.param("userId");
  const seat = await c.env.DB.prepare("SELECT username FROM user WHERE id = ? AND seat_of = ?").bind(seatId, userId).first<{ username: string }>();
  if (!seat) return c.json({ error: "not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const code = cleanCode(body?.code);
  if (!code) return c.json({ error: `a code is ${CODE_MIN} to ${CODE_MAX} characters` }, 400);
  const nowIso = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE account SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = 'credential'").bind(await hashPassword(code), nowIso, seatId),
    // Whatever device was signed in with the old code is signed out.
    c.env.DB.prepare("DELETE FROM session WHERE userId = ?").bind(seatId),
  ]);
  return c.json({ username: seat.username, code });
});

// A seat becomes a full account: the owner gives it an email address, and
// from then on it's an account like any other. It keeps its username, its
// chats and its place in the bot (as an ordinary member now), gains the
// starter credits and invites a new account gets, and stops being the
// owner's to answer for. The code stops working: the account is theirs,
// and the person who made it shouldn't be able to sign in as them. They
// sign in by email from here, with a link or a code, as soon as they ask.
//
// Lechuga is invite only, and this makes an account for an address, so the
// address needs an invite: one already waiting for it, or one of the
// owner's, spent with their say-so (the same step as sharing with a new
// address, sharing.ts). Without that, a bot's owner could open accounts
// for any address they liked.
seats.post("/:id/seats/:userId/upgrade", async (c) => {
  const userId = c.get("userId");
  const access = await botAccess(c.env, c.req.param("id"), userId, c.get("seatOf") !== null);
  if (!access || access.role !== "owner") return c.json({ error: "not found" }, 404);
  const seatId = c.req.param("userId");
  const seat = await c.env.DB.prepare("SELECT username FROM user WHERE id = ? AND seat_of = ?").bind(seatId, userId).first<{ username: string }>();
  if (!seat) return c.json({ error: "not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const email = normalizeEmail(body?.email);
  if (!email || isSeatEmail(email)) return c.json({ error: "that doesn't look like an email address" }, 400);
  if (await hasAccount(c.env, email)) return c.json({ error: "that address already has an account" }, 409);

  const invite = await pendingInviteFor(c.env, email);
  if (!invite) {
    if (body?.useInvite !== true) {
      const me = await c.env.DB.prepare("SELECT invites_remaining FROM user WHERE id = ?").bind(userId).first<{ invites_remaining: number }>();
      return c.json({ error: "that address doesn't have an invite yet", code: "needs_invite", invitesRemaining: me?.invites_remaining ?? 0 }, 409);
    }
    // Spent atomically: the UPDATE only matches while there are invites
    // left, so two quick clicks can't overspend.
    const spend = await c.env.DB.prepare("UPDATE user SET invites_remaining = invites_remaining - 1 WHERE id = ? AND invites_remaining > 0").bind(userId).run();
    if (!spend.meta.changes) return c.json({ error: "no invites left" }, 400);
  }

  const now = Date.now();
  // The terms were accepted on its behalf when it was made; now it's
  // someone's own, they accept them themselves on their first visit.
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE user SET email = ?, emailVerified = 0, seat_of = NULL, invites_remaining = ?, invited_by = ?, terms_accepted_at = NULL, terms_version = NULL, updatedAt = ? WHERE id = ?"
    ).bind(email, config.default_invites, invite?.inviter_id ?? invite?.sent_by ?? userId, new Date(now).toISOString(), seatId),
    // The code, and every device signed in with it.
    c.env.DB.prepare("DELETE FROM account WHERE userId = ? AND providerId = 'credential'").bind(seatId),
    c.env.DB.prepare("DELETE FROM session WHERE userId = ?").bind(seatId),
    ...(invite ? [c.env.DB.prepare("UPDATE invites SET status = 'accepted', accepted_at = ? WHERE id = ?").bind(now, invite.id)] : []),
  ]);
  // Keyed by user id, so it lands once even if this is somehow repeated.
  await applyOnce(c.env, { userId: seatId, delta: config.starter_credits, reason: "signup_bonus", ref: seatId });
  const sharerName = c.get("username") ? `@${c.get("username")}` : c.get("userName") || "Someone";
  c.executionCtx.waitUntil(
    sendEmail(c.env, { to: email, ...seatUpgradedEmail({ sharerName, username: seat.username, url: `${c.env.BASE_URL}/`, termsUrl: `${c.env.BASE_URL}/terms` }) }).catch((err) =>
      console.error("upgrade email failed", err)
    )
  );
  return c.json({ roster: await botRoster(c.env, access.bot, true) });
});

// Gone for good: the account, its sessions, its place in the bot, and the
// username with it, free for anyone. Its chats stay with the owner, who
// could always see them, under "someone who left". This is what keeps the
// count of seats an account can have (seats_per_account) a count of live
// ones.
seats.delete("/:id/seats/:userId", async (c) => {
  const userId = c.get("userId");
  const access = await botAccess(c.env, c.req.param("id"), userId, c.get("seatOf") !== null);
  if (!access || access.role !== "owner") return c.json({ error: "not found" }, 404);
  const seatId = c.req.param("userId");
  const seat = await c.env.DB.prepare("SELECT 1 AS one FROM user WHERE id = ? AND seat_of = ?").bind(seatId, userId).first();
  if (!seat) return c.json({ error: "not found" }, 404);
  await c.env.DB.batch([
    // Its chats become the owner's before the account goes: chats cascade
    // on their user (0002_auth.sql), and these are the owner's to keep. The
    // turns inside keep the seat's id, which reads as "someone who left".
    c.env.DB.prepare("UPDATE chats SET user_id = ? WHERE user_id = ?").bind(userId, seatId),
    c.env.DB.prepare("DELETE FROM user WHERE id = ? AND seat_of = ?").bind(seatId, userId),
  ]);
  return c.json({ roster: await botRoster(c.env, access.bot, true) });
});
