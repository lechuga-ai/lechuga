import { runReply } from "./reply";
import { toolsFor } from "./tools";
import { Hono } from "hono";
import type { AppEnv, Env, ChatRow, MessageRow } from "./types";
import { streamChat, collectText, type ChatTurn } from "./gateway";
import { accountState, costUsdFor, creditsEnforced, creditsFor, estimateTokens, ledgerStatements } from "./credits";
import { composeMessage, estimateMessageTokens, looksLikeImage, looksLikeText, modelContent, type Attachment, type ContentPart } from "./attachments";
import { SUMMARY_PREAMBLE, SUMMARY_REQUEST, isSummary, sinceLastSummary, summaryText, wrapSummary } from "./summary";
import { chatAccess, listChats, peopleByIds, roster } from "./sharing";
import config from "../config.json";

const DEFAULT_MODEL = config.models[0].id;
// New chats can only start on a current model (see ModelConfig.retired).
const MODEL_IDS = new Set(config.models.filter((m) => !("retired" in m && m.retired)).map((m) => m.id));
const MAX_MESSAGE_CHARS = 32000;
// Keeps one account from using up the AI Gateway's daily spend cap for
// everyone, including where credits aren't enforced yet (credits.ts). Per
// user, per UTC day.
const DAILY_MESSAGE_CAP = config.daily_message_cap;

const LIMITS = config.limits;
const IN_FLIGHT_WINDOW_MS = 2 * 60 * 1000;

// What's been sent lately. Two of the numbers are about the person typing:
// today (the daily cap) and the last minute (bursts), counted wherever they
// typed, their own chats or ones shared with them. The third is about whoever
// pays: turns from the last two minutes, in any of the payer's chats, that
// have no reply yet. That one matters because the balance is only checked
// before a reply and charged after it: without a limit on replies in flight,
// an account with one credit left could have dozens started at once and
// leave us paying for all of them.
async function recentActivity(env: Env, senderId: string, payerId: string): Promise<{ today: number; lastMinute: number; inFlight: number }> {
  const now = Date.now();
  const startOfDay = new Date().setUTCHours(0, 0, 0, 0);
  // A turn with no user_id is from before sharing, when only the owner typed.
  const [sent, waiting] = await env.DB.batch<{ today?: number; lastMinute?: number; inFlight?: number }>([
    env.DB.prepare(
      `SELECT COALESCE(SUM(t >= ?2), 0) AS today, COALESCE(SUM(t >= ?3), 0) AS lastMinute FROM (
         SELECT m.created_at AS t FROM messages m JOIN chats c ON c.id = m.chat_id
          WHERE c.user_id = ?1 AND m.role = 'user' AND m.created_at >= ?2 AND (m.user_id IS NULL OR m.user_id = ?1)
         UNION ALL
         SELECT m.created_at FROM messages m JOIN chats c ON c.id = m.chat_id
          WHERE m.user_id = ?1 AND c.user_id != ?1 AND m.role = 'user' AND m.created_at >= ?2)`
    ).bind(senderId, startOfDay, now - 60_000),
    env.DB.prepare(
      `SELECT COUNT(*) AS inFlight FROM messages m JOIN chats c ON c.id = m.chat_id
       WHERE c.user_id = ?1 AND m.role = 'user' AND m.created_at >= ?2 AND NOT EXISTS (
         SELECT 1 FROM messages a WHERE a.chat_id = m.chat_id AND a.role = 'assistant' AND a.created_at > m.created_at)`
    ).bind(payerId, now - IN_FLIGHT_WINDOW_MS),
  ]);
  return { today: sent.results[0]?.today ?? 0, lastMinute: sent.results[0]?.lastMinute ?? 0, inFlight: waiting.results[0]?.inFlight ?? 0 };
}

// Keeps what is sent to the model under limits.history_tokens by dropping
// the oldest turns. Without it a long chat re-sends (and pays for) its whole
// past with every message, and eventually overflows the model's context.
// The newest turn always goes, whatever its size.
function trimHistory<T extends { content: string }>(history: T[]): { kept: T[]; dropped: number } {
  let budget = LIMITS.history_tokens;
  let start = history.length;
  while (start > 0) {
    const cost = estimateMessageTokens(history[start - 1].content);
    if (start < history.length && cost > budget) break;
    budget -= cost;
    start--;
  }
  return { kept: history.slice(start), dropped: start };
}

