import { describe, expect, it } from "vitest";
import { verifyWebhook } from "./stripe";

const secret = "whsec_test_secret";
const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1" } } });

async function sign(timestamp: number, payload: string, key = secret): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${timestamp}.${payload}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

const now = () => Math.floor(Date.now() / 1000);

describe("verifyWebhook", () => {
  it("accepts a fresh, correctly signed body", async () => {
    const t = now();
    expect(await verifyWebhook(secret, `t=${t},v1=${await sign(t, body)}`, body)).toBe(true);
  });

  it("accepts when any of several v1 signatures matches", async () => {
    const t = now();
    expect(await verifyWebhook(secret, `t=${t},v1=${"0".repeat(64)},v1=${await sign(t, body)}`, body)).toBe(true);
  });

  it("refuses a body that changed after signing", async () => {
    const t = now();
    expect(await verifyWebhook(secret, `t=${t},v1=${await sign(t, body)}`, body + " ")).toBe(false);
  });

  it("refuses a signature made with another secret", async () => {
    const t = now();
    expect(await verifyWebhook(secret, `t=${t},v1=${await sign(t, body, "whsec_other")}`, body)).toBe(false);
  });

  it("refuses an old timestamp, so a captured request can't be replayed", async () => {
    const t = now() - 10 * 60;
    expect(await verifyWebhook(secret, `t=${t},v1=${await sign(t, body)}`, body)).toBe(false);
  });

  it("refuses a missing or malformed header", async () => {
    expect(await verifyWebhook(secret, null, body)).toBe(false);
    expect(await verifyWebhook(secret, "", body)).toBe(false);
    expect(await verifyWebhook(secret, "v1=abc", body)).toBe(false);
    expect(await verifyWebhook(secret, `t=${now()}`, body)).toBe(false);
  });
});
