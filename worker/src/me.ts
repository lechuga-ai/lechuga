import { Hono } from "hono";
import type { AppEnv } from "./types";
import { checkUsernameFormat, normalizeUsername } from "./username";
import { creditsEnforced } from "./credits";
import config from "../config.json";

// The signed-in user's own profile: who am I, and the one-time username step.
export const me = new Hono<AppEnv>();

me.get("/", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT u.name, u.username, u.username_set_at, u.invites_remaining, u.balance, u.subscription_status, a.updated_at AS photo
     FROM user u LEFT JOIN avatars a ON a.user_id = u.id WHERE u.id = ?`
  )
    .bind(c.get("userId"))
    .first<{
      name: string | null;
      photo: number | null;
      username: string | null;
      username_set_at: number | null;
      invites_remaining: number;
      balance: number;
      subscription_status: "active" | "cancelled" | null;
    }>();
  return c.json({
    id: c.get("userId"),
    email: c.get("userEmail"),
    // Read fresh, so a profile change shows without waiting on the session.
    name: row?.name ?? c.get("userName"),
    // The avatar's version, for /api/avatars/<id>?v=<photo>; null is no photo.
    photo: row?.photo ?? null,
    username: row?.username ?? null,
    invitesRemaining: row?.invites_remaining ?? 0,
    balance: row?.balance ?? 0,
    subscriptionStatus: row?.subscription_status ?? null,
    // False where credits can't be bought yet; the UI then hides the buy buttons.
    creditsEnforced: creditsEnforced(c.env),
    isAdmin: c.get("isAdmin"),
  });
});

// The profile: a name, and a photo. Neither is required: with no name,
// people see the @username instead (displayName in sharing.ts). The photo arrives as a small square JPEG
// data URL the browser has already scaled down (ProfileDialog); null removes
// it, and leaving it out keeps what's there.
const AVATAR_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

me.put("/profile", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.replace(/\s+/g, " ").trim() : "";
  if (name.length > 60) return c.json({ error: "that name is over 60 characters" }, 400);
  const photo: unknown = body?.photo;
  if (typeof photo === "string" && (!AVATAR_URL.test(photo) || photo.length > config.limits.avatar_chars)) {
    return c.json({ error: "that photo can't be used; try another" }, 400);
  }

  const userId = c.get("userId");
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE user SET name = ? WHERE id = ?").bind(name, userId),
    ...(typeof photo === "string"
      ? [
          c.env.DB.prepare(
            "INSERT INTO avatars (user_id, data, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(user_id) DO UPDATE SET data = ?2, updated_at = ?3"
          ).bind(userId, photo, now),
        ]
      : photo === null
        ? [c.env.DB.prepare("DELETE FROM avatars WHERE user_id = ?").bind(userId)]
        : []),
  ]);
  const saved = await c.env.DB.prepare("SELECT updated_at FROM avatars WHERE user_id = ?").bind(userId).first<{ updated_at: number }>();
  return c.json({ name, photo: saved?.updated_at ?? null });
});

// Live availability for the username page. Format problems come back with
// the reason; uniqueness is checked case-insensitively.
me.get("/username/available", async (c) => {
  const check = checkUsernameFormat(c.req.query("u") ?? "");
  if (!check.ok) return c.json({ available: false, reason: check.reason });
  const taken = await c.env.DB.prepare("SELECT 1 AS one FROM user WHERE lower(username) = ?").bind(check.username).first();
  return c.json(taken ? { available: false, reason: "that one's taken" } : { available: true });
});

// Set once. After that only an admin can change it (worker/src/admin.ts).
me.put("/username", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const check = checkUsernameFormat(typeof body?.username === "string" ? body.username : "");
  if (!check.ok) return c.json({ error: check.reason }, 400);
  if (body?.acceptTerms !== true) return c.json({ error: "please accept the terms to continue" }, 400);

  const current = await c.env.DB.prepare("SELECT username FROM user WHERE id = ?")
    .bind(c.get("userId"))
    .first<{ username: string | null }>();
  if (current?.username) return c.json({ error: "usernames can't be changed" }, 403);

  const taken = await c.env.DB.prepare("SELECT 1 AS one FROM user WHERE lower(username) = ?")
    .bind(normalizeUsername(check.username))
    .first();
  if (taken) return c.json({ error: "that one's taken" }, 409);

  // The UNIQUE index is the final word if two people race for the same name.
  try {
    const now = Date.now();
    await c.env.DB.prepare(
      "UPDATE user SET username = ?, username_set_at = ?, terms_accepted_at = ?, terms_version = ? WHERE id = ? AND username IS NULL"
    )
      .bind(check.username, now, now, config.terms_version, c.get("userId"))
      .run();
  } catch {
    return c.json({ error: "that one's taken" }, 409);
  }
  return c.json({ ok: true, username: check.username });
});

// Profile photos, as images. Signed-in only, like everything else here. The
// address carries the photo's version, so it can be cached for good: a new
// photo has a new address.
export const avatars = new Hono<AppEnv>();

avatars.get("/:userId", async (c) => {
  const row = await c.env.DB.prepare("SELECT data FROM avatars WHERE user_id = ?").bind(c.req.param("userId")).first<{ data: string }>();
  if (!row) return c.json({ error: "not found" }, 404);
  const bytes = Uint8Array.from(atob(row.data.slice(row.data.indexOf(",") + 1)), (ch) => ch.charCodeAt(0));
  return new Response(bytes, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000, immutable" } });
});
