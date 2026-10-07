import type { Auth } from "./auth";
import config from "../config.json";

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  AI_GATEWAY_ACCOUNT_ID: string;
  AI_GATEWAY_ID: string;
  CF_API_TOKEN: string;
  // Phase 2 (accounts). Vars in wrangler.toml:
  BASE_URL: string;
  TURNSTILE_SITE_KEY: string;
  GOOGLE_CLIENT_ID?: string;
  // Phase 2b: comma-separated admin emails (var).
  ADMIN_EMAILS?: string;
  // Brave Search, for the model's web_search tool. Without it, no search is offered.
  BRAVE_SEARCH_API_KEY?: string;
  // Secrets (wrangler secret put / .dev.vars):
  BETTER_AUTH_SECRET: string;
  TURNSTILE_SECRET: string;
  RESEND_API_KEY?: string;
  GOOGLE_CLIENT_SECRET?: string;
  // Phase 3 (billing). Absent on a tier means credits can't be bought there,
  // and credits.ts stops refusing people at zero.
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
};

// Per-request values set by middleware in index.ts. Routes that run after the
// session check can rely on userId being present.
export type Vars = {
  auth: Auth;
  userId: string;
  userEmail: string;
  userName: string;
  username: string | null;
  isAdmin: boolean;
  // A seat (seats.ts): the account that made it. Null for everyone else.
  seatOf: string | null;
};

export type AppEnv = { Bindings: Env; Variables: Vars };

// Rates are credits (1 credit = $0.0001) per million tokens, and must equal
// Cloudflare's price times costs.markup. A retired model is gone from the
// picker and can't start a chat, but chats already on it still load, run and
// are charged at its own rate. blurb is our plain opinion of what the model
// is good for, shown in the composer's model guide.
export type ModelConfig = {
  id: string;
  label: string;
  blurb?: string;
  // Can look at pictures (attachments.ts).
  vision?: boolean;
  retired?: boolean;
  credit_per_million_prompt_tokens: number;
  credit_per_million_completion_tokens: number;
};

// id doubles as the Stripe price's lookup key, so no price ids live here and
// test mode and live mode share one config.
export type CreditPack = {
  id: string;
  label: string;
  usd: number;
  credits: number;
};

// The shape of config.json. The code reads the JSON directly (TypeScript
// infers its type), so this is documentation with teeth: the `satisfies`
// at the bottom of this file fails the typecheck when a field the code
// expects goes missing or changes type, and it's where a new field's
// meaning gets written down.
export type AppConfig = {
  models: ModelConfig[];
  // How hard the model thinks before answering (the composer's dropdown).
  efforts: { id: string; label: string; hint: string }[];
  default_effort: string;
  // What an empty chat says, picked at random.
  empty_lines: string[];
  starter_credits: number;
  credit_packs: CreditPack[];
  subscription: CreditPack;
  // Tools the model may call while answering (tools.ts).
  tools: {
    _comment?: string;
    max_rounds: number;
    timeout_ms: number;
    web_search: { results: number; cost_usd: number; credits: number; free_per_month: number };
    read_page: { max_bytes: number; max_chars: number };
  };
  // The overnight memory pass (nightly.ts).
  nightly: { _comment?: string; train_tokens: number; turn_chars: number; reply_chars: number; min_turns: number; concurrency: number };
  // Public chats, paid for by the house account (public.ts).
  public_chats: { _comment?: string; daily_cap_credits: number; replies_in_flight: number; per_person_per_day: number; related_max: number; bring_in_chars: number };
  // Stripe as seller of record (handles sales tax). See billing.ts.
  stripe_managed_payments: boolean;
  // What the billing page's "where your money goes" is computed from. markup
  // is how many times Cloudflare's price the credit rates are (the rates in
  // models[] must agree with it); the Stripe numbers are its standard card
  // fee; monthly_fixed are bills that don't depend on usage;
  // gateway_daily_cap_usd is the AI Gateway's spend limit, for /admin.
  costs: {
    markup: number;
    gateway_daily_cap_usd: number;
    stripe_percent: number;
    stripe_fixed_usd: number;
    stripe_managed_percent: number;
    monthly_fixed: { label: string; usd: number }[];
  };
  default_invites: number;
  invite_expiry_days: number;
  username_rules: { min: number; max: number; pattern: string };
  reserved_usernames: string[];
  blocked_username_fragments: string[];
  // The home page's free chat for visitors without an account (trial.ts).
  trial: { per_visitor_per_day: number; per_day: number; max_message_chars: number; max_reply_tokens: number };
  daily_message_cap: number;
  daily_invite_cap: number;
  // Limits against abuse and runaway cost, all enforced in the worker.
  limits: {
    messages_per_minute: number;
    replies_in_flight: number;
    history_tokens: number;
    attachments_per_message: number;
    attachment_chars: number;
    images_per_message: number;
    image_chars: number;
    convert_max_bytes: number;
    paste_becomes_attachment_chars: number;
    max_reply_tokens: number;
    // How long to wait for the model to start answering, and the longest
    // gap allowed between chunks once it has (gateway.ts).
    model_first_byte_ms: number;
    model_idle_ms: number;
    // How much of each text attachment a guarded bot's check reads (guard.ts).
    guard_attachment_chars: number;
    summary_tokens: number;
    memory_chars: number;
    remember_tokens: number;
    compact_offer_tokens: number;
    public_requests_per_day: number;
    chat_members: number;
    seats_per_account: number;
    avatar_chars: number;
    max_manual_grant: number;
  };
  terms_version: string;
};

config satisfies AppConfig;

// A bot (migration 0013): whose it is, what it's called, how it talks, and
// the model its new chats start on (null: the default). is_default marks
// Seed, the one every account has.
export type BotRow = {
  id: string;
  user_id: string;
  name: string;
  soul: string;
  model: string | null;
  is_default: number;
  // 1: the guard is on (guard.ts): locked prompt, a check on every message,
  // no tools, low effort raised. The owner's switch.
  guarded: number;
  // 'public': anyone signed in can chat with it, and every chat with it is
  // a public chat (public.ts).
  visibility: "private" | "public";
  created_at: number;
  updated_at: number;
};

export type ChatRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  // The bot the chat is with. Null only on a row from before bots, which
  // botFor() reads as the owner's Seed.
  bot_id: string | null;
  // 'public': anyone signed in can read it, only the owner and the people
  // it's shared with write in it, and the house account pays (public.ts).
  // slug is reserved, unused.
  visibility: "private" | "public";
  slug: string | null;
  title: string | null;
  model: string;
  created_at: number;
  updated_at: number;
};

export type MessageRow = {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  // Who typed a user turn. Null on turns from before sharing (the owner's).
  user_id: string | null;
  created_at: number;
};

export type InviteStatus = "pending" | "accepted" | "revoked";

export type InviteRow = {
  id: string;
  token: string;
  email: string;
  inviter_id: string | null;
  // The admin who sent it, when it came from Lechuga (migration 0008).
  sent_by?: string | null;
  status: InviteStatus;
  created_at: number;
  expires_at: number;
  accepted_at: number | null;
};

export type RequestType = "access" | "feedback" | "support";
export type RequestStatus = "open" | "approved" | "declined" | "replied" | "closed";

export type RequestRow = {
  id: string;
  type: RequestType;
  email: string;
  username: string | null;
  user_id: string | null;
  body: string;
  status: RequestStatus;
  admin_note: string | null;
  reply: string | null;
  created_at: number;
  handled_at: number | null;
  handled_by: string | null;
};

// Parses the ADMIN_EMAILS var once per request; cheap.
export function adminEmails(env: Env): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}
