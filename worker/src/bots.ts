import { Hono } from "hono";
import type { AppEnv, BotRow, ChatRow, Env } from "./types";
import { collectText, streamChat } from "./gateway";
import { peopleByIds, type Person } from "./sharing";
import { createInvite, lapsedInviteFrom, normalizeEmail, pendingInviteFor } from "./invites";
import { sendEmail } from "./email";
import { botSharedEmail } from "./email/templates";
import config from "../config.json";

// Bots (migrations 0013, 0014): a name, a soul, a model, an owner. Every
// chat is with one. An account's first bot is Seed, made here the first
// time it's needed; the rest are made by naming them, and the name is the
// brief: the model drafts a first soul from it, which the person rewrites
// in Bot Manager.
//
// A bot can be shared (bot_members). The owner pays for every chat with it,
// sees every chat with it, and sets its soul. A member can chat with it,
// sees their own chats, and is told the owner can read them. What Lechuga
// remembers about a person (memory.ts) never enters a chat unless the
// person typing owns the bot, so nothing about the owner reaches a member
// and nothing about a member is kept. chat.ts and sharing.ts hold the other
// half: chatAccess lets a bot's owner into every chat with it, and the
// bot's owner is the payer.

const DEFAULT_NAME = "Seed";
const DRAFT_MODEL = config.models[0].id;
const MODEL_IDS = new Set(config.models.filter((m) => !("retired" in m && m.retired)).map((m) => m.id));
const NAME_MAX = 40;
const SOUL_MAX = config.limits.memory_chars;

export type BotRole = "owner" | "member";

// A bot as the app sees it: mine, or shared with me. people is everyone
// with it (the owner first) once it's shared, for the faces in the sidebar.
export type BotView = BotRow & { role: BotRole; people?: Person[] };

export type BotRoster = {
  owner: Person;
  // seat: an account the owner made for someone without an email (seats.ts).
  members: (Person & { removed: boolean; seat: boolean })[];
  pending: { id: string; email: string }[];
};

const GONE = (id: string): Person => ({ id, name: "someone who left", username: null, photo: null });

// Mine, Seed first, then the ones shared with me. A seat (seats.ts) has no
// bots of its own, not even Seed: only what's shared with it.
export async function listBots(env: Env, userId: string, seat = false): Promise<BotView[]> {
  if (!seat) await defaultBot(env, userId);
  const [{ results: mine }, { results: shared }, { results: memberRows }] = await Promise.all([
    env.DB.prepare("SELECT * FROM bots WHERE user_id = ? ORDER BY is_default DESC, created_at ASC").bind(userId).all<BotRow>(),
    env.DB.prepare(
      `SELECT b.* FROM bots b JOIN bot_members m ON m.bot_id = b.id WHERE m.user_id = ?1 AND m.removed_at IS NULL
       UNION
       SELECT b.* FROM bots b WHERE b.visibility = 'public' AND b.user_id != ?1 AND EXISTS (SELECT 1 FROM chats c WHERE c.bot_id = b.id AND c.user_id = ?1)
       ORDER BY created_at ASC`
    )
      .bind(userId)
      .all<BotRow>(),
    env.DB.prepare(
      `SELECT m.bot_id, m.user_id FROM bot_members m WHERE m.removed_at IS NULL AND m.bot_id IN (
         SELECT id FROM bots WHERE user_id = ?1
         UNION SELECT bot_id FROM bot_members WHERE user_id = ?1 AND removed_at IS NULL)
       ORDER BY m.added_at ASC`
    )
      .bind(userId)
      .all<{ bot_id: string; user_id: string }>(),
  ]);
  const bots: BotView[] = [...mine.map((b) => ({ ...b, role: "owner" as const })), ...shared.map((b) => ({ ...b, role: "member" as const }))];
  const membersOf = new Map<string, string[]>();
  for (const r of memberRows) membersOf.set(r.bot_id, [...(membersOf.get(r.bot_id) ?? []), r.user_id]);
  const withPeople = bots.filter((b) => membersOf.has(b.id));
  if (withPeople.length === 0) return bots;
  const people = await peopleByIds(env, withPeople.flatMap((b) => [b.user_id, ...membersOf.get(b.id)!]));
  return bots.map((b) => {
    const ids = membersOf.get(b.id);
    return ids ? { ...b, people: [b.user_id, ...ids].map((id) => people.get(id) ?? GONE(id)) } : b;
  });
}

