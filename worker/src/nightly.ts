import type { Env } from "./types";
import { streamChat, collectText } from "./gateway";
import { accountState, costUsdFor, creditsEnforced, creditsFor, estimateTokens, ledgerStatements } from "./credits";
import { splitMessage } from "./attachments";
import { loadMemory, parseRemembered, rememberRequest, saveMemory } from "./memory";
import { systemPrompt } from "./prompt";
import config from "../config.json";

// The overnight memory pass. Once a night (a cron trigger in wrangler.toml,
// index.ts's scheduled handler) Lechuga reads what each person said in their
// own chats since it last looked, and folds anything lasting into their notes
// and soul (memory.ts), the same rewrite "Remember this chat" does but
// unasked and told to be conservative. So memory fills in on its own for
// people who never press the button.
//
// Only private chats, only the typed text (attachments are documents, not
// the person), only people who chatted, and only with the switch on (Account
// > Memory, "Learn from my chats overnight"). Each pass is one model call
// per person, charged to them like a reply, with "training" on the ledger
// row; it's skipped for anyone suspended or at zero. Bounded twice over:
// config.json nightly.train_tokens caps what's read per person, and a person
// is looked at once per run.
//
// An admin can run it by hand: POST /api/admin/nightly. Locally, `npm run
// dev` starts wrangler with --test-scheduled, so
// curl -X POST "http://localhost:8787/__scheduled" fires it too.

const N = config.nightly;
const MODEL = config.models[0].id;
const DAY = 24 * 60 * 60 * 1000;

export type NightlyOutcome = { candidates: number; trained: number; skipped: number; failed: number };

export async function nightly(env: Env): Promise<NightlyOutcome> {
  const now = Date.now();
  // Anyone who typed in one of their own chats in the last two days. Two,
  // not one, so a night the cron missed is caught up the next; each person's
  // own window starts where their last pass ended (below).
  const { results: people } = await env.DB.prepare(
    `SELECT DISTINCT c.user_id FROM messages m JOIN chats c ON c.id = m.chat_id
     WHERE m.role = 'user' AND m.created_at > ?1 AND (m.user_id IS NULL OR m.user_id = c.user_id)
       AND NOT EXISTS (SELECT 1 FROM chat_members cm WHERE cm.chat_id = c.id)`
  )
    .bind(now - 2 * DAY)
    .all<{ user_id: string }>();

  const outcome: NightlyOutcome = { candidates: people.length, trained: 0, skipped: 0, failed: 0 };
  // A few at a time: one model call each, and the gateway is shared by
  // everyone awake.
  const queue = people.map((p) => p.user_id);
  const workers = Array.from({ length: Math.min(N.concurrency, queue.length) }, async () => {
    for (let userId = queue.shift(); userId; userId = queue.shift()) {
      try {
        const did = await trainOne(env, userId, now);
        if (did) outcome.trained++;
        else outcome.skipped++;
      } catch (err) {
        outcome.failed++;
        console.error("nightly pass failed for a user", err);
      }
    }
  });
  await Promise.all(workers);
  console.log("nightly memory pass", JSON.stringify(outcome));
  return outcome;
}

// One person. True if their memory was rewritten.
async function trainOne(env: Env, userId: string, now: number): Promise<boolean> {
  const [memory, account] = await Promise.all([loadMemory(env, userId), accountState(env, userId)]);
  if (!memory.enabled || !memory.nightly) return false;
  if (account.suspended) return false;
  if (creditsEnforced(env) && account.balance <= 0) return false;

  // Since the last pass, but never more than two days back: the first night
  // shouldn't read someone's whole history at their expense.
  const since = Math.max(memory.trainedAt ?? 0, now - 2 * DAY);
  const { results: rows } = await env.DB.prepare(
    `SELECT c.id AS chat_id, c.title, m.role, m.content FROM messages m JOIN chats c ON c.id = m.chat_id
     WHERE c.user_id = ?1 AND m.created_at > ?2
       AND NOT EXISTS (SELECT 1 FROM chat_members cm WHERE cm.chat_id = c.id)
     ORDER BY c.updated_at DESC, m.created_at ASC`
  )
    .bind(userId, since)
    .all<{ chat_id: string; title: string | null; role: string; content: string }>();

  const transcript = transcriptOf(rows);
  if (!transcript) return false;

  const request =
    `Here is what I said in my own chats since you last looked, newest chat first. Some of it is passing; treat it that way.\n\n${transcript.text}\n\n` +
    rememberRequest(memory, "overnight");
  const upstream = await streamChat(env, MODEL, [{ role: "system", content: systemPrompt({ model: MODEL, memory }) }, { role: "user", content: request }], {
    maxTokens: config.limits.remember_tokens,
    effort: "low",
  });
  const written = (await collectText(upstream.stream)).trim();
  const { promptTokens, completionTokens } = await upstream.usage;
  if (!written) return false;

  const tokensIn = promptTokens ?? estimateTokens(request);
  const tokensOut = completionTokens ?? estimateTokens(written);
  const credits = creditsFor(MODEL, tokensIn, tokensOut);
  await env.DB.batch(
    ledgerStatements(env, {
      userId,
      delta: -credits,
      reason: "message",
      ref: null,
      model: MODEL,
      promptTokens: tokensIn,
      completionTokens: tokensOut,
      costUsd: costUsdFor(MODEL, tokensIn, tokensOut),
      note: "training",
    })
  );
  await saveMemory(env, userId, { ...parseRemembered(written, memory), trainedAt: now });
  return true;
}

// The day's chats as plain text, newest chat first, within the token budget.
// A user turn is what was typed (the attachment blocks in front of it are
// dropped); a reply is cut short, since what Lechuga said matters less than
// what the person did. Null when there's too little to learn from.
function transcriptOf(rows: { chat_id: string; title: string | null; role: string; content: string }[]): { text: string; userTurns: number } | null {
  const chats = new Map<string, { title: string | null; lines: string[]; userTurns: number }>();
  for (const r of rows) {
    const chat = chats.get(r.chat_id) ?? { title: r.title, lines: [], userTurns: 0 };
    if (r.role === "user") {
      const typed = splitMessage(r.content).typed.trim();
      if (!typed) continue;
      chat.lines.push(`Person: ${typed.slice(0, N.turn_chars)}`);
      chat.userTurns++;
    } else {
      chat.lines.push(`Lechuga: ${r.content.slice(0, N.reply_chars)}`);
    }
    chats.set(r.chat_id, chat);
  }
  let budget = N.train_tokens;
  let userTurns = 0;
  const blocks: string[] = [];
  for (const chat of chats.values()) {
    if (chat.userTurns === 0) continue;
    const block = `Chat: ${chat.title ?? "untitled"}\n${chat.lines.join("\n")}`;
    const cost = estimateTokens(block);
    if (cost > budget) break;
    budget -= cost;
    userTurns += chat.userTurns;
    blocks.push(block);
  }
  if (userTurns < N.min_turns) return null;
  return { text: blocks.join("\n\n"), userTurns };
}
