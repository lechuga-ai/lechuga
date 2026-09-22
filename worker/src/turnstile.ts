import type { Env } from "./types";

// Server-side check of a Turnstile token for routes Better Auth's captcha
// plugin doesn't cover (the public request-access form). The plugin handles
// the sign-in endpoints itself.
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
