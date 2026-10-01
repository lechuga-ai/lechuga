import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { bearer, captcha, emailOTP, magicLink } from "better-auth/plugins";
import { adminEmails, type Env } from "./types";
import { sendEmail } from "./email";
import { acceptInvite, hasAccount, normalizeEmail, pendingInviteFor } from "./invites";
import { applyOnce } from "./credits";
import { passesBotCheck } from "./turnstile";
import { claimPendingShares } from "./sharing";
import { claimPendingBotShares } from "./bots";
import config from "../config.json";
import { APP_ORIGINS } from "./native-app";

// Better Auth is mounted under this path; the SPA's client uses the same
// default, so nothing on the web side needs to know it.
export const AUTH_BASE_PATH = "/api/auth";

// How long a magic link stays valid.
const MAGIC_LINK_TTL_SECONDS = 15 * 60;
// How long a sign-in code stays valid.
const SIGN_IN_CODE_TTL_SECONDS = 10 * 60;

// The two ways a sign-in starts: asking for a link, or asking for a code.
// Both send mail, so both sit behind the invite gate and the bot check. The
// link's check is the captcha plugin's; the code's is ours (passesBotCheck),
// because the native apps can't run Turnstile and have to be let through.
const MAGIC_LINK_PATH = "/sign-in/magic-link";
const CODE_PATH = "/email-otp/send-verification-otp";
const SIGN_IN_STARTS = new Set([MAGIC_LINK_PATH, CODE_PATH]);

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
    // The site, and the native apps' origins (native-app.ts).
    trustedOrigins: [env.BASE_URL, ...APP_ORIGINS],

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

    // Seats (seats.ts) sign in with a username and a code: Better Auth's
    // email-and-password sign-in on a made-up address. Nobody can sign up
    // this way; the only accounts with a password are the ones seats.ts
    // makes.
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 6 },

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
        // Who a seat belongs to (seats.ts), so every request knows.
        seatOf: { type: "string", required: false, input: false, fieldName: "seat_of" },
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
      // Refuse link and code requests for uninvited emails before any mail
      // goes out. The same wording for every refused address: it says the
      // site is invite only, not whether the address is known.
      before: createAuthMiddleware(async (ctx) => {
        if (!SIGN_IN_STARTS.has(ctx.path)) return;
        if (ctx.path === CODE_PATH && !(await passesBotCheck(env, ctx.headers ?? new Headers()))) {
          throw new APIError("BAD_REQUEST", { code: "CAPTCHA_FAILED", message: "the sign-in check failed; reload and try again" });
        }
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
            // Chats, and bots, shared with this address before it had an account.
            if (email) await claimPendingShares(env, user.id, email);
            if (email) await claimPendingBotShares(env, user.id, email);
            // Starter credits. Keyed by user id, so it can only land once.
            await applyOnce(env, { userId: user.id, delta: config.starter_credits, reason: "signup_bonus", ref: user.id });
          },
        },
      },
    },

    plugins: [
      // The native apps' sign-in: the session token is returned in a
      // set-auth-token header when a sign-in completes, and accepted back as
      // Authorization: Bearer on every request, in place of the cookie the
      // website uses (web/src/native.ts). Harmless for the site: a request
      // without the header is handled exactly as before.
      bearer(),
      captcha({
        provider: "cloudflare-turnstile",
        secretKey: env.TURNSTILE_SECRET,
        // The plugin's default list only covers email/password endpoints.
        // The link, and a seat's username-and-code sign-in; the emailed
        // code's check is in the hook above.
        endpoints: [MAGIC_LINK_PATH, "/sign-in/email"],
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
      // The same sign-in as a six-digit code, for a copy installed as an app
      // (Safari's Add to Home Screen or Add to Dock, Chrome's Install). There
      // the emailed link would open in the browser, which on iOS and macOS
      // has its own cookies, and the installed copy would stay signed out.
      // The web app asks for a code instead of a link when it's running
      // installed (web/src/installed.ts, web/src/components/SignIn.tsx).
      emailOTP({
        otpLength: 6,
        expiresIn: SIGN_IN_CODE_TTL_SECONDS,
        allowedAttempts: 5,
        sendVerificationOTP: async ({ email, otp, type }) => {
          // Nothing here asks for the plugin's other kinds of code (email
          // verification, password reset); only sign-in should ever send.
          if (type !== "sign-in") return;
          await sendEmail(env, {
            to: email,
            subject: `${otp} is your Lechuga sign-in code`,
            text: [
              "Your code to sign in to Lechuga:",
              "",
              otp,
              "",
              "It works once and expires in 10 minutes. If you didn't ask for it, ignore this email.",
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
