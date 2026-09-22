import { useState } from "react";
import config from "../../../worker/config.json";
import type { Costs, CreditPack } from "../api";

const usd = (n: number) => `$${n.toFixed(2)}`;

// Where the money from one purchase goes, from the published numbers in
// worker/config.json. Compute is the most Cloudflare can charge us for it:
// what it costs if every credit gets used.
function split(pack: CreditPack, costs: Costs) {
  const compute = pack.credits / 10000 / costs.markup;
  // With Managed Payments on, Stripe is the seller of record and handles
  // sales tax, for its own percentage on top of the card fee.
  const managed = config.stripe_managed_payments ? costs.stripe_managed_percent : 0;
  const stripe = (pack.usd * (costs.stripe_percent + managed)) / 100 + costs.stripe_fixed_usd;
  return [
    { key: "compute", label: "Cloudflare, for the models", detail: "running your chats and reading your pictures, if you use every credit", amount: compute },
    { key: "docs", label: "Cloudflare, for reading PDFs and documents", detail: "turning a file into text; they don't charge us, so neither do we", amount: 0 },
    { key: "stripe", label: "Stripe, for the payment", detail: `${costs.stripe_percent}% + ${usd(costs.stripe_fixed_usd)} per purchase` + (managed ? `, and ${managed}% for handling sales tax` : ""), amount: stripe },
    { key: "rest", label: "Lechuga", detail: "fixed bills first, then us", amount: Math.max(0, pack.usd - compute - stripe) },
  ];
}

// On the public home page, under "Where the money goes". The numbers are the
// published ones in config.json, so the page needs nothing from the server.
export function WhereItGoes() {
  const packs: CreditPack[] = config.credit_packs;
  const costs: Costs = config.costs;
  const [packId, setPackId] = useState(packs[0]?.id ?? "");
  const pack = packs.find((p) => p.id === packId) ?? packs[0];
  if (!pack) return null;
  const parts = split(pack, costs);
  const fixed = costs.monthly_fixed.map((f) => `${f.label} (${usd(f.usd)} a month)`).join(", ");

  return (
    <section className="billing-panel">
      <div className="billing-panel-head">
        <h3>Out of every purchase</h3>
        <div className="billing-toggle" role="group" aria-label="Which purchase">
          {packs.map((p) => (
            <button key={p.id} type="button" className={p.id === pack.id ? "active" : ""} onClick={() => setPackId(p.id)}>
              ${p.usd}
            </button>
          ))}
        </div>
      </div>
      <p className="billing-panel-lead">
        Out of {usd(pack.usd)} for {pack.label}:
      </p>

      {/* One bar, parts of a whole. The rows below carry every label and
          amount, so nothing depends on telling the colors apart. */}
      <div className="split-bar" role="img" aria-label={parts.map((p) => `${p.label}: ${usd(p.amount)}`).join(", ")}>
        {parts.map((p) => (
          <span
            key={p.key}
            className={`split-seg ${p.key}`}
            style={{ flexGrow: p.amount }}
            title={`${p.label}: ${usd(p.amount)} (${Math.round((p.amount / pack.usd) * 100)}%)`}
          />
        ))}
      </div>
      <table className="split-table">
        <tbody>
          {parts.map((p) => (
            <tr key={p.key}>
              <td>
                <span className={`split-dot ${p.key}`} />
                {p.label}
                <span className="split-detail">{p.detail}</span>
              </td>
              <td className="split-amount">{usd(p.amount)}</td>
              <td className="split-share">{Math.round((p.amount / pack.usd) * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="billing-panel-note">
        Lechuga's share pays the bills that don't depend on usage first: {fixed}, and the domain names. Then starter
        credits, the free chat on this page, and the occasional refund. What's left goes to the two people who run it.
        Credits you never use cost us nothing, and they never expire.
      </p>
    </section>
  );
}

