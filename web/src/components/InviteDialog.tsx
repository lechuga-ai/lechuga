import { useEffect, useState, type FormEvent } from "react";
import { createInvite, listInvites, revokeInvite, type Invite } from "../api";

type Props = { onClose: () => void; onRemainingChange: (n: number) => void };

function label(i: Invite): string {
  if (i.status === "accepted") return "accepted";
  if (i.status === "revoked") return "withdrawn";
  if (i.expired) return "expired";
  return "waiting";
}

export function InviteDialog({ onClose, onRemainingChange }: Props) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function refresh() {
    const data = await listInvites();
    setRemaining(data.remaining);
    setInvites(data.invites);
    onRemainingChange(data.remaining);
  }

  useEffect(() => {
    refresh().catch(() => setError("couldn't load your invites"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      await createInvite(address);
      setSent(address);
      setEmail("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      await revokeInvite(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>Invite someone</h2>
        <p>
          {remaining === null ? "…" : remaining === 1 ? "You have 1 invite left." : `You have ${remaining} invites left.`}{" "}
          Each one is an email with a link that works once.
        </p>
        <form onSubmit={send} className="modal-form">
          <input
            type="email"
            required
            placeholder="friend@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy || remaining === 0}
          />
          <button type="submit" className="primary" disabled={busy || remaining === 0 || !email.trim()}>
            {busy ? "sending…" : "send invite"}
          </button>
        </form>
        {sent && <p className="modal-ok">Invite sent to {sent}.</p>}
        {error && <p className="modal-error">{error}</p>}

        {invites.length > 0 && (
          <ul className="invite-list">
            {invites.map((i) => (
              <li key={i.id}>
                <span className="invite-email">{i.email}</span>
                <span className={`invite-state ${label(i)}`}>{label(i)}</span>
                {i.status === "pending" && !i.expired && (
                  <button type="button" className="signin-link" onClick={() => revoke(i.id)}>
                    withdraw
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