// Seed, made on first use. Accounts from before bots got theirs in the
// migration; new ones get it here.
export async function defaultBot(env: Env, userId: string): Promise<BotRow> {
  const found = await env.DB.prepare("SELECT * FROM bots WHERE user_id = ? AND is_default = 1").bind(userId).first<BotRow>();
  if (found) return found;
  const bot: BotRow = { id: crypto.randomUUID(), user_id: userId, name: DEFAULT_NAME, soul: "", model: null, is_default: 1, guarded: 0, visibility: "private", created_at: Date.now(), updated_at: Date.now() };
  await env.DB.prepare("INSERT INTO bots (id, user_id, name, soul, model, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)")
    .bind(bot.id, userId, bot.name, bot.soul, bot.model, bot.created_at, bot.updated_at)
    .run();
  return bot;
}

// The bot a chat is with. A chat with no bot (there shouldn't be any after
// the migration) is with its owner's Seed.
export async function botFor(env: Env, chat: ChatRow): Promise<BotRow> {
  if (chat.bot_id) {
    const bot = await env.DB.prepare("SELECT * FROM bots WHERE id = ?").bind(chat.bot_id).first<BotRow>();
    if (bot) return bot;
  }
  return defaultBot(env, chat.user_id);
}

// A bot I own, have been let into, or that's public (public.ts), with
// which. Anyone else's looks the same as no bot at all (null), so ids can't
// be probed. seat: a username-and-code account, which keeps to the bots it
// was given: no public ones. Always passed, never assumed.
export async function botAccess(env: Env, botId: string, userId: string, seat: boolean): Promise<{ bot: BotRow; role: BotRole } | null> {
  const bot = await env.DB.prepare(
    `SELECT b.* FROM bots b WHERE b.id = ?1 AND (b.user_id = ?2 OR (b.visibility = 'public' AND ?3 = 0) OR EXISTS (
       SELECT 1 FROM bot_members m WHERE m.bot_id = b.id AND m.user_id = ?2 AND m.removed_at IS NULL))`
  )
    .bind(botId, userId, seat ? 1 : 0)
    .first<BotRow>();
  return bot ? { bot, role: bot.user_id === userId ? "owner" : "member" } : null;
}

export async function botRoster(env: Env, bot: BotRow, forOwner: boolean): Promise<BotRoster> {
  const [{ results: rows }, { results: pending }] = await Promise.all([
    env.DB.prepare(
      "SELECT m.user_id, m.removed_at, u.seat_of FROM bot_members m LEFT JOIN user u ON u.id = m.user_id WHERE m.bot_id = ? ORDER BY m.added_at ASC"
    )
      .bind(bot.id)
      .all<{ user_id: string; removed_at: number | null; seat_of: string | null }>(),
    forOwner
      ? env.DB.prepare("SELECT id, email FROM bot_pending_shares WHERE bot_id = ? ORDER BY created_at ASC").bind(bot.id).all<{ id: string; email: string }>()
      : Promise.resolve({ results: [] as { id: string; email: string }[] }),
  ]);
  const people = await peopleByIds(env, [bot.user_id, ...rows.map((r) => r.user_id)]);
  return {
    owner: people.get(bot.user_id) ?? GONE(bot.user_id),
    members: rows.map((r) => ({ ...(people.get(r.user_id) ?? GONE(r.user_id)), removed: r.removed_at !== null, seat: r.seat_of !== null })),
    pending,
  };
}

// A new account picks up the bots that were shared with its address while
// it had none. Called from the user.create.after hook (auth.ts).
export async function claimPendingBotShares(env: Env, userId: string, email: string): Promise<void> {
  const { results } = await env.DB.prepare("SELECT id, bot_id, added_by FROM bot_pending_shares WHERE email = ?")
    .bind(email)
    .all<{ id: string; bot_id: string; added_by: string | null }>();
  if (results.length === 0) return;
  const now = Date.now();
  await env.DB.batch([
    ...results.map((r) =>
      env.DB.prepare("INSERT OR IGNORE INTO bot_members (bot_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)").bind(r.bot_id, userId, r.added_by, now)
    ),
    env.DB.prepare("DELETE FROM bot_pending_shares WHERE email = ?").bind(email),
  ]);
}

