import { useState, type FormEvent } from "react";
import { ApiError, addChatMember, cancelPendingShare, removeChatMember, type Roster } from "../api";
import { Avatar } from "./Avatar";

type Props = {
  chatId: string;
  roster: Roster;
  // The dialog shows whatever roster the server last sent back.
  onRoster: (roster: Roster) => void;
  onClose: () => void;
};

// The owner's view of who's in a chat: add people by username or email, take
// them out again. What sharing means is spelled out every time, since it's
// their words and their credits.
export function ShareDialog({ chatId, roster, onRoster, onClose }: Props) {
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Set when the address has no account: the question of spending an invite.
  const [needsInvite, setNeedsInvite] = useState<{ email: string; remaining: number } | null>(null);

  async function run(action: () => Promise<{ roster?: Roster; waitingFor?: string }>, success?: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await action();
      if (result.roster) onRoster(result.roster);
      setNeedsInvite(null);
      setDone(result.waitingFor ? `Invite sent. The chat will be waiting for ${result.waitingFor} when they sign in.` : (success ?? null));
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
    if (await run(() => addChatMember(chatId, entered), `Shared with ${entered}.`)) setWho("");
  }

  async function addWithInvite() {
    if (!needsInvite) return;
    if (await run(() => addChatMember(chatId, needsInvite.email, true))) setWho("");
  }

  const active = roster.members.filter((m) => !m.removed);
  const removed = roster.members.filter((m) => m.removed);

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal share-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>Share this chat</h2>
        <ul className="share-terms">
          <li>
            <strong>They see all of it.</strong> The whole chat from the very first message, files and pictures included.
          </li>
          <li>
            <strong>They can keep it going.</strong> Anyone you add can send messages here, and everyone sees them.
          </li>
          <li>
            <strong>You pay for it.</strong> Every reply in this chat comes out of your credits, whoever asked.
          </li>
        </ul>

        {needsInvite ? (
          <div className="share-invite">
            <p>
              <strong>{needsInvite.email}</strong> isn't on Lechuga yet.{" "}
              {needsInvite.remaining > 0
                ? `Use one of your ${needsInvite.remaining} ${needsInvite.remaining === 1 ? "invite" : "invites"} to bring them in? The chat will be waiting when they sign in.`
                : "You'd need an invite to bring them in, and you have none left."}
            </p>
            <div className="modal-actions">
              <button type="button" onClick={() => setNeedsInvite(null)} disabled={busy}>
                Never mind
              </button>
              {needsInvite.remaining > 0 && (
                <button type="button" className="primary" onClick={addWithInvite} disabled={busy}>
                  {busy ? "inviting…" : "Use an invite"}
                </button>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={add} className="modal-form">
            <input
              autoFocus
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="@username or email"
              value={who}
              onChange={(e) => setWho(e.target.value)}
              disabled={busy}
            />
            <button type="submit" className="primary" disabled={busy || !who.trim()}>
              {busy ? "sharing…" : "share"}
            </button>
          </form>
        )}
        {done && <p className="modal-ok">{done}</p>}
        {error && <p className="modal-error">{error}</p>}

        <ul className="share-people">
          <li>
            <Avatar person={roster.owner} size={28} owner />
            <span className="share-name">{roster.owner.name}</span>
            <span className="share-state">started this chat</span>
          </li>
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
                onClick={() => void run(() => removeChatMember(chatId, p.id), `${p.name} can no longer see this chat. What they wrote stays.`)}
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
              <button type="button" className="signin-link" disabled={busy} onClick={() => void run(() => cancelPendingShare(chatId, p.id))}>
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

        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