// Every route here runs after the session middleware in index.ts, so
// c.get("userId") is the signed-in user. Nothing below trusts a user id from
// the request itself.
export const chat = new Hono<AppEnv>();

// Mine, and the ones shared with me (sharing.ts).
chat.get("/chats", async (c) => c.json(await listChats(c.env, c.get("userId"))));

chat.post("/chats", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const model = MODEL_IDS.has(body?.model) ? body.model : DEFAULT_MODEL;

  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO chats (id, user_id, title, model, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)"
  )
    .bind(id, c.get("userId"), model, now, now)
    .run();
  return c.json({ id });
});

// Brings the home page's free trial chat into a new account as its first
// chat. The text comes from the visitor's own browser, so it's only ever
// shown back to them; it is size-limited, costs no credits (the trial already
// ran), and is taken once, while the account has no chats.
chat.post("/chats/import", async (c) => {
  const body = await c.req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim().slice(0, config.trial.max_message_chars) : "";
  const answer = typeof body?.answer === "string" ? body.answer.trim().slice(0, MAX_MESSAGE_CHARS) : "";
  if (!question || !answer) return c.json({ error: "nothing to import" }, 400);

  const existing = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM chats WHERE user_id = ?")
    .bind(c.get("userId"))
    .first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) return c.json({ error: "only a new account can import its trial chat" }, 409);

  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO chats (id, user_id, title, model, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)").bind(
      id,
      c.get("userId"),
      DEFAULT_MODEL,
      now,
      now
    ),
    c.env.DB.prepare("INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)").bind(
      crypto.randomUUID(),
      id,
      question,
      now
    ),
    c.env.DB.prepare("INSERT INTO messages (id, chat_id, role, content, model, created_at) VALUES (?, ?, 'assistant', ?, ?, ?)").bind(
      crypto.randomUUID(),
      id,
      answer,
      DEFAULT_MODEL,
      now + 1
    ),
  ]);
  c.executionCtx.waitUntil(generateTitle(c.env, id, question));
  return c.json({ id });
});

// Anyone in the chat gets all of it, from the beginning, along with who's in
// it. A chat you're not in looks identical to one that doesn't exist (404
// either way), so ids can't be probed.
chat.get("/chats/:id", async (c) => {
  const chatId = c.req.param("id");
  const access = await chatAccess(c.env, chatId, c.get("userId"));
  if (!access) return c.json({ error: "not found" }, 404);

  const [{ results }, people] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC").bind(chatId).all<MessageRow>(),
    roster(c.env, access.chat, access.role === "owner"),
  ]);
  return c.json({ chat: access.chat, messages: results, role: access.role, roster: people });
});

// Deleting is the owner's, and takes the chat away from everyone in it. A
// member leaves instead (sharing.ts).
chat.delete("/chats/:id", async (c) => {
  const chatId = c.req.param("id");
  const access = await chatAccess(c.env, chatId, c.get("userId"));
  if (!access) return c.json({ error: "not found" }, 404);
  if (access.role !== "owner") return c.json({ error: "only the person who started a chat can delete it" }, 403);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM chat_members WHERE chat_id = ?").bind(chatId),
    c.env.DB.prepare("DELETE FROM chat_pending_shares WHERE chat_id = ?").bind(chatId),
    c.env.DB.prepare("DELETE FROM messages WHERE chat_id = ?").bind(chatId),
    c.env.DB.prepare("DELETE FROM chats WHERE id = ?").bind(chatId),
  ]);
  return c.json({ ok: true });
});

