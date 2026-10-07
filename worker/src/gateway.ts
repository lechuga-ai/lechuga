import type { Env } from "./types";
import { parseSSE } from "./sse";
import type { ContentPart } from "./attachments";
import config from "../config.json";

const LIMITS = config.limits;

// content is a list of parts only when the turn carries pictures. The two
// tool shapes are the model asking for a tool and the answer it gets back.
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatTurn =
  | { role: "system" | "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

// null means the gateway never reported usage; the caller must not treat it as free.
export type Usage = { promptTokens: number | null; completionTokens: number | null };

export type OpenAIChunk = {
  choices?: {
    delta?: {
      content?: string;
      reasoning_content?: string;
      reasoning?: string;
      // A tool call arrives in pieces: the name and id first, then the
      // arguments a few characters at a time, all under one index.
      tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export type StreamResult = {
  stream: ReadableStream<Uint8Array>;
  usage: Promise<Usage>;
};

// Calls the model via the AI Gateway's OpenAI-compatible endpoint rather than
// the raw Workers AI binding, so we get token usage on the final SSE chunk
// (stream_options.include_usage). Billing needs that number to be trustworthy.
// maxTokens caps the reply (reasoning included), which bounds what one reply
// can cost: config.json limits.max_reply_tokens for accounts, trial's own for /try.
export async function streamChat(
  env: Env,
  model: string,
  messages: ChatTurn[],
  opts: { maxTokens?: number; effort?: string; tools?: unknown[] } = {}
): Promise<StreamResult> {
  const url = `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/workers-ai/v1/chat/completions`;

  // Two clocks, neither of which caps a long reply: one for the headers to
  // arrive (the gateway is down or queueing), cleared as soon as they do,
  // and one for the gaps between chunks (the model stalled mid-answer),
  // which errors the stream so the readers see it instead of waiting for
  // ever. A reply that thinks for minutes streams its reasoning the whole
  // time, so the gap clock doesn't trouble it.
  const abort = new AbortController();
  const firstByte = setTimeout(() => abort.abort(new Error("the model took too long to start answering")), LIMITS.model_first_byte_ms);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.CF_API_TOKEN}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        // How much the model thinks before answering: low, medium or high.
        ...(opts.effort ? { reasoning_effort: opts.effort } : {}),
        ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" } : {}),
      }),
      signal: abort.signal,
    });
  } finally {
    clearTimeout(firstByte);
  }

  if (!upstream.ok || !upstream.body) {
    throw new Error(`gateway request failed: ${upstream.status} ${await upstream.text()}`);
  }

  let resolveUsage!: (u: Usage) => void;
  const usage = new Promise<Usage>((res) => {
    resolveUsage = res;
  });

  const [forClient, forUsage] = withIdleTimeout(upstream.body, LIMITS.model_idle_ms).tee();

  (async () => {
    let found: Usage | null = null;
    try {
      for await (const chunk of parseSSE<OpenAIChunk>(forUsage)) {
        if (chunk.usage) {
          found = {
            promptTokens: chunk.usage.prompt_tokens ?? null,
            completionTokens: chunk.usage.completion_tokens ?? null,
          };
        }
      }
    } catch {
      // stream broke before usage arrived; leave it null
    } finally {
      resolveUsage(found ?? { promptTokens: null, completionTokens: null });
    }
  })();

  return { stream: forClient, usage };
}

// Errors the stream when nothing has arrived for `ms`. Downstream, parseSSE
// throws, the reply loop sends {error}, and the usage reader resolves null
// so the text that did arrive is charged by estimate rather than for free.
function withIdleTimeout(source: ReadableStream<Uint8Array>, ms: number): ReadableStream<Uint8Array> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = () => new Error("the model stopped sending");
  return source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      start(controller) {
        timer = setTimeout(() => controller.error(stalled()), ms);
      },
      transform(chunk, controller) {
        if (timer !== undefined) clearTimeout(timer);
        controller.enqueue(chunk);
        timer = setTimeout(() => controller.error(stalled()), ms);
      },
      flush() {
        if (timer !== undefined) clearTimeout(timer);
      },
    })
  );
}

// Re-encodes the upstream stream as our own SSE events for the browser:
// an optional {notice} first, then {reasoning}, {delta}, and {error} if the
// upstream breaks, then [DONE].
export function textDeltaStream(source: ReadableStream<Uint8Array>, notice?: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      if (notice) send({ notice });
      try {
        for await (const chunk of parseSSE<OpenAIChunk>(source)) {
          const d = chunk.choices?.[0]?.delta;
          const reasoning = d?.reasoning_content ?? d?.reasoning;
          if (reasoning) send({ reasoning });
          if (d?.content) send({ delta: d.content });
        }
      } catch {
        send({ error: "the model stream was interrupted" });
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

// Accumulates the assistant text from an upstream stream. If the stream
// breaks, returns whatever arrived before it did.
export async function collectText(source: ReadableStream<Uint8Array>): Promise<string> {
  let text = "";
  try {
    for await (const chunk of parseSSE<OpenAIChunk>(source)) {
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) text += content;
    }
  } catch {
    // keep the partial text
  }
  return text;
}
