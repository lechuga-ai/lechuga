import { useState, type FormEvent } from "react";
import { ApiError, type BotRoster, type Person, type Roster } from "../api";
import { Avatar } from "./Avatar";
import { appLink, copyText, seatLink } from "../copy";
import { SEAT_DOMAIN } from "../../../worker/src/seat-email";

// Sharing, as a setting with three levels, the same for a chat and a bot:
// only me; people I choose, by username or email, or a username and a code
// I make for someone without an email; everyone on Lechuga. The thing
// being shared is behind a small adapter (SharingTarget), so this one
// panel serves the chat's Share button, a bot's Share… and the Sharing
// section in Bot Manager.

type AnyRoster = Roster | BotRoster;

export type SharingTarget = {
  kind: "chat" | "bot";
  id: string;
  name: string;
  roster: AnyRoster;
  isPublic: boolean;
  // Whether Everyone is on offer here (not someone else's bot, not a
  // guarded bot, not a username-and-code account). The worker checks too.
  canPublic: boolean;
  // Why not, when it isn't; shown greyed under the option.
  publicReason?: string;
  add: (who: string, useInvite?: boolean) => Promise<{ roster?: AnyRoster; waitingFor?: string }>;
  remove: (userId: string) => Promise<{ roster?: AnyRoster }>;
  cancelPending: (pendingId: string) => Promise<{ roster?: AnyRoster }>;
  makePublic: () => Promise<void>;
  // Bots only: accounts for someone without an email.
  seats?: {
    create: (username: string) => Promise<{ roster: AnyRoster; seat: { username: string }; code: string }>;
    newCode: (userId: string) => Promise<{ username: string; code: string }>;
    remove: (userId: string) => Promise<{ roster?: AnyRoster }>;
    upgrade: (userId: string, email: string) => Promise<{ roster?: AnyRoster }>;
  };
  onRoster: (roster: AnyRoster) => void;
  onPublic: () => void;
};

type Level = "me" | "people" | "everyone";

