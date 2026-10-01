import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import {
  addBotMember,
  cancelBotPendingShare,
  createSeat,
  deleteBot,
  deleteSeat,
  getBot,
  listModels,
  removeBotMember,
  resetSeatCode,
  saveBot,
  upgradeSeat,
  type Bot,
  type BotRoster,
  type Me,
  type Model,
} from "../api";
import { makeBotPublic } from "../api";
import { SharingPanel, type SharingTarget } from "./Sharing";
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

  const sharedWith = (bot.people?.length ?? 1) - 1;
  const modelLabel = models.find((m) => m.id === bot.model)?.label;
  const status = [
    bot.is_default === 1 ? "the one every account starts with" : null,
    modelLabel ? `on ${modelLabel}` : null,
    bot.guarded === 1 ? "guarded" : null,
    bot.visibility === "public" ? "public" : null,
    sharedWith > 0 ? `shared with ${sharedWith} ${sharedWith === 1 ? "person" : "people"}` : null,
  ].filter(Boolean);

  return (
    <section id={bot.id} className={`settings-panel bot-panel ${highlighted ? "highlighted" : ""}`}>
      <header className="bot-panel-head">
        <Avatar person={{ id: bot.id, name: bot.name, username: null, photo: null }} size={40} />
        <div>
          <h2 className="bot-panel-title">{bot.name}</h2>
          {status.length > 0 && <p className="bot-panel-status">{status.join(" · ")}</p>}
        </div>
      </header>
      <form className="settings-form bot-form" onSubmit={submit}>
        <div className="bot-form-row">
          <div>
            <label htmlFor={`bot-name-${bot.id}`}>Name</label>
            <input id={`bot-name-${bot.id}`} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </div>
          <div>
            <label htmlFor={`bot-model-${bot.id}`}>Model for new chats</label>
            <select id={`bot-model-${bot.id}`} className="settings-select" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
              <option value="">The default ({current[0]?.label ?? "…"})</option>
              {current.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label htmlFor={`bot-soul-${bot.id}`}>How it behaves</label>
        <textarea
          id={`bot-soul-${bot.id}`}
          value={soul}
          maxLength={SOUL_MAX}
          rows={7}
          placeholder="What it's for, what it focuses on, how it talks. For example: You help plan meals for a family of four on a budget. Short, practical answers; ask about allergies once."
          onChange={(e) => setSoul(e.target.value)}
          disabled={busy}
        />
        <p className="settings-count">
          Sent with every message to it. {soul.length.toLocaleString()} of {SOUL_MAX.toLocaleString()} characters.
        </p>
        <div className="bot-guard">
          <label className="settings-check">
            <input type="checkbox" checked={guarded} onChange={(e) => setGuarded(e.target.checked)} disabled={busy} />
            <span>
              <b>Guarded.</b> Suitable for a young person, whatever it's asked.
            </span>
          </label>
          <details className="bot-details">
            <summary>What guarded does</summary>
            <p>
              Every message is checked before the bot sees it. If someone brings up hurting themselves or others, or weapons, the bot stops, tells them
              to talk to a trusted adult, and emails you. Explicit requests are refused. Web search and page reading are off, and it always thinks
              before answering. It works alongside how it behaves above, and has the last word.
            </p>
          </details>
        </div>
        {error && <p className="modal-error">{error}</p>}
        <div className="modal-actions bot-form-actions">
          <button type="submit" className="primary" disabled={busy || !changed}>
            {busy ? "saving…" : "Save"}
          </button>
          {saved && !changed && <span className="settings-saved">Saved.</span>}
          {bot.is_default !== 1 && (
            <button type="button" className="signin-link bot-delete" onClick={remove} disabled={busy}>
              delete this bot
            </button>
          )}
        </div>
      </form>
      <details className="bot-details bot-sharing">
        <summary>Sharing{sharedWith > 0 ? ` · ${sharedWith} ${sharedWith === 1 ? "person" : "people"}` : ""}</summary>
        <BotShare bot={bot} onPeople={onPeople} onPublic={onSaved} />
      </details>
    </section>
  );
}

// A bot's sharing: the shared panel (Sharing.tsx) over the bot's roster,
// which is fetched here. onClose makes it a dialog (a title and a Done).
export function BotShare({
  bot,
  onPeople,
  onPublic,
  onClose,
}: {
  bot: Bot;
  onPeople: (people: Person[] | undefined) => void;
  onPublic?: (bot: Bot) => void;
  onClose?: () => void;
}) {
  const [roster, setRoster] = useState<BotRoster | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const target: SharingTarget | null = roster && {
    kind: "bot",
    id: bot.id,
    name: bot.name,
    roster,
    isPublic: bot.visibility === "public",
    canPublic: bot.guarded !== 1 && roster.members.filter((m) => !m.removed).length + roster.pending.length === 0,
    publicReason:
      bot.guarded === 1
        ? "A guarded bot can't be public."
        : roster.members.filter((m) => !m.removed).length + roster.pending.length > 0
          ? "Not while it's shared with people: that would publish their chats. Remove them first."
          : undefined,
    add: (who, useInvite) => addBotMember(bot.id, who, useInvite),
    remove: (userId) => removeBotMember(bot.id, userId),
    cancelPending: (id) => cancelBotPendingShare(bot.id, id),
    makePublic: async () => {
      const next = await makeBotPublic(bot.id);
      onPublic?.({ ...bot, ...next });
    },
    seats: {
      create: (username) => createSeat(bot.id, { username }),
      newCode: (userId) => resetSeatCode(bot.id, userId),
      remove: (userId) => deleteSeat(bot.id, userId),
      upgrade: (userId, email) => upgradeSeat(bot.id, userId, email),
    },
    onRoster: (r) => took(r as BotRoster),
    onPublic: () => {},
  };

  return (
    <>
      {onClose && <h2>Sharing: {bot.name}</h2>}
      {error && <p className="modal-error">{error}</p>}
      {target ? <SharingPanel target={target} /> : !error && <p className="settings-count">loading…</p>}
      {onClose && (
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </>
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
      <header className="bot-panel-head">
        <Avatar person={{ id: bot.id, name: bot.name, username: null, photo: null }} size={40} />
        <div>
          <h2 className="bot-panel-title">{bot.name}</h2>
          <p className="bot-panel-status">
            shared with you{roster ? ` by ${ownerName}` : ""}
            {bot.guarded === 1 ? " · guarded" : ""}
          </p>
        </div>
      </header>
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
      {/* A seat exists for this bot; the way out is the owner's. */}
      {!me.seat && (
        <div className="modal-actions">
          <button type="button" className="signin-link" onClick={leave} disabled={busy}>
            leave this bot
          </button>
        </div>
      )}
    </section>
  );
}
