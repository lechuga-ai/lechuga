import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  adminAccounts,
  adminGrant,
  adminGrants,
  adminLedger,
  adminSetSuspended,
  type AdminAccount,
  type AdminGateway,
  type AdminGrant,
  type AdminLedgerRow,
  type AdminModelSpend,
} from "../api";

import config from "../../../worker/config.json";

// 1 credit = $0.0001 (worker/src/credits.ts). The page talks in dollars and
// keeps credits as the small print, since dollars are what compare.
const usdOfCredits = (credits: number) => credits * 0.0001;
const money = (usd: number) => {
  const tiny = Math.abs(usd) > 0 && Math.abs(usd) < 0.01;
  return usd.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: tiny ? 4 : 2 });
};
const count = (n: number) => n.toLocaleString();
const day = (ms: number | string | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "never");
const moment = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const modelName = (id: string | null) => config.models.find((m) => m.id === id)?.label ?? id?.split("/").pop() ?? "unknown";

function Tile({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <div className="admin-tile">
      <div className="admin-tile-label">{label}</div>
      <div className="admin-tile-value">{value}</div>
      <div className="admin-tile-note">{children}</div>
    </div>
  );
}

// The Accounts tab, in dollars: what has come in, what replies cost us at
// Cloudflare, what we've given away, and what people still hold. Then one
// row per account; a row opens to give credits, suspend, and see its ledger.
export function AdminAccounts({ myId }: { myId: string }) {
  const [users, setUsers] = useState<AdminAccount[]>([]);
  const [models, setModels] = useState<AdminModelSpend[]>([]);
  const [trials, setTrials] = useState({ total: 0, today: 0 });
  const [gateway, setGateway] = useState<AdminGateway | null>(null);
  const [grants, setGrants] = useState<AdminGrant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    try {
      const [data, given] = await Promise.all([adminAccounts(), adminGrants()]);
      setGrants(given);
      setGateway(data.gateway);
      setUsers(data.users);
      setModels(data.models);
      setTrials(data.trials);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const sum = (pick: (u: AdminAccount) => number) => users.reduce((total, u) => total + pick(u), 0);
  const paid = sum((u) => u.paid_cents) / 100;
  const cost = sum((u) => u.cost_usd);
  const charged = usdOfCredits(sum((u) => u.credits_spent));
  const held = usdOfCredits(sum((u) => u.balance));
  const given = usdOfCredits(sum((u) => u.credits_given));
  const payers = users.filter((u) => u.paid_cents > 0).length;
  const subscribers = users.filter((u) => u.subscription_status === "active").length;

  return (
    <section>
      {error && <p className="modal-error">{error}</p>}

      {gateway && (
        <div className="admin-gateway">
          <div className="admin-gateway-head">
            <span>
              <strong>{money(gateway.last24h.cost_usd)}</strong> of the {money(gateway.cap_usd)} daily AI Gateway limit, last 24
              hours
            </span>
            <a href={gateway.dashboard} target="_blank" rel="noopener">
              raise the limit in Cloudflare ↗
            </a>
          </div>
          <div
            className="admin-meter"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={gateway.cap_usd}
            aria-valuenow={gateway.last24h.cost_usd}
            aria-label="Spend against the daily AI Gateway limit"
          >
            <span
              className={gateway.last24h.cost_usd >= gateway.cap_usd * 0.8 ? "high" : ""}
              style={{ width: `${Math.min(100, (gateway.last24h.cost_usd / gateway.cap_usd) * 100)}%` }}
            />
          </div>
          <p className="admin-hint">
            Our own count: {count(gateway.last24h.replies)} account replies here. Cloudflare's figure will be a little
            higher, because the limit is shared with the other tiers and also covers free chats ({count(gateway.last24h.trials)}{" "}
            in this window) and chat titles. When the limit is hit, chat stops for everyone until older spend ages out. In
            Cloudflare: AI → AI Gateway → lechuga → Settings → spend limit; then update gateway_daily_cap_usd in
            config.json so this bar matches.
          </p>
        </div>
      )}

      <div className="admin-tiles">
        <Tile label="Money in" value={money(paid)}>
          from {count(payers)} of {count(users.length)} accounts, after refunds. {count(subscribers)} on the monthly plan.
        </Tile>
        <Tile label="Cloudflare bill for replies" value={money(cost)}>
          {count(sum((u) => u.replies))} replies. We charged {money(charged)} for them
          {cost > 0 && (
            <>
              , <strong>{(charged / cost).toFixed(1)}×</strong> our cost (the aim is {config.costs.markup}×)
            </>
          )}
          .
        </Tile>
        <Tile label="Given away" value={money(given)}>
          starter credits and gifts, at our prices. About {money(given / config.costs.markup)} at Cloudflare's if it's all used.
        </Tile>
        <Tile label="Still unspent" value={money(held)}>
          sitting in balances, bought or given. About {money(held / config.costs.markup)} of Cloudflare bill still to come.
        </Tile>
      </div>
      <p className="admin-hint">
        Current accounts only: deleting an account removes its history. Not counted: the home page's free chats (
        {count(trials.today)} today, {count(trials.total)} in all) and chat titles, which cost us a little and belong to no
        account.
      </p>

      <h2>Accounts</h2>
      <p className="admin-hint">
        Dollars first, credits underneath (10,000 credits = $1). "Net" is what they paid minus what their replies cost us.
        Click a row for the detail, to give credits, or to suspend.
      </p>
      <div className="admin-scroll">
        <table className="admin-table admin-accounts">
          <thead>
            <tr>
              <th>account</th>
              <th className="num">balance</th>
              <th className="num">paid us</th>
              <th className="num">cost us</th>
              <th className="num">net</th>
              <th className="num">we gave</th>
              <th className="num">replies</th>
              <th>last reply</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const net = u.paid_cents / 100 - u.cost_usd;
              return (
                <Fragment key={u.id}>
                  <tr className={`admin-account ${openId === u.id ? "open" : ""}`} onClick={() => setOpenId(openId === u.id ? null : u.id)}>
                    <td>
                      <strong>{u.username ? `@${u.username}` : "(no username yet)"}</strong>
                      {u.suspended_at && <span className="admin-badge suspended">suspended</span>}
                      {u.subscription_status === "active" && <span className="admin-badge">monthly</span>}
                      <div className="admin-sub">
                        {u.email} · joined {day(u.created_at)}
                      </div>
                    </td>
                    <td className="num">
                      {money(usdOfCredits(u.balance))}
                      <div className="admin-sub">{count(u.balance)} credits</div>
                    </td>
                    <td className="num">{money(u.paid_cents / 100)}</td>
                    <td className="num">{money(u.cost_usd)}</td>
                    <td className={`num ${net < 0 ? "admin-negative" : ""}`}>{money(net)}</td>
                    <td className="num">
                      {money(usdOfCredits(u.credits_given))}
                      <div className="admin-sub">{count(u.credits_given)} credits</div>
                    </td>
                    <td className="num">{count(u.replies)}</td>
                    <td>{day(u.last_reply_at)}</td>
                  </tr>
                  {openId === u.id && (
                    <tr className="admin-account-detail">
                      <td colSpan={8}>
                        <AccountDetail account={u} isMe={u.id === myId} onChanged={load} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Credits given by hand</h2>
      <p className="admin-hint">Newest first. The note starts with who did it. Give credits from an account's row above.</p>
      {grants.length === 0 && <p className="admin-empty">None yet.</p>}
      {grants.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>when</th>
              <th>to</th>
              <th className="num">credits</th>
              <th>who and why</th>
            </tr>
          </thead>
          <tbody>
            {grants.map((g) => (
              <tr key={g.id}>
                <td>{moment(g.created_at)}</td>
                <td>{g.username ? `@${g.username}` : g.email}</td>
                <td className="num">
                  {g.delta > 0 ? "+" : ""}
                  {count(g.delta)} ({money(usdOfCredits(g.delta))})
                </td>
                <td>{g.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>By model</h2>
      {models.length === 0 && <p className="admin-empty">No replies yet.</p>}
      {models.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>model</th>
              <th className="num">replies</th>
              <th className="num">we charged</th>
              <th className="num">cost us</th>
              <th className="num">markup</th>
              <th className="num">tokens in / out</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.model ?? "?"}>
                <td>{modelName(m.model)}</td>
                <td className="num">{count(m.replies)}</td>
                <td className="num">{money(usdOfCredits(m.credits_spent))}</td>
                <td className="num">{money(m.cost_usd)}</td>
                <td className="num">{m.cost_usd > 0 ? `${(usdOfCredits(m.credits_spent) / m.cost_usd).toFixed(1)}×` : ""}</td>
                <td className="num">
                  {count(m.prompt_tokens)} / {count(m.completion_tokens)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const REASONS: Record<string, string> = {
  signup_bonus: "starter credits",
  purchase: "bought a pack",
  subscription: "monthly plan",
  refund: "refund",
  manual: "from an admin",
};

function AccountDetail({ account, isMe, onChanged }: { account: AdminAccount; isMe: boolean; onChanged: () => Promise<void> }) {
  const [credits, setCredits] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<AdminLedgerRow[] | null>(null);

  async function loadLedger() {
    try {
      setLedger(await adminLedger(account.id));
    } catch (err) {
      setError((err as Error).message);
    }
  }
  useEffect(() => {
    loadLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await Promise.all([onChanged(), loadLedger()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const amount = Number(credits);
  const valid = Number.isInteger(amount) && amount !== 0 && note.trim().length > 0;

  return (
    <div className="admin-detail">
      <p className="admin-detail-summary">
        Has used {money(usdOfCredits(account.credits_spent))} ({count(account.credits_spent)} credits) on {count(account.replies)}{" "}
        replies: {count(account.prompt_tokens)} tokens in, {count(account.completion_tokens)} out.
      </p>
      <form
        className="admin-grant"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          void run(async () => {
            await adminGrant(account.id, amount, note.trim());
            setCredits("");
            setNote("");
          });
        }}
      >
        <label>
          credits to give
          <input type="number" step={1} placeholder="10000 = $1" value={credits} onChange={(e) => setCredits(e.target.value)} disabled={busy} />
        </label>
        <label className="admin-grant-note">
          why (kept on the ledger)
          <input maxLength={300} placeholder="thanks for the bug report" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
        </label>
        <button type="submit" className="primary" disabled={busy || !valid}>
          {amount < 0 ? "take back" : "give"}
        </button>
        {!isMe && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const next = !account.suspended_at;
              if (next && !window.confirm(`Suspend ${account.email}? They keep their chats but can't send messages.`)) return;
              void run(() => adminSetSuspended(account.id, next));
            }}
          >
            {account.suspended_at ? "lift suspension" : "suspend"}
          </button>
        )}
      </form>
      <p className="admin-hint">A negative number takes credits back. 10,000 credits is $1 at our prices.</p>
      {error && <p className="modal-error">{error}</p>}

      {ledger && ledger.length === 0 && <p className="admin-empty">No ledger rows.</p>}
      {ledger && ledger.length > 0 && (
        <table className="admin-table admin-ledger">
          <thead>
            <tr>
              <th>when</th>
              <th>what</th>
              <th className="num">credits</th>
              <th className="num">tokens in / out</th>
              <th className="num">cost us</th>
              <th className="num">paid us</th>
              <th>note</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((row) => (
              <tr key={row.id}>
                <td>{moment(row.created_at)}</td>
                <td>{row.reason === "message" ? `reply, ${modelName(row.model)}` : (REASONS[row.reason] ?? row.reason)}</td>
                <td className="num">{row.delta > 0 ? `+${count(row.delta)}` : count(row.delta)}</td>
                <td className="num">{row.completion_tokens != null ? `${count(row.prompt_tokens ?? 0)} / ${count(row.completion_tokens)}` : ""}</td>
                <td className="num">{row.cost_usd != null ? money(row.cost_usd) : ""}</td>
                <td className="num">{row.paid_cents != null ? money(row.paid_cents / 100) : ""}</td>
                <td>{row.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ledger && ledger.length === 100 && <p className="admin-hint">The latest 100 rows.</p>}
    </div>
  );
}
