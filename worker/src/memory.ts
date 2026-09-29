import { Hono } from "hono";
import type { AppEnv, Env } from "./types";
import type { ToolDef } from "./tools";
import config from "../config.json";

// Memory: what Lechuga keeps about a person across their chats (migration
// 0011). Two short documents per person:
//
//   notes  what to remember: who they are, what they're working on, lasting
//          preferences. Facts and context, a line each.
//   soul   how to be with them: tone, length, manner, from what they've
//          said and how they've reacted.
//
// Both go into the system prompt (prompt.ts) of the person's private chats,
// and only those: in a shared chat anyone could get the model to say what
// it was told, so a chat that has ever had someone else in it gets none of
// it. Four ways they're written: the person edits them under Account >
// Memory; "Remember this chat" (chat.ts) has the model fold a chat into
// both; the remember tool below lets the model save a line mid-chat when
// asked to; and the overnight pass (nightly.ts) folds in the day's chats
// unasked, while the nightly switch is on. Every reply re-reads them and
// pays for it, so each is capped at config.json limits.memory_chars.

export type Memory = {
  notes: string;
  soul: string;
  enabled: boolean;
  // The overnight pass may read my chats. trainedAt: when it last did.
  nightly: boolean;
  trainedAt: number | null;
  updatedAt: number | null;
};

type MemoryPatch = Partial<Pick<Memory, "notes" | "soul" | "enabled" | "nightly" | "trainedAt">>;

const MAX = config.limits.memory_chars;
const EMPTY: Memory = { notes: "", soul: "", enabled: true, nightly: true, trainedAt: null, updatedAt: null };

export async function loadMemory(env: Env, userId: string): Promise<Memory> {
  const row = await env.DB.prepare("SELECT notes, soul, enabled, nightly, trained_at, updated_at FROM memory WHERE user_id = ?")
    .bind(userId)
    .first<{ notes: string; soul: string; enabled: number; nightly: number; trained_at: number | null; updated_at: number }>();
  return row
    ? { notes: row.notes, soul: row.soul, enabled: row.enabled === 1, nightly: row.nightly === 1, trainedAt: row.trained_at, updatedAt: row.updated_at }
    : EMPTY;
}

// Writes what's given and keeps the rest. Text is trimmed and cut to the cap
// here, whoever wrote it, so nothing longer ever reaches the prompt.
export async function saveMemory(env: Env, userId: string, patch: MemoryPatch): Promise<Memory> {
  const current = await loadMemory(env, userId);
  const next: Memory = {
    notes: clean(patch.notes ?? current.notes),
    soul: clean(patch.soul ?? current.soul),
    enabled: patch.enabled ?? current.enabled,
    nightly: patch.nightly ?? current.nightly,
    trainedAt: patch.trainedAt ?? current.trainedAt,
    updatedAt: Date.now(),
  };
  await env.DB.prepare(
    `INSERT INTO memory (user_id, notes, soul, enabled, nightly, trained_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(user_id) DO UPDATE SET notes = ?2, soul = ?3, enabled = ?4, nightly = ?5, trained_at = ?6, updated_at = ?7`
  )
    .bind(userId, next.notes, next.soul, next.enabled ? 1 : 0, next.nightly ? 1 : 0, next.trainedAt, next.updatedAt)
    .run();
  return next;
}

function clean(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX);
}

// What the person sees and edits: GET and PUT /api/memory. Runs after the
// session check in index.ts, so the user is the signed-in one.
export const memory = new Hono<AppEnv>();

memory.get("/", async (c) => c.json(await loadMemory(c.env, c.get("userId"))));

memory.put("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const patch: MemoryPatch = {};
  for (const key of ["notes", "soul"] as const) {
    if (typeof body?.[key] !== "string") continue;
    if (body[key].length > MAX * 2) return c.json({ error: `that's too long; the most each part can hold is ${MAX.toLocaleString("en-US")} characters` }, 400);
    patch[key] = body[key];
  }
  if (typeof body?.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body?.nightly === "boolean") patch.nightly = body.nightly;
  return c.json(await saveMemory(c.env, c.get("userId"), patch));
});