// The first soul, from the name alone: "Penny Pincher" should arrive
// knowing what it's for. Low effort on Flash, paid by us like chat titles.
// A name that says nothing ("Bob") gets a plain helper. Never fails the
// bot's creation: with no draft the soul is empty and the page says so.
async function draftSoul(env: Env, name: string): Promise<string> {
  try {
    const { stream } = await streamChat(
      env,
      DRAFT_MODEL,
      [
        {
          role: "user",
          content:
            `Someone has made a new bot in Lechuga, a chat app, and named it "${name}". Write the bot's soul: the instructions it will be given about what it's for, how it talks, and what it focuses on and avoids, worked out from the name. ` +
            `Second person, addressed to the bot ("You are…"). Three to six short lines, under 600 characters in all. Plain and specific; no headings, no bullets, no preamble. ` +
            `If the name gives no clue, make it a friendly all-round helper and say so lightly.`,
        },
      ],
      { effort: "low", maxTokens: 800 }
    );
    return (await collectText(stream)).trim().slice(0, SOUL_MAX);
  } catch (err) {
    console.error("soul draft failed", err);
    return "";
  }
}

function cleanName(raw: unknown): string | null {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return name && name.length <= NAME_MAX ? name : null;
}

// Runs after the session check in index.ts.
export const bots = new Hono<AppEnv>();

bots.get("/", async (c) => c.json(await listBots(c.env, c.get("userId"), c.get("seatOf") !== null)));

bots.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = cleanName(body?.name);
  if (!name) return c.json({ error: `a bot needs a name, up to ${NAME_MAX} characters` }, 400);
  const model = typeof body?.model === "string" && MODEL_IDS.has(body.model) ? body.model : null;
  const userId = c.get("userId");
  await defaultBot(c.env, userId);
  const now = Date.now();
  const bot: BotView = { id: crypto.randomUUID(), user_id: userId, name, soul: "", model, is_default: 0, guarded: 0, visibility: "private", created_at: now, updated_at: now, role: "owner" };
  await c.env.DB.prepare("INSERT INTO bots (id, user_id, name, soul, model, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)")
    .bind(bot.id, userId, name, "", model, now, now)
    .run();
  // The draft takes the model a few seconds; the bot exists now and the
  // soul lands when it's written (the page asks again until it has). An
  // empty draft stays empty: the person writes it, or leaves it.
  c.executionCtx.waitUntil(
    draftSoul(c.env, name).then(async (soul) => {
      if (!soul) return;
      // Only if nobody has written one meanwhile.
      await c.env.DB.prepare("UPDATE bots SET soul = ?, updated_at = ? WHERE id = ? AND soul = ''").bind(soul, Date.now(), bot.id).run();
    })
  );
  return c.json({ ...bot, drafting: true });
});

// One bot, with who's in it. A member sees the soul too (read-only on the
// page): it's fair to know what a bot you talk to has been told to be.
bots.get("/:id", async (c) => {
  const access = await botAccess(c.env, c.req.param("id"), c.get("userId"), c.get("seatOf") !== null);
  if (!access) return c.json({ error: "not found" }, 404);
  return c.json({ bot: { ...access.bot, role: access.role }, roster: await botRoster(c.env, access.bot, access.role === "owner") });
});

