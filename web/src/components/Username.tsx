import { useEffect, useState, type FormEvent } from "react";
import { checkUsername, setUsername } from "../api";
import { checkUsernameFormat } from "../../../worker/src/username";

type Props = { onDone: (username: string) => void };

// First sign-in: choose a username, once. Format rules are checked as you
// type (shared code with the worker); availability is asked of the server
// after a short pause. The server has the final say on submit.
export function Username({ onDone }: Props) {
  const [value, setValue] = useState("");
  const [hint, setHint] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = value.trim();
    if (!raw) {
      setHint(null);
      return;
    }
    const format = checkUsernameFormat(raw);
    if (!format.ok) {
      setHint({ ok: false, text: format.reason });
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      checkUsername(format.username)
        .then((r) => !cancelled && setHint(r.available ? { ok: true, text: "available" } : { ok: false, text: r.reason ?? "taken" }))
        .catch(() => !cancelled && setHint(null));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const format = checkUsernameFormat(value);
    if (!format.ok) {
      setError(format.reason);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { username } = await setUsername(format.username, agreed);
      onDone(username);
    } catch (err) {
      setError((err as Error).message);
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
          <p className="hero-tag">welcome. pick a name.</p>
        </div>
        <div className="signin">
          <form className="signin-form" onSubmit={submit}>
            <label className="signin-label" htmlFor="username">
              Your username
            </label>
            <input
              id="username"
              className="signin-input"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="lettuce_fan"
              value={value}
              onChange={(e) => setValue(e.target.value.toLowerCase())}
              disabled={busy}
            />
            <p className={`signin-hint ${hint ? (hint.ok ? "ok" : "bad") : ""}`}>
              {hint?.text ?? "4 to 20 characters: lowercase letters, numbers, underscores; starts with a letter."}
            </p>
            <p className="signin-hint">It can't be changed later, so pick one you'll keep.</p>
            <label className="signin-agree">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={busy} />
              <span>
                I agree to the <a href="/terms" target="_blank" rel="noopener">terms</a> and the{" "}
                <a href="/privacy" target="_blank" rel="noopener">privacy policy</a>.
              </span>
            </label>
            {error && <p className="signin-error">{error}</p>}
            {/* Last, under the checkbox it waits for. */}
            <div className="signin-row signin-actions">
              <button type="submit" disabled={busy || !hint?.ok || !agreed}>
                {busy ? "saving…" : "that's me"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
