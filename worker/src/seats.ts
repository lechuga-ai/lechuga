import { Hono } from "hono";
import { hashPassword } from "better-auth/crypto";
import type { AppEnv, Env } from "./types";
import { botAccess, botRoster } from "./bots";
import { checkUsernameFormat, normalizeUsername } from "./username";
import { seatEmail } from "./seat-email";
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

// Six digits, easy to say out loud and to type on a tablet.
function newCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
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
  const access = await botAccess(c.env, c.req.param("id"), userId);
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
  const access = await botAccess(c.env, c.req.param("id"), userId);
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

// Gone for good: the account, its sessions, its place in the bot, and the
// username with it, free for anyone. Its chats stay with the owner, who
// could always see them, under "someone who left". This is what keeps the
// count of seats an account can have (seats_per_account) a count of live
// ones.
seats.delete("/:id/seats/:userId", async (c) => {
  const userId = c.get("userId");
  const access = await botAccess(c.env, c.req.param("id"), userId);
  if (!access || access.role !== "owner") return c.json({ error: "not found" }, 404);
  const seatId = c.req.param("userId");
  const gone = await c.env.DB.prepare("DELETE FROM user WHERE id = ? AND seat_of = ?").bind(seatId, userId).run();
  if (!gone.meta.changes) return c.json({ error: "not found" }, 404);
  return c.json({ roster: await botRoster(c.env, access.bot, true) });
});
