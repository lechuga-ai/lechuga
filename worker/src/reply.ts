import { parseSSE } from "./sse";
import { streamChat, type ChatTurn, type OpenAIChunk, type ToolCall, type Usage } from "./gateway";
import type { ToolDef } from "./tools";
import { toolSchemas } from "./tools";
import type { Env } from "./types";
import config from "../config.json";

// One reply, start to finish: the model answers, or asks for a tool, gets
// its result and goes again, up to config.tools.max_rounds times. Everything
// the browser should see goes out as SSE events on `stream` while it
// happens; what should be stored and charged comes back in `done` when the
// last round ends.
//
// Events, in the order they can appear:
//   {notice}            once, if the caller has something to say first
//   {reasoning}         the model thinking, in pieces
//   {step: {id, label, links?, done}}  a tool starting (done false) and finishing
//   {delta}             the answer, in pieces
//   {error}             the upstream broke; then [DONE] anyway
//   [DONE]

export type Step = { id: string; label: string; links?: { title: string; url: string }[]; done: boolean };

// One tool the model actually ran, for tool_calls (migration 0010). Counted,
// not recorded: the arguments don't come along, only the tool's own logHost
// where it has one. Who asked and who pays isn't known here — the caller
// knows that, and fills it in when it stores these.
export type ToolUse = { tool: string; host: string | null; ok: boolean; costUsd: number; credits: number };

export type ReplyOutcome = {
  text: string;
  // Summed over every round, so the whole reply is charged, not just the last
  // call. null if any round failed to report; the caller then estimates.
  promptTokens: number | null;
  completionTokens: number | null;
  toolCredits: number;
  toolCostUsd: number;
  steps: Step[];
  toolUses: ToolUse[];
};

export function runReply(
  env: Env,
  model: string,
  turns: ChatTurn[],
  opts: { maxTokens: number; effort: string; tools: ToolDef[]; notice?: string }
): { stream: ReadableStream<Uint8Array>; done: Promise<ReplyOutcome> } {
  const encoder = new TextEncoder();
  let resolveDone!: (o: ReplyOutcome) => void;
  const done = new Promise<ReplyOutcome>((r) => (resolveDone = r));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // the browser went away; keep going so the reply is still stored
        }
      };
      if (opts.notice) send({ notice: opts.notice });

      const messages: ChatTurn[] = [...turns];
      const outcome: ReplyOutcome = { text: "", promptTokens: 0, completionTokens: 0, toolCredits: 0, toolCostUsd: 0, steps: [], toolUses: [] };
      const schemas = toolSchemas(opts.tools);
      // The reply's own text is whatever the last round said; text from a
      // round that ended in a tool call is the model talking to itself.
      for (let round = 0; round <= config.tools.max_rounds; round++) {
        // On the last allowed round the tools are withheld, so it has to answer.
        const withTools = round < config.tools.max_rounds ? schemas : [];
        // Withholding them silently is the trap described in chat.ts: the
        // preamble it is still carrying says it has tools, so GLM writes the
        // call it wanted into its answer as text and that becomes the reply
        // (seen on prod, 2026-09-22: five rounds spent, then a literal
        // <tool_call> where the answer should have been, charged in full).
        // Telling it the tools are gone is what turns that into an answer.
        if (schemas.length > 0 && withTools.length === 0) {
          messages.push({
            role: "system",
            content:
              "You have used every tool round this reply allows, so the tools are gone now. Answer from what you already have, in your own words. Don't write a tool call: written into an answer it does nothing, and the person sees the markup. If something is still unchecked, say so plainly and answer around it.",
          });
        }
        let upstream;
        try {
          upstream = await streamChat(env, model, messages, { maxTokens: opts.maxTokens, effort: opts.effort, tools: withTools });
        } catch (err) {
          console.error("gateway call failed", err);
          send({ error: round === 0 ? "the model isn't reachable right now" : "the model stopped answering part way" });
          break;
        }
        let text = "";
        const calls = new Map<number, ToolCall>();
        try {
          for await (const chunk of parseSSE<OpenAIChunk>(upstream.stream)) {
            const d = chunk.choices?.[0]?.delta;
            const reasoning = d?.reasoning_content ?? d?.reasoning;
            if (reasoning) send({ reasoning });
            if (d?.content) {
              text += d.content;
              send({ delta: d.content });
            }
            for (const tc of d?.tool_calls ?? []) {
              const i = tc.index ?? 0;
              const cur = calls.get(i) ?? { id: tc.id ?? `call_${i}`, type: "function" as const, function: { name: "", arguments: "" } };
              if (tc.id) cur.id = tc.id;
              if (tc.function?.name) cur.function.name += tc.function.name;
              if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
              calls.set(i, cur);
            }
          }
        } catch {
          send({ error: "the model stream was interrupted" });
          outcome.text = text;
          break;
        }
        const usage: Usage = await upstream.usage;
        outcome.promptTokens = usage.promptTokens === null || outcome.promptTokens === null ? null : outcome.promptTokens + usage.promptTokens;
        outcome.completionTokens = usage.completionTokens === null || outcome.completionTokens === null ? null : outcome.completionTokens + usage.completionTokens;

        if (calls.size === 0) {
          // Even told the tools are gone, GLM sometimes writes the call it
          // wanted in its own markup and stops. That isn't an answer: take
          // it out, and if nothing is left say so instead of showing it.
          // An empty reply is neither stored nor charged (chat.ts), the same
          // as one that never arrived, so the person doesn't pay for markup.
          if (withTools.length === 0 && schemas.length > 0 && text.includes("<tool_call>")) {
            const cleaned = text.replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/g, "").trim();
            // The markup already went out as deltas; redraw without it.
            send({ retract: true });
            if (!cleaned) {
              send({ error: "the model ran out of tool rounds before it answered; ask again, or ask for less at once" });
              break;
            }
            send({ delta: cleaned });
            text = cleaned;
          }
          outcome.text = text;
          break;
        }
        // A tool round. Anything it said on the way is discarded from the
        // browser's point of view too: it was thinking out loud.
        if (text) send({ retract: true });
        const toolCalls = [...calls.values()];
        messages.push({ role: "assistant", content: text || null, tool_calls: toolCalls });
        for (const call of toolCalls) {
          const tool = opts.tools.find((t) => t.name === call.function.name);
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || "{}");
          } catch {
            // malformed; the tool will say so
          }
          const step: Step = { id: call.id, label: tool ? tool.label(args) : `Tried: ${call.function.name}`, done: false };
          outcome.steps.push(step);
          send({ step });
          let result: string;
          if (!tool) result = `There is no tool called ${call.function.name}.`;
          else {
            // Recorded whether or not it works. A search that came back empty
            // or broken still counted against Brave's 2,000 a month, and a
            // dashboard that only counts the good ones reads low exactly when
            // something is wrong.
            const use: ToolUse = { tool: tool.name, host: tool.logHost?.(args) ?? null, ok: true, costUsd: 0, credits: 0 };
            outcome.toolUses.push(use);
            try {
              const out = await tool.run(env, args);
              result = out.result;
              outcome.toolCredits += out.credits;
              outcome.toolCostUsd += out.costUsd;
              use.credits = out.credits;
              use.costUsd = out.costUsd;
              use.ok = out.ok !== false;
              step.links = out.links;
            } catch (err) {
              use.ok = false;
              result = `The tool failed: ${(err as Error).message}`;
            }
          }
          step.done = true;
          send({ step });
          messages.push({ role: "tool", tool_call_id: call.id, content: result });
        }
      }
      try {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch {
        // already gone
      }
      resolveDone(outcome);
    },
  });
  return { stream, done };
}
