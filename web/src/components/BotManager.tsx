import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { ApiError, addBotMember, cancelBotPendingShare, deleteBot, getBot, listModels, removeBotMember, saveBot, type Bot, type BotRoster, type Me, type Model } from "../api";
import { Avatar } from "./Avatar";
import type { Person } from "../api";
import config from "../../../worker/config.json";

const SOUL_MAX = config.limits.memory_chars;

type Props = { me: Me; bots: Bot[]; onBotsChange: (bots: Bot[]) => void };

// Account > Bot Manager: every bot on one page, a section each, with the
// nav down the left listing them. Arriving with #<bot id> (the three-dots
// menu in a chat) scrolls to that bot and marks it.
export function BotManager({ me, bots, onBotsChange }: Props) {
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
        Each of your bots, and what makes it what it is: its name, the model its new chats start on, how it behaves, which is sent with every
        message to it, and who you've shared it with. Make a new one from the list on the left of your chats.
      </p>
      {bots.map((bot) =>
        bot.role === "owner" ? (
          <BotPanel
            key={bot.id}
            bot={bot}
            models={models}
            highlighted={bot.id === focus}
            onSaved={(next) => onBotsChange(bots.map((b) => (b.id === next.id ? { ...b, ...next } : b)))}
            onDeleted={() => onBotsChange(bots.filter((b) => b.id !== bot.id))}
            onPeople={(people) => onBotsChange(bots.map((b) => (b.id === bot.id ? { ...b, people } : b)))}
          />
        ) : (
          <SharedBotPanel key={bot.id} me={me} bot={bot} highlighted={bot.id === focus} onLeft={() => onBotsChange(bots.filter((b) => b.id !== bot.id))} />
        )
      )}
    </>
  );
}

type PanelProps = {
  bot: Bot;
  models: Model[];
  highlighted: boolean;
  onSaved: (bot: Bot) => void;
  onDeleted: () => void;
  // The faces in the sidebar follow who's in it.
  onPeople: (people: Person[] | undefined) => void;
};

function BotPanel({ bot, models, highlighted, onSaved, onDeleted, onPeople }: PanelProps) {
  const [name, setName] = useState(bot.name);
  const [model, setModel] = useState(bot.model ?? "");
  const [soul, setSoul] = useState(bot.soul);
  const [guarded, setGuarded] = useState(bot.guarded === 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const changed = name.trim() !== bot.name || soul !== bot.soul || (model || null) !== bot.model || guarded !== (bot.guarded === 1);
  const current = models.filter((m) => !m.retired);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!changed || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await saveBot(bot.id, { name: name.trim(), soul, model: model || null, guarded });
      onSaved(next);
      setName(next.name);
      setSoul(next.soul);
      setModel(next.model ?? "");
      setGuarded(next.guarded === 1);
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
        <label className="settings-check bot-guard-check">
          <input type="checkbox" checked={guarded} onChange={(e) => setGuarded(e.target.checked)} disabled={busy} />
          <span>
            <b>Guarded.</b> Keeps everything it says suitable for a young person, whatever it's asked and however it's asked. Every message is checked
            first: if someone brings up hurting themselves or others, or weapons, it stops, tells them to talk to a trusted adult, and emails you.
            Explicit requests are refused. Web search is off, and it always thinks before answering. Works alongside how it behaves above; this has the
            last word.
          </span>
        </label>
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
      <BotShare bot={bot} onPeople={onPeople} />
    </section>
  );
}

