import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Message, Model, Person, Step } from "../api";
import { Avatar } from "./Avatar";
import { randomEmptyLine } from "../emptyLine";
import { splitMessage } from "../../../worker/src/attachments";
import { Chiclet } from "./Composer";
import { isSummary, summaryText } from "../../../worker/src/summary";

type Props = {
  messages: Message[];
  streamingText: string | null;
  streamingReasoning: string;
  streamingSteps?: Step[];
  // For the model's label on each reply's cost line.
  models: Model[];
  // In a chat that's been shared: everyone who has typed in it, so each
  // person's messages can carry their name. Null in a chat that's only mine.
  people?: Map<string, Person> | null;
  ownerId?: string;
  meId?: string;
};

// Markdown folds a single newline into a space, which flattens poems and
// lyrics. Turn lone newlines into hard breaks, leaving code blocks alone.
function keepLineBreaks(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/([^\n])\n(?!\n)/g, "$1  \n")))
    .join("");
}

// Reasoning arrives as rough markdown. The preview shows it as plain prose, so
// strip the symbols rather than render them.
function plainText(text: string): string {
  return text.replace(/[*_`#>]+/g, "").replace(/\s*\n\s*/g, " ");
}

// The tail of the text, starting on a whole word.
function tail(text: string, chars: number): string {
  return text.length <= chars ? text : text.slice(-chars).replace(/^\S*\s/, "");
}

function useElapsedSeconds(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const t = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running]);
  return seconds;
}

// What the model looked up on the way to its answer: one line per search or
// page, with the pages it found as links. A step still running has a pulse.
function Steps({ steps }: { steps: Step[] }) {
  return (
    <ul className="steps">
      {steps.map((st) => (
        <li key={st.id} className={`step ${st.done ? "done" : "running"}`}>
          {!st.done && <span className="pulse" />}
          <span className="step-label">{st.label}</span>
          {st.links && st.links.length > 0 && (
            <span className="step-links">
              {st.links.slice(0, 6).map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noopener" title={l.title}>
                  {hostOf(l.url)}
                </a>
              ))}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// The model's reasoning. Finished, it's a closed toggle. Live, it shows how
// long it's been going and a few lines of the latest text in a fixed-height
// window, so there's something to read without the page jumping around.
// Opened, it shows the whole text either way.
function Reasoning({ text, live, writing = false }: { text: string; live: boolean; writing?: boolean }) {
  const [open, setOpen] = useState(false);
  const seconds = useElapsedSeconds(live && !writing);
  const label = !live ? "reasoned" : writing ? `reasoned for ${seconds}s` : `reasoning · ${seconds}s`;
  return (
    <div className={`reasoning ${open ? "open" : ""}`}>
      <div className="reasoning-head">
        {live && <span className="pulse" />}
        <button type="button" className="reasoning-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="reasoning-caret">{open ? "▾" : "▸"}</span>
          {label}
        </button>
      </div>
      {open ? (
        <div className="reasoning-text">{text}</div>
      ) : (
        live && !writing && <div className="reasoning-peek">{tail(plainText(text), 400)}</div>
      )}
    </div>
  );
}

const METER_KEY = "lechuga.meter";

// The receipt under a reply: what went in, what came out, what it cost. The
// numbers are the stored ones, so this line and the ledger row always agree.
function Meter({ message, models }: { message: Message; models: Model[] }) {
  if (message.credits == null) return null;
  const label = models.find((m) => m.id === message.model)?.label ?? message.model ?? "";
  return (
    <div className="meter">
      {message.credits.toLocaleString()} {message.credits === 1 ? "credit" : "credits"}
      {label && ` · ${label}`}
    </div>
  );
}

// What the person sent: their attachments as chiclets (click one to read it),
// then what they typed.
function UserTurn({ content }: { content: string }) {
  const { attachments, typed } = splitMessage(content);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (attachments.length === 0) return <>{content}</>;
  return (
    <>
      <div className="chiclets sent">
        {attachments.map((a, i) => (
          <Chiclet key={i} attachment={a} open={openIndex === i} onOpen={() => setOpenIndex(openIndex === i ? null : i)} />
        ))}
      </div>
      {openIndex !== null &&
        (attachments[openIndex].image ? (
          <img className="chiclet-full-image" src={attachments[openIndex].text} alt={attachments[openIndex].name} />
        ) : (
          <pre className="chiclet-full">{attachments[openIndex].text}</pre>
        ))}
      {typed}
    </>
  );
}

// In a shared chat, who typed this. A turn with no user_id is from before
// the chat was shared, when only its owner could type.
function Author({ message, people, ownerId, meId }: { message: Message; people: Map<string, Person>; ownerId?: string; meId?: string }) {
  const id = message.user_id ?? ownerId ?? "";
  const person = people.get(id) ?? { id, name: "someone who left", username: null, photo: null };
  return (
    <div className="message-author">
      <Avatar person={person} size={18} owner={id === ownerId} />
      {id === meId ? "you" : person.name}
    </div>
  );
}

export function MessageList({ messages, streamingText, streamingReasoning, streamingSteps = [], models, people = null, ownerId, meId }: Props) {
  // New pick whenever the message list is swapped (new or different chat), stable while typing.
  const emptyLine = useMemo(randomEmptyLine, [messages]);
  // Costs show by default; the choice to hide them is remembered per browser.
  const [showMeter, setShowMeter] = useState(() => localStorage.getItem(METER_KEY) !== "off");
  const chatTotal = messages.reduce((n, m) => n + (m.credits ?? 0), 0);

  function toggleMeter() {
    setShowMeter((v) => {
      localStorage.setItem(METER_KEY, v ? "off" : "on");
      return !v;
    });
  }

  if (messages.length === 0 && streamingText === null) {
    return <div className="empty-state">{emptyLine}</div>;
  }

  const searching = streamingSteps.some((st) => !st.done);
  const status = searching ? "looking things up" : streamingText ? "writing" : streamingReasoning ? "reasoning" : "thinking";

  return (
    <div className="messages">
      {chatTotal > 0 && (
        <div className="chat-total">
          {showMeter && <span>this chat so far: {chatTotal.toLocaleString()} credits</span>}
          <button type="button" onClick={toggleMeter}>
            {showMeter ? "hide costs" : "show costs"}
          </button>
        </div>
      )}
      {messages.map((m) =>
        m.role === "assistant" && isSummary(m.content) ? (
          // Where the chat was compacted: what's above stays to read, but
          // from here on the model works from this summary.
          <div key={m.id} className="chat-summary">
            <div className="chat-summary-rule">
              <span>chat compacted here</span>
            </div>
            <p>
              From this point Lechuga works from a summary of everything above, and no longer re-reads it (or any files in
              it) with each message.
              {showMeter && m.credits != null && ` Writing it cost ${m.credits.toLocaleString()} credits.`}
            </p>
            <details>
              <summary>read the summary</summary>
              <ReactMarkdown>{keepLineBreaks(summaryText(m.content))}</ReactMarkdown>
            </details>
          </div>
        ) : (
        <div key={m.id} className={`message ${m.role} ${m.role === "user" && people ? ((m.user_id ?? ownerId) === meId ? "by-name" : "by-name theirs") : ""}`}>
          {m.role === "user" && people && <Author message={m} people={people} ownerId={ownerId} meId={meId} />}
          {m.reasoning && <Reasoning text={m.reasoning} live={false} />}
          {m.steps && <Steps steps={m.steps} />}
          {m.role === "assistant" ? <ReactMarkdown>{keepLineBreaks(m.content)}</ReactMarkdown> : <UserTurn content={m.content} />}
          {m.error && (
            <div className="message-error">
              {m.error}
              {m.errorCode === "out_of_credits" && (
                <>
                  {" "}
                  <a href="/billing">Get more credits</a>
                </>
              )}
            </div>
          )}
          {showMeter && m.role === "assistant" && <Meter message={m} models={models} />}
        </div>
        )
      )}
      {streamingText !== null && (
        <div className="message assistant">
          {streamingReasoning ? (
            <Reasoning text={streamingReasoning} live writing={Boolean(streamingText)} />
          ) : null}
          {streamingSteps.length > 0 && <Steps steps={streamingSteps} />}
          {!streamingReasoning && (
            <div className="breadcrumb">
              <span className="pulse" />
              {status}
            </div>
          )}
          {streamingText && (
            <div className="streaming-text">
              <ReactMarkdown>{keepLineBreaks(streamingText)}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
