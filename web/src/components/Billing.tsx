import { useEffect, useState } from "react";
import {
  creditsAsDollars,
  getBilling,
  openPortal,
  startCheckout,
  type Billing as BillingData,
  type Me,
} from "../api";
import { DeleteAccount } from "./DeleteAccount";

type Props = { me: Me };

const HISTORY_LABELS: Record<string, string> = {
  purchase: "Bought credits",
  subscription: "Monthly plan",
  refund: "Refund",
  signup_bonus: "Starter credits, on us",
  manual: "From Lechuga",
};

// Everything that has changed the balance other than replies, newest first.
function History({ rows }: { rows: BillingData["history"] }) {
  return (
    <section className="billing-panel">
      <div className="billing-panel-head">
        <h2>Your purchases</h2>
      </div>
      {rows.length === 0 ? (
        <p className="billing-panel-lead">Nothing yet.</p>
      ) : (
        <ol className="history">
          {rows.map((r) => (
            <li key={r.id}>
              <span className="history-date">
                {new Date(r.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
              </span>
              <span className="history-what">
                {r.reason === "manual" && r.delta < 0 ? "Adjustment" : (HISTORY_LABELS[r.reason] ?? r.reason)}
              </span>
              <span className="history-credits">
                {r.delta > 0 ? "+" : ""}
                {r.delta.toLocaleString()} credits
              </span>
              <span className="history-money">
                {r.paid_cents ? `${r.paid_cents < 0 ? "−" : ""}$${(Math.abs(r.paid_cents) / 100).toFixed(2)}` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="billing-panel-note">
        Receipts are on Stripe's page, linked above once you've bought something. <a href="/pricing">Where the money goes</a>.
      </p>
    </section>
  );
}

// /billing (and /usage, until Phase 4 gives that its own page): the balance,
// what's for sale, the subscription, and the account's purchase history
// (where the money goes is on the public home page). Paying happens
// on Stripe's site; the buttons here only send the browser there and back.
export function Billing({ me }: Props) {
  const [data, setData] = useState<BillingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const justPaid = new URLSearchParams(window.location.search).get("checkout") === "success";

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getBilling()
        .then((d) => !cancelled && setData(d))
        .catch((err) => !cancelled && setError((err as Error).message));
    load();
    // Credits land when Stripe's webhook arrives, usually a second or two
    // after the browser gets back here. Look again a few times so the new
    // balance shows up without a reload.
    const timers = justPaid ? [2000, 5000, 10000].map((ms) => setTimeout(load, ms)) : [];
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [justPaid]);

  async function go(key: string, start: () => Promise<{ url: string }>) {
    setBusy(key);
    setError(null);
    try {
      window.location.href = (await start()).url;
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="admin billing">
      <header className="admin-header">
        <a href="/" className="admin-back">
          ← Lechuga
        </a>
        <h1>Credits</h1>
        <span className="admin-who">{me.username ?? me.email}</span>
      </header>

      {justPaid && <p className="billing-note ok">Thank you. Your credits will show up here in a few seconds.</p>}
      {error && <p className="billing-note bad">{error}</p>}

      {data && (
        <>
          <section className="billing-panel billing-balance">
            <div className="billing-balance-label">Your balance</div>
            <div className="billing-balance-number">
              {data.balance.toLocaleString()} <span>credits</span>
            </div>
            <div className="billing-balance-sub">
              About {creditsAsDollars(Math.max(0, data.balance))} of chatting. Every reply shows what it cost. Credits
              never expire.
            </div>
          </section>

          {!data.purchasesOpen ? (
            <p className="billing-note">
              Buying credits isn't open yet. Until it is, you can keep chatting; your balance just keeps count.
            </p>
          ) : (
            <>
              <h2 className="billing-heading">Pay once</h2>
              <div className="billing-cards">
                {data.packs.map((p) => (
                  <div key={p.id} className="billing-card">
                    <div className="billing-card-name">{p.label}</div>
                    <div className="billing-card-price">${p.usd}</div>
                    <div className="billing-card-detail">{p.credits.toLocaleString()} credits</div>
                    <button type="button" className="primary" disabled={busy !== null} onClick={() => go(p.id, () => startCheckout(p.id))}>
                      {busy === p.id ? "one moment…" : `buy ${p.label}`}
                    </button>
                  </div>
                ))}
              </div>

              <h2 className="billing-heading">Or monthly</h2>
              <div className="billing-cards">
                <div className="billing-card">
                  <div className="billing-card-name">
                    {data.subscription.label}
                    {data.subscriptionStatus && <span className={`billing-status ${data.subscriptionStatus}`}>{data.subscriptionStatus}</span>}
                  </div>
                  <div className="billing-card-price">${data.subscription.usd}/month</div>
                  <div className="billing-card-detail">
                    {data.subscription.credits.toLocaleString()} credits each month. Unused credits roll over. Cancel any time and
                    keep what's left.
                  </div>
                  {data.subscriptionStatus === "active" ? (
                    <>
                      <button type="button" disabled={busy !== null} onClick={() => go("portal", openPortal)}>
                        {busy === "portal" ? "one moment…" : "manage subscription"}
                      </button>
                      {/* Stripe's cancel page says the subscription "will no
                          longer be available to you", and that wording is
                          theirs. Say what actually happens before they go. */}
                      <div className="billing-card-foot">
                        Cancelling happens on Stripe's page. Whatever it says there, you keep every credit you have and can
                        subscribe again whenever you like.
                      </div>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="primary"
                      disabled={busy !== null}
                      onClick={() => go(data.subscription.id, () => startCheckout(data.subscription.id))}
                    >
                      {busy === data.subscription.id ? "one moment…" : "subscribe"}
                    </button>
                  )}
                </div>
              </div>

              {data.hasCustomer && data.subscriptionStatus !== "active" && (
                <p className="billing-foot">
                  <button type="button" className="billing-link" disabled={busy !== null} onClick={() => go("portal", openPortal)}>
                    Receipts and payment details
                  </button>
                </p>
              )}
            </>
          )}

          <History rows={data.history} />
          <DeleteAccount email={me.email} />
        </>
      )}
    </div>
  );
}
