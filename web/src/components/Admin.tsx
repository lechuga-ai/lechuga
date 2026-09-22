import { useEffect, useState, type FormEvent } from "react";
import {
  adminInvites,
  adminListRequests,
  adminRequestAction,
  adminSendInvite,
  adminSetInvites,
  adminSetUsername,
  type AdminRequest,
  type AdminInvite,
  type AdminUser,
  type Me,
} from "../api";
import { AdminAccounts } from "./AdminAccounts";
import { AdminActivity } from "./AdminActivity";

type Props = { me: Me };
type Tab = "requests" | "invites" | "accounts" | "activity";

function when(ms: number | string | null): string {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Admin area at /admin. Four tabs: the requests inbox, everyone's invites,
// accounts (credits, spend, payments; components/AdminAccounts.tsx) and the
// dashboard (day by day, and what the outside services cost;
// components/AdminActivity.tsx).
export function Admin({ me }: Props) {
  const [tab, setTab] = useState<Tab>("requests");
  return (
    <div className="admin">
      <header className="admin-header">
        <a href="/" className="admin-back">
          ← Lechuga
        </a>
        <h1>Admin</h1>
        <span className="admin-who">{me.username ?? me.email}</span>
      </header>
      <nav className="admin-tabs">
        <button type="button" className={tab === "requests" ? "active" : ""} onClick={() => setTab("requests")}>
          Requests
        </button>
        <button type="button" className={tab === "invites" ? "active" : ""} onClick={() => setTab("invites")}>
          Invites
        </button>
        <button type="button" className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}>
          Dashboard
        </button>
        <button type="button" className={tab === "accounts" ? "active" : ""} onClick={() => setTab("accounts")}>
          Accounts
        </button>
      </nav>
      {tab === "requests" && <Requests />}
      {tab === "invites" && <Invites />}
      {tab === "accounts" && <AdminAccounts myId={me.id} />}
      {tab === "activity" && <AdminActivity />}
    </div>
  );
}

