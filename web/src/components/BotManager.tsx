import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import {
  ApiError,
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
  type Bot,
  type BotRoster,
  type Me,
  type Model,
} from "../api";
import { SEAT_DOMAIN } from "../../../worker/src/seat-email";
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
        <BotShare bot={bot} onPeople={onPeople} />
      </details>
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
  // Three screens, one at a time: the share panel; the box for someone
  // without an email; and the username and code to hand over, shown once.
  const [mode, setMode] = useState<"share" | "seat" | "code">("share");
  const [seatUser, setSeatUser] = useState("");
  const [handOver, setHandOver] = useState<{ username: string; code: string } | null>(null);

  useEffect(() => {
    getBot(bot.id)
      .then((r) => setRoster(r.roster))
      .catch(() => setError("couldn't load who has this bot"));
  }, [bot.id]);

  async function addSeat(e: FormEvent) {
    e.preventDefault();
    const username = seatUser.trim().replace(/^@/, "");
    if (!username || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const made = await createSeat(bot.id, { username });
      took(made.roster);
      setHandOver({ username: made.seat.username, code: made.code });
      setSeatUser("");
      setMode("code");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function newCode(userId: string) {
    if (!window.confirm("Hand out a new code? The old one stops working, and any device signed in with it is signed out.")) return;
    setBusy(true);
    setError(null);
    try {
      setHandOver(await resetSeatCode(bot.id, userId));
      setMode("code");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

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

  if (mode === "code" && handOver) {
    return (
      <div className="bot-share">
        <h3 className="bot-share-title">Share {bot.name}</h3>
        <div className="bot-seat-code">
          <p>Hand these over. The code is shown this once; if it's lost, hand out a new one from the bot's sharing.</p>
          <p className="bot-seat-pair">
            <span>
              username <b>{handOver.username}</b>
            </span>
            <span>
              code <b>{handOver.code}</b>
            </span>
          </p>
          <p className="settings-count">
            They sign in at the usual place with "I have a username and a code". (It's stored as {handOver.username}@{SEAT_DOMAIN}, an address that gets
            no mail.)
          </p>
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="primary"
            onClick={() => {
              setHandOver(null);
              setMode("share");
            }}
          >
            Got it
          </button>
        </div>
      </div>
    );
  }

  if (mode === "seat") {
    return (
      <div className="bot-share">
        <h3 className="bot-share-title">Share {bot.name}</h3>
        <form onSubmit={addSeat} className="bot-seat-form">
          <p>
            For someone without an email address: an account of its own, for this bot only. Pick a username; Lechuga gives you a code to hand over,
            and they sign in with those. What they say to {bot.name} is yours to read, like any chat with a bot you share. It can't buy credits, make
            bots or be shared with. You can hand out a new code or delete it at any time.
          </p>
          <div className="bot-seat-fields">
            <input
              autoFocus
              placeholder="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={20}
              value={seatUser}
              onChange={(e) => setSeatUser(e.target.value)}
              disabled={busy}
            />
          </div>
          {error && <p className="modal-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={() => setMode("share")} disabled={busy}>
              Back
            </button>
            <button type="submit" className="primary" disabled={busy || !seatUser.trim()}>
              {busy ? "making…" : "Make the account"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="bot-share">
      <h3 className="bot-share-title">Share {bot.name}</h3>
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
      {!needsInvite && (
        <p className="bot-seat-offer">
          Someone without an email address?{" "}
          <button
            type="button"
            className="signin-link"
            onClick={() => {
              setError(null);
              setMode("seat");
            }}
            disabled={busy}
          >
            make them a username and a code
          </button>
        </p>
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
                {p.seat && <span className="share-state"> · username and code</span>}
              </span>
              {p.seat && (
                <button type="button" className="signin-link" disabled={busy} onClick={() => void newCode(p.id)}>
                  new code
                </button>
              )}
              <button
                type="button"
                className="signin-link"
                disabled={busy}
                onClick={() => {
                  if (p.seat) {
                    if (window.confirm(`Delete ${p.name}'s account? They won't be able to sign in. Their chats with ${bot.name} stay with you.`)) {
                      void run(() => deleteSeat(bot.id, p.id), `${p.name}'s account is gone.`);
                    }
                  } else {
                    void run(() => removeBotMember(bot.id, p.id), `${p.name} no longer has this bot. Their chats with it stay with you.`);
                  }
                }}
              >
                {p.seat ? "delete" : "remove"}
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
