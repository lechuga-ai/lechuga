import { Hono } from "hono";
import type { AppEnv, BotRow, ChatRow, Env } from "./types";
import { collectText, streamChat } from "./gateway";
import config from "../config.json";

// Bots (migration 0013): a name, a soul, a model, an owner. Every chat is
// with one. An account's first bot is Seed, made here the first time it's
// needed; the rest are made by naming them, and the name is the brief: the
// model drafts a first soul from it, which the person rewrites on the bot's
// page. Nothing here is shared yet (plan, step 2): a bot is its owner's, and
// any other account's bot is a 404.

const DEFAULT_NAME = "Seed";
const DRAFT_MODEL = config.models[0].id;
const MODEL_IDS = new Set(config.models.filter((m) => !("retired" in m && m.retired)).map((m) => m.id));
const NAME_MAX = 40;
const SOUL_MAX = config.limits.memory_chars;

export async function listBots(env: Env, userId: string): Promise<BotRow[]> {
  await defaultBot(env, userId);
  const { results } = await env.DB.prepare("SELECT * FROM bots WHERE user_id = ? ORDER BY is_default DESC, created_at ASC").bind(userId).all<BotRow>();
  return results;
}

// Seed, made on first use. Accounts from before bots got theirs in the
// migration; new ones get it here.
export async function defaultBot(env: Env, userId: string): Promise<BotRow> {
  const found = await env.DB.prepare("SELECT * FROM bots WHERE user_id = ? AND is_default = 1").bind(userId).first<BotRow>();
  if (found) return found;
  const bot: BotRow = { id: crypto.randomUUID(), user_id: userId, name: DEFAULT_NAME, soul: "", model: null, is_default: 1, created_at: Date.now(), updated_at: Date.now() };
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

// One of mine, or null: someone else's bot looks the same as no bot.
export async function myBot(env: Env, userId: string, botId: string): Promise<BotRow | null> {
  return env.DB.prepare("SELECT * FROM bots WHERE id = ? AND user_id = ?").bind(botId, userId).first<BotRow>();
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

bots.get("/", async (c) => c.json(await listBots(c.env, c.get("userId"))));

bots.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = cleanName(body?.name);
  if (!name) return c.json({ error: `a bot needs a name, up to ${NAME_MAX} characters` }, 400);
  const model = typeof body?.model === "string" && MODEL_IDS.has(body.model) ? body.model : null;
  const userId = c.get("userId");
  await defaultBot(c.env, userId);
  const soul = await draftSoul(c.env, name);
  const now = Date.now();
  const bot: BotRow = { id: crypto.randomUUID(), user_id: userId, name, soul, model, is_default: 0, created_at: now, updated_at: now };
  await c.env.DB.prepare("INSERT INTO bots (id, user_id, name, soul, model, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)")
    .bind(bot.id, userId, name, soul, model, now, now)
    .run();
  return c.json(bot);
});

bots.get("/:id", async (c) => {
  const bot = await myBot(c.env, c.get("userId"), c.req.param("id"));
  return bot ? c.json(bot) : c.json({ error: "not found" }, 404);
});

bots.put("/:id", async (c) => {
  const bot = await myBot(c.env, c.get("userId"), c.req.param("id"));
  if (!bot) return c.json({ error: "not found" }, 404);
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
  next.updated_at = Date.now();
  await c.env.DB.prepare("UPDATE bots SET name = ?, soul = ?, model = ?, updated_at = ? WHERE id = ?").bind(next.name, next.soul, next.model, next.updated_at, bot.id).run();
  return c.json(next);
});

// Its chats aren't lost: they move to Seed, which is why Seed can't go.
bots.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const bot = await myBot(c.env, userId, c.req.param("id"));
  if (!bot) return c.json({ error: "not found" }, 404);
  if (bot.is_default) return c.json({ error: `${bot.name} is where your chats live; it can't be deleted` }, 403);
  const seed = await defaultBot(c.env, userId);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE chats SET bot_id = ? WHERE bot_id = ?").bind(seed.id, bot.id),
    c.env.DB.prepare("DELETE FROM bots WHERE id = ?").bind(bot.id),
  ]);
  return c.json({ ok: true, movedTo: seed.id });
});
