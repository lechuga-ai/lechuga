import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MessageList } from "../components/MessageList";
import { Copyright } from "../components/SiteFooter";
import { ApiError, getAuthConfig, sendTrialMessage, type Message, type Model } from "../api";
import { readTrial, saveTrial, takeTrialMessage } from "../startMessage";

type Props = {
  models: Model[];
  onSignIn: () => void;
  onRequestInvite: () => void;
};

function message(role: "user" | "assistant", content: string, extra: Partial<Message> = {}): Message {
  return { id: crypto.randomUUID(), chat_id: "trial", role, content, prompt_tokens: null, completion_tokens: null, created_at: Date.now(), ...extra };
}

// /try: the home page's one free chat, in the app's chat look but with no
// account behind it. The message arrives from the home page in memory; the
// bot check runs here, the reply streams, and then the box is replaced by an
// invitation to carry on with an account. Reloading, or coming back later,
// shows the finished conversation again rather than starting a new one.
export function TrialPage({ models, onSignIn, onRequestInvite }: Props) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [checking, setChecking] = useState(false);
  const [done, setDone] = useState(false);
  const widgetHost = useRef<HTMLDivElement>(null);
  // StrictMode runs effects twice; the message must only be taken once.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const content = takeTrialMessage();
    const saved = readTrial();
    if (!content) {
      // Nothing to send: show the earlier trial, or go back to the home page.
      if (saved) {
        setMessages([message("user", saved.question), message("assistant", saved.answer)]);
        setDone(true);
      } else {
        navigate("/", { replace: true });
      }
      return;
    }

    setMessages([message("user", content)]);
    setChecking(true);
    void start(content);
  }, []);

  // The bot check, then the one request. Turnstile's script loads
  // asynchronously, so wait for it briefly.
  async function start(content: string) {
    let token: string;
    try {
      token = await turnstileToken();
    } catch (err) {
      finish(content, "", (err as Error).message);
      return;
    }
    setChecking(false);
    setStreamingText("");

    let full = "";
    let reasoning = "";
    let failure: string | null = null;
    try {
      await sendTrialMessage(content, token, {
        onDelta: (delta) => {
          full += delta;
          setStreamingText(full);
        },
        onReasoning: (r) => {
          reasoning += r;
          setStreamingReasoning(reasoning);
        },
      });
    } catch (err) {
      // trial_used and trials_full read fine as they are; the invitation
      // below them is the way forward either way.
      failure = err instanceof ApiError ? err.message : (err as Error).message || "something went wrong";
    }
    finish(content, full, failure, reasoning);
  }

  function finish(question: string, answer: string, failure: string | null, reasoning = "") {
    setChecking(false);
    setStreamingText(null);
    setStreamingReasoning("");
    setMessages((prev) => [
      ...prev,
      message("assistant", answer, { reasoning: reasoning.trim() || undefined, error: failure ?? undefined }),
    ]);
    if (answer && !failure) saveTrial(question, answer);
    setDone(true);
  }

  async function turnstileToken(): Promise<string> {
    const { turnstileSiteKey } = await getAuthConfig();
    const startedAt = Date.now();
    while (!window.turnstile) {
      if (Date.now() - startedAt > 6000) {
        throw new Error("the bot check couldn't load. An ad blocker may be blocking challenges.cloudflare.com; allow it and reload.");
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return new Promise((resolve, reject) => {
      window.turnstile!.render(widgetHost.current!, {
        sitekey: turnstileSiteKey,
        theme: "light",
        size: "flexible",
        callback: resolve,
        "error-callback": () => reject(new Error("the bot check failed; reload the page to try again.")),
      });
    });
  }

  return (
    <div className="chat-view trial">
      <Link className="trial-brand" to="/">
        <span className="logo">
          <img src="/lechuga_logo.png" alt="" />
        </span>
        Lechuga <span className="alpha" title="Early days: rough edges expected">alpha</span>
      </Link>
      <MessageList messages={messages} streamingText={streamingText} streamingReasoning={streamingReasoning} models={models} />
      <div className="trial-check" hidden={!checking}>
        <p>One moment: checking you're a person.</p>
        <div ref={widgetHost} />
      </div>
      {done && (
        <div className="trial-next">
          <h2>Want to keep going?</h2>
          <p>
            That was your free chat. Lechuga is invite only while it's small: ask a friend who uses it, or request an
            invite. Once you're in you pick your username, this conversation comes with you, and you get some credits
            to start.
          </p>
          <div className="trial-next-actions">
            <button type="button" className="primary" onClick={onRequestInvite}>
              Request an invite
            </button>
            <button type="button" onClick={onSignIn}>
              I have an account
            </button>
          </div>
        </div>
      )}
      <Copyright className="trial-copyright" />
    </div>
  );
}
