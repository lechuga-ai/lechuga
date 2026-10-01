import { useState, type FormEvent } from "react";
import { acceptTerms, type Me } from "../api";

type Props = { me: Me; onDone: () => void };

// The terms, asked for before anything else when the ones on record aren't
// the current text: for nearly everyone, because the terms changed. Rarely,
// because the account was made for someone and has just become their own
// (worker/src/seats.ts), in which case nobody has agreed for them yet.
export function AcceptTerms({ me, onDone }: Props) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = me.termsVersion !== null;

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
    <div className="home">
      <section className="home-hero">
        <img className="hero-logo" src="/lechuga_logo.png" alt="" />
        <h1 className="hero-title">
          Lechuga <span className="alpha" title="Early days: rough edges expected">alpha</span>
        </h1>
        <p className="hero-tag">{changed ? "the terms have changed." : "one thing before you go on."}</p>
        <div className="signin">
          <form className="signin-form" onSubmit={submit}>
            <p className="signin-lead">
              {changed
                ? "We've updated the terms and the privacy policy since you last agreed to them. Have a look, and tick the box to carry on."
                : "This account is yours now. Before you go on, please read the terms and the privacy policy and agree to them."}
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
      </section>
    </div>
  );
}
