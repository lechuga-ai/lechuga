import { Hono, type Context } from "hono";
import type { AppEnv, ChatRow, Env } from "./types";
import { chatAccess, peopleByIds, type Person } from "./sharing";
import { botAccess, botFor, type BotView } from "./bots";
import { splitMessage } from "./attachments";
import { normalizeEmail } from "./invites";
import { sendEmail } from "./email";
import { publicPointerEmail } from "./email/templates";
import config from "../config.json";

// Public chats (migration 0017; the visibility column is from 0003). The
// person who started a chat can make it public: from then on anyone signed
// in can read it, and its replies are paid for by the house account below,
// not by them. Writing in it stays with the owner and the people they've
// shared it with (sharing.ts); everyone else is a reader. It can be made
// private again. Only a chat with your own bot can go public, and not with
// a guarded one.
//
// The house account is an ordinary account, @lechuga (a reserved name), so
// the ledger, the admin pages and the balance all work as they do for
// anyone; admins top it up with the grant tool. Two caps keep it from
// running away: its balance (where credits are enforced), and a daily cap
// on what public chats may spend together (config.json public_chats).
//
// "Asked before" (step 5): when a chat's first message goes in, public
// chats whose opening message shares its words are found (relatedPublic)
// and shown as links; the closest one's first answer is handed to the
// model too, so a question with a public answer can point at it instead
// of being answered from scratch.

const PUBLIC = config.public_chats;
const HOUSE_EMAIL = "house@lechuga.ai";
const HOUSE_USERNAME = "lechuga";

export type PublicChatSummary = {
  id: string;
  title: string | null;
  owner: Person;
  updated_at: number;
  messages: number;
  snippet?: string | null;
};

// The house account, made on first use.
export async function houseAccount(env: Env): Promise<string> {
  const found = await env.DB.prepare("SELECT id FROM user WHERE lower(email) = ?").bind(HOUSE_EMAIL).first<{ id: string }>();
  if (found) return found.id;
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt, username, username_set_at, invites_remaining, terms_accepted_at, terms_version)
     VALUES (?, 'Lechuga', ?, 1, NULL, ?, ?, ?, ?, 0, ?, ?)`
  )
    .bind(id, HOUSE_EMAIL, nowIso, nowIso, HOUSE_USERNAME, now, now, config.terms_version)
    .run();
  return id;
}

// What public chats have cost today (UTC), against the daily cap.
export async function publicSpendToday(env: Env, houseId: string): Promise<number> {
  const startOfDay = new Date().setUTCHours(0, 0, 0, 0);
  const row = await env.DB.prepare("SELECT COALESCE(-SUM(delta), 0) AS spent FROM credit_ledger WHERE user_id = ? AND reason = 'message' AND created_at >= ?")
    .bind(houseId, startOfDay)
    .first<{ spent: number }>();
  return row?.spent ?? 0;
}

// How many messages this person has sent in public chats today.
export async function publicMessagesToday(env: Env, userId: string): Promise<number> {
  const startOfDay = new Date().setUTCHours(0, 0, 0, 0);
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.user_id = ? AND m.role = 'user' AND c.visibility = 'public' AND m.created_at >= ?"
  )
    .bind(userId, startOfDay)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// The words of a message worth matching on: four letters or more, not the
// everyday ones, at most six.
const STOP = new Set(["about", "after", "again", "also", "because", "been", "before", "being", "between", "both", "could", "does", "doing", "down", "each", "from", "have", "here", "into", "just", "like", "make", "more", "most", "much", "need", "only", "other", "over", "please", "same", "should", "some", "something", "such", "than", "that", "their", "them", "then", "there", "these", "they", "thing", "this", "those", "through", "very", "want", "were", "what", "when", "where", "which", "while", "will", "with", "would", "your"]);

export function keyWords(text: string): string[] {
  const seen = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []) {
    if (STOP.has(w) || seen.has(w)) continue;
    seen.add(w);
    if (seen.size === 6) break;
  }
  return [...seen];
}

export type Related = { id: string; title: string | null };

// Public chats whose opening message shares the words of this one. All the
// words, in any order, with LIKE: fine while public chats number in the
// hundreds; the plan names FTS5 for when they don't.
export async function relatedPublic(env: Env, text: string, excludeChatId: string): Promise<Related[]> {
  const words = keyWords(splitMessage(text).typed);
  if (words.length < 2) return [];
  const like = (w: string) => `%${w.replace(/[\\%_]/g, (ch) => "\\" + ch)}%`;
  const clauses = words.map((_, i) => `lower(m.content) LIKE ?${i + 2} ESCAPE '\\'`).join(" AND ");
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.title FROM chats c JOIN messages m ON m.chat_id = c.id
     WHERE c.visibility = 'public' AND c.id != ?1 AND m.role = 'user'
       AND m.created_at = (SELECT MIN(created_at) FROM messages WHERE chat_id = c.id AND role = 'user')
       AND ${clauses}
     ORDER BY c.updated_at DESC LIMIT ${PUBLIC.related_max}`
  )
    .bind(excludeChatId, ...words.map(like))
    .all<Related>();
  return results;
}

