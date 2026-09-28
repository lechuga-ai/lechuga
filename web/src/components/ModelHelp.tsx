import { useEffect } from "react";
import { Link } from "react-router-dom";
import type { Model } from "../api";
import config from "../../../worker/config.json";

type Props = {
  models: Model[];
  selectedModel: string;
  onClose: () => void;
};

// Effort, described for someone who hasn't met the idea. config.json has a
// one-line hint per setting for the menu; this is the longer version, keyed
// by the same ids, with the hint as the fallback for any setting added later.
const EFFORT_DETAIL: Record<string, string> = {
  low: "It answers straight away, without working anything out first. This is the fastest and the cheapest, and it is all you need for a quick fact, a rewrite, or an ordinary conversation.",
  medium:
    "It thinks briefly before it answers. On anything with steps in it, such as a sum, a plan, or a piece of code, the answer is noticeably better. It costs about three times what low does, because you pay for the working-out as well as the reply. This is the default.",
  high: "It thinks for as long as it needs. This is the slowest and costs the most. It is the one to choose for a genuinely hard problem, where the extra care pays off.",
};

// The "?" beside the model name: what a model is, which ones are here and
// what each is for, and what the effort setting does to the answer and the
// price. Written for someone using a chat assistant for the first time.
export function ModelHelp({ models, selectedModel, onClose }: Props) {
  const base = models[0];
  const shown = models.filter((m) => !m.retired || m.id === selectedModel);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide model-help" role="dialog" aria-modal="true" aria-labelledby="model-help-title" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <h2 id="model-help-title">Which model, and how hard it thinks</h2>

        <h3>The models</h3>
        <p>
          A model is the program that writes the replies. Lechuga offers a few, made by different labs. They differ in
          how sharp they are, how quickly they answer, and what they cost. The first one is the right choice for most
          people most of the time. The others are there for when it gets something wrong and you want a second opinion.
        </p>
        <ul className="model-help-list">
          {shown.map((m) => {
            // Replies are most of any bill, so compare on the output rate.
            const times = base ? Math.round(m.credit_per_million_completion_tokens / base.credit_per_million_completion_tokens) : 1;
            return (
              <li key={m.id} className={m.id === selectedModel ? "selected" : ""}>
                <span className="model-help-name">
                  {m.label}
                  <span className="model-help-cost">{m.id === base?.id ? "our default" : `about ${times}× the cost`}</span>
                </span>
                {m.blurb && <span className="model-help-blurb">{m.blurb}</span>}
              </li>
            );
          })}
        </ul>
        <p>A chat keeps the model it started with. To try a different one, start a new chat.</p>

        <h3>Effort</h3>
        <p>
          Before it answers, a model can write itself some working notes and reason the problem through, much as you
          might scribble on paper before replying to a hard question. The effort setting beside the model name decides
          how much of that it does, and you can watch the working-out as it happens.
        </p>
        <ul className="model-help-list">
          {config.efforts.map((e) => (
            <li key={e.id}>
              <span className="model-help-name">{e.label}</span>
              <span className="model-help-blurb">{EFFORT_DETAIL[e.id] ?? e.hint}</span>
            </li>
          ))}
        </ul>
        <p>
          On a simple question, all three give much the same answer, so low gets you the same result for less. The
          setting matters on problems that take reasoning, and there the higher ones are worth their price.
        </p>

        <p className="model-help-foot">
          Exact prices are under <Link to="/welcome#what-it-costs-us">Where the money goes</Link>. There is more on choosing well in{" "}
          <Link to="/help/getting-started">Getting started with AI</Link>.
        </p>
      </div>
    </div>
  );
}