// Who else has the bot. The owner adds people by username or email and
// takes them out again; what sharing a bot means is spelled out, since it's
// their credits and they'll be reading.
export function BotShare({ bot, onPeople }: { bot: Bot; onPeople: (people: Person[] | undefined) => void }) {
  const [roster, setRoster] = useState<BotRoster | null>(null);
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [needsInvite, setNeedsInvite] = useState<{ email: string; remaining: number } | null>(null);

  useEffect(() => {
    getBot(bot.id)
      .then((r) => setRoster(r.roster))
      .catch(() => setError("couldn't load who has this bot"));
  }, [bot.id]);

  function took(r: BotRoster) {
    setRoster(r);
    const active = r.members.filter((m) => !m.removed);
    onPeople(active.length > 0 ? [r.owner, ...active] : undefined);
  }

  async function run(action: () => Promise<{ roster?: BotRoster; waitingFor?: string }>, success?: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await action();
      if (result.roster) took(result.roster);
      setNeedsInvite(null);
      setDone(result.waitingFor ? `Invite sent. The bot will be waiting for ${result.waitingFor} when they sign in.` : (success ?? null));
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === "needs_invite") {
        setNeedsInvite({ email: who.trim(), remaining: Number(err.body?.invitesRemaining ?? 0) });
      } else {
        setError((err as Error).message);
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    const entered = who.trim();
    if (!entered || busy) return;
    if (await run(() => addBotMember(bot.id, entered), `Shared with ${entered}.`)) setWho("");
  }

  const active = roster?.members.filter((m) => !m.removed) ?? [];
  const removed = roster?.members.filter((m) => m.removed) ?? [];

  return (
    <div className="bot-share">
      <h3>Share {bot.name}</h3>
      <ul className="share-terms">
        <li>
          <strong>They get their own chats with it.</strong> It shows up in their list, and they talk to it like you do.
        </li>
        <li>
          <strong>You see every chat they have with it.</strong> They're told that on the bot, and in each chat.
        </li>
        <li>
          <strong>You pay for it.</strong> Every reply in those chats comes out of your credits.
        </li>
      </ul>
      {needsInvite ? (
        <div className="share-invite">
          <p>
            <strong>{needsInvite.email}</strong> isn't on Lechuga yet.{" "}
            {needsInvite.remaining > 0
              ? `Use one of your ${needsInvite.remaining} ${needsInvite.remaining === 1 ? "invite" : "invites"} to bring them in? The bot will be waiting when they sign in.`
              : "You'd need an invite to bring them in, and you have none left."}
          </p>
          <div className="modal-actions">
            <button type="button" onClick={() => setNeedsInvite(null)} disabled={busy}>
              Never mind
            </button>
            {needsInvite.remaining > 0 && (
              <button type="button" className="primary" onClick={() => void run(() => addBotMember(bot.id, needsInvite.email, true)).then((ok) => ok && setWho(""))} disabled={busy}>
                {busy ? "inviting…" : "Use an invite"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={add} className="modal-form">
          <input autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="@username or email" value={who} onChange={(e) => setWho(e.target.value)} disabled={busy} />
          <button type="submit" className="primary" disabled={busy || !who.trim()}>
            {busy ? "sharing…" : "share"}
          </button>
        </form>
      )}
      {done && <p className="modal-ok">{done}</p>}
      {error && <p className="modal-error">{error}</p>}
      {roster && (active.length > 0 || roster.pending.length > 0 || removed.length > 0) && (
        <ul className="share-people">
          {active.map((p) => (
            <li key={p.id}>
              <Avatar person={p} size={28} />
              <span className="share-name">
                {p.name}
                {p.username && p.name !== `@${p.username}` && <span className="share-handle"> @{p.username}</span>}
              </span>
              <button
                type="button"
                className="signin-link"
                disabled={busy}
                onClick={() => void run(() => removeBotMember(bot.id, p.id), `${p.name} no longer has this bot. Their chats with it stay with you.`)}
              >
                remove
              </button>
            </li>
          ))}
          {roster.pending.map((p) => (
            <li key={p.id}>
              <span className="avatar more" style={{ width: 28, height: 28, fontSize: 13 }}>
                ?
              </span>
              <span className="share-name">{p.email}</span>
              <span className="share-state">hasn't joined yet</span>
              <button type="button" className="signin-link" disabled={busy} onClick={() => void run(() => cancelBotPendingShare(bot.id, p.id))}>
                cancel
              </button>
            </li>
          ))}
          {removed.map((p) => (
            <li key={p.id} className="removed">
              <Avatar person={p} size={28} />
              <span className="share-name">{p.name}</span>
              <span className="share-state">removed</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// A bot someone shared with me: whose it is, what it's been told to be, and
// the way out. Nothing here can be changed; that's the owner's.
function SharedBotPanel({ me, bot, highlighted, onLeft }: { me: Me; bot: Bot; highlighted: boolean; onLeft: () => void }) {
  const [roster, setRoster] = useState<BotRoster | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBot(bot.id)
      .then((r) => setRoster(r.roster))
      .catch(() => setError("couldn't load this bot"));
  }, [bot.id]);

  async function leave() {
    if (!window.confirm(`Leave ${bot.name}? It disappears from your list. Your chats with it stay with its owner.`)) return;
    setBusy(true);
    try {
      await removeBotMember(bot.id, me.id);
      onLeft();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const ownerName = roster?.owner.name ?? "its owner";
  return (
    <section id={bot.id} className={`settings-panel bot-panel ${highlighted ? "highlighted" : ""}`}>
      <h2 className="bot-panel-title">
        <Avatar person={{ id: bot.id, name: bot.name, username: null, photo: null }} size={26} />
        {bot.name}
        <span className="bot-panel-note">shared with you{roster ? ` by ${ownerName}` : ""}</span>
      </h2>
      <p>
        {ownerName} can read every chat you have with {bot.name}, and can join in. The replies come out of their credits, not yours. Nothing you tell
        it is kept about you.
      </p>
      {bot.guarded === 1 && (
        <p>
          <b>This bot is guarded.</b> It keeps everything suitable for a young person, can't search the web, and if a message brings up hurting
          yourself or others, or weapons, it will tell you to talk to a trusted adult and let {ownerName} know.
        </p>
      )}
      {bot.soul && (
        <>
          <p className="settings-count">How {ownerName} has told it to behave:</p>
          <blockquote className="bot-soul-quote">{bot.soul}</blockquote>
        </>
      )}
      {error && <p className="modal-error">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="signin-link" onClick={leave} disabled={busy}>
          leave this bot
        </button>
      </div>
    </section>
  );
}
