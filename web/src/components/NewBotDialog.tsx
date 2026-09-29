import { useState, type FormEvent } from "react";
import { createBot, type Bot } from "../api";

type Props = { onCreated: (bot: Bot) => void; onClose: () => void };

// "New bot": one box, for a name. The name is the brief: the worker has the
// model draft a first soul from it (bots.ts), which takes a few seconds, and
// then the bot's page opens with the draft ready to rewrite.
export function NewBotDialog({ onCreated, onClose }: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await createBot(name.trim()));
    } catch (err) {
      setError((err as Error).message || "couldn't make the bot, try again");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New bot</h2>
        <p>Name it for what it's for. Lechuga writes a first draft of how it should behave from the name, which you can change on the next page.</p>
        <form onSubmit={submit}>
          <input
            autoFocus
            maxLength={40}
            value={name}
            placeholder="Penny Pincher, Holly Helpdesk, Sous Chef…"
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            aria-label="Bot name"
          />
          {error && <p className="modal-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy || !name.trim()}>
              {busy ? "thinking about the name…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
