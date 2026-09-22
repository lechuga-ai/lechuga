import { useEffect, useMemo, useRef, useState } from "react";
import {
  adminActivity,
  type AdminActivityDay,
  type AdminActivityModel,
  type AdminActivityPerson,
  type AdminActivityTools,
} from "../api";

// The dashboard: what happened each day, who did it, and what we paid the
// world outside Cloudflare for it. Everything on this page is in tokens and
// dollars rather than credits — it's the operator's view, and credits are the
// unit for people spending them, not for us working out whether this pays.
//
// Charts are drawn by hand rather than with a charting library: there are
// five of them, they're all the same two shapes, and an admin page shouldn't
// pull a hundred kilobytes into the bundle to draw a line.

// Fixed, in this order, and never cycled: the fourth slot is "Other", not a
// fifth colour. Checked with the palette validator against white for
// colourblind separation, so a model's line is tellable from its neighbour's
// by more than hue. Five distinct series provably can't be, which is why the
// model chart folds everything past the top three together.
const SERIES = ["#3f7a17", "#0072b2", "#c87f00", "#b5397f"];
const INK = "#1e221b";
const INK_DIM = "#5f6659";
const INK_FAINT = "#98a092";
const GRID = "rgba(0, 0, 0, 0.08)";

const RANGES = [7, 30, 90];

