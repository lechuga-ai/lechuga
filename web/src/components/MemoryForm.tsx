import { useEffect, useState, type FormEvent } from "react";
import { getMemory, saveMemory, type Memory } from "../api";
import config from "../../../worker/config.json";

const MAX = config.limits.memory_chars;

// Account > Memory: what Lechuga keeps about you across chats, in two
// boxes you can read and rewrite, a switch to stop it being used, and a way
// to forget the lot. The text is what goes into the model's instructions in
// your private chats, word for word, so what you see here is what it knows.
export function MemoryForm() {
  const [memory, setMemory] = useState<Memory | null>(null);
  const [notes, setNotes] = useState("");
  const [soul, setSoul] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [nightly, setNightly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMemory()
      .then((m) => {
        if (cancelled) return;
        setMemory(m);
        setNotes(m.notes);
        setSoul(m.soul);
        setEnabled(m.enabled);
        setNightly(m.nightly);
      })
      .catch((err) => !cancelled && setError((err as Error).message));
    return () => {
      cancelled = true;
    };
  }, []);

  const changed = memory !== null && (notes !== memory.notes || soul !== memory.soul || enabled !== memory.enabled || nightly !== memory.nightly);

  async function save(next: { notes: string; soul: string; enabled: boolean; nightly: boolean }) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const m = await saveMemory(next);
      setMemory(m);
      setNotes(m.notes);
      setSoul(m.soul);
      setEnabled(m.enabled);
      setNightly(m.nightly);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!changed || busy) return;
    void save({ notes, soul, enabled, nightly });
  }

  function forget() {
    if (!window.confirm("Forget everything Lechuga remembers about you? This can't be undone.")) return;
    void save({ notes: "", soul: "", enabled, nightly });
  }

  const empty = memory !== null && !memory.notes && !memory.soul;
  const when = memory?.updatedAt ? new Date(memory.updatedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null;

  return (
    <section className="settings-panel">
      <p>
        Lechuga can carry a little about you from one chat to the next: what you're working on, what you like, how you'd like it to answer. It's
        kept here in two short notes, which you can rewrite or wipe. They are sent with every message in your own chats, and never in a chat you've
        shared, so each costs a few credits a message while they're not empty.
      </p>
      <p>
        Four things write to them: pressing <b>Remember</b> in a chat, which has Lechuga fold that chat in; telling Lechuga in a chat to remember
        something; an overnight pass that reads the day's chats and keeps only what's clearly lasting, charged like one message; and you, here.
      </p>
      {memory === null ? (
        <p>{error ?? "loading…"}</p>
      ) : (
        <form className="settings-form" onSubmit={submit}>
          <label className="settings-check">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={busy} />
            Use what Lechuga remembers in my chats
          </label>
          <label className="settings-check">
            <input type="checkbox" checked={nightly} onChange={(e) => setNightly(e.target.checked)} disabled={busy || !enabled} />
            Learn from my chats overnight
            {memory.trainedAt && <span className="settings-check-note">last learned {new Date(memory.trainedAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })}</span>}
          </label>
          <label htmlFor="memory-notes">About you</label>
          <textarea
            id="memory-notes"
            value={notes}
            maxLength={MAX}
            rows={8}
            placeholder={empty ? "Nothing yet. Press Remember in a chat, or write something here: who you are, what you're working on, what you like." : ""}
            onChange={(e) => setNotes(e.target.value)}
            disabled={busy}
          />
          <p className="settings-count">
            {notes.length.toLocaleString()} of {MAX.toLocaleString()} characters
          </p>
          <label htmlFor="memory-soul">How Lechuga should talk to you</label>
          <textarea
            id="memory-soul"
            value={soul}
            maxLength={MAX}
            rows={5}
            placeholder={empty ? "Tone, length, format. For example: short answers, no bullet points, and tell me plainly when I'm wrong." : ""}
            onChange={(e) => setSoul(e.target.value)}
            disabled={busy}
          />
          <p className="settings-count">
            {soul.length.toLocaleString()} of {MAX.toLocaleString()} characters{when ? `. Last changed ${when}.` : ""}
          </p>
          {error && <p className="modal-error">{error}</p>}
          <div className="modal-actions">
            {saved && !changed && <span className="settings-saved">Saved.</span>}
            <button type="submit" className="primary" disabled={busy || !changed}>
              {busy ? "saving…" : "Save"}
            </button>
            {!empty && (
              <button type="button" className="signin-link" onClick={forget} disabled={busy}>
                forget everything
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
