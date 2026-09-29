import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { SideNavPage, type NavGroup } from "../components/SideNavPage";
import { deleteBot, getBot, listBots, listModels, saveBot, type Bot, type Model } from "../api";
import config from "../../../worker/config.json";

const SOUL_MAX = config.limits.memory_chars;

// /bots/:id: one bot's name, the model its new chats start on, and its soul,
// the instructions it's given about what it's for and how it talks. The
// other bots are the table of contents down the left, so this doubles as
// the place to look them all over.
export function BotPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [bots, setBots] = useState<Bot[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [bot, setBot] = useState<Bot | null>(null);
  const [name, setName] = useState("");
  const [model, setModel] = useState<string>("");
  const [soul, setSoul] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    listBots().then(setBots).catch(() => setBots([]));
    listModels().then(setModels).catch(() => setModels([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setBot(null);
    setError(null);
    setSaved(false);
    getBot(id)
      .then((b) => {
        if (cancelled) return;
        setBot(b);
        setName(b.name);
        setModel(b.model ?? "");
        setSoul(b.soul);
      })
      .catch(() => !cancelled && setError("that bot isn't here"));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const nav: NavGroup[] = bots.map((b) => ({ to: `/bots/${b.id}`, label: b.name }));
  const changed = bot !== null && (name.trim() !== bot.name || soul !== bot.soul || (model || null) !== bot.model);
  const current = models.filter((m) => !m.retired);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!bot || !changed || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await saveBot(bot.id, { name: name.trim(), soul, model: model || null });
      setBot(next);
      setName(next.name);
      setSoul(next.soul);
      setModel(next.model ?? "");
      setBots((prev) => prev.map((b) => (b.id === next.id ? next : b)));
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!bot || !window.confirm(`Delete ${bot.name}? Its chats stay, and move to Seed.`)) return;
    setBusy(true);
    try {
      const { movedTo } = await deleteBot(bot.id);
      navigate(`/bots/${movedTo}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <SideNavPage title={bot?.name ?? "Bot"} nav={nav.length > 0 ? nav : [{ to: `/bots/${id}`, label: "Bot" }]} navLabel="Your bots">
      <section className="settings-panel">
        {bot === null ? (
          <p>{error ?? "loading…"}</p>
        ) : (
          <>
            <p>
              {bot.is_default
                ? "Seed is the bot every account starts with, and where a deleted bot's chats go. What you write below is how it behaves in every chat with it."
                : "What you write below is how this bot behaves in every chat with it. The draft came from its name; rewrite it as you like."}
            </p>
            <form className="settings-form" onSubmit={submit}>
              <label htmlFor="bot-name">Name</label>
              <input id="bot-name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
              <label htmlFor="bot-model">Model for new chats</label>
              <select id="bot-model" className="settings-select" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
                <option value="">The default ({current[0]?.label ?? "…"})</option>
                {current.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className="settings-count">A chat keeps the model it was started on; you can still pick another for any one chat.</p>
              <label htmlFor="bot-soul">How it should behave</label>
              <textarea
                id="bot-soul"
                value={soul}
                maxLength={SOUL_MAX}
                rows={10}
                placeholder="What it's for, what it focuses on, how it talks. For example: You help plan meals for a family of four on a budget. Short, practical answers; ask about allergies once."
                onChange={(e) => setSoul(e.target.value)}
                disabled={busy}
              />
              <p className="settings-count">
                {soul.length.toLocaleString()} of {SOUL_MAX.toLocaleString()} characters. Sent with every message to this bot, so it costs a little while it's not empty.
              </p>
              {error && <p className="modal-error">{error}</p>}
              <div className="modal-actions">
                {saved && !changed && <span className="settings-saved">Saved.</span>}
                <button type="submit" className="primary" disabled={busy || !changed}>
                  {busy ? "saving…" : "Save"}
                </button>
                {!bot.is_default && (
                  <button type="button" className="signin-link" onClick={remove} disabled={busy}>
                    delete this bot
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </section>
    </SideNavPage>
  );
}
