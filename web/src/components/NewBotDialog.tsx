import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { createBot, getBot, saveBot, type Bot } from "../api";
import { Avatar } from "./Avatar";

type Props = {
  // The bot exists (and again as its draft and settings arrive): for the list.
  onCreated: (bot: Bot) => void;
  // Start chatting: the bot's start page.
  onStart: (bot: Bot) => void;
  onClose: () => void;
};

// How long to keep asking for the draft before giving up quietly.
const DRAFT_TRIES = 15;

// "New bot": one question, its name. Then the bot itself, right away, with
// how it behaves written in by the model a few seconds later (bots.ts
// drafts it in the background), a Guarded switch, and where to tune it.
export function NewBotDialog({ onCreated, onStart, onClose }: Props) {
  const [name, setName] = useState("");
  const [bot, setBot] = useState<Bot | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const made = await createBot(name.trim());
      setBot(made);
      setDrafting(made.drafting);
      onCreated(made);
    } catch (err) {
      setError((err as Error).message || "couldn't make the bot, try again");
    } finally {
      setBusy(false);
    }
  }

  // The draft: ask every couple of seconds until the soul is there.
  useEffect(() => {
    if (!bot || !drafting) return;
    let tries = 0;
    let cancelled = false;
    const timer = setInterval(async () => {
      tries++;
      try {
        const { bot: fresh } = await getBot(bot.id);
        if (cancelled) return;
        if (fresh.soul || tries >= DRAFT_TRIES) {
          setDrafting(false);
          if (fresh.soul) {
            setBot((cur) => (cur ? { ...cur, soul: fresh.soul } : cur));
            onCreated({ ...bot, soul: fresh.soul });
          }
        }
      } catch {
        // ask again
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot?.id, drafting]);

  async function setGuarded(on: boolean) {
    if (!bot) return;
    setBusy(true);
    setError(null);
    try {
      const next = await saveBot(bot.id, { guarded: on });
      setBot((cur) => (cur ? { ...cur, guarded: next.guarded } : cur));
      onCreated({ ...bot, guarded: next.guarded });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal new-bot-modal" onClick={(e) => e.stopPropagation()}>
        {bot === null ? (
          <>
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
          </>
        ) : (
          <>
            <h2 className="new-bot-title">
              <Avatar person={{ id: bot.id, name: bot.name, username: null, photo: null }} size={30} />
              {bot.name} is ready
            </h2>
            <p className="new-bot-soul-label">How it behaves, worked out from the name:</p>
            {bot.soul ? (
              <blockquote className="bot-soul-quote">{bot.soul}</blockquote>
            ) : (
              <p className="new-bot-drafting">{drafting ? "writing…" : "Nothing came of the name. Write it yourself in Bot Manager."}</p>
            )}
            <label className="settings-check new-bot-guard">
              <input type="checkbox" checked={bot.guarded === 1} onChange={(e) => void setGuarded(e.target.checked)} disabled={busy} />
              <span>
                <b>Guarded.</b> Suitable for a young person whatever it's asked; messages about hurting oneself or others get a trusted-adult reply and
                an email to you.
              </span>
            </label>
            <p className="new-bot-tune">
              Rewrite how it behaves, pick its model, or share it in{" "}
              <Link to={`/settings/bots#${bot.id}`} onClick={onClose}>
                Bot Manager
              </Link>
              .
            </p>
            {error && <p className="modal-error">{error}</p>}
            <div className="modal-actions">
              <button type="button" onClick={onClose} disabled={busy}>
                Close
              </button>
              <button type="button" className="primary" onClick={() => onStart(bot)} disabled={busy}>
                Start chatting
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
