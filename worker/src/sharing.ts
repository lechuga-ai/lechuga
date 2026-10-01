import { Hono } from "hono";
import type { AppEnv, ChatRow, Env } from "./types";
import { createInvite, lapsedInviteFrom, normalizeEmail, pendingInviteFor } from "./invites";
import { sendEmail } from "./email";
import { chatSharedEmail } from "./email/templates";
import config from "../config.json";

// Shared chats. A chat has one owner (chats.user_id), who is the only one who
// can share it, remove people, compact it or delete it, and who pays for every
// reply in it. Members (chat_members, removed_at IS NULL) can read all of it
// and keep it going. See 0009_sharing.sql.

// What the app shows of another account: enough for a face and a name, and
// never the email address. photo is the avatar's version (its updated_at), for
// /api/avatars/<id>?v=<photo>; null means no photo.
export type Person = { id: string; name: string; username: string | null; photo: number | null };
export type Roster = {
  owner: Person;
  // Everyone ever added, so removed people's messages keep their names.
  members: (Person & { removed: boolean })[];
  // Shares waiting for an address to sign up. Only the owner is told.
  pending: { id: string; email: string }[];
};

export type ChatRole = "owner" | "member";

// A chat that exists but isn't yours looks identical to one that doesn't
// exist (null either way), so ids can't be probed. Four ways in: it's
// mine, I've been added to it, it's with a bot I own (bots.ts: the owner of
// a shared bot sees every chat with it, pays for them, and can do
// everything its starter can), or it's public (public.ts: anyone signed in
// may read and join).
// seat: the caller is a username-and-code account (seats.ts), which keeps
// to the bots it was given: no public chats.
export async function chatAccess(env: Env, chatId: string, userId: string, seat = false): Promise<{ chat: ChatRow; role: ChatRole } | null> {
  const chat = await env.DB.prepare(
    `SELECT c.* FROM chats c WHERE c.id = ?1 AND (c.user_id = ?2
       OR (c.visibility = 'public' AND ?3 = 0)
       OR EXISTS (SELECT 1 FROM chat_members m WHERE m.chat_id = c.id AND m.user_id = ?2 AND m.removed_at IS NULL)
       OR EXISTS (SELECT 1 FROM bots b WHERE b.id = c.bot_id AND b.user_id = ?2))`
  )
    .bind(chatId, userId, seat ? 1 : 0)
    .first<ChatRow>();
  if (!chat) return null;
  if (chat.user_id === userId) return { chat, role: "owner" };
  const ownsBot = chat.bot_id ? await env.DB.prepare("SELECT 1 AS one FROM bots WHERE id = ? AND user_id = ?").bind(chat.bot_id, userId).first() : null;
  return { chat, role: ownsBot ? "owner" : "member" };
}

