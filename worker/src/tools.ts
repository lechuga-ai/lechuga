import config from "../config.json";
import type { Env } from "./types";

// Tools the model can call while answering. Each one is a definition in the
// OpenAI function-calling shape (what the model sees) and a run function
// (what happens when it asks). New tools go in TOOLS; nothing else needs to
// know about them. Anything backed by a person's own account (their mail, a
// calendar) will need an account link first, and a tool that checks for it.

export type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  // Only offered when this says so: a search with no key isn't offered.
  available: (env: Env) => boolean;
  // What the chat shows while it runs, and after: "Searched: …", "Read: …".
  label: (args: Record<string, unknown>) => string;
  run: (env: Env, args: Record<string, unknown>) => Promise<ToolOutcome>;
};

export type ToolOutcome = {
  // Goes back to the model, as the tool message.
  result: string;
  // What it cost us, in dollars, and what it costs the chat's payer, in
  // credits. The credits are our cost at the published markup, rounded up
  // to a whole number set in config.json so it's easy to say out loud.
  costUsd: number;
  credits: number;
  // Something for the chat to show or link: the pages a search found, or the
  // page that was read.
  links?: { title: string; url: string }[];
};

const T = config.tools;

const webSearch: ToolDef = {
  name: "web_search",
  description:
    "Search the web. Use it for anything that may have changed since your training data ends (news, prices, versions, schedules, who holds which job), for facts you aren't sure of, and when the person asks you to look something up. Returns titles, addresses and a short description of each page; use read_page on the ones that matter.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "What to search for, as you'd type it into a search engine" } },
    required: ["query"],
  },
  available: (env) => Boolean(env.BRAVE_SEARCH_API_KEY),
  label: (args) => `Searched: ${String(args.query ?? "")}`,
  async run(env, args) {
    const query = String(args.query ?? "").trim().slice(0, 400);
    if (!query) return { result: "The query was empty.", costUsd: 0, credits: 0 };
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(T.web_search.results));
    url.searchParams.set("text_decorations", "false");
    const res = await fetch(url, {
      headers: { accept: "application/json", "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY! },
      signal: AbortSignal.timeout(T.timeout_ms),
    });
    // Every call is billed, even one that finds nothing.
    const cost = { costUsd: T.web_search.cost_usd, credits: T.web_search.credits };
    if (!res.ok) {
      console.error("brave search failed", res.status, (await res.text()).slice(0, 200));
      return { result: "The search failed; say so, and answer from what you know.", ...cost };
    }
    const data = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string; age?: string }[] } };
    const results = (data.web?.results ?? []).filter((r) => r.url && r.title);
    if (results.length === 0) return { result: `No results for "${query}".`, ...cost };
    const lines = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.age ? `\n   (${r.age})` : ""}\n   ${r.description ?? ""}`);
    return {
      result: `Results for "${query}":\n\n${lines.join("\n\n")}`,
      links: results.map((r) => ({ title: r.title!, url: r.url! })),
      ...cost,
    };
  },
};

const readPage: ToolDef = {
  name: "read_page",
  description:
    "Fetch a web page and read it as text. Use it on a search result that looks right, or on an address the person gave you. Long pages are cut off; say so if what you needed was probably further down.",
  parameters: {
    type: "object",
    properties: { url: { type: "string", description: "The page's full address, starting with http:// or https://" } },
    required: ["url"],
  },
  available: () => true,
  label: (args) => `Read: ${hostOf(String(args.url ?? ""))}`,
  async run(env, args) {
    const free = { costUsd: 0, credits: 0 };
    let url: URL;
    try {
      url = new URL(String(args.url ?? ""));
    } catch {
      return { result: "That isn't a valid address.", ...free };
    }
    // Only the public web. No other schemes, and nothing on our own network:
    // the worker can reach things a browser can't, and a page could tell the
    // model to ask for them.
    if (!/^https?:$/.test(url.protocol) || isPrivateHost(url.hostname)) {
      return { result: "That address can't be read from here.", ...free };
    }
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; Lechuga/1.0; +https://lechuga.ai)", accept: "text/html,application/xhtml+xml,text/plain,application/pdf;q=0.9,*/*;q=0.5" },
        redirect: "follow",
        signal: AbortSignal.timeout(T.timeout_ms),
      });
    } catch (err) {
      return { result: `Couldn't reach ${url.hostname}: ${(err as Error).message}`, ...free };
    }
    if (!res.ok) return { result: `${url.hostname} answered ${res.status}.`, ...free };
    const type = res.headers.get("content-type") ?? "";
    const raw = await res.arrayBuffer();
    if (raw.byteLength > T.read_page.max_bytes) return { result: "That page is too large to read.", ...free };
    let text: string;
    if (type.includes("text/plain") || type.includes("markdown")) {
      text = new TextDecoder().decode(raw);
    } else {
      // Cloudflare's converter, the same one that reads attached PDFs and
      // Office files (convert.ts), turns the HTML or PDF into markdown.
      const ext = type.includes("pdf") ? "pdf" : "html";
      const form = new FormData();
      form.append("files", new Blob([raw], { type: type.split(";")[0] || "text/html" }), `page.${ext}`);
      const conv = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.AI_GATEWAY_ACCOUNT_ID}/ai/tomarkdown`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.CF_API_TOKEN}` },
        body: form,
        signal: AbortSignal.timeout(T.timeout_ms),
      });
      const data = (await conv.json().catch(() => null)) as { success?: boolean; result?: { data?: string }[] } | null;
      const md = data?.result?.[0]?.data;
      if (!conv.ok || typeof md !== "string") return { result: `Couldn't read the page at ${url.hostname}.`, ...free };
      const contents = md.indexOf("## Contents");
      text = contents >= 0 ? md.slice(contents + "## Contents".length) : md;
    }
    text = text.replace(/\n{3,}/g, "\n\n").trim();
    const cut = text.length > T.read_page.max_chars;
    return {
      result: `Contents of ${url.href}${cut ? " (cut off; the page is longer)" : ""}:\n\n${text.slice(0, T.read_page.max_chars)}`,
      links: [{ title: url.hostname, url: url.href }],
      ...free,
    };
  },
};

export const TOOLS: ToolDef[] = [webSearch, readPage];

export function toolsFor(env: Env): ToolDef[] {
  return TOOLS.filter((t) => t.available(env));
}

// The shape the model is sent.
export function toolSchemas(tools: ToolDef[]) {
  return tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return u.slice(0, 60);
  }
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // IPv4 literals in private, loopback, link-local or metadata ranges.
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return h.startsWith("[") || h === "::1";
}
