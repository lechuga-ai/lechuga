import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { authClient } from "../auth";
import { getAuthConfig, lookupInvite, requestAccess, type AuthConfig } from "../api";

type View = "signin" | "sent" | "invite-only" | "requested";

type CardProps = {
  // Where Better Auth sends the user after the magic link or Google
  // callback completes and the session cookie is set.
  callbackURL: string;
  // From /invite/<token>: prefills the invited address.
  inviteToken?: string | null;
  // Open straight on the request-access form (the home page's "Request an
  // invite" button) instead of on sign-in.
  startOnRequest?: boolean;
  // Offered only when the card is an overlay on another page.
  onClose?: () => void;
};

const BLOCKED_MESSAGE =
  "the sign-in check couldn't load. An ad blocker or privacy extension may be blocking challenges.cloudflare.com; allow it for this site and reload.";

// The sign-in card: email field, Google, and the request-access form for
// people without an invite. One Turnstile widget serves both forms; it stays
// mounted at the bottom of the card while the forms above it swap. Used as an
// overlay on the home page and inside SignInScreen below.
export function SignInCard({ callbackURL, inviteToken = null, startOnRequest = false, onClose }: CardProps) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [view, setView] = useState<View>(startOnRequest ? "invite-only" : "signin");
  const [email, setEmail] = useState("");
  const [emailLocked, setEmailLocked] = useState(false);
  const [inviteNote, setInviteNote] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaBlocked, setCaptchaBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const widgetHost = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    getAuthConfig()
      .then(setConfig)
      .catch(() => setError("couldn't load the sign-in page, try refreshing"));

    // Coming back from a refused Google or magic-link sign-in: Better Auth
    // sends the browser to "/?error=...". Any error here means "not invited".
    const params = new URLSearchParams(window.location.search);
    if (params.get("error")) {
      setView("invite-only");
      window.history.replaceState(null, "", "/");
    }

    if (inviteToken) {
      lookupInvite(inviteToken)
        .then(({ email, state }) => {
          if (state === "pending") {
            setEmail(email);
            setEmailLocked(true);
            setInviteNote("You're invited. Sign in with this address to accept.");
          } else if (state === "accepted") {
            setEmail(email);
            setInviteNote("This invite was already used. If that was you, just sign in.");
          } else {
            setEmail(email);
            setInviteNote(state === "expired" ? "This invite has expired." : "This invite was withdrawn.");
            setView("invite-only");
          }
        })
        .catch(() => setInviteNote("That invite link isn't valid."));
    }
  }, [inviteToken]);

  // Turnstile's script loads asynchronously; poll briefly until it's there,
  // then render once. The token is sent as a header the worker checks.
  useEffect(() => {
    if (!config || !widgetHost.current || widgetId.current) return;
    let cancelled = false;
    const startedAt = Date.now();
    const render = () => {
      if (cancelled || !widgetHost.current) return;
      if (!window.turnstile) {
        if (Date.now() - startedAt > 6000) {
          setCaptchaBlocked(true);
          setError(BLOCKED_MESSAGE);
          return;
        }
        setTimeout(render, 100);
        return;
      }
      widgetId.current = window.turnstile.render(widgetHost.current, {
        sitekey: config.turnstileSiteKey,
        theme: "light",
        size: "flexible",
        callback: (token) => {
          setCaptcha(token);
          setError(null);
        },
        "expired-callback": () => setCaptcha(null),
        "error-callback": () => {
          setCaptcha(null);
          setError("the sign-in check failed; reload the page to try again.");
        },
      });
    };
    render();
    return () => {
      cancelled = true;
    };
  }, [config]);

  function resetCaptcha() {
    setCaptcha(null);
    window.turnstile?.reset(widgetId.current ?? undefined);
  }

  function needCaptcha(): string | null {
    if (captcha) return captcha;
    setError(captchaBlocked ? BLOCKED_MESSAGE : "one moment, the bot check hasn't finished");
    return null;
  }

  async function sendLink(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    const token = needCaptcha();
    if (!token) return;
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.signIn.magicLink({
      email: address,
      callbackURL,
      // A refused sign-in comes back to the home page, which reopens this
      // card on the invite-only view.
      errorCallbackURL: "/",
      fetchOptions: { headers: { "x-captcha-response": token } },
    });
    setBusy(false);
    resetCaptcha();
    if (err) {
      if (err.code === "INVITE_ONLY") {
        setView("invite-only");
        return;
      }
      setError(err.message || "couldn't send the link, try again");
      return;
    }
    setView("sent");
  }

  async function signInWithGoogle() {
    setError(null);
    const { error: err } = await authClient.signIn.social({ provider: "google", callbackURL, errorCallbackURL: "/" });
    if (err) setError(err.message || "Google sign-in didn't start");
  }

  async function submitRequest(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    const token = needCaptcha();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await requestAccess(address, reason, token);
      setView("requested");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      resetCaptcha();
    }
  }

  const showWidget = view === "signin" || view === "invite-only";

  return (
    <div className="signin">
      {onClose && (
        <button type="button" className="signin-close" onClick={onClose} aria-label="Close sign-in">
          ✕
        </button>
      )}
      {inviteNote && view !== "requested" && <p className="signin-invite-note">{inviteNote}</p>}

      {view === "sent" && (
        <div className="signin-sent">
          <p>
            Check <strong>{email.trim()}</strong> for a sign-in link from hello@lechuga.ai.
          </p>
          <p className="signin-hint">It works once and expires in 15 minutes. Look in spam if it's slow.</p>
          <button type="button" className="signin-link" onClick={() => setView("signin")}>
            use a different email
          </button>
        </div>
      )}

      {view === "requested" && (
        <div className="signin-sent">
          <p>
            Thanks, you're on the list. We'll write to <strong>{email.trim()}</strong> as soon as there's a spot for you.
          </p>
          <p className="signin-hint">
            Requests are handled by hand, not a filter, so it can take a day or so. Know someone who already uses
            Lechuga? They can invite you directly, and that's quicker.
          </p>
        </div>
      )}

      {view === "signin" && (
        <form className="signin-form" onSubmit={sendLink}>
          <label className="signin-label" htmlFor="signin-email">
            Sign in with your email
          </label>
          <div className="signin-row">
            <input
              id="signin-email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              value={email}
              readOnly={emailLocked}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
            <button type="submit" disabled={busy || !config || captchaBlocked}>
              {busy ? "sending…" : "send link"}
            </button>
          </div>
          {config?.googleSignIn && (
            <>
              <div className="signin-or">or</div>
              <button type="button" className="signin-google" onClick={signInWithGoogle}>
                Continue with Google
              </button>
            </>
          )}
          <p className="signin-hint">
            Lechuga is invite only.{" "}
            <button type="button" className="signin-link" onClick={() => setView("invite-only")}>
              request access
            </button>
          </p>
        </form>
      )}

      {view === "invite-only" && (
        <form className="signin-form" onSubmit={submitRequest}>
          <p className="signin-lead">
            Lechuga is invite only while it's small. Ask a friend who uses it, or leave your address and we'll
            get back to you.
          </p>
          <label className="signin-label" htmlFor="request-email">
            Your email
          </label>
          <input
            id="request-email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            className="signin-input"
          />
          <label className="signin-label" htmlFor="request-reason">
            What would you use it for? <span className="signin-optional">optional</span>
          </label>
          <textarea
            id="request-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            className="signin-input"
          />
          <div className="signin-row signin-actions">
            <button type="button" className="signin-google" onClick={() => setView("signin")} disabled={busy}>
              back to sign in
            </button>
            <button type="submit" disabled={busy || !config || captchaBlocked}>
              {busy ? "sending…" : "request access"}
            </button>
          </div>
        </form>
      )}

      <div className="signin-turnstile" ref={widgetHost} hidden={!showWidget} />
      {error && <p className="signin-error">{error}</p>}
    </div>
  );
}

// Full-page sign-in for someone who arrived signed out at a page that needs a
// session: a chat URL, /billing, or an invite link (then with the token). The
// wordmark leads back to the landing page; the card returns them to where
// they were headed once the session exists.
export function SignInScreen({ callbackURL, inviteToken = null }: { callbackURL: string; inviteToken?: string | null }) {
  return (
    <div className="home">
      <section className="home-hero">
        <Link className="signin-home" to="/">
          <img className="hero-logo" src="/lechuga_logo.png" alt="" />
          <h1 className="hero-title">
          Lechuga <span className="alpha" title="Early days: rough edges expected">alpha</span>
        </h1>
        </Link>
        <p className="hero-tag">Lechuga is lettuce in Spanish.</p>
        <SignInCard callbackURL={callbackURL} inviteToken={inviteToken} />
      </section>
    </div>
  );
}