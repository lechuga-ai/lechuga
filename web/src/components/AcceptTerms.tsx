import { useState, type FormEvent } from "react";
import { acceptTerms, type Me } from "../api";

type Props = { me: Me; onDone: () => void };

// The terms, asked for before anything else when the ones on record aren't
// the current text, or none are: an account that was made for someone and
// has just become their own (worker/src/seats.ts), or anyone after the
// terms change. The same page as the username step, with one thing on it.
export function AcceptTerms({ me, onDone }: Props) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!agreed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await acceptTerms();
      onDone();
    } catch (err) {
      setError((err as Error).message || "couldn't save that, try again");
      setBusy(false);
    }
  }

  return (
    <div className="app landing">
      <div className="chat-view">
        <div className="hero">
          <img className="hero-logo" src="/lechuga_logo.png" alt="" />
          <h1 className="hero-title">
            Lechuga <span className="alpha" title="Early days: rough edges expected">alpha</span>
          </h1>
          <p className="hero-tag">one thing before you go on.</p>
        </div>
        <div className="signin">
          <form className="signin-form" onSubmit={submit}>
            <p className="signin-lead">
              Hello{me.username ? `, @${me.username}` : ""}. This account is yours now, or the terms have changed since you last agreed to them.
              Either way, they need your own yes.
            </p>
            <label className="signin-agree">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={busy} />
              <span>
                I agree to the <a href="/terms" target="_blank" rel="noopener">terms</a> and the{" "}
                <a href="/privacy" target="_blank" rel="noopener">privacy policy</a>.
              </span>
            </label>
            {error && <p className="signin-error">{error}</p>}
            <div className="signin-row signin-actions">
              <button type="submit" disabled={busy || !agreed}>
                {busy ? "saving…" : "continue"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