chat.post("/chats/:id/messages", async (c) => {
  const chatId = c.req.param("id");
  const userId = c.get("userId");
  const access = await chatAccess(c.env, chatId, userId);
  if (!access) return c.json({ error: "not found" }, 404);
  const chatRow = access.chat;
  // Whoever typed, the chat's payer is charged for the reply. Today that's
  // always its owner; it's named apart so a chat can one day be paid for by
  // someone else (a public chat, by Lechuga).
  const payerId = chatRow.user_id;
  const mine = access.role === "owner";

  const body = await c.req.json().catch(() => null);
  const typed = typeof body?.content === "string" ? body.content.trim() : "";
  if (typed.length > MAX_MESSAGE_CHARS) {
    return c.json({ error: `message is over ${MAX_MESSAGE_CHARS} characters` }, 400);
  }
  // Files and long pastes (attachments.ts). Text only, a few at a time, and
  // a ceiling on their size together: they're re-sent, and paid for, with
  // every later turn until the history budget drops them.
  const attachments: Attachment[] = [];
  const vision = config.models.some((m) => m.id === chatRow.model && "vision" in m && m.vision);
  for (const raw of Array.isArray(body?.attachments) ? body.attachments : []) {
    if (typeof raw?.name !== "string" || typeof raw?.text !== "string" || !raw.text.trim()) continue;
    if (raw.image === true) {
      if (!vision) return c.json({ error: "this chat's model can't read pictures. Start a new chat on GLM 5.3 Flash, which can." }, 400);
      if (!looksLikeImage(raw.text) || raw.text.length > LIMITS.image_chars) return c.json({ error: `${raw.name} isn't a picture we can use` }, 400);
      attachments.push({ name: raw.name, text: raw.text, image: true });
      continue;
    }
    if (!looksLikeText(raw.text)) return c.json({ error: `${raw.name} isn't a text file` }, 400);
    attachments.push({ name: raw.name, text: raw.text, pasted: raw.pasted === true });
  }
  if (attachments.filter((a) => a.image).length > LIMITS.images_per_message) {
    return c.json({ error: `that's more than ${LIMITS.images_per_message} pictures on one message` }, 400);
  }
  if (attachments.length > LIMITS.attachments_per_message) {
    return c.json({ error: `that's more than ${LIMITS.attachments_per_message} attachments on one message` }, 400);
  }
  const attachedChars = attachments.reduce((n, a) => n + (a.image ? 0 : a.text.length), 0);
  if (attachedChars > LIMITS.attachment_chars) {
    return c.json({ error: `the attachments come to ${attachedChars.toLocaleString("en-US")} characters; the most one message can carry is ${LIMITS.attachment_chars.toLocaleString("en-US")}` }, 400);
  }
  // The composer's effort dropdown. Anything unexpected gets the default.
  const effort = config.efforts.some((e) => e.id === body?.effort) ? (body.effort as string) : config.default_effort;
  const content = composeMessage(typed, attachments);
  if (!content) return c.json({ error: "message is empty" }, 400);
  // All checked before anything is stored or sent to the model.
  const [account, sender, recent] = await Promise.all([
    accountState(c.env, payerId),
    mine ? null : accountState(c.env, userId),
    recentActivity(c.env, userId, payerId),
  ]);
  if ((sender ?? account).suspended) {
    return c.json({ error: "this account is suspended. Write to hello@lechuga.ai if that's a mistake.", code: "suspended" }, 403);
  }
  if (account.suspended) return c.json({ error: "this chat is on hold for now" }, 403);
  if (recent.today >= DAILY_MESSAGE_CAP) {
    return c.json({ error: `that's ${DAILY_MESSAGE_CAP} messages today, which is the daily limit for now. It resets at midnight UTC.` }, 429);
  }
  if (recent.lastMinute >= LIMITS.messages_per_minute) {
    return c.json({ error: "that's a lot of messages in one minute. Give it a moment and try again." }, 429);
  }
  if (recent.inFlight >= LIMITS.replies_in_flight) {
    return c.json({ error: "a few replies are still being written. Wait for one to finish, then send this again." }, 429);
  }
  // The code field is what the UI turns into the buy prompt. Someone typing
  // in a chat that isn't theirs can't buy its owner credits, so no code.
  if (creditsEnforced(c.env) && account.balance <= 0) {
    return mine
      ? c.json({ error: "you're out of lettuce", code: "out_of_credits" }, 402)
      : c.json({ error: "the person who started this chat is out of credits, so it's paused until they get more" }, 402);
  }

  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO messages (id, chat_id, role, content, user_id, created_at) VALUES (?, ?, 'user', ?, ?, ?)"
    ).bind(crypto.randomUUID(), chatId, content, userId, now),
    c.env.DB.prepare("UPDATE chats SET updated_at = ? WHERE id = ?").bind(now, chatId),
  ]);

  const { results: fullHistory } = await c.env.DB.prepare(
    "SELECT role, content, user_id FROM messages WHERE chat_id = ? ORDER BY created_at ASC"
  )
    .bind(chatId)
    .all<Turn>();
  // After a "compact this chat", only the summary and what came after it.
  const { kept: history, dropped } = trimHistory(sinceLastSummary(fullHistory));
  const names = await speakerNames(c.env, chatRow);

  const notice = dropped
    ? "This chat has grown long, so only its most recent part was sent to the model. Start a new chat if it loses the thread."
    : undefined;
  const tools = toolsFor(c.env);
  const reply = runReply(c.env, chatRow.model, forModel(history, names, tools.map((t) => t.name)), {
    maxTokens: LIMITS.max_reply_tokens,
    effort,
    tools,
    notice,
  });

  c.header("content-type", "text/event-stream");
  c.header("cache-control", "no-cache");
  c.header("connection", "keep-alive");

  // The reply is timestamped just after the user turn it answers, so history
  // stays in turn order even if a later message arrives before this finishes.
  const storeReply = (async () => {
    const { text: full, promptTokens, completionTokens, toolCredits, toolCostUsd, toolUses } = await reply.done;
    if (!full) return;
    // Charged from the gateway's own token counts. If the stream broke before
    // they arrived, estimate from the text rather than charge nothing. A
    // search the model made is added at its own published price.
    const tokensIn = promptTokens ?? history.reduce((n, m) => n + estimateMessageTokens(m.content), 0);
    const tokensOut = completionTokens ?? estimateTokens(full);
    const credits = creditsFor(chatRow.model, tokensIn, tokensOut) + toolCredits;
    const messageId = crypto.randomUUID();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO messages (id, chat_id, role, content, model, prompt_tokens, completion_tokens, credits, created_at) VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?)"
      ).bind(messageId, chatId, full, chatRow.model, promptTokens, completionTokens, credits, now + 1),
      c.env.DB.prepare("UPDATE chats SET updated_at = ? WHERE id = ?").bind(Date.now(), chatId),
      ...ledgerStatements(c.env, {
        userId: payerId,
        delta: -credits,
        reason: "message",
        ref: messageId,
        model: chatRow.model,
        chatId,
        promptTokens: tokensIn,
        completionTokens: tokensOut,
        costUsd: costUsdFor(chatRow.model, tokensIn, tokensOut) + toolCostUsd,
      }),
      // What the reply spent outside Cloudflare, one row each, for the
      // dashboard's external-services panel (migration 0010). Charged to the
      // payer like the reply itself, but recorded against whoever asked, so a
      // shared chat shows which person is doing the searching.
      ...toolUses.map((use) =>
        c.env.DB.prepare(
          "INSERT INTO tool_calls (id, user_id, payer_id, chat_id, message_id, tool, host, ok, cost_usd, credits, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(crypto.randomUUID(), userId, payerId, chatId, messageId, use.tool, use.host, use.ok ? 1 : 0, use.costUsd, use.credits, now + 1)
      ),
    ]);
  })();

  c.executionCtx.waitUntil(storeReply);
  if (!chatRow.title) {
    // Titled from what was typed, or failing that from the file names.
    c.executionCtx.waitUntil(generateTitle(c.env, chatId, typed || attachments.map((a) => a.name).join(", ")));
  }

  return c.body(reply.stream);
});

