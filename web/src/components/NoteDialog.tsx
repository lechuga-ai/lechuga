import { useState, type FormEvent } from "react";
import { sendNote, type NoteType } from "../api";

type Props = { onClose: () => void };

// "Send us a note": feedback or a support request, for signed-in people, from
// the Help page. Lands in the admin requests inbox with the sender's email
// and username.
export function NoteDialog({ onClose }: Props) {
  const [type, setType] = useState<NoteType>("feedback");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await sendNote(type, body.trim());
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>Send us a note</h2>
        {done ? (
          <>
            <p>Thanks. We'll reply by email if there's something to say.</p>
            <div className="modal-actions">
              <button type="button" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="note-type">This is</label>
            <select id="note-type" value={type} onChange={(e) => setType(e.target.value as NoteType)} disabled={busy}>
              <option value="feedback">feedback</option>
              <option value="support">a problem I need help with</option>
            </select>
            <label htmlFor="note-body">Your note</label>
            <textarea
              id="note-body"
              rows={5}
              maxLength={2000}
              autoFocus
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={busy}
            />
            {error && <p className="modal-error">{error}</p>}
            <div className="modal-actions">
              <button type="button" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={busy || !body.trim()}>
                {busy ? "sending…" : "Send"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