bots.put("/:id", async (c) => {
  const access = await botAccess(c.env, c.req.param("id"), c.get("userId"), c.get("seatOf") !== null);
  if (!access) return c.json({ error: "not found" }, 404);
  if (access.role !== "owner") return c.json({ error: "only the bot's owner can change it" }, 403);
  const bot = access.bot;
  const body = await c.req.json().catch(() => ({}));
  const next = { ...bot };
  if (body?.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) return c.json({ error: `a bot needs a name, up to ${NAME_MAX} characters` }, 400);
    next.name = name;
  }
  if (typeof body?.soul === "string") {
    if (body.soul.length > SOUL_MAX * 2) return c.json({ error: `that's too long; a soul holds up to ${SOUL_MAX.toLocaleString("en-US")} characters` }, 400);
    next.soul = body.soul.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, SOUL_MAX);
  }
  if (body?.model === null) next.model = null;
  else if (typeof body?.model === "string") {
    if (!MODEL_IDS.has(body.model)) return c.json({ error: "that model isn't available" }, 400);
    next.model = body.model;
  }
  if (typeof body?.guarded === "boolean") next.guarded = body.guarded ? 1 : 0;
  if (next.guarded && bot.visibility === "public") return c.json({ error: "a public bot can't be guarded; everything in it is already everyone's" }, 400);
  next.updated_at = Date.now();
  await c.env.DB.prepare("UPDATE bots SET name = ?, soul = ?, model = ?, guarded = ?, updated_at = ? WHERE id = ?")
    .bind(next.name, next.soul, next.model, next.guarded, next.updated_at, bot.id)
    .run();
  return c.json({ ...next, role: "owner" });
});

// Its chats aren't lost: they move to Seed, which is why Seed can't go.
// Members' chats with it go the same way, to the owner's Seed, where the
// owner (who could always see them) keeps them; the members lose sight of
// them, as they would if removed.
bots.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const access = await botAccess(c.env, c.req.param("id"), userId, c.get("seatOf") !== null);
  if (!access) return c.json({ error: "not found" }, 404);
  if (access.role !== "owner") return c.json({ error: "only the bot's owner can delete it" }, 403);
  const bot = access.bot;
  if (bot.is_default) return c.json({ error: `${bot.name} is where your chats live; it can't be deleted` }, 403);
  const seed = await defaultBot(c.env, userId);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE chats SET bot_id = ? WHERE bot_id = ?").bind(seed.id, bot.id),
    c.env.DB.prepare("DELETE FROM bots WHERE id = ?").bind(bot.id),
  ]);
  return c.json({ ok: true, movedTo: seed.id });
});

