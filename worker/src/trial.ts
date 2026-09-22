import { basePreamble } from "./chat";
import { Hono } from "hono";
import type { AppEnv, Env } from "./types";
import { streamChat, textDeltaStream } from "./gateway";
import { verifyTurnstile } from "./turnstile";
import config from "../config.json";

// Public: one free chat from the home page, no account. This is the only
// place an anonymous request reaches the model, and every tier shares one AI
// Gateway spend cap, so it has its own small budget: a Turnstile check, a
// per-visitor daily limit, an overall daily limit, and short messages. A
// trial that would exceed any of them is refused before the model is called.
// The conversation itself is never stored; it lives in the visitor's tab.
export const trial = new Hono<AppEnv>();

const TRIAL = config.trial;
const TRIAL_MODEL = config.models[0].id;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Salted with the auth secret and the day: can't be reversed to an address
// by anyone who sees the table, and the same visitor looks different tomorrow.
async function visitorHash(env: Env, ip: string, day: string): Promise<string> {
  const data = new TextEncoder().encode(`${env.BETTER_AUTH_SECRET}:${day}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

trial.post("/", async (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  if (!(await verifyTurnstile(c.env, c.req.header("x-captcha-response") ?? null, ip === "local" ? null : ip))) {
    return c.json({ error: "the bot check didn't pass; reload the page and try again" }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content) return c.json({ error: "message is empty" }, 400);
  if (content.length > TRIAL.max_message_chars) {
    return c.json({ error: `the free chat takes up to ${TRIAL.max_message_chars} characters; sign in for longer ones` }, 400);
  }

  const day = today();
  const visitor = await visitorHash(c.env, ip, day);
  const [mine, everyone] = await c.env.DB.batch<{ n: number }>([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM trial_uses WHERE day = ? AND visitor = ?").bind(day, visitor),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM trial_uses WHERE day = ?").bind(day),
  ]);
  if ((mine.results[0]?.n ?? 0) >= TRIAL.per_visitor_per_day) {
    return c.json({ error: "that was your free chat for today", code: "trial_used" }, 429);
  }
  if ((everyone.results[0]?.n ?? 0) >= TRIAL.per_day) {
    return c.json({ error: "the free chats are used up for today", code: "trials_full" }, 429);
  }

  // Counted before the model is called, so a request that fails halfway
  // still uses the visitor's turn and can't be retried in a loop.
  await c.env.DB.prepare("INSERT INTO trial_uses (id, visitor, day, created_at) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), visitor, day, Date.now())
    .run();

  let upstream;
  try {
    upstream = await streamChat(c.env, TRIAL_MODEL, [{ role: "system", content: basePreamble() }, { role: "user", content }], { maxTokens: TRIAL.max_reply_tokens });
  } catch (err) {
    console.error("gateway call failed (trial)", err);
    return c.json({ error: "the model isn't reachable right now" }, 502);
  }

  c.header("content-type", "text/event-stream");
  c.header("cache-control", "no-cache");
  c.header("connection", "keep-alive");
  return c.body(textDeltaStream(upstream.stream));
});
