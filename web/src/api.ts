import { parseSSE } from "../../worker/src/sse";
import type { Attachment } from "../../worker/src/attachments";
import { getEffort } from "./effort";
// Inside the native app this adds the API's address and the sign-in token;
// on the website it is plain fetch.
import { apiFetch } from "./native";

// What the app shows of another account: a name and a face, never an email.
// photo is the avatar's version, or null for none (see avatarUrl).
export type Person = { id: string; name: string; username: string | null; photo: number | null };

export function avatarUrl(p: Pick<Person, "id" | "photo">): string | null {
  return p.photo ? `/api/avatars/${p.id}?v=${p.photo}` : null;
}

export type Chat = {
  id: string;
  // The owner, who pays for the chat's replies.
  user_id: string;
  // The bot it's with (null only on a chat from before bots: the owner's Seed).
  bot_id: string | null;
  title: string | null;
  model: string;
  created_at: number;
  updated_at: number;
  // Only on a shared chat: everyone in it, the owner first.
  people?: Person[];
};

// Who's in a chat. members includes people since removed, so what they wrote
// keeps their name; pending (owner only) is shares waiting for a sign-up.
export type Roster = {
  owner: Person;
  members: (Person & { removed: boolean })[];
  pending: { id: string; email: string }[];
};

export type Message = {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  // Who typed a user turn; null on turns from before sharing (the owner's).
  user_id?: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  // What the reply cost, and on which model. Null on user turns, on replies
  // from before credits existed, and on a fresh reply until it's re-read.
  model?: string | null;
  credits?: number | null;
  created_at: number;
  // Client-only: the model's reasoning, kept for this session (never stored).
  reasoning?: string;
  // Client-only: the searches and pages the model used on the way to this
  // reply, kept for this session like the reasoning.
  steps?: Step[];
  // Client-only: shown in place of a reply when the request failed.
  error?: string;
  errorCode?: string;
};

export type Model = {
  id: string;
  label: string;
  // Our plain opinion of what it's good for, shown in the model guide.
  blurb?: string;
  // Can look at pictures.
  vision?: boolean;
  // No longer offered; listed only so old chats on it show its name.
  retired?: boolean;
  credit_per_million_prompt_tokens: number;
  credit_per_million_completion_tokens: number;
};

// An Error that keeps the server's machine-readable code, if it sent one
// (out_of_credits is the one the UI acts on).
export class ApiError extends Error {
  constructor(
    message: string,
    public code?: string,
    // The rest of the error body, for the few codes that carry more.
    public body?: Record<string, unknown>
  ) {
    super(message);
  }
}

async function expectJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    let code: string | undefined;
    let extra: Record<string, unknown> | undefined;
    try {
      const body = await res.json();
      extra = body;
      if (body?.error) detail = body.error;
      if (body?.detail) detail += ` (${body.detail})`;
      if (typeof body?.code === "string") code = body.code;
    } catch {
      // keep statusText
    }
    throw new ApiError(detail || `request failed (${res.status})`, code, extra);
  }
  return res.json();
}

export type AuthConfig = {
  turnstileSiteKey: string;
  googleSignIn: boolean;
};

// Public; served before there is a session.
export async function getAuthConfig(): Promise<AuthConfig> {
  return expectJson(await apiFetch("/api/config"));
}

export async function listModels(): Promise<Model[]> {
  return expectJson(await apiFetch("/api/models"));
}

export async function listChats(): Promise<Chat[]> {
  return expectJson(await apiFetch("/api/chats"));
}

// Chats whose title or messages contain every word of q. snippet is the
// first matching message, trimmed around the first word; null when only the
// title matched.
export type ChatHit = Chat & { snippet: string | null };

export async function searchChats(q: string): Promise<ChatHit[]> {
  return expectJson(await apiFetch(`/api/chats/search?q=${encodeURIComponent(q)}`));
}