// Share the bot with someone, by username or by email address. The same
// steps as sharing a chat (sharing.ts): an address with no account waits as
// a pending share, and may spend one of the owner's invites, with their
// say-so.
bots.post("/:id/members", async (c) => {
  const userId = c.get("userId");
  const access = await botAccess(c.env, c.req.param("id"), userId, c.get("seatOf") !== null);
  if (!access) return c.json({ error: "not found" }, 404);
  if (access.role !== "owner") return c.json({ error: "only the bot's owner can share it" }, 403);
  const bot = access.bot;

  const body = await c.req.json().catch(() => ({}));
  const who = typeof body?.who === "string" ? body.who.trim().replace(/^@/, "") : "";
  if (!who) return c.json({ error: "enter a username or an email address" }, 400);

  const counts = await c.env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM bot_members WHERE bot_id = ?1 AND removed_at IS NULL)
          + (SELECT COUNT(*) FROM bot_pending_shares WHERE bot_id = ?1) AS n`
  )
    .bind(bot.id)
    .first<{ n: number }>();
  if ((counts?.n ?? 0) >= config.limits.chat_members) {
    return c.json({ error: `a bot can be shared with ${config.limits.chat_members} people at most` }, 400);
  }

  const sharerName = c.get("username") ? `@${c.get("username")}` : c.get("userName") || "Someone";
  let target: { id: string; email: string } | null;
  if (who.includes("@")) {
    const email = normalizeEmail(who);
    if (!email) return c.json({ error: "that doesn't look like an email address" }, 400);
    target = await c.env.DB.prepare("SELECT id, email FROM user WHERE lower(email) = ?").bind(email).first<{ id: string; email: string }>();
    if (!target) {
      const waiting = await c.env.DB.prepare("SELECT 1 AS one FROM bot_pending_shares WHERE bot_id = ? AND email = ?").bind(bot.id, email).first();
      if (waiting) return c.json({ error: "this bot is already waiting for that address" }, 400);
      if (!(await pendingInviteFor(c.env, email))) {
        if (body?.useInvite !== true && !(await lapsedInviteFrom(c.env, userId, email))) {
          const me = await c.env.DB.prepare("SELECT invites_remaining FROM user WHERE id = ?").bind(userId).first<{ invites_remaining: number }>();
          return c.json({ error: "that address doesn't have an account yet", code: "needs_invite", invitesRemaining: me?.invites_remaining ?? 0 }, 409);
        }
        const invited = await createInvite(c.env, { email, inviterId: userId, inviterName: sharerName, sharedChat: true });
        if (!invited.ok) return c.json({ error: invited.reason }, 400);
      }
      await c.env.DB.prepare("INSERT INTO bot_pending_shares (id, bot_id, email, added_by, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), bot.id, email, userId, Date.now())
        .run();
      return c.json({ roster: await botRoster(c.env, bot, true), waitingFor: email });
    }
  } else {
    target = await c.env.DB.prepare("SELECT id, email FROM user WHERE lower(username) = ?").bind(who.toLowerCase()).first<{ id: string; email: string }>();
    if (!target) return c.json({ error: `nobody here goes by @${who}` }, 404);
  }

  if (target.id === userId) return c.json({ error: "that's you" }, 400);
  // A seat (seats.ts) goes where the account that made it puts it, nowhere else.
  const seat = await c.env.DB.prepare("SELECT seat_of FROM user WHERE id = ?").bind(target.id).first<{ seat_of: string | null }>();
  if (seat?.seat_of && seat.seat_of !== userId) return c.json({ error: `nobody here goes by @${who}` }, 404);
  const existing = await c.env.DB.prepare("SELECT removed_at FROM bot_members WHERE bot_id = ? AND user_id = ?")
    .bind(bot.id, target.id)
    .first<{ removed_at: number | null }>();
  if (existing && existing.removed_at === null) return c.json({ error: "they already have this bot" }, 400);

  const now = Date.now();
  await (existing
    ? c.env.DB.prepare("UPDATE bot_members SET removed_at = NULL, added_at = ?, added_by = ? WHERE bot_id = ? AND user_id = ?").bind(now, userId, bot.id, target.id)
    : c.env.DB.prepare("INSERT INTO bot_members (bot_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)").bind(bot.id, target.id, userId, now)
  ).run();
  // A seat's address gets no mail; its owner hands over the news in person.
  if (!seat?.seat_of) {
    c.executionCtx.waitUntil(
      sendEmail(c.env, { to: target.email, ...botSharedEmail({ sharerName, botName: bot.name, url: `${c.env.BASE_URL}/` }) }).catch((err) => console.error("bot share email failed", err))
    );
  }
  return c.json({ roster: await botRoster(c.env, bot, true) });
});

// The owner removes someone, or a member leaves. The row stays, stamped, so
// their chats keep their name; the owner keeps sight of those chats.
bots.delete("/:id/members/:userId", async (c) => {
  const userId = c.get("userId");
  const targetId = c.req.param("userId");
  const access = await botAccess(c.env, c.req.param("id"), userId, c.get("seatOf") !== null);
  if (!access) return c.json({ error: "not found" }, 404);
  if (access.role !== "owner" && targetId !== userId) return c.json({ error: "only the bot's owner can remove people" }, 403);
  const removed = await c.env.DB.prepare("UPDATE bot_members SET removed_at = ? WHERE bot_id = ? AND user_id = ? AND removed_at IS NULL")
    .bind(Date.now(), access.bot.id, targetId)
    .run();
  if (!removed.meta.changes) return c.json({ error: "not found" }, 404);
  if (access.role !== "owner") return c.json({ ok: true });
  return c.json({ roster: await botRoster(c.env, access.bot, true) });
});

bots.delete("/:id/pending/:pendingId", async (c) => {
  const access = await botAccess(c.env, c.req.param("id"), c.get("userId"), c.get("seatOf") !== null);
  if (!access || access.role !== "owner") return c.json({ error: "not found" }, 404);
  await c.env.DB.prepare("DELETE FROM bot_pending_shares WHERE id = ? AND bot_id = ?").bind(c.req.param("pendingId"), access.bot.id).run();
  return c.json({ roster: await botRoster(c.env, access.bot, true) });
});