// The first answer in a public chat, cut short, for the model to lean on.
export async function firstAnswer(env: Env, chatId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT content FROM messages WHERE chat_id = ? AND role = 'assistant' ORDER BY created_at ASC LIMIT 1")
    .bind(chatId)
    .first<{ content: string }>();
  return row ? row.content.slice(0, PUBLIC.bring_in_chars) : null;
}

export type PublicBotSummary = { id: string; name: string; soul: string; owner: Person; chats: number; updated_at: number };

export const publicChats = new Hono<AppEnv>();

// The browse page's bots: public ones, most recently active first, with
// the opening of their soul so people know what they're for.
publicChats.get("/bots", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 200).toLowerCase();
  const words = q.split(/\s+/).filter(Boolean).slice(0, 6);
  const like = (w: string) => `%${w.replace(/[\\%_]/g, (ch) => "\\" + ch)}%`;
  const clauses = words.map((_, i) => `(lower(b.name) LIKE ?${i + 1} ESCAPE '\\' OR lower(b.soul) LIKE ?${i + 1} ESCAPE '\\')`).join(" AND ");
  const { results } = await c.env.DB.prepare(
    `SELECT b.id, b.name, b.soul, b.user_id, b.updated_at, (SELECT COUNT(*) FROM chats WHERE bot_id = b.id) AS chats FROM bots b
     WHERE b.visibility = 'public' ${clauses ? `AND ${clauses}` : ""} ORDER BY b.updated_at DESC LIMIT 50`
  )
    .bind(...words.map(like))
    .all<{ id: string; name: string; soul: string; user_id: string; updated_at: number; chats: number }>();
  const people = await peopleByIds(c.env, results.map((r) => r.user_id));
  const out: PublicBotSummary[] = results.map((r) => ({
    id: r.id,
    name: r.name,
    soul: r.soul.slice(0, 200),
    owner: people.get(r.user_id) ?? { id: r.user_id, name: "someone who left", username: null, photo: null },
    chats: r.chats,
    updated_at: r.updated_at,
  }));
  return c.json(out);
});

// Make a bot public: the owner's call. Everything in it becomes public,
// the chats so far included, so a bot that's been shared with people can't
// go (their chats would be published; remove them first), and neither can
// a guarded one. It can be made private again.
publicChats.post("/bots/:id/public", async (c) => {
  const userId = c.get("userId");
  if (c.get("seatOf")) return c.json({ error: "not available on this account" }, 403);
  const access = await botAccess(c.env, c.req.param("id"), userId);
  if (!access) return c.json({ error: "not found" }, 404);
  if (access.role !== "owner") return c.json({ error: "only the bot's owner can make it public" }, 403);
  const bot = access.bot;
  if (bot.visibility === "public") return c.json({ ok: true, already: true });
  if (bot.guarded) return c.json({ error: "a guarded bot can't be made public" }, 403);
  const shared = await c.env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM bot_members WHERE bot_id = ?1 AND removed_at IS NULL) + (SELECT COUNT(*) FROM bot_pending_shares WHERE bot_id = ?1) AS n"
  )
    .bind(bot.id)
    .first<{ n: number }>();
  if ((shared?.n ?? 0) > 0) return c.json({ error: "a bot you've shared can't be made public, since that would publish their chats; remove them first" }, 403);
  await houseAccount(c.env);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE bots SET visibility = 'public', updated_at = ? WHERE id = ?").bind(now, bot.id),
    c.env.DB.prepare("UPDATE chats SET visibility = 'public', updated_at = ? WHERE bot_id = ?").bind(now, bot.id),
  ]);
  const view: BotView = { ...bot, visibility: "public", updated_at: now, role: "owner" };
  return c.json(view);
});

