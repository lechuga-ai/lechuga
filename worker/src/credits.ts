import type { Env } from "./types";
import config from "../config.json";

// 1 credit = $0.0001. Credits are whole numbers everywhere: in the ledger, in
// user.balance, and on screen.

export type LedgerReason = "signup_bonus" | "purchase" | "subscription" | "message" | "refund" | "manual";

export type LedgerEntry = {
  userId: string;
  delta: number;
  reason: LedgerReason;
  ref?: string | null;
  model?: string | null;
  chatId?: string | null;
  // Bookkeeping for /admin (migration 0007). Message rows carry the token
  // counts and what Cloudflare charged us; money rows carry cents in (or,
  // on a refund, out); manual rows say who and why.
  promptTokens?: number | null;
  completionTokens?: number | null;
  costUsd?: number | null;
  paidCents?: number | null;
  note?: string | null;
};

// Without a Stripe key there is no way to buy credits (prod, until live mode
// is set up), so balances are recorded but nobody is refused at zero. The
// daily message cap in chat.ts is the backstop there.
export function creditsEnforced(env: Env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

// What a reply costs, from the rates in config.json. Rounded up, so a reply
// that used any tokens costs at least 1 credit.
export function creditsFor(modelId: string, promptTokens: number, completionTokens: number): number {
  const model = config.models.find((m) => m.id === modelId) ?? config.models[0];
  const exact =
    (promptTokens * model.credit_per_million_prompt_tokens +
      completionTokens * model.credit_per_million_completion_tokens) /
    1_000_000;
  return Math.ceil(exact);
}

// What the same reply cost us. Our rates are Cloudflare's price times
// costs.markup, so this is the unrounded charge divided back down, in dollars.
export function costUsdFor(modelId: string, promptTokens: number, completionTokens: number): number {
  const model = config.models.find((m) => m.id === modelId) ?? config.models[0];
  const credits =
    (promptTokens * model.credit_per_million_prompt_tokens +
      completionTokens * model.credit_per_million_completion_tokens) /
    1_000_000;
  return (credits * 0.0001) / config.costs.markup;
}

// Used when the gateway didn't report usage (the stream broke early). About
// four characters per token is close enough that a broken stream isn't free.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// The ledger row and the balance change, as a pair for one DB.batch() call.
// They are never run apart: a batch is a transaction, so both land or neither.
export function ledgerStatements(env: Env, entry: LedgerEntry): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      "INSERT INTO credit_ledger (id, user_id, delta, reason, ref, model, chat_id, prompt_tokens, completion_tokens, cost_usd, paid_cents, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      crypto.randomUUID(),
      entry.userId,
      entry.delta,
      entry.reason,
      entry.ref ?? null,
      entry.model ?? null,
      entry.chatId ?? null,
      entry.promptTokens ?? null,
      entry.completionTokens ?? null,
      entry.costUsd ?? null,
      entry.paidCents ?? null,
      entry.note ?? null,
      Date.now()
    ),
    env.DB.prepare("UPDATE user SET balance = balance + ? WHERE id = ?").bind(entry.delta, entry.userId),
  ];
}

// For rows that must happen once per ref (the signup bonus, anything from
// Stripe). Returns false when the row was already there.
export async function applyOnce(env: Env, entry: LedgerEntry & { ref: string }): Promise<boolean> {
  try {
    await env.DB.batch(ledgerStatements(env, entry));
    return true;
  } catch (err) {
    if (String(err).includes("UNIQUE")) return false;
    throw err;
  }
}

// The two things checked before a message is accepted, in one read.
export async function accountState(env: Env, userId: string): Promise<{ balance: number; suspended: boolean }> {
  const row = await env.DB.prepare("SELECT balance, suspended_at FROM user WHERE id = ?")
    .bind(userId)
    .first<{ balance: number; suspended_at: number | null }>();
  return { balance: row?.balance ?? 0, suspended: Boolean(row?.suspended_at) };
}

export async function balanceOf(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT balance FROM user WHERE id = ?").bind(userId).first<{ balance: number }>();
  return row?.balance ?? 0;
}
