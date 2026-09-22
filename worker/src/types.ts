import type { Auth } from "./auth";

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

export type AppConfig = {
  models: ModelConfig[];
  starter_credits: number;
  credit_packs: CreditPack[];
  subscription: CreditPack;
  // What the billing page's "where your money goes" is computed from. markup
  // is how many times Cloudflare's price the credit rates are (the rates in
  // models[] must agree with it); the Stripe numbers are its standard card
  // fee; monthly_fixed are bills that don't depend on usage.
  costs: { markup: number; stripe_percent: number; stripe_fixed_usd: number; stripe_managed_percent: number; monthly_fixed: { label: string; usd: number }[] };
  // Stripe as seller of record (handles sales tax). See billing.ts.
  stripe_managed_payments: boolean;
  default_invites: number;
  invite_expiry_days: number;
  username_rules: { min: number; max: number; pattern: string };
  reserved_usernames: string[];
  blocked_username_fragments: string[];
  // The home page's free chat for visitors without an account (trial.ts).
  trial: { per_visitor_per_day: number; per_day: number; max_message_chars: number; max_reply_tokens: number };
  daily_message_cap: number;
  daily_invite_cap: number;
  terms_version: string;
};

export type ChatRow = {
  id: string;
  user_id: string;
  project_id: string | null;
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