export function AdminActivity() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Awaited<ReturnType<typeof adminActivity>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    adminActivity(days)
      .then((d) => live && setData(d))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [days]);

  // A dense day-by-day series: the query returns only days that had rows, and
  // a chart that skips empty days draws a busy week and a quiet week the same
  // width. Gaps are real zeros here, not missing data.
  const series = useMemo(() => {
    if (!data) return [];
    const byDay = new Map(data.days.map((d) => [d.day, d]));
    const out: AdminActivityDay[] = [];
    const start = data.window.start_of_today - (data.window.days - 1) * 86400000;
    for (let i = 0; i < data.window.days; i++) {
      const key = pacificKey(start + i * 86400000);
      out.push(
        byDay.get(key) ?? {
          day: key,
          active_users: 0,
          replies: 0,
          prompt_tokens: 0,
          completion_tokens: 0,
          cost_usd: 0,
          paid_cents: 0,
        }
      );
    }
    return out;
  }, [data]);

  // Top three models by tokens, everything else folded into one line.
  const modelSeries = useMemo(() => {
    if (!data || series.length === 0) return [];
    const top = data.models.slice(0, 3).map((m) => m.model);
    const labels = new Map(data.models.map((m) => [m.model, modelLabel(m.model)]));
    const names = [...top, ...(data.models.length > 3 ? ["__other"] : [])];
    return names.map((name, i) => ({
      key: name,
      label: name === "__other" ? `Other (${data.models.length - 3})` : labels.get(name) ?? name,
      color: SERIES[i],
      points: series.map((d) => {
        const rows = data.model_days.filter((r) => r.day === d.day && (name === "__other" ? !top.includes(r.model) : r.model === name));
        return rows.reduce((n, r) => n + r.prompt_tokens + r.completion_tokens, 0);
      }),
    }));
  }, [data, series]);

  if (error) return <p className="admin-empty">Couldn't load the dashboard: {error}</p>;
  if (!data) return <p className="admin-empty">Loading…</p>;

  const labels = series.map((d) => shortDay(d.day));
  const totals = series.reduce(
    (a, d) => ({
      replies: a.replies + d.replies,
      tokensIn: a.tokensIn + d.prompt_tokens,
      tokensOut: a.tokensOut + d.completion_tokens,
      costUsd: a.costUsd + d.cost_usd,
      paidCents: a.paidCents + d.paid_cents,
    }),
    { replies: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, paidCents: 0 }
  );
  const activeToday = data.people.filter((p) => p.last_at >= data.window.start_of_today);
  const searches = data.tools?.days.filter((d) => d.tool === "web_search") ?? [];
  const searchByDay = series.map((d) => searches.find((s) => s.day === d.day)?.calls ?? 0);
  const reads = data.tools?.days.filter((d) => d.tool === "read_page") ?? [];

  return (
    <div className="dash">
      <div className="dash-range">
        {RANGES.map((n) => (
          <button key={n} type="button" className={n === days ? "active" : ""} onClick={() => setDays(n)}>
            {n} days
          </button>
        ))}
        <span className="admin-hint">Days are Pacific, like the rest of Lechuga.</span>
      </div>

      <div className="dash-tiles">
        <Tile label="People" value={String(data.people.length)} note={`${activeToday.length} today`} />
        <Tile label="Replies" value={num(totals.replies)} note={`${num(Math.round(totals.replies / Math.max(series.length, 1)))} a day`} />
        <Tile label="Tokens in" value={compact(totals.tokensIn)} />
        <Tile label="Tokens out" value={compact(totals.tokensOut)} />
        <Tile label="Money in" value={usd(totals.paidCents / 100)} note="before Stripe's cut" />
        <Tile label="Our cost" value={usd(totals.costUsd)} note={`${data.markup}× markup`} />
        <Tile
          label="Margin"
          value={totals.costUsd > 0 ? `${(totals.paidCents / 100 / totals.costUsd).toFixed(1)}×` : "—"}
          note="money in ÷ our cost"
        />
      </div>

      <Panel title="People here each day" hint="Anyone charged for a reply. In a shared chat that's the owner, so a guest shows under whoever pays.">
        <Chart
          labels={labels}
          series={[{ key: "people", label: "People", color: SERIES[0], points: series.map((d) => d.active_users) }]}
          format={num}
        />
        {activeToday.length > 0 && (
          <p className="dash-who">
            Today: {activeToday.map((p) => who(p)).join(", ")}
          </p>
        )}
      </Panel>

      <Panel title="Tokens each day" hint="What went into the models and what came back out.">
        <Chart
          labels={labels}
          series={[
            { key: "in", label: "In", color: SERIES[0], points: series.map((d) => d.prompt_tokens) },
            { key: "out", label: "Out", color: SERIES[1], points: series.map((d) => d.completion_tokens) },
          ]}
          format={compact}
        />
      </Panel>

      <Panel title="Tokens by model" hint="In and out together, per model.">
        {modelSeries.length === 0 ? (
          <p className="admin-empty">Nothing yet in this window.</p>
        ) : (
          <>
            <Chart labels={labels} series={modelSeries} format={compact} />
            <table className="admin-table dash-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="num">Replies</th>
                  <th className="num">In</th>
                  <th className="num">Out</th>
                  <th className="num">Cost us</th>
                  <th className="num">Charged</th>
                </tr>
              </thead>
              <tbody>
                {data.models.map((m: AdminActivityModel) => (
                  <tr key={m.model}>
                    <td>{modelLabel(m.model)}</td>
                    <td className="num">{num(m.replies)}</td>
                    <td className="num">{compact(m.prompt_tokens)}</td>
                    <td className="num">{compact(m.completion_tokens)}</td>
                    <td className="num">{usd(m.cost_usd)}</td>
                    <td className="num">{usd(m.credits_spent * 0.0001)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Panel>

      <Panel title="Money in each day" hint="Packs and subscriptions, less refunds. What Stripe took isn't deducted here.">
        <Bars labels={labels} values={series.map((d) => d.paid_cents / 100)} color={SERIES[0]} format={usd} />
      </Panel>

      <Panel
        title="Outside services"
        hint="What we pay per call to anyone but Cloudflare. Searches are counted, never recorded: we don't keep what anyone typed."
      >
        <ToolsPanel tools={data.tools} labels={labels} searchByDay={searchByDay} reads={reads} />
      </Panel>

      <Panel title="People" hint="Everyone charged for a reply in this window, busiest first.">
        <table className="admin-table dash-table">
          <thead>
            <tr>
              <th>Who</th>
              <th className="num">Replies</th>
              <th className="num">In</th>
              <th className="num">Out</th>
              <th className="num">Searches</th>
              <th className="num">Cost us</th>
              <th className="num">Charged</th>
              <th className="num">Balance</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {data.people.map((p: AdminActivityPerson) => {
              const t = data.tools?.people.find((x) => x.user_id === p.id);
              return (
                <tr key={p.id}>
                  <td>
                    {who(p)}
                    {p.suspended_at ? <span className="dash-flag">suspended</span> : null}
                  </td>
                  <td className="num">{num(p.replies)}</td>
                  <td className="num">{compact(p.prompt_tokens)}</td>
                  <td className="num">{compact(p.completion_tokens)}</td>
                  <td className="num">{t ? num(t.searches) : "—"}</td>
                  <td className="num">{usd(p.cost_usd)}</td>
                  <td className="num">{usd(p.credits_spent * 0.0001)}</td>
                  <td className="num">{num(p.balance)}</td>
                  <td>{ago(p.last_at)}</td>
                </tr>
              );
            })}
            {data.people.length === 0 && (
              <tr>
                <td colSpan={9} className="admin-empty">
                  Nobody sent anything in this window.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function ToolsPanel({
  tools,
  labels,
  searchByDay,
  reads,
}: {
  tools: AdminActivityTools;
  labels: string[];
  searchByDay: number[];
  reads: { day: string; calls: number; failed: number }[];
}) {
  if (!tools) {
    return (
      <p className="admin-empty">
        Nothing recorded yet — migration 0010 hasn't been run on this tier. Until it has, searches still work and are still
        charged; they just aren't counted here.
      </p>
    );
  }
  const used = tools.month_searches;
  const pct = Math.min(100, (used / Math.max(tools.free_quota, 1)) * 100);
  const readCalls = reads.reduce((n, r) => n + r.calls, 0);
  const failed = reads.reduce((n, r) => n + r.failed, 0) + (tools.days.filter((d) => d.tool === "web_search").reduce((n, d) => n + d.failed, 0) || 0);
  return (
    <>
      <div className="dash-quota">
        <div className="dash-quota-head">
          <strong>Brave</strong>
          <span>
            {num(used)} of {num(tools.free_quota)} free searches this month
          </span>
        </div>
        <div className="dash-meter" role="img" aria-label={`${Math.round(pct)} percent of the free monthly searches used`}>
          <span style={{ width: `${pct}%`, background: pct > 80 ? SERIES[3] : SERIES[0] }} />
        </div>
        <p className="admin-hint">
          {tools.search_enabled ? "Search is on for this tier." : "No BRAVE_SEARCH_API_KEY here, so only read_page is offered."}
          {failed > 0 ? ` ${num(failed)} call${failed === 1 ? "" : "s"} failed in this window.` : ""}
        </p>
      </div>

      <Bars labels={labels} values={searchByDay} color={SERIES[0]} format={num} />

      <div className="dash-split">
        <div>
          <h4>Who searched</h4>
          <table className="admin-table dash-table">
            <thead>
              <tr>
                <th>Who</th>
                <th className="num">Searches</th>
                <th className="num">Pages read</th>
                <th className="num">Cost us</th>
              </tr>
            </thead>
            <tbody>
              {tools.people.map((p) => (
                <tr key={p.user_id}>
                  <td>{who(p)}</td>
                  <td className="num">{num(p.searches)}</td>
                  <td className="num">{num(p.reads)}</td>
                  <td className="num">{usd(p.cost_usd)}</td>
                </tr>
              ))}
              {tools.people.length === 0 && (
                <tr>
                  <td colSpan={4} className="admin-empty">
                    No tool calls in this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div>
          <h4>Pages read ({num(readCalls)})</h4>
          <table className="admin-table dash-table">
            <thead>
              <tr>
                <th>Site</th>
                <th className="num">Times</th>
              </tr>
            </thead>
            <tbody>
              {tools.hosts.map((h) => (
                <tr key={h.host}>
                  <td>{h.host}</td>
                  <td className="num">{num(h.reads)}</td>
                </tr>
              ))}
              {tools.hosts.length === 0 && (
                <tr>
                  <td colSpan={2} className="admin-empty">
                    Nothing read yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

type Series = { key: string; label: string; color: string; points: number[] };

// A line chart with a crosshair: hovering anywhere snaps to the nearest day
// and shows every series at once, which is the question you actually have
// ("what happened on the 14th?"), not one series at a time.
function Chart({ labels, series, format }: { labels: string[]; series: Series[]; format: (n: number) => string }) {
  const [at, setAt] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const W = 720;
  const H = 210;
  const PAD = { top: 12, right: 64, bottom: 24, left: 46 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const max = Math.max(1, ...series.flatMap((s) => s.points));
  const top = niceCeil(max);
  const n = labels.length;
  const x = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    // The SVG scales to its container, so a client x has to come back through
    // the viewBox before it means anything.
    const vx = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((vx - PAD.left) / plotW) * (n - 1));
    setAt(Math.max(0, Math.min(n - 1, i)));
  };

  const ticks = [0, top / 2, top];
  // Every label would collide; roughly six reads well at any range.
  const every = Math.max(1, Math.ceil(n / 6));

  return (
    <div className="dash-chart">
      {series.length > 1 && (
        <div className="dash-legend">
          {series.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="dash-svg"
        onMouseMove={onMove}
        onMouseLeave={() => setAt(null)}
        role="img"
        aria-label={`${series.map((s) => s.label).join(" and ")} per day. The table below the charts has the same numbers.`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={INK_FAINT}>
              {format(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % every === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={11} fill={INK_FAINT}>
              {l}
            </text>
          ) : null
        )}
        {at !== null && <line x1={x(at)} x2={x(at)} y1={PAD.top} y2={PAD.top + plotH} stroke={INK_FAINT} strokeWidth={1} strokeDasharray="3 3" />}
        {series.map((s) => (
          <polyline
            key={s.key}
            points={s.points.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {/* The last value, named in its own colour's company: with four
            series a legend alone makes you count across to work out which
            line is which. */}
        {series.map((s) => (
          <text key={s.key} x={W - PAD.right + 8} y={y(s.points[n - 1] ?? 0) + 4} fontSize={11} fill={INK_DIM}>
            {format(s.points[n - 1] ?? 0)}
          </text>
        ))}
        {at !== null &&
          series.map((s) => (
            <circle key={s.key} cx={x(at)} cy={y(s.points[at] ?? 0)} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />
          ))}
      </svg>
      {at !== null && (
        <div className="dash-tip" style={{ left: `${(x(at) / W) * 100}%` }}>
          <strong>{labels[at]}</strong>
          {series.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} />
              {s.label} {format(s.points[at] ?? 0)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Money and searches arrive in lumps with empty days between them, and a line
// through a lump implies a slope that isn't there.
function Bars({ labels, values, color, format }: { labels: string[]; values: number[]; color: string; format: (n: number) => string }) {
  const [at, setAt] = useState<number | null>(null);
  const W = 720;
  const H = 180;
  const PAD = { top: 12, right: 16, bottom: 24, left: 46 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const top = niceCeil(Math.max(1, ...values));
  const n = values.length;
  const slot = plotW / n;
  // A 2px gap so neighbouring bars read as two marks, not one block.
  const w = Math.max(2, slot - 2);
  const every = Math.max(1, Math.ceil(n / 6));
  const total = values.reduce((a, b) => a + b, 0);

  return (
    <div className="dash-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="dash-svg" role="img" aria-label={`Per day, ${format(total)} in total across the window.`}>
        {[0, top / 2, top].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH - (t / top) * plotH} y2={PAD.top + plotH - (t / top) * plotH} stroke={GRID} strokeWidth={1} />
            <text x={PAD.left - 8} y={PAD.top + plotH - (t / top) * plotH + 4} textAnchor="end" fontSize={11} fill={INK_FAINT}>
              {format(t)}
            </text>
          </g>
        ))}
        {values.map((v, i) => {
          const h = v > 0 ? Math.max(2, (v / top) * plotH) : 0;
          return (
            <g key={i} onMouseEnter={() => setAt(i)} onMouseLeave={() => setAt(null)}>
              {/* A full-height target, so a one-pixel bar is still hoverable. */}
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent" />
              {h > 0 && <rect x={PAD.left + i * slot + (slot - w) / 2} y={PAD.top + plotH - h} width={w} height={h} rx={2} fill={color} opacity={at === null || at === i ? 1 : 0.55} />}
            </g>
          );
        })}
        {labels.map((l, i) =>
          i % every === 0 || i === n - 1 ? (
            <text key={i} x={PAD.left + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize={11} fill={INK_FAINT}>
              {l}
            </text>
          ) : null
        )}
      </svg>
      {at !== null && (
        <div className="dash-tip" style={{ left: `${((PAD.left + at * slot + slot / 2) / W) * 100}%` }}>
          <strong>{labels[at]}</strong>
          <span>{format(values[at] ?? 0)}</span>
        </div>
      )}
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="dash-panel">
      <h3>{title}</h3>
      {hint && <p className="admin-hint">{hint}</p>}
      {children}
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="dash-tile">
      <span className="dash-tile-label">{label}</span>
      <strong>{value}</strong>
      {note && <span className="dash-tile-note">{note}</span>}
    </div>
  );
}

function who(p: { username: string | null; email: string }): string {
  return p.username ? `@${p.username}` : p.email;
}

function modelLabel(id: string): string {
  return id.split("/").pop() ?? id;
}

function num(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

function usd(n: number): string {
  if (n === 0) return "$0";
  if (Math.abs(n) < 1) return `$${n.toFixed(2)}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// A round number above the peak, so the top gridline is readable rather than
// "13,847".
function niceCeil(n: number): number {
  if (n <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / (pow / 2)) * (pow / 2);
}

function pacificKey(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

function shortDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function ago(ms: number): string {
  if (!ms) return "—";
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}