export async function peopleByIds(env: Env, ids: string[]): Promise<Map<string, Person>> {
  const unique = [...new Set(ids)];
  const found = new Map<string, Person>();
  if (unique.length === 0) return found;
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.name, u.username, a.updated_at AS photo FROM user u LEFT JOIN avatars a ON a.user_id = u.id
     WHERE u.id IN (${unique.map(() => "?").join(",")})`
  )
    .bind(...unique)
    .all<Person>();
  for (const p of results) found.set(p.id, { ...p, name: displayName(p) });
  return found;
}

// Accounts made with an emailed link start with no name; fall back to the
// username, which everyone has by the time they can be in a chat.
function displayName(p: { name: string | null; username: string | null }): string {
  return p.name?.trim() || (p.username ? `@${p.username}` : "someone");
}

const GONE = (id: string): Person => ({ id, name: "someone who left", username: null, photo: null });

export async function roster(env: Env, chat: ChatRow, forOwner: boolean): Promise<Roster> {
  const [{ results: rows }, { results: pending }] = await Promise.all([
    env.DB.prepare("SELECT m.user_id, m.removed_at, u.seat_of FROM chat_members m LEFT JOIN user u ON u.id = m.user_id WHERE m.chat_id = ? ORDER BY m.added_at ASC")
      .bind(chat.id)
      .all<{ user_id: string; removed_at: number | null; seat_of: string | null }>(),
    forOwner
      ? env.DB.prepare("SELECT id, email FROM chat_pending_shares WHERE chat_id = ? ORDER BY created_at ASC").bind(chat.id).all<{ id: string; email: string }>()
      : Promise.resolve({ results: [] as { id: string; email: string }[] }),
  ]);
  const people = await peopleByIds(env, [chat.user_id, ...rows.map((r) => r.user_id)]);
  return {
    owner: people.get(chat.user_id) ?? GONE(chat.user_id),
    // seat: a username-and-code account (seats.ts), so the dialog can offer
    // the link that signs it in.
    members: rows.map((r) => ({ ...(people.get(r.user_id) ?? GONE(r.user_id)), removed: r.removed_at !== null, seat: r.seat_of !== null })),
    pending,
  };
}

// The sidebar's list: my chats, the ones I've been added to, and every chat
// with a bot I own, newest first. A shared chat carries its people (owner
// first) so the list can show faces; so does a chat someone else started
// with my bot, so I can see whose it is.
export async function listChats(env: Env, userId: string): Promise<(ChatRow & { people?: Person[] })[]> {
  const [{ results: chats }, { results: memberRows }] = await Promise.all([
    env.DB.prepare(
      `SELECT c.* FROM chats c WHERE c.user_id = ?1
       UNION
       SELECT c.* FROM chats c JOIN chat_members m ON m.chat_id = c.id WHERE m.user_id = ?1 AND m.removed_at IS NULL
       UNION
       SELECT c.* FROM chats c JOIN bots b ON b.id = c.bot_id WHERE b.user_id = ?1 AND c.user_id != ?1
       ORDER BY updated_at DESC`
    )
      .bind(userId)
      .all<ChatRow>(),
    env.DB.prepare(
      `SELECT m.chat_id, m.user_id FROM chat_members m
       WHERE m.removed_at IS NULL AND m.chat_id IN (
         SELECT id FROM chats WHERE user_id = ?1
         UNION SELECT chat_id FROM chat_members WHERE user_id = ?1 AND removed_at IS NULL)
       ORDER BY m.added_at ASC`
    )
      .bind(userId)
      .all<{ chat_id: string; user_id: string }>(),
  ]);
  const membersOf = new Map<string, string[]>();
  for (const r of memberRows) membersOf.set(r.chat_id, [...(membersOf.get(r.chat_id) ?? []), r.user_id]);
  // A chat someone else started with my bot: its starter is its face.
  for (const c of chats) if (c.user_id !== userId && !membersOf.has(c.id)) membersOf.set(c.id, []);
  if (membersOf.size === 0) return chats;
  const shared = chats.filter((c) => membersOf.has(c.id));
  const people = await peopleByIds(env, shared.flatMap((c) => [c.user_id, ...membersOf.get(c.id)!]));
  return chats.map((c) => {
    const ids = membersOf.get(c.id);
    return ids ? { ...c, people: [c.user_id, ...ids].map((id) => people.get(id) ?? GONE(id)) } : c;
  });
}

// A new account picks up the chats that were shared with its address while it
// had none. Called from the user.create.after hook (auth.ts).
export async function claimPendingShares(env: Env, userId: string, email: string): Promise<void> {
  const { results } = await env.DB.prepare("SELECT id, chat_id, added_by FROM chat_pending_shares WHERE email = ?")
    .bind(email)
    .all<{ id: string; chat_id: string; added_by: string | null }>();
  if (results.length === 0) return;
  const now = Date.now();
  await env.DB.batch([
    ...results.map((r) =>
      env.DB.prepare("INSERT OR IGNORE INTO chat_members (chat_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)").bind(r.chat_id, userId, r.added_by, now)
    ),
    env.DB.prepare("DELETE FROM chat_pending_shares WHERE email = ?").bind(email),
  ]);
}

export const sharing = new Hono<AppEnv>();

// Add someone, by username or by email address.
sharing.post("/chats/:id/members", async (c) => {
  const userId = c.get("userId");
  const access = await chatAccess(c.env, c.req.param("id"), userId);
  if (!access) return c.json({ error: "not found" }, 404);
  if (access.role !== "owner") return c.json({ error: "only the person who started a chat can share it" }, 403);
  const chat = access.chat;

  const body = await c.req.json().catch(() => ({}));
  const who = typeof body?.who === "string" ? body.who.trim().replace(/^@/, "") : "";
  if (!who) return c.json({ error: "enter a username or an email address" }, 400);

  const counts = await c.env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM chat_members WHERE chat_id = ?1 AND removed_at IS NULL)
          + (SELECT COUNT(*) FROM chat_pending_shares WHERE chat_id = ?1) AS n`
  )
    .bind(chat.id)
    .first<{ n: number }>();
  if ((counts?.n ?? 0) >= config.limits.chat_members) {
    return c.json({ error: `a chat can be shared with ${config.limits.chat_members} people at most` }, 400);
  }

  const sharerName = c.get("username") ? `@${c.get("username")}` : c.get("userName") || "Someone";
  let target: { id: string; email: string } | null;
  if (who.includes("@")) {
    const email = normalizeEmail(who);
    if (!email) return c.json({ error: "that doesn't look like an email address" }, 400);
    target = await c.env.DB.prepare("SELECT id, email FROM user WHERE lower(email) = ?").bind(email).first<{ id: string; email: string }>();
    if (!target) {
      // No account yet: the share waits for them. An invite already waiting
      // for that address, from anyone, is reused as it is. One the owner sent
      // before that has lapsed is renewed, which costs nothing, so it isn't
      // asked about. Otherwise it takes one of the owner's invites, and only
      // with their say-so.
      const waiting = await c.env.DB.prepare("SELECT 1 AS one FROM chat_pending_shares WHERE chat_id = ? AND email = ?").bind(chat.id, email).first();
      if (waiting) return c.json({ error: "this chat is already waiting for that address" }, 400);
      if (!(await pendingInviteFor(c.env, email))) {
        if (body?.useInvite !== true && !(await lapsedInviteFrom(c.env, userId, email))) {
          const me = await c.env.DB.prepare("SELECT invites_remaining FROM user WHERE id = ?").bind(userId).first<{ invites_remaining: number }>();
          return c.json({ error: "that address doesn't have an account yet", code: "needs_invite", invitesRemaining: me?.invites_remaining ?? 0 }, 409);
        }
        const invited = await createInvite(c.env, { email, inviterId: userId, inviterName: sharerName, sharedChat: true });
        if (!invited.ok) return c.json({ error: invited.reason }, 400);
      }
      await c.env.DB.prepare("INSERT INTO chat_pending_shares (id, chat_id, email, added_by, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), chat.id, email, userId, Date.now())
        .run();
      return c.json({ roster: await roster(c.env, chat, true), waitingFor: email });
    }
  } else {
    target = await c.env.DB.prepare("SELECT id, email FROM user WHERE lower(username) = ?").bind(who.toLowerCase()).first<{ id: string; email: string }>();
    if (!target) return c.json({ error: `nobody here goes by @${who}` }, 404);
  }

  if (target.id === userId) return c.json({ error: "that's you" }, 400);
  // A seat (seats.ts) goes where the account that made it puts it, nowhere else.
  const seat = await c.env.DB.prepare("SELECT seat_of FROM user WHERE id = ?").bind(target.id).first<{ seat_of: string | null }>();
  if (seat?.seat_of && seat.seat_of !== userId) return c.json({ error: `nobody here goes by @${who}` }, 404);
  const existing = await c.env.DB.prepare("SELECT removed_at FROM chat_members WHERE chat_id = ? AND user_id = ?")
    .bind(chat.id, target.id)
    .first<{ removed_at: number | null }>();
  if (existing && existing.removed_at === null) return c.json({ error: "they're already in this chat" }, 400);

  const now = Date.now();
  await c.env.DB.batch([
    existing
      ? c.env.DB.prepare("UPDATE chat_members SET removed_at = NULL, added_at = ?, added_by = ? WHERE chat_id = ? AND user_id = ?").bind(now, userId, chat.id, target.id)
      : c.env.DB.prepare("INSERT INTO chat_members (chat_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)").bind(chat.id, target.id, userId, now),
    // Moves it to the top of their sidebar, where they'll notice it.
    c.env.DB.prepare("UPDATE chats SET updated_at = ? WHERE id = ?").bind(now, chat.id),
  ]);
  c.executionCtx.waitUntil(
    sendEmail(c.env, { to: target.email, ...chatSharedEmail({ sharerName, title: chat.title, url: `${c.env.BASE_URL}/c/${chat.id}` }) }).catch((err) =>
      console.error("share email failed", err)
    )
  );
  return c.json({ roster: await roster(c.env, chat, true) });
});