// The browse page: public chats, newest first, or the ones whose title or
// messages contain every word of ?q.
publicChats.get("/chats", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 200).toLowerCase();
  const words = q.split(/\s+/).filter(Boolean).slice(0, 6);
  const like = (w: string) => `%${w.replace(/[\\%_]/g, (ch) => "\\" + ch)}%`;
  let rows: (ChatRow & { messages: number })[];
  const snippetOf = new Map<string, string>();
  if (words.length === 0) {
    rows = (
      await c.env.DB.prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM messages WHERE chat_id = c.id) AS messages FROM chats c
         WHERE c.visibility = 'public' ORDER BY c.updated_at DESC LIMIT 50`
      ).all<ChatRow & { messages: number }>()
    ).results;
  } else {
    const clauses = words.map((_, i) => `lower(m.content) LIKE ?${i + 1} ESCAPE '\\'`).join(" AND ");
    const { results: hits } = await c.env.DB.prepare(
      `SELECT m.chat_id, m.content FROM messages m JOIN chats c ON c.id = m.chat_id
       WHERE c.visibility = 'public' AND ${clauses} ORDER BY m.created_at DESC LIMIT 300`
    )
      .bind(...words.map(like))
      .all<{ chat_id: string; content: string }>();
    for (const h of hits) {
      if (snippetOf.has(h.chat_id)) continue;
      const flat = splitMessage(h.content).typed.replace(/\s+/g, " ");
      const at = flat.toLowerCase().indexOf(words[0]);
      const start = Math.max(0, at - 40);
      snippetOf.set(h.chat_id, (start > 0 ? "…" : "") + flat.slice(start, start + 120) + (start + 120 < flat.length ? "…" : ""));
    }
    const titleClauses = words.map((_, i) => `lower(c.title) LIKE ?${i + 1} ESCAPE '\\'`).join(" AND ");
    const { results: all } = await c.env.DB.prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM messages WHERE chat_id = c.id) AS messages FROM chats c
       WHERE c.visibility = 'public' AND (${titleClauses} OR c.id IN (${[...snippetOf.keys()].map(() => "?").join(",") || "''"}))
       ORDER BY c.updated_at DESC LIMIT 50`
    )
      .bind(...words.map(like), ...snippetOf.keys())
      .all<ChatRow & { messages: number }>();
    rows = all;
  }
  const people = await peopleByIds(c.env, rows.map((r) => r.user_id));
  const gone: Person = { id: "", name: "someone who left", username: null, photo: null };
  const out: PublicChatSummary[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    owner: people.get(r.user_id) ?? { ...gone, id: r.user_id },
    updated_at: r.updated_at,
    messages: r.messages,
    snippet: snippetOf.get(r.id) ?? null,
  }));
  return c.json(out);
});

// Point someone at a public chat or bot: an email with the link, from
// whoever owns the thing. Nothing else happens; public is everyone's to
// read (to let them write in a chat, share it with them instead). The
// person needs an account already (Lechuga is invite only), so a username
// or an address that has one.
async function pointer(c: Context<AppEnv>, what: "chat" | "bot", title: string, url: string, ownerId: string) {
  const userId = c.get("userId");
  if (ownerId !== userId) return c.json({ error: `only the ${what}'s owner can send it on` }, 403);
  const body = await c.req.json().catch(() => ({}));
  const who = typeof body?.who === "string" ? body.who.trim().replace(/^@/, "") : "";
  if (!who) return c.json({ error: "enter a username or an email address" }, 400);
  let target: { id: string; email: string } | null;
  if (who.includes("@")) {
    const email = normalizeEmail(who);
    if (!email) return c.json({ error: "that doesn't look like an email address" }, 400);
    target = await c.env.DB.prepare("SELECT id, email FROM user WHERE lower(email) = ? AND seat_of IS NULL").bind(email).first<{ id: string; email: string }>();
    if (!target) return c.json({ error: "that address doesn't have a Lechuga account yet; invite them first, from the menu behind your name" }, 404);
  } else {
    target = await c.env.DB.prepare("SELECT id, email FROM user WHERE lower(username) = ? AND seat_of IS NULL").bind(who.toLowerCase()).first<{ id: string; email: string }>();
    if (!target) return c.json({ error: `nobody here goes by @${who}` }, 404);
  }
  if (target.id === userId) return c.json({ error: "that's you" }, 400);
  const sharerName = c.get("username") ? `@${c.get("username")}` : c.get("userName") || "Someone";
  c.executionCtx.waitUntil(
    sendEmail(c.env, { to: target.email, ...publicPointerEmail({ sharerName, what, title, url }) }).catch((err) => console.error("pointer email failed", err))
  );
  return c.json({ ok: true, sentTo: who });
}

publicChats.post("/chats/:id/invite", async (c) => {
  const access = await chatAccess(c.env, c.req.param("id"), c.get("userId"), c.get("seatOf") !== null);
  if (!access || access.chat.visibility !== "public") return c.json({ error: "not found" }, 404);
  return pointer(c, "chat", access.chat.title ?? "untitled", `${c.env.BASE_URL}/c/${access.chat.id}`, access.chat.user_id);
});

