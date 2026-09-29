import type { Env } from "./types";
import { APP_ORIGINS } from "./native-app";

// Server-side check of a Turnstile token for routes Better Auth's captcha
// plugin doesn't cover (the public request-access form). The plugin handles
// the sign-in endpoints itself.
// The bot check as every public form and the sign-in code run it. The native
// apps' origins (native-app.ts) pass without a token: Turnstile only runs on
// http(s) pages and the iOS app's aren't, so the widget can't ever load
// there. Everyone else needs a valid token. An Origin header can be forged,
// so this leans on what sits behind each form: the invite gate on sign-in
// (codes only go to invited or existing addresses), the daily ceilings on
// the public forms, and the trial's caps.
export async function passesBotCheck(env: Env, headers: Headers): Promise<boolean> {
  if (APP_ORIGINS.includes(headers.get("origin") ?? "")) return true;
  return verifyTurnstile(env, headers.get("x-captcha-response"), headers.get("cf-connecting-ip"));
}

export async function verifyTurnstile(env: Env, token: string | null, ip: string | null): Promise<boolean> {
  if (!token) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  if (ip) body.set("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { success?: boolean };
  return data.success === true;
}
