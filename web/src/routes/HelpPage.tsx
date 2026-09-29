import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { getAuthConfig, sendFeedback, type Me } from "../api";
import { NoteDialog } from "../components/NoteDialog";
import { SideNavPage } from "../components/SideNavPage";
import { HELP_NAV } from "./GettingStartedPage";

const FAQS: { q: string; a: ReactNode }[] = [
  {
    q: "Is Lechuga free?",
    a: (
      <>
        The home page's one free chat a day needs no account. Beyond that you buy credits or subscribe;{" "}
        <Link to="/welcome#what-it-costs">What it costs</Link> has the numbers, and the section after it shows where the
        money goes.
      </>
    ),
  },
  {
    q: "Which model should I use?",
    a: "GLM 5.3 Flash, the default, is right for nearly everything. The ? beside the model's name, under the box you type in, explains each one and what effort means.",
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

// /help: FAQs, a short how-to, and a way to reach us, with Getting started
// with AI as the other page in its nav. Reachable signed in or out. Signed out, that's the public Turnstile-checked feedback form (see
// worker/src/requests.ts); signed in, it's "Send us a note" (NoteDialog),
// tied to the account and without a captcha. `me` comes from Root, which
// already has it loaded before routing here; Visitor leaves it unset.
type Props = { me?: Me };

export function HelpPage({ me }: Props) {
  const [noteOpen, setNoteOpen] = useState(false);
  return (
    <SideNavPage title="Help" nav={HELP_NAV}>
      <p>
        New to chat models, or want to get more out of this one?{" "}
        <Link to="/help/getting-started">Getting started with AI</Link> covers how they work, where they go wrong, what
        not to type in, and how to spend fewer credits.
      </p>

      <section id="questions" className="help-section">
        <h2 className="help-section-title">Questions</h2>
        <dl className="help-faq">
          {FAQS.map(({ q, a }) => (
            <div key={q}>
              <dt>{q}</dt>
              <dd>{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="how-to" className="help-section">
        <h2 className="help-section-title">How to use it</h2>
        <ol className="help-steps">
          <li>Type in the box and send. That's the whole interface.</li>
          <li>Your past chats are on the left; click one to go back to it, or start a new one any time.</li>
          <li>Drag a file onto the page (a PDF, a document, a spreadsheet, code, or a picture if you're on GLM 5.3 Flash), or paste in something long, and it becomes a card attached to your message.</li>
          <li>Next to the model is how hard it should think. Low is quick and cheap; high is slower and better on hard problems. The ? beside them explains both.</li>
          <li>Pick a model under the box before you start a chat. A chat keeps the model it started with.</li>
          <li>The box above your chats searches them: type a word or two and the list shows the chats that mention them.</li>
          <li>Your credit balance is in the sidebar. To buy more or manage a subscription, choose Account from the menu behind your name, then Credits.</li>
          <li>Your name and photo are under Account too. <Link to="/welcome">About Lechuga</Link>, in the list on the left, is what this is and who made it.</li>
          <li>Invite a friend from the menu behind your name.</li>
          <li>
            Delete your account at the foot of the <Link to="/settings/credits">credits page</Link>.
          </li>
        </ol>
      </section>

      <section id="install" className="help-section">
        <h2 className="help-section-title">On your phone or desktop</h2>
        <p>
          Lechuga can sit on your home screen or in your Dock like any other app. There's nothing to download from a
          store: it's the same site, the same account and the same chats, in a window of its own.
        </p>
        <dl className="help-faq">
          <div>
            <dt>iPhone and iPad</dt>
            <dd>Open lechuga.ai in Safari, tap the share button, then Add to Home Screen.</dd>
          </div>
          <div>
            <dt>Mac</dt>
            <dd>In Safari, choose Add to Dock from the File menu. In Chrome, click the install icon at the right end of the address bar.</dd>
          </div>
          <div>
            <dt>Android</dt>
            <dd>Open lechuga.ai in Chrome, open its menu, and choose Install app (on some phones it says Add to Home screen).</dd>
          </div>
          <div>
            <dt>Signing in there</dt>
            <dd>The installed app emails you a six-digit code instead of a link, because a link would open in the browser, and the browser and the app don't share a sign-in.</dd>
          </div>
        </dl>
      </section>

      <section id="feedback" className="help-section">
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
      </section>
    </SideNavPage>
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
