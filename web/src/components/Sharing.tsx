import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError, makePrivate, sendPublicPointer, type BotRoster, type Person, type Roster } from "../api";
import { Avatar } from "./Avatar";
import { appLink, copyText, seatLink } from "../copy";
import { SEAT_DOMAIN } from "../../../worker/src/seat-email";

// Sharing, as a setting with three levels, the same for a chat and a bot:
// only me; people I choose, by username or email, or a username and a code
// I make for someone without an email; everyone on Lechuga. Picking a
// level shows what it means and who it affects; nothing changes until
// Done, which asks once. Adding or removing a person happens at once, and
// anything that takes access away asks first, inside the dialog. A public
// chat keeps its people: they're the ones who write in it, so they're
// shown and editable under Everyone too. The thing
// being shared is behind a small adapter (SharingTarget), so this one
// panel serves the chat's Share button, a bot's Share… and the Sharing
// section in Bot Manager.

type AnyRoster = Roster | BotRoster;
type Member = Person & { removed: boolean; seat?: boolean };

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
  // Accounts for someone without an email. On a bot they live in it; on a
  // chat they live in the chat's bot and get the chat.
  seats?: {
    create: (username: string) => Promise<{ roster?: AnyRoster; seat: { username: string }; code: string }>;
    newCode: (userId: string) => Promise<{ username: string; code: string }>;
    remove: (userId: string) => Promise<{ roster?: AnyRoster }>;
    upgrade: (userId: string, email: string) => Promise<{ roster?: AnyRoster }>;
  };
  onRoster: (roster: AnyRoster) => void;
  onPublic: () => void;
  onPrivate: () => void;
};

type Level = "me" | "people" | "everyone";
type Confirm = { title: string; body: ReactNode; button: string; action: () => Promise<void> };