type Turn = { role: "user" | "assistant"; content: string; user_id: string | null };

// In a chat that has ever been shared, who each person is, so the model can
// be told who's talking. Null for a chat that's only ever had its owner.
async function speakerNames(env: Env, chatRow: ChatRow): Promise<Map<string, string> | null> {
  const { results } = await env.DB.prepare("SELECT user_id FROM chat_members WHERE chat_id = ?").bind(chatRow.id).all<{ user_id: string }>();
  if (results.length === 0) return null;
  const people = await peopleByIds(env, [chatRow.user_id, ...results.map((r) => r.user_id)]);
  const names = new Map([...people].map(([id, p]) => [id, p.name]));
  // Turns from before sharing have no user_id; they were the owner's.
  names.set("", names.get(chatRow.user_id) ?? "someone");
  return names;
}

// Sent first in every chat. Two things the model can't know on its own:
// what day it is (without it GLM assumes it's still the year its training
// ended, and reasons from there), and that its knowledge has an end date,
// so that it says so instead of guessing at recent things. And one thing we
// ask of it: these models think out loud before answering, and GLM's thinking
// tends to circle back over the same ground, which is paid for by the token.
// toolNames: the tools this reply is offered, so the model is told only about
// those. Told about tools it doesn't have, GLM writes a pretend call in its
// answer and invents the result (seen on the free chat, 2026-09-21).
export function basePreamble(toolNames: string[] = [], now = new Date()): string {
  // Pacific time: most of Lechuga's people are in California, and the UTC
  // date would be tomorrow's for them every evening.
  const today = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/Los_Angeles" });
  return (
    `You're answering inside Lechuga, a small chat app made by friends for friends that runs open source models; if asked, say which model you are if you know, and that you're not Lechuga itself. ` +
    `Today is ${today}. Your training data ends some time before that, so for anything recent (news, prices, versions, who holds which job) say that you may be out of date rather than guessing. ` +
    `Most people here are in California: unless they say otherwise, assume Pacific time, US dollars, Fahrenheit, miles and American spelling. ` +
    "Before you answer, think only as much as the question needs: settle each point once and move on, don't restate the question or your own conclusions, and for simple questions don't deliberate at all. " +
    "Be direct and warm. Skip the preamble and the recap, and don't praise the question. " +
    "Don't claim to have searched, browsed, or remembered anything from other chats; you can't. " +
    "Files and pictures the person attached appear inline; read them before answering. " +
    "For medical, legal or money questions, answer, then say when it's worth asking a professional. " +
    toolNote(toolNames)
  );
}

