import { Hono } from "hono";
import { adminEmails, type AppEnv } from "./types";
import { chat } from "./chat";
import { AUTH_BASE_PATH, createAuth, publicAuthConfig } from "./auth";
import { inviteLookup, invites } from "./invites";
import { accessRequests, feedbackRequests, notes } from "./requests";
import { admin } from "./admin";
import { avatars, me } from "./me";
import { sharing } from "./sharing";
import { billing } from "./billing";
import { billingWebhook } from "./billing-webhook";
import { trial } from "./trial";
import { convert } from "./convert";
import config from "../config.json";

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice(4);
    return c.redirect(url.toString(), 301);
  }
  await next();
});

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
  await next();
});

app.route("/api/me", me);
app.route("/api/avatars", avatars);
app.route("/api/invites", invites);
app.route("/api/notes", notes);
app.route("/api/admin", admin);
app.route("/api/billing", billing);
app.route("/api/convert", convert);
app.route("/api", sharing);
app.route("/api", chat);

app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
