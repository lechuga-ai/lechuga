import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { getAuthConfig, sendFeedback, type Me } from "../api";
import { NoteDialog } from "../components/NoteDialog";
import { SiteFooter } from "../components/SiteFooter";

const FAQS: { q: string; a: ReactNode }[] = [
  {
    q: "Is Lechuga free?",
    a: "The home page's one free chat a day needs no account. Beyond that you buy credits or subscribe; see \"Pricing transparency\" for the breakdown.",
  },
  {
    q: "Which model should I use?",
    a: "GLM 5.3 Flash, the default, is right for nearly everything. The composer has a \"which model?\" guide that compares them.",
  },
  {
    q: "Do my chats train the models?",
    a: "No. They're stored so you can come back to them, never used to train anything, and never sold. See the Privacy page for the full detail.",
  },
  {
    q: "How do I get an account?",
    a: (
      <>
        Lechuga is invite only while it's small. Ask someone who already has an account, or{" "}
        <Link to="/">request an invite</Link> from the home page.
      </>
    ),
  },
  {
    q: "Can I get a refund?",
    a: "Credits aren't refundable as a rule, but we try to be fair if something went wrong — write in below or to hello@lechuga.ai.",
  },
];

// /help: FAQs, a short how-to, and a way to reach us. Reachable signed in or
// out. Signed out, that's the public Turnstile-checked feedback form (see
// worker/src/requests.ts); signed in, it's "Send us a note" (NoteDialog),
// tied to the account and without a captcha. `me` comes from Root, which
// already has it loaded before routing here; Visitor leaves it unset.
type Props = { me?: Me };

export function HelpPage({ me }: Props) {
  const [noteOpen, setNoteOpen] = useState(false);
  return (
    <div className="doc-page">
      <div className="doc-inner">
        <Link className="doc-brand" to="/">
          <span className="logo">
            <img src="/lechuga_logo.png" alt="" />
          </span>
          Lechuga
        </Link>
        <h1>Help</h1>

        <p>
          New to chat models, or want to get more out of this one? <Link to="/tips">Tips + tricks</Link> covers how they
          work, where they go wrong, what not to type in, and how to spend fewer credits.
        </p>

        <h2 className="help-section-title">FAQs</h2>
        <dl className="help-faq">
          {FAQS.map(({ q, a }) => (
            <div key={q}>
              <dt>{q}</dt>
              <dd>{a}</dd>
            </div>
          ))}
        </dl>

        <h2 className="help-section-title">How to use it</h2>
        <ol className="help-steps">
          <li>Type in the box and send. That's the whole interface.</li>
          <li>Your past chats are on the left; click one to go back to it, or start a new one any time.</li>
          <li>Drag a file onto the page (a PDF, a document, a spreadsheet, code, or a picture if you're on GLM 5.3 Flash), or paste in something long, and it becomes a card attached to your message.</li>
          <li>Next to the model is how hard it should think. Low is quick and cheap; high is slower and better on hard problems.</li>
          <li>Pick a model under the box before you start a chat. A chat keeps the model it started with.</li>
          <li>Your credit balance is in the sidebar; click it to buy more or manage a subscription.</li>
          <li>Invite a friend from the menu behind your name.</li>
          <li>
            Delete your account at the foot of the <a href="/billing">credits page</a>.
          </li>
        </ol>

        <h2 className="help-section-title">Feedback</h2>
        <p>Something wrong, confusing, or worth telling us? This goes straight to us, not a form that vanishes.</p>
        {me ? (
          <>
            <button type="button" className="help-feedback-btn" onClick={() => setNoteOpen(true)}>
              Send us a note…
            </button>
            {noteOpen && createPortal(<NoteDialog onClose={() => setNoteOpen(false)} />, document.body)}
          </>
        ) : (
          <FeedbackForm />
        )}
      </div>
      <SiteFooter />
    </div>
  );
}

function FeedbackForm() {
  const [email, setEmail] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const widgetHost = useRef<HTMLDivElement>(null);

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

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await turnstileToken();
      await sendFeedback(body.trim(), email.trim(), token);
      setDone(true);
    } catch (err) {
      setError((err as Error).message || "couldn't send that, try again");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <p className="help-feedback-done">Thanks. If you left an email and there's something to say back, we will.</p>;
  }

  return (
    <form className="help-feedback" onSubmit={submit}>
      <label htmlFor="feedback-email">
        Your email <span className="help-optional">optional, only if you'd like a reply</span>
      </label>
      <input
        id="feedback-email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={busy}
      />
      <label htmlFor="feedback-body">What's on your mind</label>
      <textarea
        id="feedback-body"
        rows={4}
        maxLength={2000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={busy}
      />
      <div ref={widgetHost} />
      {error && <p className="help-feedback-error">{error}</p>}
      <button type="submit" disabled={busy || !body.trim()}>
        {busy ? "sending…" : "Send feedback"}
      </button>
    </form>
  );
}