publicChats.post("/bots/:id/invite", async (c) => {
  const access = await botAccess(c.env, c.req.param("id"), c.get("userId"), c.get("seatOf") !== null);
  if (!access || access.bot.visibility !== "public") return c.json({ error: "not found" }, 404);
  return pointer(c, "bot", access.bot.name, `${c.env.BASE_URL}/b/${access.bot.id}`, access.bot.user_id);
});

// Private again, for a chat: everyone else stops being able to read it;
// the people the owner shared it with keep it. What anyone wrote stays.
async function chatPrivate(env: Env, chatId: string, now: number): Promise<D1PreparedStatement[]> {
  return [env.DB.prepare("UPDATE chats SET visibility = 'private', updated_at = ? WHERE id = ?").bind(now, chatId)];
}

publicChats.post("/chats/:id/private", async (c) => {
  const userId = c.get("userId");
  const access = await chatAccess(c.env, c.req.param("id"), userId, c.get("seatOf") !== null);
  if (!access) return c.json({ error: "not found" }, 404);
  if (access.chat.user_id !== userId) return c.json({ error: "only the person who started a chat can make it private" }, 403);
  if (access.chat.visibility !== "public") return c.json({ ok: true, already: true });
  await c.env.DB.batch(await chatPrivate(c.env, access.chat.id, Date.now()));
  return c.json({ ok: true });
});

// Private again, for a bot: the bot, and every chat with it. Chats that
// strangers started with it while it was public stay theirs to read (they
// started them) and the owner's (it's the owner's bot), as with a bot
// shared on purpose; they just stop being everyone's, and the owner pays
// for them from here, as for any shared bot. The owner can remove those
// people from the bot's sharing, or delete the chats.
publicChats.post("/bots/:id/private", async (c) => {
  const userId = c.get("userId");
  const access = await botAccess(c.env, c.req.param("id"), userId);
  if (!access) return c.json({ error: "not found" }, 404);
  if (access.role !== "owner") return c.json({ error: "only the bot's owner can make it private" }, 403);
  const bot = access.bot;
  if (bot.visibility !== "public") return c.json({ ok: true, already: true });
  const now = Date.now();
  const { results: chats } = await c.env.DB.prepare("SELECT id, user_id FROM chats WHERE bot_id = ?").bind(bot.id).all<{ id: string; user_id: string }>();
  const statements: D1PreparedStatement[] = [c.env.DB.prepare("UPDATE bots SET visibility = 'private', updated_at = ? WHERE id = ?").bind(now, bot.id)];
  for (const ch of chats) statements.push(...(await chatPrivate(c.env, ch.id, now)));
  // Whoever started a chat with it while public keeps that chat: they're a
  // member of the bot from here, which is what makes it theirs to read.
  for (const starter of new Set(chats.map((ch) => ch.user_id).filter((id) => id !== userId))) {
    statements.push(
      c.env.DB.prepare("INSERT INTO bot_members (bot_id, user_id, added_by, added_at) VALUES (?1, ?2, ?2, ?3) ON CONFLICT(bot_id, user_id) DO UPDATE SET removed_at = NULL").bind(bot.id, starter, now)
    );
  }
  await c.env.DB.batch(statements);
  return c.json({ ...bot, visibility: "private", updated_at: now, role: "owner" });
});

// Make a chat public. The owner's call, on a chat with their own bot, not a
// guarded one. It can be made private again.
publicChats.post("/chats/:id/public", async (c) => {
  const userId = c.get("userId");
  if (c.get("seatOf")) return c.json({ error: "not available on this account" }, 403);
  const access = await chatAccess(c.env, c.req.param("id"), userId);
  if (!access) return c.json({ error: "not found" }, 404);
  const chat = access.chat;
  if (chat.user_id !== userId) return c.json({ error: "only the person who started a chat can make it public" }, 403);
  if (chat.visibility === "public") return c.json({ ok: true, already: true });
  const bot = await botFor(c.env, chat);
  if (bot.user_id !== userId) return c.json({ error: "a chat with someone else's bot can't be made public" }, 403);
  if (bot.guarded) return c.json({ error: "a chat with a guarded bot can't be made public" }, 403);
  await houseAccount(c.env);
  await c.env.DB.prepare("UPDATE chats SET visibility = 'public', updated_at = ? WHERE id = ?").bind(Date.now(), chat.id).run();
  return c.json({ ok: true });
});
