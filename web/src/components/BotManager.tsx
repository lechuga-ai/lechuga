import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { deleteBot, listModels, saveBot, type Bot, type Model } from "../api";
import { Avatar } from "./Avatar";
import config from "../../../worker/config.json";

const SOUL_MAX = config.limits.memory_chars;

type Props = { bots: Bot[]; onBotsChange: (bots: Bot[]) => void };

// Account > Bot Manager: every bot on one page, a section each, with the
// nav down the left listing them. Arriving with #<bot id> (the three-dots
// menu in a chat) scrolls to that bot and marks it.
export function BotManager({ bots, onBotsChange }: Props) {
  const { hash } = useLocation();
  const [models, setModels] = useState<Model[]>([]);
  const focus = hash.slice(1);

  useEffect(() => {
    listModels().then(setModels).catch(() => setModels([]));
  }, []);

  // The bots arrive after the page does, so the router's own scroll-to-hash
  // (SideNavPage) has nothing to find; do it once they're here.
  useEffect(() => {
    if (!focus || bots.length === 0) return;
    document.getElementById(focus)?.scrollIntoView({ block: "start" });
  }, [focus, bots.length]);

  if (bots.length === 0) return <p>loading…</p>;
  return (
    <>
      <p className="settings-lead">
        Each of your bots, and what makes it what it is: its name, the model its new chats start on, and how it behaves, which is sent with every
        message to it. Make a new one from the list on the left of your chats.
      </p>
      {bots.map((bot) => (
        <BotPanel
          key={bot.id}
          bot={bot}
          models={models}
          highlighted={bot.id === focus}
          onSaved={(next) => onBotsChange(bots.map((b) => (b.id === next.id ? next : b)))}
          onDeleted={() => onBotsChange(bots.filter((b) => b.id !== bot.id))}
        />
      ))}
    </>
  );
}

type PanelProps = { bot: Bot; models: Model[]; highlighted: boolean; onSaved: (bot: Bot) => void; onDeleted: () => void };

function BotPanel({ bot, models, highlighted, onSaved, onDeleted }: PanelProps) {
  const [name, setName] = useState(bot.name);
  const [model, setModel] = useState(bot.model ?? "");
  const [soul, setSoul] = useState(bot.soul);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const changed = name.trim() !== bot.name || soul !== bot.soul || (model || null) !== bot.model;
  const current = models.filter((m) => !m.retired);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!changed || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await saveBot(bot.id, { name: name.trim(), soul, model: model || null });
      onSaved(next);
      setName(next.name);
      setSoul(next.soul);
      setModel(next.model ?? "");
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete ${bot.name}? Its chats stay, and move to Seed.`)) return;
    setBusy(true);
    try {
      await deleteBot(bot.id);
      onDeleted();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <section id={bot.id} className={`settings-panel bot-panel ${highlighted ? "highlighted" : ""}`}>
      <h2 className="bot-panel-title">
        <Avatar person={{ id: bot.id, name: bot.name, username: null, photo: null }} size={26} />
        {bot.name}
        {bot.is_default === 1 && <span className="bot-panel-note">the one every account starts with</span>}
      </h2>
      <form className="settings-form" onSubmit={submit}>
        <label htmlFor={`bot-name-${bot.id}`}>Name</label>
        <input id={`bot-name-${bot.id}`} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        <label htmlFor={`bot-model-${bot.id}`}>Model for new chats</label>
        <select id={`bot-model-${bot.id}`} className="settings-select" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
          <option value="">The default ({current[0]?.label ?? "…"})</option>
          {current.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <p className="settings-count">A chat keeps the model it was started on; you can still pick another for any one chat.</p>
        <label htmlFor={`bot-soul-${bot.id}`}>How it behaves</label>
        <textarea
          id={`bot-soul-${bot.id}`}
          value={soul}
          maxLength={SOUL_MAX}
          rows={8}
          placeholder="What it's for, what it focuses on, how it talks. For example: You help plan meals for a family of four on a budget. Short, practical answers; ask about allergies once."
          onChange={(e) => setSoul(e.target.value)}
          disabled={busy}
        />
        <p className="settings-count">
          {soul.length.toLocaleString()} of {SOUL_MAX.toLocaleString()} characters.
        </p>
        {error && <p className="modal-error">{error}</p>}
        <div className="modal-actions">
          {saved && !changed && <span className="settings-saved">Saved.</span>}
          <button type="submit" className="primary" disabled={busy || !changed}>
            {busy ? "saving…" : "Save"}
          </button>
          {bot.is_default !== 1 && (
            <button type="button" className="signin-link" onClick={remove} disabled={busy}>
              delete this bot
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