// A new chat with one of my bots (Seed if none is given). The model asked
// for wins; otherwise the bot's; otherwise the default.
export async function createChat(model?: string, bot?: string): Promise<{ id: string; bot: string }> {
  return expectJson(
    await apiFetch("/api/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, bot }),
    })
  );
}

// bot.owner is set when the chat is with someone else's bot: they can see it.
export async function getChat(
  id: string
): Promise<{ chat: Chat; messages: Message[]; role: "owner" | "member"; roster: Roster; bot: { id: string; name: string; owner: Person | null } }> {
  return expectJson(await apiFetch(`/api/chats/${id}`));
}

// Bots (worker/src/bots.ts): a name, a soul, a model, and an owner. Seed is
// the one every account has (is_default). role says whether it's mine or
// shared with me; people (owner first) is everyone with it once shared.
export type Bot = {
  id: string;
  user_id: string;
  name: string;
  soul: string;
  model: string | null;
  is_default: number;
  // The guard is on: locked prompt, every message checked, no web tools.
  guarded: number;
  created_at: number;
  updated_at: number;
  role: "owner" | "member";
  people?: Person[];
};

export type BotRoster = {
  owner: Person;
  // seat: an account the owner made for someone without an email.
  members: (Person & { removed: boolean; seat: boolean })[];
  pending: { id: string; email: string }[];
};

// Seats (worker/src/seats.ts): an account for someone without an email,
// tied to one bot, signing in with a username and a code. The code comes
// back once, here and from resetSeatCode; it's stored hashed.
export async function createSeat(
  botId: string,
  seat: { username: string; name?: string; code?: string }
): Promise<{ roster: BotRoster; seat: { id: string; username: string; name: string }; code: string }> {
  return expectJson(await postJson(`/api/bots/${botId}/seats`, seat));
}

export async function resetSeatCode(botId: string, userId: string, code?: string): Promise<{ username: string; code: string }> {
  return expectJson(await postJson(`/api/bots/${botId}/seats/${userId}/code`, { code }));
}

// A seat becomes a full account with this email address.
export async function upgradeSeat(botId: string, userId: string, email: string): Promise<{ roster: BotRoster }> {
  return expectJson(await postJson(`/api/bots/${botId}/seats/${userId}/upgrade`, { email }));
}

export async function deleteSeat(botId: string, userId: string): Promise<{ roster: BotRoster }> {
  return expectJson(await apiFetch(`/api/bots/${botId}/seats/${userId}`, { method: "DELETE" }));
}

export async function listBots(): Promise<Bot[]> {
  return expectJson(await apiFetch("/api/bots"));
}

// Share a bot with a username or an email address; the same needs_invite
// dance as addChatMember.
export async function addBotMember(botId: string, who: string, useInvite = false): Promise<{ roster: BotRoster; waitingFor?: string }> {
  return expectJson(await postJson(`/api/bots/${botId}/members`, { who, useInvite }));
}

// The owner removing someone, or (with your own id) leaving.
export async function removeBotMember(botId: string, userId: string): Promise<{ roster?: BotRoster }> {
  return expectJson(await apiFetch(`/api/bots/${botId}/members/${userId}`, { method: "DELETE" }));
}

export async function cancelBotPendingShare(botId: string, pendingId: string): Promise<{ roster: BotRoster }> {
  return expectJson(await apiFetch(`/api/bots/${botId}/pending/${pendingId}`, { method: "DELETE" }));
}

// Comes back at once with an empty soul; the worker drafts one from the name
// in the background, so ask again (getBot) until it's there.
export async function createBot(name: string): Promise<Bot & { drafting: boolean }> {
  return expectJson(await postJson("/api/bots", { name }));
}

export async function getBot(id: string): Promise<{ bot: Bot; roster: BotRoster }> {
  return expectJson(await apiFetch(`/api/bots/${id}`));
}

export async function saveBot(id: string, patch: { name?: string; soul?: string; model?: string | null; guarded?: boolean }): Promise<Bot> {
  return expectJson(await postJson(`/api/bots/${id}`, patch, "PUT"));
}

