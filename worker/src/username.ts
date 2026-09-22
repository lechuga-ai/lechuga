import config from "../config.json";

// Username rules (plan v3, section 2): lowercase a-z, 0-9, underscore; starts
// with a letter; 4 to 20 characters; not reserved. Shared with the web build,
// which imports this file for the live availability hint. The server is the
// authority; the client only previews.

const RULES = config.username_rules;
const PATTERN = new RegExp(RULES.pattern);
const RESERVED = new Set(config.reserved_usernames.map((s) => s.toLowerCase()));
// Blocked anywhere inside a name, not just as the whole name. Kept short
// because substrings cause false positives; see config.json.
const FRAGMENTS = config.blocked_username_fragments.map((s) => s.toLowerCase());

export type UsernameCheck = { ok: true; username: string } | { ok: false; reason: string };

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

// Format and reserved-list check only; uniqueness is a database question.
export function checkUsernameFormat(raw: string): UsernameCheck {
  const username = normalizeUsername(raw);
  if (username.length < RULES.min) return { ok: false, reason: `at least ${RULES.min} characters` };
  if (username.length > RULES.max) return { ok: false, reason: `at most ${RULES.max} characters` };
  if (!/^[a-z]/.test(username)) return { ok: false, reason: "must start with a letter" };
  if (!PATTERN.test(username)) return { ok: false, reason: "letters, numbers and underscores only" };
  if (RESERVED.has(username)) return { ok: false, reason: "that one's reserved" };
  // Underscores are dropped and look-alike digits read as letters, so
  // "n_i_g_g" and "n1gg" don't slip past.
  const squeezed = username
    .replace(/_/g, "")
    .replace(/[013457]/g, (d) => ({ "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t" })[d] ?? d)
    .replace(/[0-9]/g, "");
  if (FRAGMENTS.some((f) => squeezed.includes(f))) return { ok: false, reason: "that name isn't allowed" };
  return { ok: true, username };
}
