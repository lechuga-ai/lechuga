import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Composer } from "../components/Composer";
import { SiteFooter } from "../components/SiteFooter";
import { WhereItGoes } from "../components/WhereItGoes";
import { randomEmptyLine } from "../emptyLine";
import type { Model } from "../api";
import config from "../../../worker/config.json";

const PACKS = config.credit_packs;
const SUB = config.subscription;
const MARKUP = config.costs.markup === 2 ? "twice" : `${config.costs.markup} times`;
const perMillion = (credits: number) => `$${(credits / 10000).toFixed(2)}`;

type Props = {
  models: Model[];
  selectedModel: string;
  onSelectModel: (id: string) => void;
  // Creates the chat and navigates to /c/:id; rejects if creation fails.
  onSend: (content: string, model?: string) => Promise<void>;
  // lechuga is invite only: both open the sign-in card, on its sign-in form
  // and on its request-access form.
  onSignIn: () => void;
  onRequestInvite: () => void;
};

type Section = {
  id: string;
  title: string;
  // source: where a number in the paragraph comes from, linked after it.
  paragraphs: { lead?: string; text: string; source?: { label: string; href: string } }[];
};

// In Cynthia's voice, like the About page: plain, warm, explaining as it
// goes, no punchline sentences. Keep the numbers true (they're checked against
// config.json and Artificial Analysis) and keep the section ids: the footer
// links to them. Shown here and again on /welcome for people who are signed
// in (routes/WelcomePage.tsx).
export const HOME_SECTIONS: Section[] = [
  {
    id: "what-it-is",
    title: "What it is",
    paragraphs: [
      {
        text:
          "Lechuga is a chat assistant, the kind where you type a question into a box and get an answer, with your past chats down the left side so you can come back to them. Under the hood it runs open source AI models (currently GLM 5.3 Flash and GLM 5.3 from Z.ai, and DeepSeek V4 Flash) on Cloudflare's infrastructure.",
      },
      {
        text:
          "We started it because we wanted somewhere to send our friends. Open source models turned out to be surprisingly good, good enough for nearly everything people actually use a chat assistant for, and we didn't see why using one should mean running your own server or reading pages of documentation first. So we built the easy version: sign in, type, get an answer, and pay only for what it costs.",
      },
      {
        text:
          "Every chat is with a bot. You start with one, called Seed, and make more by naming them for a job (Sous Chef, Homework Helper): Lechuga works out from the name how each should behave, and you can rewrite that, pick a model for it, and share it.",
      },
    ],
  },
  {
    id: "sharing",
    title: "Sharing",
    paragraphs: [
      {
        text:
          "A chat or a bot has one setting for who can see it, with three choices: only you, people you choose, or everyone on Lechuga. Change it from Share, on the chat or the bot. Nothing changes until you press Done, and anything that takes access away asks first.",
      },
      {
        lead: "A chat you share",
        text:
          "is read in full by the people you share it with, from the first message, and they can keep it going; every message shows who typed it. The replies come out of your credits, whoever asked. Remove someone and they lose sight of it; what they wrote stays.",
      },
      {
        lead: "A bot you share",
        text:
          "gives each person their own chats with it, which you can read, and they're told so. You pay for those too. It's how a household shares one well-tuned bot, and how you set one up for someone who has no email address: make them a username and a code, and the account can only chat with what you've given it. Turn Guarded on in Bot Manager and the bot keeps everything suitable for a young person, with a check on every message that emails you about the serious kinds.",
      },
      {
        lead: "Everyone on Lechuga",
        text:
          "means public: anyone signed in can read it, it's listed under Public in the menu behind your name, and the replies come out of Lechuga's credits rather than yours. Only you and the people you've chosen can write in a public chat. Your name is on it. A public bot makes every chat with it public, the ones so far included. Public can be undone from the same place.",
      },
    ],
  },
  {
    id: "why-its-different",
    title: "Why we made it",
    paragraphs: [
      {
        lead: "Mostly because of what people tell these things.",
        text:
          "People say things to a chat assistant that they would never type into a search box: what they're worried about, what they're planning, what hurts. Ads are starting to appear in chat assistants, and there has never been better material for targeting them. We wanted a place where that isn't a question you have to ask. Lechuga has no ads and no advertisers, and your chats are kept so you can come back to them and for no other reason. They aren't used to train anything, they aren't sold, and we don't read them. Delete a chat and it's gone. Delete your account and everything goes with it.",
      },
      {
        lead: "Your chats stay with a company you can name.",
        text:
          "Some of the best open source models come from labs in China, and many of the services that offer them send your chats to the model maker's own servers. Lechuga runs the models on Cloudflare, an American company, on Cloudflare's own machines, and none of it runs in China. Your words never reach the company that trained the model.",
      },
      {
        lead: "It's cheaper, and you can see why.",
        text:
          "Open source models cost very little to run, so an ordinary conversation on Lechuga costs a fraction of a cent, and you only pay for what you use. We charge twice what the models cost us, the other half covers the bills, and the sums are further down this page. We aren't trying to make money from this; we're trying to cover our costs and give our friends something good. When you can see exactly what a reply costs and what we charge on top, nobody has to guess whether they're getting a fair deal.",
      },
      {
        lead: "The models are good, though not the very best.",
        text:
          "On Artificial Analysis's independent Intelligence Index, GLM 5.3 Flash, the model Lechuga uses by default, scores 42. The very best models from OpenAI and Anthropic score 53, and cost more than ten times as much per task to get there (September 2026). You'll notice the difference on hard coding and research problems, and on most everyday things you won't.",
        source: { label: "artificialanalysis.ai", href: "https://artificialanalysis.ai/leaderboards/models" },
      },
      {
        lead: "It's for friends and family.",
        text:
          "Lechuga is a side project by the two of us, Cynthia and Teg, who like what these models can do and dislike most of what the AI business has become. There's no company behind it, no venture funding and no growth target. It's an alpha, so some things will be rough, and when you find one we'd love to hear about it. It's invite only for now, which means if you're reading this, someone we like sent you.",
      },
    ],
  },
  {
    id: "what-it-costs",
    title: "What it costs",
    paragraphs: [
      {
        text: `You start with ${config.starter_credits.toLocaleString()} credits from us. After that, ${PACKS.map((p) => `$${p.usd} buys ${p.credits.toLocaleString()}`).join(" and ")}; you pay once and use them whenever you like, and they don't expire. If you'd rather, it's $${SUB.usd} a month for ${SUB.credits.toLocaleString()} credits each month, and whatever you don't use rolls over. You can cancel at any time and keep what's left.`,
      },
      {
        text:
          "10,000 credits is a dollar of use, which is enough for hundreds of ordinary messages; a long chat with a big document in it costs more. Every reply shows what it cost, and your balance is always in view.",
      },
    ],
  },
  {
    id: "what-it-costs-us",
    title: "Where the money goes",
    paragraphs: [
      {
        text: `We publish our numbers, because it's the only way you can tell whether a price is fair. We charge ${MARKUP} what Cloudflare charges us to run each model, and that's the whole pricing model. The other half covers card fees, the server bill, the domains, the free chat on the home page, the occasional refund, and then us. If our costs come down, so do our prices. Here's how a purchase splits up:`,
      },
    ],
  },
  {
    id: "where-your-words-go",
    title: "Where your words go",
    paragraphs: [
      {
        text:
          "Your messages are stored in our database on Cloudflare so you can come back to them, and that's the only place they go. They aren't used to train anything, they aren't sold, and we don't have advertisers to share them with. We don't read them either. Delete a chat and it's gone, and delete your account and everything goes with it.",
      },
      {
        text:
          "Nothing is seen by anyone else unless you choose it. A chat you share is read by the people you shared it with; a chat you make public is read by everyone on Lechuga, with your name on it, and you can make it private again. A bot can carry a short note about you from one chat to the next; it's yours to read, edit or wipe under Account, and it never goes into a chat anyone else can see.",
      },
    ],
  },
  {
    id: "what-it-doesnt-do",
    title: "What it doesn't do",
    paragraphs: [
      {
        text:
          "There's no image generation, no video, no \"uncensored\" mode, no API and no enterprise plan. If you need those things, there are plenty of companies that would be happy to sell them to you.",
      },
    ],
  },
];