function toolNote(names: string[]): string {
  if (names.length === 0) {
    return "You have no tools in this chat: you can't search the web or open pages, so never write out a tool call or make up what one would return. If something needs looking up, say that you can't from here.";
  }
  const parts = [];
  if (names.includes("web_search")) parts.push("use web_search for anything recent or that you're unsure of; each search costs the person a little, so don't search for things you know");
  if (names.includes("read_page")) parts.push("use read_page on an address the person gives you, or to check a source before relying on it");
  return `You have tools; call them properly rather than writing them into your answer. ${parts.join(". ").replace(/^u/, "U")}. When you've used a page, link to it in your answer.`;
}

const SHARED_PREAMBLE =
  "Several people are taking part in this chat. Each of their messages starts with the sender's name in square brackets, which the app adds. Don't start your own replies with a name in brackets.";

// Stored messages, as the model should see them: pictures as image parts, a
// compaction summary as a system message that explains what it is, and in a
// shared chat, each person's turn marked with their name.
function forModel(history: Turn[], names: Map<string, string> | null, toolNames: string[] = []): ChatTurn[] {
  const tagged = (m: Turn): string | ContentPart[] => {
    const content = modelContent(m.content);
    if (!names) return content;
    const tag = `[${names.get(m.user_id ?? "") ?? "someone"}] `;
    return typeof content === "string" ? tag + content : content.map((part, i) => (i === 0 && part.type === "text" ? { ...part, text: tag + part.text } : part));
  };
  const turns = history.map((m): ChatTurn =>
    m.role === "user"
      ? { role: "user", content: tagged(m) }
      : isSummary(m.content)
        ? { role: "system", content: SUMMARY_PREAMBLE + summaryText(m.content) }
        : { role: "assistant", content: m.content }
  );
  const base = basePreamble(toolNames);
  return [{ role: "system", content: names ? `${base}\n\n${SHARED_PREAMBLE}` : base }, ...turns];
}

