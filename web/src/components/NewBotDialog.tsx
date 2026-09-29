import { useState, type FormEvent } from "react";
import { createBot, type Bot } from "../api";

type Props = { onCreated: (bot: Bot) => void; onClose: () => void };

// "New bot": one question, its name. The name is the brief: the worker has
// the model draft what the bot is for and how it talks from it (bots.ts),
// which takes a few seconds and can be rewritten in Bot Manager.
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
        <p>
          A bot is like an assistant. Pretend you're hiring someone for one particular job: planning meals, helping with homework, keeping an eye
          on what you spend. What is that job? Name the bot for it.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="new-bot-name">What would you like to name your new bot?</label>
          <input
            id="new-bot-name"
            autoFocus
            maxLength={40}
            value={name}
            placeholder="Penny Pincher, Sous Chef, Homework Helper…"
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
          {error && <p className="modal-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy || !name.trim()}>
              {busy ? "creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