export function SharingPanel({ target: t, onClose }: { target: SharingTarget; onClose?: () => void }) {
  const active = t.roster.members.filter((m) => !m.removed) as Member[];
  const pending = t.roster.pending;
  const current: Level = t.isPublic ? "everyone" : active.length + pending.length > 0 ? "people" : "me";
  const [level, setLevel] = useState<Level>(current);
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [needsInvite, setNeedsInvite] = useState<{ email: string; remaining: number } | null>(null);
  const [seatBox, setSeatBox] = useState(false);
  const [seatUser, setSeatUser] = useState("");
  const [handOver, setHandOver] = useState<{ username: string; code: string } | null>(null);
  const [upgrading, setUpgrading] = useState<Member | null>(null);
  const [upgradeEmail, setUpgradeEmail] = useState("");
  const [tell, setTell] = useState("");
  const [copied, setCopied] = useState(false);
  // The question being asked before something that takes access away.
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const path = t.kind === "chat" ? `/c/${t.id}` : `/b/${t.id}`;
  const thing = t.kind === "chat" ? "this chat" : t.name;
  const juniors = active.filter((m) => m.seat);
  const others = active.filter((m) => !m.seat);
  const count = active.length + pending.length;

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

  async function upgrade(e: FormEvent) {
    e.preventDefault();
    if (!upgrading || !t.seats || !upgradeEmail.trim() || busy) return;
    const name = upgrading.name;
    if (await run(() => t.seats!.upgrade(upgrading.id, upgradeEmail.trim()), `${name} is a full account now; we've emailed them.`)) {
      setUpgrading(null);
      setUpgradeEmail("");
    }
  }

  async function sendPointer(e: FormEvent) {
    e.preventDefault();
    const entered = tell.trim();
    if (!entered || busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await sendPublicPointer(t.kind, t.id, entered);
      setNote(`Sent to ${r.sentTo}.`);
      setTell("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // The questions.
  function askRemove(p: Member) {
    setConfirm(
      p.seat
        ? {
            title: `Remove ${p.name}?`,
            body: (
              <p>
                This deletes their account for good: they can't sign in again, and the username is released for anyone to take. Their chats stay with
                you. There's no undo.
              </p>
            ),
            button: "Remove and delete the account",
            action: async () => {
              await run(() => t.seats!.remove(p.id), `${p.name} is gone.`);
            },
          }
        : {
            title: `Remove ${p.name}?`,
            body: <p>They lose sight of {thing}. What they wrote stays, under their name.</p>,
            button: "Remove",
            action: async () => {
              await run(() => t.remove(p.id), `${p.name} no longer has ${thing}.`);
            },
          }
    );
  }

  function askNewCode(p: Member) {
    setConfirm({
      title: `A new code for ${p.name}?`,
      body: <p>The old code stops working, and any device signed in with it is signed out. You'll see the new code once, to hand over.</p>,
      button: "New code",
      action: async () => {
        setHandOver(await t.seats!.newCode(p.id));
      },
    });
  }

  // Done: apply the chosen level if it isn't the current one, asking first.
  function done() {
    if (level === current || (level === "people" && current === "me")) {
      onClose?.();
      return;
    }
    if (level === "everyone") {
      setConfirm({
        title: `Make ${thing} public?`,
        body:
          t.kind === "chat" ? (
            <ul className="sharing-rules">
              <li>Anyone on Lechuga can read all of it, from the first message.</li>
              <li>Only you and the people you've shared it with can write in it. You can add or remove people while it's public.</li>
              <li>Your name is on it, and so is everyone's who writes in it.</li>
              <li>The replies come out of Lechuga's credits, not yours.</li>
              <li>You can make it private again; the people you've shared it with keep it.</li>
            </ul>
          ) : (
            <ul className="sharing-rules">
              <li>Anyone on Lechuga can find it and chat with it.</li>
              <li>Every chat with it becomes public: the ones you've had so far, and every one from now on.</li>
              <li>Its replies come out of Lechuga's credits from now on.</li>
              <li>You can make it private again; people who started chats with it keep those, as people you've shared it with.</li>
            </ul>
          ),
        button: "Make it public",
        action: async () => {
          await t.makePublic();
          t.onPublic();
          onClose?.();
        },
      });
      return;
    }
    // Back to "People I choose" from public, or to "Only me" from either.
    const fromPublic = t.isPublic;
    const toPeople = level === "people";
    const lose = count === 1 ? "The person below loses" : "The people below lose";
    const losing = fromPublic
      ? t.kind === "chat"
        ? `Everyone on Lechuga stops being able to read it, and you pay for it from here. ${
            toPeople ? (count > 0 ? "The people below keep it." : "") : count > 0 ? `${lose} sight of it too. What they wrote stays.` : "What anyone wrote stays."
          }`.trim()
        : `${t.name} and every chat with it stop being everyone's. People who started chats with it keep those chats, as people you've shared the bot with, and you pay for those from here; you can remove them afterwards.`
      : `${count === 1 ? "This person loses" : "These people lose"} sight of ${thing}. What they wrote stays.${juniors.length > 0 ? " A username-and-code account is deleted for good, and its username released." : ""}`;
    // The people go when the choice is Only me; a bot's don't (it has none
    // while public, and the people its chats came from are kept on purpose).
    const dropPeople = !toPeople && (!fromPublic || t.kind === "chat");
    setConfirm({
      title: fromPublic ? `Make ${thing} private?` : `Stop sharing ${thing}?`,
      body: (
        <>
          <p>{losing}</p>
          {count > 0 && (!fromPublic || t.kind === "chat") && <PeopleList active={active} pending={pending} />}
        </>
      ),
      button: fromPublic ? "Make it private" : "Stop sharing",
      action: async () => {
        if (fromPublic) {
          await makePrivate(t.kind, t.id);
          t.onPrivate();
        }
        if (dropPeople) {
          for (const p of active) {
            const r = p.seat && t.seats ? await t.seats.remove(p.id) : await t.remove(p.id);
            if (r.roster) t.onRoster(r.roster);
          }
          for (const p of pending) {
            const r = await t.cancelPending(p.id);
            if (r.roster) t.onRoster(r.roster);
          }
        }
        onClose?.();
      },
    });
  }

  // The question, in place of the panel.
  if (confirm) {
    return (
      <div className="sharing sharing-confirm">
        <h3>{confirm.title}</h3>
        {confirm.body}
        {error && <p className="modal-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={() => setConfirm(null)} disabled={busy}>
            Back
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              confirm
                .action()
                .then(() => setConfirm(null))
                .catch((err) => setError((err as Error).message))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "…" : confirm.button}
          </button>
        </div>
      </div>
    );
  }

  const peopleSummary =
    count === 0
      ? "Nobody yet."
      : [
          others.length > 0 ? `${others.length} ${others.length === 1 ? "person" : "people"}` : null,
          juniors.length > 0 ? `${juniors.length} username-and-code ${juniors.length === 1 ? "account" : "accounts"}` : null,
          pending.length > 0 ? `${pending.length} waiting to sign up` : null,
        ]
          .filter(Boolean)
          .join(", ") + ".";
  const changed = level !== current && !(level === "people" && current === "me");

  // Adding and removing people, and the username-and-code accounts. Under
  // People I choose, and under Everyone while a chat is public, since the
  // people chosen are the ones who write in it.
  const peopleEditor = (
    <>
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
            An account of its own, for {t.kind === "chat" ? "this chat and its bot" : "this bot"} only: pick a username, and Lechuga gives you a
            code to hand over. What they say is yours to read; they can't buy credits, make bots or be shared with by anyone else. Up to five.
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

      {count > 0 && (
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
                  <button type="button" className="signin-link" disabled={busy} onClick={() => askNewCode(p)}>
                    new code
                  </button>
                  <button
                    type="button"
                    className="signin-link"
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setUpgrading(p);
                    }}
                  >
                    full account
                  </button>
                </>
              )}
              <button type="button" className="signin-link" disabled={busy} onClick={() => askRemove(p)}>
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
    </>
  );

  return (
    <div className="sharing">
      <div className="sharing-levels" role="radiogroup" aria-label="Who can see it">
        {/* Only me */}
        <label className={`sharing-level ${level === "me" ? "on" : ""}`}>
          <input type="radio" name={`sharing-${t.id}`} checked={level === "me"} disabled={busy} onChange={() => setLevel("me")} />
          <span>
            <b>Only me</b>
            <span className="sharing-why">
              {level === "me" && current !== "me"
                ? t.isPublic
                  ? `Private: nobody else sees it. Press Done to make ${thing} private again${
                      t.kind === "chat" && count > 0 ? `: ${count === 1 ? "the one person" : `all ${count} people`} below lose sight of it too` : ""
                    }.`
                  : `Private: nobody else sees it. Press Done to stop sharing: ${count === 1 ? "the one person" : `all ${count} people`} below lose sight of ${thing}.`
                : t.kind === "chat"
                  ? "Private: nobody else sees it, and it's on your credits."
                  : "Private: only you can chat with it, and it's on your credits."}
            </span>
          </span>
        </label>
        {level === "me" && current !== "me" && count > 0 && (
          <div className="sharing-people">
            <PeopleList active={active} pending={pending} noteSeats />
          </div>
        )}

        {/* People I choose */}
        <label className={`sharing-level ${level === "people" ? "on" : ""}`}>
          <input type="radio" name={`sharing-${t.id}`} checked={level === "people"} disabled={busy} onChange={() => setLevel("people")} />
          <span>
            <b>People I choose</b>
            <span className="sharing-why">
              {t.kind === "chat" ? "They see all of it and can keep it going. You pay." : "They get their own chats with it; you see every one. You pay."}
              {current === "people" ? ` ${peopleSummary}` : ""}
            </span>
          </span>
        </label>
        {level === "people" && (
          <div className="sharing-people">
            {t.isPublic && <p className="sharing-why">It's public at the moment: anyone can read it, and the people here write in it. Press Done to make it theirs only.</p>}
            {peopleEditor}
          </div>
        )}

        {/* Everyone */}
        <label className={`sharing-level ${level === "everyone" ? "on" : ""} ${!t.canPublic && !t.isPublic ? "off" : ""}`}>
          <input type="radio" name={`sharing-${t.id}`} checked={level === "everyone"} disabled={busy || (!t.canPublic && !t.isPublic)} onChange={() => setLevel("everyone")} />
          <span>
            <b>Everyone on Lechuga</b>
            <span className="sharing-why">
              {!t.canPublic && !t.isPublic && t.publicReason
                ? t.publicReason
                : t.kind === "chat"
                  ? "Anyone can read it. Only you and the people you choose can write in it. Lechuga pays."
                  : "Anyone can chat with it, and every chat with it is public, yours so far included. Lechuga pays."}
              {t.isPublic ? " It is public now." : ""}
            </span>
          </span>
        </label>
        {level === "everyone" && !t.isPublic && t.canPublic && (
          <div className="sharing-people">
            <p className="sharing-why">Press Done to make {thing} public. You'll be asked once, with the rules spelled out, and you can make it private again later.</p>
          </div>
        )}
        {level === "everyone" && t.isPublic && (
          <div className="sharing-people">
            {t.kind === "chat" && (
              <>
                <p className="sharing-why">
                  {count === 0 ? "Only you can write in it so far. Add people here to let them write too; everyone else reads." : "Only you and the people here can write in it; everyone else reads."}
                </p>
                {peopleEditor}
              </>
            )}
            <div className="sharing-link">
              <code>{appLink(path)}</code>
              <button
                type="button"
                className="primary"
                onClick={() =>
                  void copyText(appLink(path)).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  })
                }
              >
                {copied ? "copied" : "copy"}
              </button>
            </div>
            <form onSubmit={sendPointer} className="sharing-add sharing-tell">
              <span className="sharing-tell-label">Tell someone:</span>
              <input
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="@username or email"
                value={tell}
                onChange={(e) => setTell(e.target.value)}
                disabled={busy}
                aria-label="Username or email"
              />
              <button type="submit" className="primary" disabled={busy || !tell.trim()}>
                {busy ? "…" : "send"}
              </button>
            </form>
            <p className="sharing-why">
              {t.kind === "chat" ? "They get an email with the link, to read it. To let them write in it, add them above." : "They get an email with the link. Nothing else changes: public is everyone's already."}
            </p>
          </div>
        )}
      </div>
      {note && <p className="modal-ok">{note}</p>}
      {error && <p className="modal-error">{error}</p>}
      {onClose && (
        <div className="modal-actions">
          <button type="button" className={changed ? "primary" : ""} onClick={done} disabled={busy}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}

// Who has it, read-only, for the places that say who's about to lose it.
function PeopleList({ active, pending, noteSeats = false }: { active: Member[]; pending: { id: string; email: string }[]; noteSeats?: boolean }) {
  return (
    <ul className="share-people compact">
      {active.map((p) => (
        <li key={p.id}>
          <Avatar person={p} size={22} />
          <span className="share-name">
            {p.name}
            {p.seat && <span className="share-state"> · username and code{noteSeats ? ", deleted for good" : ""}</span>}
          </span>
        </li>
      ))}
      {pending.map((p) => (
        <li key={p.id}>
          <span className="share-name">{p.email}</span>
          <span className="share-state">hasn't joined yet</span>
        </li>
      ))}
    </ul>
  );
}

// The panel as a dialog.
export function SharingDialog({ target, onClose }: { target: SharingTarget; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal share-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{target.kind === "chat" ? "Sharing this chat" : `Sharing: ${target.name}`}</h2>
        <SharingPanel target={target} onClose={onClose} />
      </div>
    </div>
  );
}