// "Compact this chat". The model reads what it would have been sent anyway
// and writes a summary; from then on that summary stands in for all of it.
// It's a reply like any other as far as credits go: charged from its token
// counts, once, in the batch that stores it.
chat.post("/chats/:id/compact", async (c) => {
  const chatId = c.req.param("id");
  const userId = c.get("userId");
  const access = await chatAccess(c.env, chatId, userId);
  if (!access) return c.json({ error: "not found" }, 404);
  // It spends the owner's credits on something nobody asked the model, so
  // it's the owner's call.
  if (access.role !== "owner") return c.json({ error: "only the person who started a chat can compact it" }, 403);
  const chatRow = access.chat;

  const [account, recent] = await Promise.all([accountState(c.env, userId), recentActivity(c.env, userId, userId)]);
  if (account.suspended) return c.json({ error: "this account is suspended", code: "suspended" }, 403);
  if (recent.inFlight > 0) return c.json({ error: "a reply is still being written. Wait for it to finish, then compact." }, 429);
  if (creditsEnforced(c.env) && account.balance <= 0) return c.json({ error: "you're out of lettuce", code: "out_of_credits" }, 402);

  const { results: all } = await c.env.DB.prepare("SELECT role, content, user_id FROM messages WHERE chat_id = ? ORDER BY created_at ASC")
    .bind(chatId)
    .all<Turn>();
  const { kept: history } = trimHistory(sinceLastSummary(all));
  if (history.length < 3) return c.json({ error: "there isn't enough here to compact yet" }, 400);

  let upstream;
  try {
    upstream = await streamChat(c.env, chatRow.model, [...forModel(history, await speakerNames(c.env, chatRow)), { role: "user", content: SUMMARY_REQUEST }], {
      maxTokens: LIMITS.summary_tokens,
      effort: "low",
    });
  } catch (err) {
    console.error("gateway call failed", err);
    return c.json({ error: "the model isn't reachable right now" }, 502);
  }
  const summary = (await collectText(upstream.stream)).trim();
  const { promptTokens, completionTokens } = await upstream.usage;
  if (!summary) return c.json({ error: "the model didn't write a summary. Try again." }, 502);

  const tokensIn = promptTokens ?? history.reduce((n, m) => n + estimateMessageTokens(m.content), 0);
  const tokensOut = completionTokens ?? estimateTokens(summary);
  const credits = creditsFor(chatRow.model, tokensIn, tokensOut);
  const messageId = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO messages (id, chat_id, role, content, model, prompt_tokens, completion_tokens, credits, created_at) VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?)"
    ).bind(messageId, chatId, wrapSummary(summary), chatRow.model, tokensIn, tokensOut, credits, now),
    c.env.DB.prepare("UPDATE chats SET updated_at = ? WHERE id = ?").bind(now, chatId),
    ...ledgerStatements(c.env, {
      userId,
      delta: -credits,
      reason: "message",
      ref: messageId,
      model: chatRow.model,
      chatId,
      promptTokens: tokensIn,
      completionTokens: tokensOut,
      costUsd: costUsdFor(chatRow.model, tokensIn, tokensOut),
    }),
  ]);
  return c.json({ ok: true, credits });
});

async function generateTitle(env: Env, chatId: string, firstMessage: string) {
  // A title needs no thinking, and we pay for these ourselves.
  const { stream } = await streamChat(
    env,
    DEFAULT_MODEL,
    [
      {
        role: "user",
        content: `Summarize this in 4 words or fewer as a chat title, no punctuation, no quotes: ${firstMessage.slice(0, 2000)}`,
      },
    ],
    { effort: "low", maxTokens: 512 }
  );
  const title = (await collectText(stream)).trim().replace(/^["'\s]+|["'.\s]+$/g, "").slice(0, 60);
  if (title) {
    await env.DB.prepare("UPDATE chats SET title = ? WHERE id = ?").bind(title, chatId).run();
  }
}