// Its chats move to Seed, whose id comes back.
export async function deleteBot(id: string): Promise<{ movedTo: string }> {
  return expectJson(await apiFetch(`/api/bots/${id}`, { method: "DELETE" }));
}

// Share a chat with a username or an email address. An address with no
// account throws ApiError code needs_invite (its invitesRemaining says how
// many the owner has); sending again with useInvite spends one.
export async function addChatMember(chatId: string, who: string, useInvite = false): Promise<{ roster: Roster; waitingFor?: string }> {
  return expectJson(await postJson(`/api/chats/${chatId}/members`, { who, useInvite }));
}

// The owner removing someone, or (with your own id) leaving.
export async function removeChatMember(chatId: string, userId: string): Promise<{ roster?: Roster }> {
  return expectJson(await apiFetch(`/api/chats/${chatId}/members/${userId}`, { method: "DELETE" }));
}

export async function cancelPendingShare(chatId: string, pendingId: string): Promise<{ roster: Roster }> {
  return expectJson(await apiFetch(`/api/chats/${chatId}/pending/${pendingId}`, { method: "DELETE" }));
}

export async function deleteChat(id: string): Promise<void> {
  await expectJson(await apiFetch(`/api/chats/${id}`, { method: "DELETE" }));
}

export type Step = { id: string; label: string; links?: { title: string; url: string }[]; done: boolean };

export type StreamHandlers = {
  onDelta: (text: string) => void;
  onReasoning?: (text: string) => void;
  // A tool the model used: once when it starts, again when it's done.
  onStep?: (step: Step) => void;
  // The model went on to use a tool after starting to answer; what it said
  // so far was working-out, so drop it from the screen.
  onRetract?: () => void;
  // Something the server wants said alongside the reply (the chat was too
  // long to send whole).
  onNotice?: (text: string) => void;
  signal?: AbortSignal;
};

type StreamEvent = { delta?: string; reasoning?: string; notice?: string; error?: string; step?: Step; retract?: boolean };