function Requests() {
  const [type, setType] = useState("");
  const [status, setStatus] = useState("open");
  const [rows, setRows] = useState<AdminRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Which row has a compose box open, and for what.
  const [compose, setCompose] = useState<{ id: string; action: "decline" | "reply" } | null>(null);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");

  async function load() {
    try {
      setRows(await adminListRequests({ type, status }));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, status]);

  async function act(id: string, action: "approve" | "decline" | "reply" | "close", payload: Record<string, string> = {}) {
    setBusyId(id);
    setError(null);
    try {
      await adminRequestAction(id, action, payload);
      setCompose(null);
      setSubject("");
      setText("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <div className="admin-filters">
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">all types</option>
          <option value="access">access</option>
          <option value="feedback">feedback</option>
          <option value="support">support</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">all statuses</option>
          <option value="open">open</option>
          <option value="approved">approved</option>
          <option value="declined">declined</option>
          <option value="replied">replied</option>
          <option value="closed">closed</option>
        </select>
        <span className="admin-count">{rows.length} shown</span>
      </div>
      {error && <p className="modal-error">{error}</p>}
      {rows.length === 0 && <p className="admin-empty">Nothing here.</p>}
      <ul className="admin-list">
        {rows.map((r) => (
          <li key={r.id} className={`admin-row ${r.status}`}>
            <div className="admin-row-head">
              <span className={`admin-badge ${r.type}`}>{r.type}</span>
              <span className="admin-from">
                {r.username ? `@${r.username} · ` : ""}
                {r.email}
              </span>
              <span className="admin-when">{when(r.created_at)}</span>
              <span className={`admin-status ${r.status}`}>{r.status}</span>
            </div>
            {r.body && <p className="admin-body">{r.body}</p>}
            {r.reply && (
              <p className="admin-reply">
                <strong>reply:</strong> {r.reply}
              </p>
            )}
            {r.handled_at && (
              <p className="admin-handled">
                handled {when(r.handled_at)} by {r.handled_by_username ?? r.handled_by_email ?? "?"}
              </p>
            )}
            {r.status === "open" && (
              <div className="admin-actions">
                {r.type === "access" && (
                  <button type="button" className="primary" disabled={busyId === r.id} onClick={() => act(r.id, "approve")}>
                    approve &amp; invite
                  </button>
                )}
                <button type="button" disabled={busyId === r.id} onClick={() => setCompose({ id: r.id, action: "reply" })}>
                  reply
                </button>
                {r.type === "access" && (
                  <button type="button" disabled={busyId === r.id} onClick={() => setCompose({ id: r.id, action: "decline" })}>
                    decline
                  </button>
                )}
                <button type="button" disabled={busyId === r.id} onClick={() => act(r.id, "close")}>
                  close
                </button>
              </div>
            )}
            {compose?.id === r.id && (
              <div className="admin-compose">
                {compose.action === "reply" && (
                  <input placeholder="subject (optional)" value={subject} onChange={(e) => setSubject(e.target.value)} />
                )}
                <textarea
                  rows={4}
                  autoFocus
                  placeholder={compose.action === "reply" ? "Your reply, sent from hello@lechuga.ai" : "Optional message to send with the decline"}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <div className="admin-actions">
                  <button type="button" onClick={() => setCompose(null)}>
                    cancel
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={busyId === r.id || (compose.action === "reply" && !text.trim())}
                    onClick={() =>
                      compose.action === "reply" ? act(r.id, "reply", { subject, body: text }) : act(r.id, "decline", { message: text })
                    }
                  >
                    {compose.action === "reply" ? "send reply" : "decline"}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Invites() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string; field: "invites" | "username"; value: string } | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteSent, setInviteSent] = useState<string | null>(null);

  async function sendInvite(e: FormEvent) {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email || inviteBusy) return;
    setInviteBusy(true);
    setError(null);
    setInviteSent(null);
    try {
      await adminSendInvite(email);
      setInviteSent(email);
      setInviteEmail("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInviteBusy(false);
    }
  }

  async function load() {
    try {
      const data = await adminInvites();
      setUsers(data.users);
      setInvites(data.invites);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!edit) return;
    try {
      if (edit.field === "invites") await adminSetInvites(edit.id, Number(edit.value));
      else await adminSetUsername(edit.id, edit.value);
      setEdit(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const byId = new Map(users.map((u) => [u.id, u]));
  const children = (id: string | null) => users.filter((u) => u.invited_by === id);
  const name = (u: AdminUser) => (u.username ? `@${u.username}` : u.email);

  function Tree({ parent, depth }: { parent: string | null; depth: number }) {
    const kids = children(parent);
    if (kids.length === 0) return null;
    return (
      <ul className="admin-tree" style={{ marginLeft: depth ? 18 : 0 }}>
        {kids.map((u) => (
          <li key={u.id}>
            <span className="admin-tree-name">{name(u)}</span>
            <span className="admin-tree-meta">{u.email}</span>
            <Tree parent={u.id} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section>
      {error && <p className="modal-error">{error}</p>}
      <h2>Send an invite</h2>
      <p className="admin-hint">From Lechuga rather than from you: it doesn't use up your own invites. The link is good for 14 days.</p>
      <form className="admin-grant" onSubmit={sendInvite}>
        <label className="admin-grant-note">
          their email
          <input type="email" required placeholder="friend@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} disabled={inviteBusy} />
        </label>
        <button type="submit" className="primary" disabled={inviteBusy || !inviteEmail.trim()}>
          {inviteBusy ? "sending…" : "send invite"}
        </button>
      </form>
      {inviteSent && <p className="admin-hint">Sent to {inviteSent}.</p>}

      <h2>People</h2>
      <p className="admin-hint">Click a count or a username to change it. The default for new accounts is in config.json.</p>
      <table className="admin-table">
        <thead>
          <tr>
            <th>username</th>
            <th>email</th>
            <th>invites left</th>
            <th>invited by</th>
            <th>joined</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>
                {edit?.id === u.id && edit.field === "username" ? (
                  <EditCell value={edit.value} onChange={(v) => setEdit({ ...edit, value: v })} onSave={save} onCancel={() => setEdit(null)} />
                ) : (
                  <button type="button" className="admin-cell" onClick={() => setEdit({ id: u.id, field: "username", value: u.username ?? "" })}>
                    {u.username ? `@${u.username}` : "(none yet)"}
                  </button>
                )}
              </td>
              <td>{u.email}</td>
              <td>
                {edit?.id === u.id && edit.field === "invites" ? (
                  <EditCell value={edit.value} onChange={(v) => setEdit({ ...edit, value: v })} onSave={save} onCancel={() => setEdit(null)} numeric />
                ) : (
                  <button type="button" className="admin-cell" onClick={() => setEdit({ id: u.id, field: "invites", value: String(u.invites_remaining) })}>
                    {u.invites_remaining}
                  </button>
                )}
              </td>
              <td>{u.invited_by ? name(byId.get(u.invited_by) ?? ({ email: "?" } as AdminUser)) : "—"}</td>
              <td>{when(u.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Who invited whom</h2>
      <Tree parent={null} depth={0} />

      <h2>Invites, newest first</h2>
      {invites.length === 0 && <p className="admin-empty">None yet.</p>}
      <table className="admin-table">
        <thead>
          <tr>
            <th>invited</th>
            <th>email</th>
            <th>from</th>
            <th>accepted</th>
            <th>status</th>
          </tr>
        </thead>
        <tbody>
          {invites.map((i) => {
            const expired = i.status === "pending" && i.expires_at <= Date.now();
            return (
              <tr key={i.id}>
                <td>{when(i.created_at)}</td>
                <td>{i.email}</td>
                <td>
                  {i.inviter_id
                    ? name(byId.get(i.inviter_id) ?? ({ email: "?" } as AdminUser))
                    : i.sent_by
                      ? `Lechuga, sent by ${name(byId.get(i.sent_by) ?? ({ email: "?" } as AdminUser))}`
                      : "Lechuga"}
                </td>
                <td>{i.accepted_at ? when(i.accepted_at) : "—"}</td>
                <td>{expired ? "expired" : i.status === "pending" ? `waiting, until ${when(i.expires_at)}` : i.status}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function EditCell({
  value,
  onChange,
  onSave,
  onCancel,
  numeric,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  numeric?: boolean;
}) {
  return (
    <span className="admin-edit">
      <input
        autoFocus
        type={numeric ? "number" : "text"}
        min={numeric ? 0 : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave();
          if (e.key === "Escape") onCancel();
        }}
      />
      <button type="button" className="primary" onClick={onSave}>
        save
      </button>
      <button type="button" onClick={onCancel}>
        cancel
      </button>
    </span>
  );
}
