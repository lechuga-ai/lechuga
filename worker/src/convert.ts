import { Hono } from "hono";
import type { AppEnv } from "./types";
import { CONVERTIBLE } from "./attachments";
import config from "../config.json";

// Turns a PDF or an Office file into Markdown, so it can be attached to a
// message as text (attachments.ts). The work is done by Workers AI's
// document conversion, called over REST with the same token as the models;
// for these formats Cloudflare doesn't charge for it. Nothing is stored here:
// the text goes back to the browser, which sends it with the message.
export const convert = new Hono<AppEnv>();

convert.post("/", async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file") as File | string | null | undefined;
  if (!file || typeof file === "string") return c.json({ error: "no file" }, 400);
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!CONVERTIBLE.includes(ext)) return c.json({ error: `Sorry, Lechuga can't read .${ext} files yet` }, 400);
  if (file.size > config.limits.convert_max_bytes) {
    return c.json({ error: `${file.name} is over ${Math.round(config.limits.convert_max_bytes / 1_000_000)} MB, which is the most we can convert` }, 400);
  }

  const upstream = new FormData();
  upstream.append("files", file, file.name);
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${c.env.AI_GATEWAY_ACCOUNT_ID}/ai/tomarkdown`, {
    method: "POST",
    headers: { authorization: `Bearer ${c.env.CF_API_TOKEN}` },
    body: upstream,
  });
  const data = (await res.json().catch(() => null)) as { success?: boolean; result?: { data?: string }[] } | null;
  const markdown = data?.result?.[0]?.data;
  if (!res.ok || !data?.success || typeof markdown !== "string") {
    console.error("tomarkdown failed", res.status, JSON.stringify(data).slice(0, 300));
    return c.json({ error: `couldn't read ${file.name}. If it's a scan, it has no text in it to read.` }, 502);
  }
  // The converter leads with a block of file metadata nobody asked about.
  const contents = markdown.indexOf("## Contents");
  const text = (contents >= 0 ? markdown.slice(contents + "## Contents".length) : markdown).trim();
  if (!text) return c.json({ error: `${file.name} has no text in it that we could find. If it's a scan, that's why.` }, 400);
  return c.json({ name: file.name, text });
});
