import type { Env } from "./types";

// A thin client for the handful of Stripe calls billing needs, over fetch, so
// the worker carries no Stripe SDK. The API version is pinned so a change on
// Stripe's side can't alter the shapes read here and in billing-webhook.ts.
const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_VERSION = "2026-08-26.dahlia";

// How old a webhook's timestamp may be. Stops a captured request from being
// replayed later.
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export class StripeError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

type Params = { [key: string]: string | number | Params | Params[] | string[] };

// Stripe takes form encoding with bracketed keys: line_items[0][price]=...
function encode(params: Params, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(params)) {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) =>
        typeof item === "object" ? encode(item, `${name}[${i}]`, out) : out.append(`${name}[${i}]`, String(item))
      );
    } else if (typeof value === "object") {
      encode(value, name, out);
    } else {
      out.append(name, String(value));
    }
  }
  return out;
}

export async function stripe<T>(env: Env, method: "GET" | "POST", path: string, params: Params = {}): Promise<T> {
  const query = encode(params).toString();
  const res = await fetch(`${STRIPE_API}${path}${method === "GET" && query ? `?${query}` : ""}`, {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "stripe-version": STRIPE_VERSION,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: method === "POST" ? query : undefined,
  });
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new StripeError(res.status, body.error?.message ?? `stripe ${res.status}`);
  return body;
}

// Prices are found by lookup key (leaf, head, monthly), which is the same in
// test and live mode, so no price ids are stored anywhere.
export async function priceIdFor(env: Env, lookupKey: string): Promise<string> {
  const { data } = await stripe<{ data: { id: string }[] }>(env, "GET", "/prices", {
    lookup_keys: [lookupKey],
    active: "true",
    limit: 1,
  });
  if (!data[0]) throw new StripeError(404, `no active Stripe price with lookup key "${lookupKey}"`);
  return data[0].id;
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Compares without stopping at the first difference, so timing says nothing
// about how much of a forged signature was right.
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signWebhook(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)));
}

// Stripe-Signature looks like "t=1726650000,v1=abc...,v1=def...". The body
// must be the raw text exactly as received; re-serialized JSON won't match.
export async function verifyWebhook(secret: string, header: string | null | undefined, body: string): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.trim().split("=") as [string, string]);
  const timestamp = Number(parts.find(([k]) => k === "t")?.[1]);
  const candidates = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!timestamp || candidates.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const expected = await signWebhook(secret, timestamp, body);
  return candidates.some((c) => sameString(c, expected));
}
