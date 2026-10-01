import { Hono } from "hono";
import { cors } from "hono/cors";
import { adminEmails, type AppEnv, type Env } from "./types";
import { chat } from "./chat";
import { AUTH_BASE_PATH, createAuth, publicAuthConfig } from "./auth";
import { inviteLookup, invites } from "./invites";
import { accessRequests, feedbackRequests, notes } from "./requests";
import { admin } from "./admin";
import { avatars, me } from "./me";
import { memory } from "./memory";
import { bots } from "./bots";
import { seats } from "./seats";
import { nightly } from "./nightly";
import { sharing } from "./sharing";
import { billing } from "./billing";
import { billingWebhook } from "./billing-webhook";
import { trial } from "./trial";
import { convert } from "./convert";
import config from "../config.json";
import { APP_ORIGINS } from "./native-app";

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice(4);
    return c.redirect(url.toString(), 301);
  }
  await next();
});

// The native apps call the API from the origins in native-app.ts; those, and
// only those, get CORS headers. Visits to the site are same-origin and get
// none. The browser's preflight (OPTIONS) is answered here, so it comes before
// the session check, which it could never pass.
app.use(
  "/api/*",
  cors({
    origin: (origin) => (APP_ORIGINS.includes(origin) ? origin : null),
    allowHeaders: ["authorization", "content-type", "x-captcha-response"],
    exposeHeaders: ["set-auth-token"],
    maxAge: 86400,
  })
);

// One Better Auth instance per request, shared by the routes below.
app.use("/api/*", async (c, next) => {
  c.set("auth", createAuth(c.env));
  await next();
});

// Public routes. Anything registered before the session check below answers
// without a signed-in user; keep this list short and deliberate.
//
// Sign-in, sign-out, magic-link callback, Google callback, session, delete
// account: all handled by Better Auth.
app.on(["GET", "POST"], `${AUTH_BASE_PATH}/*`, (c) => c.get("auth").handler(c.req.raw));
// What the sign-in page needs before there is a session.
app.get("/api/config", (c) => c.json(publicAuthConfig(c.env)));
// The model list and its rates: already published on the home page, and its
// picker needs them before sign-in.
app.get("/api/models", (c) => c.json(config.models));
// The /invite/<token> page: whose invite this is and whether it's still good.
app.route("/api/invites/lookup", inviteLookup);
// The request-access form on the sign-in page (Turnstile-checked inside).
app.route("/api/requests/access", accessRequests);
// The Help page's feedback form, for visitors with no account (Turnstile-checked inside).
app.route("/api/requests/feedback", feedbackRequests);
// The home page's one free chat (Turnstile-checked and capped inside).
app.route("/api/try", trial);
// Stripe's webhook. No session: the signature check inside is the gate.
app.route("/api/billing/webhook", billingWebhook);

// Everything else under /api requires a signed-in user (plan v3: 401 when
// unauthenticated). Routes read the user from the context, never from input.
app.use("/api/*", async (c, next) => {
  const session = await c.get("auth").api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "sign in required" }, 401);
  c.set("userId", session.user.id);
  c.set("userEmail", session.user.email);
  c.set("userName", session.user.name);
  c.set("username", session.user.username ?? null);
  c.set("isAdmin", adminEmails(c.env).has(session.user.email.toLowerCase()));
  c.set("seatOf", (session.user as { seatOf?: string | null }).seatOf ?? null);
  await next();
});

// A seat (seats.ts) is someone else's account for one bot: it chats, and
// that's all. No credits, invites, memory, bots of its own, or sharing.
app.use("/api/*", async (c, next) => {
  if (!c.get("seatOf")) return next();
  const path = c.req.path;
  const method = c.req.method;
  const closed =
    path.startsWith("/api/billing") ||
    path.startsWith("/api/invites") ||
    path.startsWith("/api/memory") ||
    path.startsWith("/api/admin") ||
    (path === "/api/bots" && method === "POST") ||
    /^\/api\/chats\/[^/]+\/(members|pending|remember)/.test(path) ||
    /^\/api\/bots\/[^/]+\/(members|pending|seats)/.test(path);
  if (closed) return c.json({ error: "not available on this account" }, 403);
  await next();
});

app.route("/api/me", me);
app.route("/api/memory", memory);
app.route("/api/bots", seats);
app.route("/api/bots", bots);
app.route("/api/avatars", avatars);
app.route("/api/invites", invites);
app.route("/api/notes", notes);
app.route("/api/admin", admin);
app.route("/api/billing", billing);
app.route("/api/convert", convert);
app.route("/api", sharing);
app.route("/api", chat);

app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  // The cron in wrangler.toml: the overnight memory pass (nightly.ts).
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(nightly(env));
  },
} satisfies ExportedHandler<Env>;