// The owner removes someone, or a member leaves. Either way the row stays,
// stamped, so what they wrote keeps their name.
sharing.delete("/chats/:id/members/:userId", async (c) => {
  const userId = c.get("userId");
  const targetId = c.req.param("userId");
  const access = await chatAccess(c.env, c.req.param("id"), userId);
  if (!access) return c.json({ error: "not found" }, 404);
  if (access.role !== "owner" && targetId !== userId) return c.json({ error: "only the person who started a chat can remove people" }, 403);

  const removed = await c.env.DB.prepare("UPDATE chat_members SET removed_at = ? WHERE chat_id = ? AND user_id = ? AND removed_at IS NULL")
    .bind(Date.now(), access.chat.id, targetId)
    .run();
  if (!removed.meta.changes) return c.json({ error: "not found" }, 404);
  if (access.role !== "owner") return c.json({ ok: true });
  return c.json({ roster: await roster(c.env, access.chat, true) });
});

// The owner takes back a share that's still waiting for someone to sign up.
// The invite itself, if one was sent, stands: it's theirs to withdraw from
// the invite dialog.
sharing.delete("/chats/:id/pending/:pendingId", async (c) => {
  const access = await chatAccess(c.env, c.req.param("id"), c.get("userId"));
  if (!access || access.role !== "owner") return c.json({ error: "not found" }, 404);
  await c.env.DB.prepare("DELETE FROM chat_pending_shares WHERE id = ? AND chat_id = ?").bind(c.req.param("pendingId"), access.chat.id).run();
  return c.json({ roster: await roster(c.env, access.chat, true) });
});
