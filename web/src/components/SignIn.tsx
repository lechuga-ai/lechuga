import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { authClient } from "../auth";
import { isInstalledApp } from "../installed";
import { NATIVE } from "../native";
import { getAuthConfig, lookupInvite, requestAccess, type AuthConfig } from "../api";
import { seatEmail } from "../../../worker/src/seat-email";

// sent: a link is on its way (browser). code: a code is, and there is a field
// for it (installed app). seat: a username and a code, for an account made
// for someone without an email (worker/src/seats.ts).
type View = "signin" | "sent" | "code" | "invite-only" | "requested" | "seat";

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

// Installed (home screen, Dock), the emailed link would open in the browser,
// which on iOS and macOS has its own cookies, and this copy would stay signed
// out. So installed copies are emailed a code to type here instead. Fixed for
// the life of the page: it can't change without a relaunch.
const INSTALLED = isInstalledApp();

// The sign-in card: email field, Google, and the request-access form for
// people without an invite. One Turnstile widget serves both forms; it stays
// mounted at the bottom of the card while the forms above it swap. Used as an
// overlay on the home page and inside SignInScreen below.
export function SignInCard({ callbackURL, inviteToken = null, startOnRequest = false, onClose }: CardProps) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [view, setView] = useState<View>(startOnRequest ? "invite-only" : "signin");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [seatName, setSeatName] = useState("");
  const [seatCode, setSeatCode] = useState("");
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
  // then render once. The token is sent as a header the worker checks. Not
  // in the native app: Turnstile only runs on http(s) pages and the app's
  // aren't, so the worker lets the app's origins through without it.
  useEffect(() => {
    if (NATIVE || !config || !widgetHost.current || widgetId.current) return;
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
        "error-callback": (code) => {
          setCaptcha(null);
          setError(`the sign-in check failed${code ? ` (code ${code})` : ""}; reload the page to try again.`);
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
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
  }

  // The token to send, or null when the form must wait. Inside the native
  // app there is no widget and the worker doesn't ask for a token, so "".
  function needCaptcha(): string | null {
    if (NATIVE) return "";
    if (captcha) return captcha;
    setError(captchaBlocked ? BLOCKED_MESSAGE : "one moment, the bot check hasn't finished");
    return null;
  }

  async function sendLink(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    const token = needCaptcha();
    if (token === null) return;
    setBusy(true);
    setError(null);
    const fetchOptions = { headers: { "x-captcha-response": token } };
    // Both paths go through the same invite gate and bot check on the worker.
    let err: { code?: string; message?: string } | null;
    try {
      ({ error: err } = INSTALLED
        ? await authClient.emailOtp.sendVerificationOtp({ email: address, type: "sign-in", fetchOptions })
        : await authClient.signIn.magicLink({
            email: address,
            callbackURL,
            // A refused sign-in comes back to the home page, which reopens
            // this card on the invite-only view.
            errorCallbackURL: "/",
            fetchOptions,
          }));
    } catch (thrown) {
      // Never leave the button on "sending…": say what went wrong instead.
      err = { message: (thrown as Error).message || String(thrown) };
    }
    setBusy(false);
    resetCaptcha();
    if (err) {
      if (err.code === "INVITE_ONLY") {
        setView("invite-only");
        return;
      }
      setError(err.message || `couldn't send the ${INSTALLED ? "code" : "link"}, try again`);
      return;
    }
    setCode("");
    setView(INSTALLED ? "code" : "sent");
  }

  // The installed copy's second step: the code from the email. On success the
  // session cookie is set, and a plain load of callbackURL lands signed in,
  // where the link would have.
  async function enterCode(e: FormEvent) {
    e.preventDefault();
    const otp = code.trim();
    if (otp.length < 6) return;
    setBusy(true);
    setError(null);
    let err: { code?: string; message?: string } | null;
    try {
      ({ error: err } = await authClient.signIn.emailOtp({ email: email.trim(), otp }));
    } catch (thrown) {
      err = { message: (thrown as Error).message || String(thrown) };
    }
    if (err) {
      setBusy(false);
      const messages: Record<string, string> = {
        INVALID_OTP: "that code isn't right; check the email and try again",
        OTP_EXPIRED: "that code has expired; send yourself a new one",
        TOO_MANY_ATTEMPTS: "too many tries; send yourself a new code",
      };
      setError(messages[err.code ?? ""] ?? err.message ?? "couldn't sign you in, try again");
      return;
    }
    window.location.assign(callbackURL);
  }

  // A seat's sign-in: the username as a made-up address, the code as the
  // password, through Better Auth's ordinary sign-in. Behind the bot check.
  async function signInSeat(e: FormEvent) {
    e.preventDefault();
    const username = seatName.trim().replace(/^@/, "");
    if (!username || !seatCode.trim()) return;
    const token = needCaptcha();
    if (token === null) return;
    setBusy(true);
    setError(null);
    let err: { code?: string; message?: string } | null;
    try {
      ({ error: err } = await authClient.signIn.email({
        email: seatEmail(username),
        password: seatCode.trim(),
        fetchOptions: { headers: { "x-captcha-response": token } },
      }));
    } catch (thrown) {
      err = { message: (thrown as Error).message || String(thrown) };
    }
    if (err) {
      setBusy(false);
      resetCaptcha();
      setError(err.code === "INVALID_EMAIL_OR_PASSWORD" ? "that username and code don't match" : err.message || "couldn't sign you in, try again");
      return;
    }
    window.location.assign(callbackURL);
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
    if (token === null) return;
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

  const showWidget = !NATIVE && (view === "signin" || view === "invite-only" || view === "seat");

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

      {view === "code" && (
        <form className="signin-form" onSubmit={enterCode}>
          <p className="signin-lead">
            Check <strong>{email.trim()}</strong> for a six-digit code from hello@lechuga.ai and type it here.
          </p>
          <label className="signin-label" htmlFor="signin-code">
            Code
          </label>
          <div className="signin-row">
            <input
              id="signin-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              disabled={busy}
              autoFocus
            />
            <button type="submit" disabled={busy || code.trim().length < 6}>
              {busy ? "checking…" : "sign in"}
            </button>
          </div>
          <p className="signin-hint">
            It works once and expires in 10 minutes. Look in spam if it's slow.{" "}
            <button
              type="button"
              className="signin-link"
              onClick={() => {
                setCode("");
                setError(null);
                setView("signin");
              }}
            >
              send another
            </button>
          </p>
        </form>
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
              {busy ? "sending…" : INSTALLED ? "send code" : "send link"}
            </button>
          </div>
          {/* Not in the native app yet: Google refuses its sign-in page inside
              an app's web view, so that needs Google's native SDK first. */}
          {config?.googleSignIn && !NATIVE && (
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
            {!NATIVE && (
              <>
                {" · "}
                <button type="button" className="signin-link" onClick={() => setView("seat")}>
                  I have a username and a code
                </button>
              </>
            )}
          </p>
        </form>
      )}

      {view === "seat" && (
        <form className="signin-form" onSubmit={signInSeat}>
          <p className="signin-lead">If someone set Lechuga up for you, they gave you a username and a code.</p>
          <label className="signin-label" htmlFor="seat-username">
            Username
          </label>
          <input
            id="seat-username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            placeholder="username"
            value={seatName}
            onChange={(e) => setSeatName(e.target.value)}
            disabled={busy}
            className="signin-input"
          />
          <label className="signin-label" htmlFor="seat-code">
            Code
          </label>
          <input
            id="seat-code"
            type="password"
            autoComplete="current-password"
            inputMode="numeric"
            required
            placeholder="the code"
            value={seatCode}
            onChange={(e) => setSeatCode(e.target.value)}
            disabled={busy}
            className="signin-input"
          />
          <div className="signin-row signin-actions">
            <button type="button" className="signin-google" onClick={() => setView("signin")} disabled={busy}>
              back
            </button>
            <button type="submit" disabled={busy || !config || captchaBlocked}>
              {busy ? "signing in…" : "sign in"}
            </button>
          </div>
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