export function SharingPanel({ target }: { target: SharingTarget }) {
  const t = target;
  const active = t.roster.members.filter((m) => !m.removed);
  const pending = t.roster.pending;
  const current: Level = t.isPublic ? "everyone" : active.length + pending.length > 0 ? "people" : "me";
  // The level being looked at; it becomes the real one when something is done.
  const [level, setLevel] = useState<Level>(current);
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [needsInvite, setNeedsInvite] = useState<{ email: string; remaining: number } | null>(null);
  // Someone without an email: the box, and what to hand over, shown once.
  const [seatBox, setSeatBox] = useState(false);
  const [seatUser, setSeatUser] = useState("");
  const [handOver, setHandOver] = useState<{ username: string; code: string } | null>(null);
  // A username-and-code account getting an email address.
  const [upgrading, setUpgrading] = useState<{ id: string; name: string } | null>(null);
  const [upgradeEmail, setUpgradeEmail] = useState("");

  const shown = t.isPublic ? "everyone" : level;
  const path = t.kind === "chat" ? `/c/${t.id}` : `/b/${t.id}`;

  async function run<T extends { roster?: AnyRoster; waitingFor?: string }>(action: () => Promise<T>, done?: string): Promise<T | null> {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const result = await action();
      if (result.roster) t.onRoster(result.roster);
      setNeedsInvite(null);
      setNote(result.waitingFor ? `Invite sent. It'll be waiting for ${result.waitingFor} when they sign in.` : (done ?? null));
      return result;
    } catch (err) {
      if (err instanceof ApiError && err.code === "needs_invite") {
        setNeedsInvite({ email: who.trim(), remaining: Number(err.body?.invitesRemaining ?? 0) });
      } else {
        setError((err as Error).message);
      }
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    const entered = who.trim();
    if (!entered || busy) return;
    if (await run(() => t.add(entered), `Shared with ${entered}.`)) setWho("");
  }

  async function onlyMe() {
    if (active.length + pending.length === 0) {
      setLevel("me");
      return;
    }
    if (!window.confirm(`Stop sharing ${t.name}? Everyone you've added loses sight of it. What they wrote stays.`)) return;
    setBusy(true);
    setError(null);
    try {
      for (const p of active) {
        const r = p.seat && t.seats ? await t.seats.remove(p.id) : await t.remove(p.id);
        if (r.roster) t.onRoster(r.roster);
      }
      for (const p of pending) {
        const r = await t.cancelPending(p.id);
        if (r.roster) t.onRoster(r.roster);
      }
      setLevel("me");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function goPublic() {
    setBusy(true);
    setError(null);
    try {
      await t.makePublic();
      t.onPublic();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function makeSeat(e: FormEvent) {
    e.preventDefault();
    const username = seatUser.trim().replace(/^@/, "");
    if (!username || !t.seats || busy) return;
    const made = await run(() => t.seats!.create(username));
    if (made) {
      setHandOver({ username: made.seat.username, code: made.code });
      setSeatUser("");
      setSeatBox(false);
    }
  }

  async function newCode(p: Person) {
    if (!t.seats || !window.confirm(`Hand ${p.name} a new code? The old one stops working, and any device signed in with it is signed out.`)) return;
    setBusy(true);
    setError(null);
    try {
      setHandOver(await t.seats.newCode(p.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function upgrade(e: FormEvent) {
    e.preventDefault();
    if (!upgrading || !t.seats || !upgradeEmail.trim() || busy) return;
    const whoName = upgrading.name;
    if (await run(() => t.seats!.upgrade(upgrading.id, upgradeEmail.trim()), `${whoName} is a full account now; we've emailed them.`)) {
      setUpgrading(null);
      setUpgradeEmail("");
    }
  }

  function removePerson(p: Person & { seat?: boolean }) {
    if (p.seat && t.seats) {
      if (
        window.confirm(
          `Remove ${p.name}? This deletes the account for good: they can't sign in again, and the username is released. Their chats with ${t.name} stay with you. There's no undo.`
        )
      ) {
        void run(() => t.seats!.remove(p.id), `${p.name} is gone.`);
      }
    } else {
      void run(() => t.remove(p.id), `${p.name} no longer has it. What they wrote stays.`);
    }
  }

  return (
    <div className="sharing">
      <div className="sharing-levels" role="radiogroup" aria-label="Who can see it">
        <label className={`sharing-level ${shown === "me" ? "on" : ""} ${t.isPublic ? "off" : ""}`}>
          <input type="radio" name={`sharing-${t.id}`} checked={shown === "me"} disabled={busy || t.isPublic} onChange={() => void onlyMe()} />
          <span>
            <b>Only me</b>
          </span>
        </label>

        <label className={`sharing-level ${shown === "people" ? "on" : ""} ${t.isPublic ? "off" : ""}`}>
          <input type="radio" name={`sharing-${t.id}`} checked={shown === "people"} disabled={busy || t.isPublic} onChange={() => setLevel("people")} />
          <span>
            <b>People I choose</b>
            <span className="sharing-why">
              {t.kind === "chat" ? "They see all of it and can keep it going. You pay." : "They get their own chats with it; you see every one. You pay."}
            </span>
          </span>
        </label>
        {shown === "people" && (
          <div className="sharing-people">
            {needsInvite ? (
              <div className="share-invite">
                <p>
                  <strong>{needsInvite.email}</strong> isn't on Lechuga yet.{" "}
                  {needsInvite.remaining > 0
                    ? `Use one of your ${needsInvite.remaining} ${needsInvite.remaining === 1 ? "invite" : "invites"} to bring them in?`
                    : "You'd need an invite to bring them in, and you have none left."}
                </p>
                <div className="modal-actions">
                  <button type="button" onClick={() => setNeedsInvite(null)} disabled={busy}>
                    Never mind
                  </button>
                  {needsInvite.remaining > 0 && (
                    <button type="button" className="primary" disabled={busy} onClick={() => void run(() => t.add(needsInvite.email, true)).then((r) => r && setWho(""))}>
                      {busy ? "inviting…" : "Use an invite"}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <form onSubmit={add} className="sharing-add">
                <input
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="@username or email"
                  value={who}
                  onChange={(e) => setWho(e.target.value)}
                  disabled={busy}
                  aria-label="Username or email"
                />
                <button type="submit" className="primary" disabled={busy || !who.trim()}>
                  {busy ? "…" : "add"}
                </button>
              </form>
            )}

            {(active.length > 0 || pending.length > 0) && (
              <ul className="share-people">
                {active.map((p) => (
                  <li key={p.id}>
                    <Avatar person={p} size={26} />
                    <span className="share-name">
                      {p.name}
                      {p.seat && <span className="share-state"> · username and code</span>}
                    </span>
                    {p.seat && p.username && (
                      <button type="button" className="signin-link" disabled={busy} title="Copy a link that signs them in and lands here" onClick={() => void copyText(seatLink(path, p.username!))}>
                        link
                      </button>
                    )}
                    {p.seat && t.seats && (
                      <>
                        <button type="button" className="signin-link" disabled={busy} onClick={() => void newCode(p)}>
                          new code
                        </button>
                        <button
                          type="button"
                          className="signin-link"
                          disabled={busy}
                          onClick={() => {
                            setError(null);
                            setUpgrading({ id: p.id, name: p.name });
                          }}
                        >
                          full account
                        </button>
                      </>
                    )}
                    <button type="button" className="signin-link" disabled={busy} onClick={() => removePerson(p)}>
                      remove
                    </button>
                  </li>
                ))}
                {pending.map((p) => (
                  <li key={p.id}>
                    <span className="avatar more" style={{ width: 26, height: 26, fontSize: 12 }}>
                      ?
                    </span>
                    <span className="share-name">{p.email}</span>
                    <span className="share-state">hasn't joined yet</span>
                    <button type="button" className="signin-link" disabled={busy} onClick={() => void run(() => t.cancelPending(p.id))}>
                      cancel
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {upgrading && t.seats && (
              <form onSubmit={upgrade} className="sharing-sub">
                <p>
                  Make {upgrading.name} a full account with their email address. They keep their username and chats, get their own credits and
                  invites, and the account stops being yours to answer for. We'll email them.
                </p>
                <div className="sharing-add">
                  <input type="email" autoFocus placeholder="their email address" value={upgradeEmail} onChange={(e) => setUpgradeEmail(e.target.value)} disabled={busy} />
                  <button type="submit" className="primary" disabled={busy || !upgradeEmail.trim()}>
                    {busy ? "…" : "make it theirs"}
                  </button>
                  <button type="button" className="signin-link" onClick={() => setUpgrading(null)} disabled={busy}>
                    cancel
                  </button>
                </div>
              </form>
            )}

            {t.seats && !seatBox && !upgrading && (
              <p className="sharing-offer">
                Someone without an email address?{" "}
                <button type="button" className="signin-link" disabled={busy} onClick={() => setSeatBox(true)}>
                  make them a username and a code
                </button>
              </p>
            )}
            {t.seats && seatBox && (
              <form onSubmit={makeSeat} className="sharing-sub">
                <p>
                  An account of its own, for this bot only: pick a username, and Lechuga gives you a code to hand over. What they say to {t.name} is
                  yours to read. Up to five.
                </p>
                <div className="sharing-add">
                  <input autoFocus placeholder="username" autoCapitalize="none" spellCheck={false} maxLength={20} value={seatUser} onChange={(e) => setSeatUser(e.target.value)} disabled={busy} />
                  <button type="submit" className="primary" disabled={busy || !seatUser.trim()}>
                    {busy ? "…" : "make"}
                  </button>
                  <button type="button" className="signin-link" onClick={() => setSeatBox(false)} disabled={busy}>
                    cancel
                  </button>
                </div>
              </form>
            )}
            {handOver && (
              <div className="bot-seat-code">
                <p className="bot-seat-pair">
                  <span>
                    username <b>{handOver.username}</b>
                  </span>
                  <span>
                    code <b>{handOver.code}</b>
                  </span>
                </p>
                <p>
                  Hand these over; the code is shown this once. They sign in with "I have a username and a code", or with this link, which fills the
                  username in:{" "}
                  <button type="button" className="signin-link" onClick={() => void copyText(seatLink(path, handOver.username))}>
                    copy link
                  </button>
                  . (Stored as {handOver.username}@{SEAT_DOMAIN}, an address that gets no mail.)
                </p>
                <button type="button" className="signin-link" onClick={() => setHandOver(null)}>
                  got it
                </button>
              </div>
            )}
          </div>
        )}

        <label className={`sharing-level ${shown === "everyone" ? "on" : ""} ${!t.canPublic && !t.isPublic ? "off" : ""}`}>
          <input
            type="radio"
            name={`sharing-${t.id}`}
            checked={shown === "everyone"}
            disabled={busy || t.isPublic || !t.canPublic}
            onChange={() => setLevel("everyone")}
          />
          <span>
            <b>Everyone on Lechuga</b>
            <span className="sharing-why">
              {t.isPublic
                ? "It's public: anyone can read it and join in, on Lechuga's credits."
                : !t.canPublic && t.publicReason
                  ? t.publicReason
                  : t.kind === "chat"
                    ? "Anyone can read it and join in. Lechuga pays. Can't be undone."
                    : "Anyone can chat with it, and every chat with it is public, yours so far included. Lechuga pays. Can't be undone."}
            </span>
          </span>
        </label>
        {shown === "everyone" && !t.isPublic && t.canPublic && (
          <div className="sharing-people">
            <button type="button" className="primary" onClick={() => void goPublic()} disabled={busy}>
              {busy ? "…" : `Make ${t.kind === "chat" ? "this chat" : t.name} public`}
            </button>
          </div>
        )}
        {t.isPublic && (
          <div className="sharing-people">
            <button type="button" className="signin-link" onClick={() => void copyText(appLink(path))}>
              copy the link
            </button>
          </div>
        )}
      </div>
      {note && <p className="modal-ok">{note}</p>}
      {error && <p className="modal-error">{error}</p>}
    </div>
  );
}

// The panel as a dialog.
export function SharingDialog({ target, onClose }: { target: SharingTarget; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal share-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{target.kind === "chat" ? "Sharing this chat" : `Sharing: ${target.name}`}</h2>
        <SharingPanel target={target} />
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