// One section's paragraphs, and the cost breakdown under the one about costs.
export function HomeSectionBody({ section }: { section: Section }) {
  return (
    <>
      {section.paragraphs.map((p, i) => (
        <p key={i}>
          {p.lead && <strong>{p.lead} </strong>}
          {p.text}
          {p.source && (
            <>
              {" "}
              <a className="marketing-source" href={p.source.href} target="_blank" rel="noopener">
                Source: {p.source.label}
              </a>
            </>
          )}
        </p>
      ))}
      {section.id === "what-it-costs-us" && (
        <>
          <WhereItGoes />
          <ModelRates />
        </>
      )}
    </>
  );
}

// What each model costs, and a search. Models are priced per million tokens,
// so that's how they're listed; in the app you only ever see credits.
function ModelRates() {
  return (
    <>
      <p>
        Model by model, that comes to the prices below, per million tokens (a token is about three-quarters of a word).
        In the app you only ever see credits.
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>model</th>
            <th>what you type and the chat so far</th>
            <th>the reply</th>
          </tr>
        </thead>
        <tbody>
          {config.models
            .filter((m) => !("retired" in m && m.retired))
            .map((m) => (
              <tr key={m.id}>
                <td>{m.label}</td>
                <td>{perMillion(m.credit_per_million_prompt_tokens)}</td>
                <td>{perMillion(m.credit_per_million_completion_tokens)}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <p>
        When the model searches the web on your behalf, each search is {config.tools.web_search.credits} credits (Brave
        Search charges us ${config.tools.web_search.cost_usd.toFixed(3)}, doubled the same way). Reading a web page
        costs nothing extra. Both show as steps above the reply, so you can see what it looked up.
      </p>
    </>
  );
}

export function HomePage({ models, selectedModel, onSelectModel, onSend, onSignIn, onRequestInvite }: Props) {
  const placeholder = useMemo(randomEmptyLine, []);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { hash } = useLocation();

  // The footer links to sections here by hash (e.g. from /about). Landing
  // on "/" directly with a hash already scrolls there via the browser; this
  // covers arriving from another route, where the router doesn't.
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    el?.scrollIntoView();
  }, [hash]);

  async function send(content: string) {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(content);
    } catch (err) {
      setError((err as Error).message || "couldn't start a chat");
      setSending(false);
    }
  }

  return (
    <div className="home">
      <section className="home-hero">
        <button type="button" className="home-signin" onClick={onSignIn}>
          Sign in
        </button>
        <img className="hero-logo" src="/lechuga_logo.png" alt="" />
        <h1 className="hero-title">
          Lechuga <span className="alpha" title="Early days: rough edges expected">alpha</span>
        </h1>
        <p className="hero-tag">Lechuga is lettuce in Spanish.</p>
        <p className="hero-sub">
          It's also a chat assistant that runs open source AI models on a US company's servers. For friends and
          family.
        </p>
        <Composer
          streaming={sending}
          models={models}
          selectedModel={selectedModel}
          modelLocked
          modelLockedTitle="The free chat uses this model. With an account you can pick."
          placeholder={placeholder}
          onSelectModel={onSelectModel}
          onSend={(content) => void send(content)}
          onStop={() => {}}
          sendLabel="Try it"
        />
        <div className="hero-actions">
          <a className="hero-btn" href="#what-it-is">
            How it works
          </a>
        </div>
        {error && <p className="hero-error">{error}</p>}
        <a className="hero-scroll" href="#what-it-is">
          Scroll to learn more
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M2 5l5 5 5-5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
      </section>
      <section className="home-marketing">
        {HOME_SECTIONS.map((s) => (
          <div className="marketing-section" id={s.id} key={s.id}>
            <h2>{s.title}</h2>
            <HomeSectionBody section={s} />
          </div>
        ))}
      </section>
      <SiteFooter />
    </div>
  );
}