// Streams the assistant's reply. Resolves when the stream ends, or quietly
// when aborted via signal (the server still finishes and stores the reply).
// Throws on an HTTP error or an error event from the server.
export async function sendMessage(
  chatId: string,
  content: string,
  attachments: Attachment[],
  { onDelta, onReasoning, onNotice, onStep, onRetract, signal }: StreamHandlers
): Promise<void> {
  let res: Response;
  try {
    res = await apiFetch(`/api/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, attachments, effort: getEffort() }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    throw err;
  }
  await readReplyStream(res, { onDelta, onReasoning, onNotice, onStep, onRetract });
}

async function readReplyStream(res: Response, { onDelta, onReasoning, onNotice, onStep, onRetract }: StreamHandlers): Promise<void> {
  if (!res.ok || !res.body) {
    await expectJson(res);
    return;
  }
  try {
    for await (const event of parseSSE<StreamEvent>(res.body)) {
      if (event.error) throw new Error(event.error);
      if (event.notice) onNotice?.(event.notice);
      if (event.reasoning) onReasoning?.(event.reasoning);
      if (event.step) onStep?.(event.step);
      if (event.retract) onRetract?.();
      if (event.delta) onDelta(event.delta);
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    throw err;
  }
}

// The home page's one free chat: no account, a Turnstile token instead.
// Throws ApiError with code trial_used or trials_full when there's none left.
export async function sendTrialMessage(content: string, captcha: string, handlers: StreamHandlers): Promise<void> {
  let res: Response;
  try {
    res = await apiFetch("/api/try", {
      method: "POST",
      headers: { "content-type": "application/json", "x-captcha-response": captcha },
      body: JSON.stringify({ content }),
      signal: handlers.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    throw err;
  }
  await readReplyStream(res, handlers);
}

// After sign-up: saves the trial conversation as the new account's first chat.
export async function importTrialChat(question: string, answer: string): Promise<{ id: string }> {
  return expectJson(await postJson("/api/chats/import", { question, answer }));
}

// ---- Phase 2b: profile, usernames, invites, requests, admin ----

export type Me = {
  id: string;
  email: string;
  name: string;
  // The profile photo's version, or null for none (see avatarUrl).
  photo: number | null;
  username: string | null;
  invitesRemaining: number;
  balance: number;
  subscriptionStatus: "active" | "cancelled" | null;
  // False on a tier where credits can't be bought yet: balances are tracked
  // but nobody is stopped at zero.
  creditsEnforced: boolean;
  isAdmin: boolean;
  // Someone else's account for one bot (worker/src/seats.ts): no credits,
  // invites, memory or bots of its own.
  seat: boolean;
};

export async function getMe(): Promise<Me> {
  return expectJson(await apiFetch("/api/me"));
}

// photo: a small square JPEG data URL, null to remove it, undefined to keep it.
// Account > Memory (worker/src/memory.ts): what Lechuga keeps about you
// across your own chats, and whether it's used. (How a bot talks is on the
// bot: saveBot.)
export type Memory = {
  notes: string;
  enabled: boolean;
  // The overnight pass may read my chats; trainedAt is when it last did.
  nightly: boolean;
  trainedAt: number | null;
  updatedAt: number | null;
};

export async function getMemory(): Promise<Memory> {
  return expectJson(await apiFetch("/api/memory"));
}

export async function saveMemory(memory: { notes: string; enabled: boolean; nightly: boolean }): Promise<Memory> {
  return expectJson(await postJson("/api/memory", memory, "PUT"));
}

// Has the bot fold this chat into its memory of you and its own soul. Costs
// about a message.
export async function rememberChat(chatId: string): Promise<{ credits: number; memory: Memory; soul: string }> {
  return expectJson(await apiFetch(`/api/chats/${chatId}/remember`, { method: "POST" }));
}

export async function saveProfile(name: string, photo?: string | null): Promise<{ name: string; photo: number | null }> {
  return expectJson(await postJson("/api/me/profile", { name, photo }, "PUT"));
}

// ---- Phase 3: credits and billing ----

export type CreditPack = { id: string; label: string; usd: number; credits: number };

export type Billing = {
  balance: number;
  subscriptionStatus: "active" | "cancelled" | null;
  hasCustomer: boolean;
  purchasesOpen: boolean;
  packs: CreditPack[];
  subscription: CreditPack;
  costs: Costs;
  // Balance changes other than replies, newest first.
  history: { id: string; reason: string; delta: number; paid_cents: number | null; created_at: number }[];
};

// The published numbers behind "where your money goes" (worker/config.json).
export type Costs = {
  markup: number;
  stripe_percent: number;
  stripe_fixed_usd: number;
  stripe_managed_percent: number;
  monthly_fixed: { label: string; usd: number }[];
};

export async function getBilling(): Promise<Billing> {
  return expectJson(await apiFetch("/api/billing"));
}

// Both return a URL on Stripe's site to send the browser to.
export async function startCheckout(item: string): Promise<{ url: string }> {
  return expectJson(await postJson("/api/billing/checkout", { item }));
}

export async function openPortal(): Promise<{ url: string }> {
  return expectJson(await postJson("/api/billing/portal", {}));
}

// 1 credit = $0.0001.
export function creditsAsDollars(credits: number): string {
  return `$${(credits / 10000).toFixed(2)}`;
}

export async function checkUsername(u: string): Promise<{ available: boolean; reason?: string }> {
  return expectJson(await apiFetch(`/api/me/username/available?u=${encodeURIComponent(u)}`));
}

export async function setUsername(username: string, acceptTerms: boolean): Promise<{ username: string }> {
  return expectJson(await postJson("/api/me/username", { username, acceptTerms }, "PUT"));
}

export type InviteState = "pending" | "accepted" | "revoked";
export type Invite = {
  id: string;
  email: string;
  inviter_id: string | null;
  status: InviteState;
  created_at: number;
  expires_at: number;
  accepted_at: number | null;
  expired: boolean;
};

export async function listInvites(): Promise<{ remaining: number; invites: Invite[] }> {
  return expectJson(await apiFetch("/api/invites"));
}

export async function createInvite(email: string): Promise<{ invite: Invite }> {
  return expectJson(await postJson("/api/invites", { email }));
}

export async function revokeInvite(id: string): Promise<void> {
  await expectJson(await apiFetch(`/api/invites/${id}`, { method: "DELETE" }));
}

export async function lookupInvite(token: string): Promise<{ email: string; state: InviteState | "expired" }> {
  return expectJson(await apiFetch(`/api/invites/lookup/${encodeURIComponent(token)}`));
}

export async function requestAccess(email: string, body: string, captcha: string): Promise<void> {
  await expectJson(
    await apiFetch("/api/requests/access", {
      method: "POST",
      headers: { "content-type": "application/json", "x-captcha-response": captcha },
      body: JSON.stringify({ email, body }),
    })
  );
}

export type NoteType = "feedback" | "support";

export async function sendNote(type: NoteType, body: string): Promise<void> {
  await expectJson(await postJson("/api/notes", { type, body }));
}

// The Help page's feedback form, for visitors with no account. Signed-in
// people see "Send us a note" (sendNote) on the same page instead.
export async function sendFeedback(body: string, email: string, captcha: string): Promise<void> {
  await expectJson(
    await apiFetch("/api/requests/feedback", {
      method: "POST",
      headers: { "content-type": "application/json", "x-captcha-response": captcha },
      body: JSON.stringify({ body, email }),
    })
  );
}

export type RequestType = "access" | NoteType;
export type RequestStatus = "open" | "approved" | "declined" | "replied" | "closed";
export type AdminRequest = {
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
  handled_by_username: string | null;
  handled_by_email: string | null;
};

export async function adminListRequests(filter: { type?: string; status?: string }): Promise<AdminRequest[]> {
  const q = new URLSearchParams();
  if (filter.type) q.set("type", filter.type);
  if (filter.status) q.set("status", filter.status);
  return expectJson(await apiFetch(`/api/admin/requests?${q}`));
}

export async function adminRequestAction(
  id: string,
  action: "approve" | "decline" | "reply" | "close",
  payload: Record<string, string> = {}
): Promise<void> {
  await expectJson(await postJson(`/api/admin/requests/${id}/${action}`, payload));
}

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  username: string | null;
  invites_remaining: number;
  invited_by: string | null;
  created_at: string;
};

// sent_by: the admin behind an invite from Lechuga (inviter_id is null then).
export type AdminInvite = Omit<Invite, "expired"> & { sent_by: string | null };

export async function adminInvites(): Promise<{ users: AdminUser[]; invites: AdminInvite[] }> {
  return expectJson(await apiFetch("/api/admin/invites"));
}

export async function adminSetInvites(userId: string, n: number): Promise<void> {
  await expectJson(await postJson(`/api/admin/users/${userId}/invites`, { invites_remaining: n }, "PUT"));
}

export async function adminSetUsername(userId: string, username: string): Promise<void> {
  await expectJson(await postJson(`/api/admin/users/${userId}/username`, { username }, "PUT"));
}

function postJson(url: string, body: unknown, method: "POST" | "PUT" = "POST"): Promise<Response> {
  return apiFetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

// The Accounts tab. Credits are whole numbers; cost_usd is dollars we owe
// Cloudflare for the account's replies; paid_cents is money in, net of refunds.
export type AdminAccount = {
  id: string;
  email: string;
  username: string | null;
  created_at: string;
  balance: number;
  subscription_status: "active" | "cancelled" | null;
  suspended_at: number | null;
  replies: number;
  credits_spent: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  paid_cents: number;
  credits_given: number;
  last_reply_at: number | null;
};

export type AdminModelSpend = {
  model: string | null;
  replies: number;
  credits_spent: number;
  cost_usd: number;
  prompt_tokens: number;
  completion_tokens: number;
};

export type AdminLedgerRow = {
  id: string;
  delta: number;
  reason: string;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | null;
  paid_cents: number | null;
  note: string | null;
  created_at: number;
};

// Our own count of the last 24 hours against the AI Gateway's spend limit.
export type AdminGateway = {
  last24h: { cost_usd: number; replies: number; trials: number };
  cap_usd: number;
  dashboard: string;
};

export type AdminGrant = { id: string; delta: number; note: string | null; created_at: number; username: string | null; email: string };

export async function adminGrants(): Promise<AdminGrant[]> {
  return expectJson(await apiFetch("/api/admin/grants"));
}

// An invite from us: nobody's invite count is spent.
export async function adminSendInvite(email: string): Promise<void> {
  await expectJson(await postJson("/api/admin/invites", { email }));
}

export async function adminAccounts(): Promise<{
  users: AdminAccount[];
  models: AdminModelSpend[];
  trials: { total: number; today: number };
  gateway: AdminGateway;
}> {
  return expectJson(await apiFetch("/api/admin/accounts"));
}

export async function adminLedger(userId: string): Promise<AdminLedgerRow[]> {
  return expectJson(await apiFetch(`/api/admin/users/${userId}/ledger`));
}

export async function adminGrant(userId: string, credits: number, note: string): Promise<void> {
  await expectJson(await postJson(`/api/admin/users/${userId}/grant`, { credits, note }));
}

export async function adminSetSuspended(userId: string, suspended: boolean): Promise<void> {
  await expectJson(await postJson(`/api/admin/users/${userId}/suspended`, { suspended }, "PUT"));
}

// A PDF or Office file, turned into text by the worker (worker/src/convert.ts).
export async function convertFile(file: File): Promise<{ name: string; text: string }> {
  const form = new FormData();
  form.append("file", file, file.name);
  return expectJson(await apiFetch("/api/convert", { method: "POST", body: form }));
}

// "Compact this chat": the worker has the model summarise the conversation,
// and later messages carry the summary in place of everything before it.
export async function compactChat(chatId: string): Promise<{ credits: number }> {
  return expectJson(await postJson(`/api/chats/${chatId}/compact`, {}));
}

// The dashboard (components/AdminActivity.tsx). Days are Pacific and come
// back as "YYYY-MM-DD", already grouped; anything the window has no rows for
// is simply absent, so the chart fills the gaps rather than the query.
export type AdminActivityDay = {
  day: string;
  active_users: number;
  replies: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  paid_cents: number;
};

export type AdminActivityModelDay = { day: string; model: string; prompt_tokens: number; completion_tokens: number };

export type AdminActivityModel = {
  model: string;
  replies: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  credits_spent: number;
};

export type AdminActivityPerson = {
  id: string;
  username: string | null;
  email: string;
  balance: number;
  suspended_at: number | null;
  replies: number;
  prompt_tokens: number;
  completion_tokens: number;
  credits_spent: number;
  cost_usd: number;
  last_at: number;
};

// null until migration 0010 has been run on this tier.
export type AdminActivityTools = {
  days: { day: string; tool: string; calls: number; cost_usd: number; failed: number }[];
  people: { user_id: string; username: string | null; email: string; searches: number; reads: number; cost_usd: number }[];
  hosts: { host: string; reads: number }[];
  month_searches: number;
  free_quota: number;
  search_enabled: boolean;
} | null;

export async function adminActivity(days: number): Promise<{
  days: AdminActivityDay[];
  model_days: AdminActivityModelDay[];
  models: AdminActivityModel[];
  people: AdminActivityPerson[];
  tools: AdminActivityTools;
  window: { days: number; since: number; start_of_today: number };
  markup: number;
}> {
  return expectJson(await apiFetch(`/api/admin/activity?days=${days}`));
}