// "Remember this chat": what the model is asked, after the chat it would
// have been sent anyway, and how its answer is read back. It rewrites both
// documents in full, merged with what the chat adds, so memory stays short
// instead of growing with every chat. The two markers are what parseRemembered
// looks for; a model that writes only one leaves the other as it was. The
// overnight pass asks the same, but for a day's chats and more warily: the
// person didn't ask, so nothing should land that they'd be surprised by.
export function rememberRequest(current: Memory, mode: "chat" | "overnight" = "chat"): string {
  const opening =
    mode === "chat"
      ? `Update what you keep about me from this conversation. Below is what you have so far, in two parts. Rewrite both in full: keep what still holds, fold in what this chat adds, and drop anything this chat shows is out of date. Leave out one-off details that won't matter in another chat.\n\n`
      : `Update what you keep about me from those chats. Below is what you have so far, in two parts. Rewrite both in full: keep what still holds, add only what is clearly lasting and would help in a future chat, and drop anything the chats show is out of date. I didn't ask for this, so be conservative: no one-off tasks, no passing moods, nothing private I'd not expect kept, and if nothing lasting came up, return both parts as they are.\n\n`;
  return (
    opening +
    `[NOTES] is what to remember about me: who I am, what I'm working on, people and things I've mentioned that will come up again, and preferences about content. Facts, a short line each, in the third person.\n` +
    `[SOUL] is how to be with me: the tone, length, format and manner I seem to want, from what I've asked for and how I've reacted. Short lines.\n\n` +
    `Each part under ${MAX.toLocaleString("en-US")} characters. Write exactly two sections, one headed [NOTES] and one headed [SOUL], and nothing else: no preamble, no sign-off.\n\n` +
    `[NOTES]\n${current.notes.trim() || "(nothing yet)"}\n\n[SOUL]\n${current.soul.trim() || "(nothing yet)"}`
  );
}

export function parseRemembered(text: string, current: Memory): { notes: string; soul: string } {
  const notesAt = text.indexOf("[NOTES]");
  const soulAt = text.indexOf("[SOUL]");
  if (notesAt < 0 && soulAt < 0) return { notes: clean(text), soul: current.soul };
  const section = (from: number, to: number) => (from < 0 ? null : clean(text.slice(from, to < from ? undefined : to)));
  const notes = section(notesAt < 0 ? -1 : notesAt + "[NOTES]".length, soulAt);
  const soul = section(soulAt < 0 ? -1 : soulAt + "[SOUL]".length, notesAt);
  return { notes: notes ?? current.notes, soul: soul ?? current.soul };
}

// The model's own way to save a line while it answers, offered only in a
// private chat with memory on (chat.ts). The person's id is bound in here
// so the tool has the same shape as the others in tools.ts, which know
// nothing about who's asking.
export function rememberTool(userId: string): ToolDef {
  return {
    name: "remember",
    description:
      "Save one thing about the person to your memory of them, which you'll have in all their chats. Use it when they ask you to remember something, or tell you something clearly meant to last: their name, what they do, a lasting preference, how they'd like you to answer. One short line in the third person. Not for passing details.",
    parameters: {
      type: "object",
      properties: { note: { type: "string", description: "One line, under 200 characters. For example: Vegetarian; cooks for two most nights." } },
      required: ["note"],
    },
    available: () => true,
    label: (args) => `Remembered: ${String(args.note ?? "").slice(0, 80)}`,
    async run(env, args) {
      const free = { costUsd: 0, credits: 0 };
      const note = String(args.note ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (!note) return { result: "There was nothing to save.", ...free };
      const current = await loadMemory(env, userId);
      if (!current.enabled) return { result: "Memory is turned off, so nothing was saved. Tell the person they can turn it on under Account, then Memory.", ...free };
      if (current.notes.toLowerCase().includes(note.toLowerCase())) return { result: "That's already in your memory.", ...free };
      const notes = current.notes.trim() ? `${current.notes.trim()}\n${note}` : note;
      if (notes.length > MAX) {
        return { result: "Your memory of this person is full, so this wasn't saved. Tell them so: they can trim it under Account, then Memory, or use Remember this chat, which condenses it.", ...free };
      }
      await saveMemory(env, userId, { notes });
      return { result: `Saved to memory: ${note}`, ...free };
    },
  };
}
