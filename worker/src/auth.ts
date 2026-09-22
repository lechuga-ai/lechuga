import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { captcha, magicLink } from "better-auth/plugins";
import { adminEmails, type Env } from "./types";
import { sendEmail } from "./email";
import { acceptInvite, hasAccount, normalizeEmail, pendingInviteFor } from "./invites";
import { applyOnce } from "./credits";
import { claimPendingShares } from "./sharing";
import config from "../config.json";

// Better Auth is mounted under this path; the SPA's client uses the same
// default, so nothing on the web side needs to know it.
export const AUTH_BASE_PATH = "/api/auth";

// How long a magic link stays valid.
const MAGIC_LINK_TTL_SECONDS = 15 * 60;

// Built once per request. On Workers the D1 binding only exists inside a
// request, so there is no module-level instance to share.
export function createAuth(env: Env) {
  const local = env.BASE_URL.startsWith("http://localhost");
  const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

  // The invite gate (plan v3, Phase 2b step 2): an email may sign in if it
  // already has an account or holds an unexpired pending invite. Admin emails
  // (ADMIN_EMAILS) always pass: someone has to be first into an empty
  // database, on prod and on every fresh local setup.
  const admins = adminEmails(env);
  const allowed = async (email: string) =>
    admins.has(email) || (await hasAccount(env, email)) || (await pendingInviteFor(env, email)) !== null;

  return betterAuth({
    appName: "Lechuga",
    baseURL: env.BASE_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    trustedOrigins: [env.BASE_URL],

    // Google sign-in is offered only where both halves are configured
    // (plan v3: "each optional per environment").
    socialProviders: googleEnabled
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID!,
            clientSecret: env.GOOGLE_CLIENT_SECRET!,
          },
        }
      : {},

    user: {
      // Deleting is confirmed in the UI by typing "delete"; no email round
      // trip. The user row cascades to sessions, accounts, chats and
      // messages (0002_auth.sql).
      deleteUser: { enabled: true },
      // Read-only extras on session.user so every /api request knows the
      // username without a second query. Set through /api/me, never here.
      additionalFields: {
        username: { type: "string", required: false, input: false, fieldName: "username" },
        invitesRemaining: {
          type: "number",
          required: false,
          input: false,
          fieldName: "invites_remaining",
          defaultValue: config.default_invites,
        },
      },
    },

    session: {
      // Better Auth otherwise refuses to delete an account unless the
      // session is under a day old, and magic-link users have no password
      // to re-enter instead. 0 turns that check off.
      freshAge: 0,
    },

    advanced: {
      // Plan v3 constraint: HttpOnly, Secure, SameSite=Lax. Secure is dropped
      // only for http://localhost, where browsers would refuse the cookie.
      useSecureCookies: !local,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
      },
    },

    hooks: {
      // Refuse magic-link requests for uninvited emails before any mail goes
      // out. The same wording for every refused address: it says the site is
      // invite only, not whether the address is known.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/magic-link") return;
        const email = normalizeEmail((ctx.body as { email?: unknown } | undefined)?.email);
        if (!email) return;
        if (await allowed(email)) return;
        throw new APIError("FORBIDDEN", { code: "INVITE_ONLY", message: "Lechuga is invite only" });
      }),
    },

    databaseHooks: {
      user: {
        create: {
          // Covers Google too: no pending invite, no account. Better Auth
          // turns a false here into a redirect back to the sign-in page with
          // an error query parameter, which shows the invite-only view.
          before: async (user) => {
            const email = normalizeEmail(user.email);
            if (!email) return false;
            if (admins.has(email)) return;
            return (await pendingInviteFor(env, email)) ? undefined : false;
          },
          after: async (user) => {
            const email = normalizeEmail(user.email);
            if (email) await acceptInvite(env, user.id, email);
            // Chats shared with this address before it had an account.
            if (email) await claimPendingShares(env, user.id, email);
            // Starter credits. Keyed by user id, so it can only land once.
            await applyOnce(env, { userId: user.id, delta: config.starter_credits, reason: "signup_bonus", ref: user.id });
          },
        },
      },
    },

    plugins: [
      captcha({
        provider: "cloudflare-turnstile",
        secretKey: env.TURNSTILE_SECRET,
        // The plugin's default list only covers email/password endpoints.
        endpoints: ["/sign-in/magic-link"],
      }),
      magicLink({
        expiresIn: MAGIC_LINK_TTL_SECONDS,
        sendMagicLink: async ({ email, url }) => {
          await sendEmail(env, {
            to: email,
            subject: "Your Lechuga sign-in link",
            text: [
              "Here is your link to sign in to Lechuga:",
              "",
              url,
              "",
              "It works once and expires in 15 minutes. If you didn't ask for it, ignore this email.",
            ].join("\n"),
          });
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

// What the SPA needs to render the sign-in page. Both values are public.
export function publicAuthConfig(env: Env) {
  return {
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
    googleSignIn: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  };
}
