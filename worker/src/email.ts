import type { Env } from "./types";

// All mail leaves from this address (plan v3, section 2). Resend must have
// lechuga.ai verified as a sending domain for it to be accepted.
export const FROM_ADDRESS = "Lechuga (alpha) <hello@lechuga.ai>";
export const REPLY_TO = "hello@lechuga.ai";

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  // The same words dressed up, for clients that show it; text is the fallback.
  html?: string;
  // Set on admin replies so a user's answer lands in the inbox, not nowhere.
  replyTo?: string;
};

// Sends email through Resend's REST API. No SDK: one fetch is all
// it takes, and it keeps the worker bundle small.
export async function sendEmail(env: Env, msg: OutgoingEmail): Promise<void> {
  if (!env.RESEND_API_KEY) {
    // Local convenience: with no key on a localhost BASE_URL, print instead of
    // failing. Never reachable on dev/prod, where BASE_URL is https.
    if (env.BASE_URL.startsWith("http://localhost")) {
      console.log(`[email to ${msg.to}] ${msg.subject}\n${msg.text}\n`);
      return;
    }
    throw new Error("RESEND_API_KEY is not set");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [msg.to],
      subject: msg.subject,
      text: msg.text,
      ...(msg.html ? { html: msg.html } : {}),
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`resend ${res.status}: ${detail.slice(0, 200)}`);
  }
}
