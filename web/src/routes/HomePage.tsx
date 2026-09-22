import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Composer } from "../components/Composer";
import { SiteFooter } from "../components/SiteFooter";
import { WhereItGoes } from "../components/WhereItGoes";
import { randomEmptyLine } from "../emptyLine";
import type { Model } from "../api";

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
// links to them.
const SECTIONS: Section[] = [
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
        text:
          "You start with some credits from us. After that, $5 buys credits and $10 buys twice as many; you pay once and use them whenever you like, and they don't expire. If you'd rather, it's $5 a month, and whatever you don't use rolls over. You can cancel at any time and keep what's left.",
      },
      {
        text:
          "A dollar of credits is enough for hundreds of ordinary messages, and a long chat with a big document in it costs more. Every reply shows what it cost, and your balance is always in view.",
      },
    ],
  },
  {
    id: "what-it-costs-us",
    title: "Where the money goes",
    paragraphs: [
      {
        text:
          "We publish our numbers, because it's the only way you can tell whether a price is fair. Right now Cloudflare charges us $0.15 per million input tokens and $0.50 per million output tokens for GLM 5.3 Flash, and we charge twice that. The other half covers card fees, the server bill, the domains, the free chat on this page, the occasional refund, and then us. If our costs come down, so do our prices. Here's how a purchase splits up:",
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
    ],
  },
  {
    id: "what-it-doesnt-do",
    title: "What it doesn't do",
    paragraphs: [
      {
        text:
          "There's no image generation, no video, no \"uncensored\" mode, no characters to talk to, no API and no enterprise plan. If you need those things, there are plenty of companies that would be happy to sell them to you.",
      },
    ],
  },
];

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
        {SECTIONS.map((s) => (
          <div className="marketing-section" id={s.id} key={s.id}>
            <h2>{s.title}</h2>
            {s.paragraphs.map((p, i) => (
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
            {s.id === "what-it-costs-us" && <WhereItGoes />}
          </div>
        ))}
      </section>
      <SiteFooter />
    </div>
  );
}
