import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { SiteFooter } from "../components/SiteFooter";
import { WhereItGoes } from "../components/WhereItGoes";
import config from "../../../worker/config.json";

// /terms and /privacy are components/Legal.tsx: those are the texts people
// accept on the username step, so there is one copy of each. Every static
// page gets the full trust footer.
export function DocPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="doc-page">
      <div className="doc-inner">
        <Link className="doc-brand" to="/">
          <span className="logo">
            <img src="/lechuga_logo.png" alt="" />
          </span>
          Lechuga
        </Link>
        <h1>{title}</h1>
        {children}
      </div>
      <SiteFooter />
    </div>
  );
}

type TeamMemberProps = { name: string; photo: string; linkedin: string; facts: { label: string; value: ReactNode }[] };

function TeamMember({ name, photo, linkedin, facts }: TeamMemberProps) {
  return (
    <div className="about-person">
      <img className="about-avatar" src={photo} alt={name} />
      <div className="about-person-info">
        <div className="about-person-name">
          {name}{" "}
          <a href={linkedin} target="_blank" rel="noopener">
            LinkedIn
          </a>
        </div>
        {facts.map((fact) => (
          <div className="about-person-fact" key={fact.label}>
            <span className="about-person-fact-label">{fact.label}:</span> {fact.value}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AboutPage() {
  return (
    <DocPage title="About Lechuga">
      <p>
        Lechuga is a chat assistant that runs open source AI models — currently GLM 5.3 Flash and GLM 5.3 from Z.ai,
        and DeepSeek V4 Flash — on Cloudflare's infrastructure, at a fraction of what the big labs charge.
      </p>
      <p>
        We started this because we wanted somewhere to send our friends. Open source models turned out to be
        surprisingly good — good enough for nearly everything people actually use a chat assistant for — and we
        didn't see why using one well should mean running your own server or reading pages of documentation first. So
        we built the easy version: sign in, type, get an answer, and pay only what it costs.
      </p>
      <p>
        That openness is also why we think this is fairer, not just cheaper. When you can see exactly what a reply
        costs to run and what we charge on top of it, nobody's guessing whether they're getting a fair deal. It tends
        to be lighter on the planet too: we run smaller, efficient open-weight models instead of the biggest frontier
        ones, and that means less compute behind every reply.
      </p>
      <p>
        It's a side project, run by people who like what these models can do and dislike most of what the AI business
        has become. There's no venture funding, no growth target, and no plan to sell your attention or your data.
      </p>

      <h2 className="about-section-title">Who we are</h2>
      <div className="about-team">
        <TeamMember
          name="Cynthia Johanson"
          photo="/cynthia.jpg"
          linkedin="https://www.linkedin.com/in/johanson/"
          facts={[
            {
              label: "Favorite book",
              value: (
                <a href="https://bookshop.org/p/books/circe-madeline-miller/e28b1768925ee3b0" target="_blank" rel="noopener">
                  Circe, by Madeline Miller
                </a>
              ),
            },
            { label: "Favorite lettuce", value: "arugula" },
            { label: "Often found at", value: "Love Potion Library, Gamescape, or ABFits" },
          ]}
        />
        <TeamMember
          name="Teg Grenager"
          photo="/teg.jpg"
          linkedin="https://www.linkedin.com/in/grenager/"
          facts={[
            {
              label: "Favorite podcast",
              value: (
                <a href="https://www.acquired.fm" target="_blank" rel="noopener">
                  Acquired
                </a>
              ),
            },
            { label: "Favorite lettuce", value: "little gem" },
            { label: "Often found", value: "running in the hills with his dogs" },
          ]}
        />
      </div>

      <p>
        Say hi: <a href="mailto:hello@lechuga.ai">hello@lechuga.ai</a>.
      </p>
    </DocPage>
  );
}

const perMillion = (credits: number) => `$${(credits / 10000).toFixed(2)}`;

// /pricing: what it costs and where the money goes, for anyone, signed in or
// not (the home page says the same, but only signed-out visitors see it).
export function PricingPage() {
  const packs = config.credit_packs;
  return (
    <DocPage title="Pricing, and where the money goes">
      <p>
        {packs.map((p) => `$${p.usd} buys ${p.credits.toLocaleString()} credits`).join(". ")}. Or ${config.subscription.usd} a
        month adds {config.subscription.credits.toLocaleString()} credits each month, and unused ones roll over. Credits
        never expire. 10,000 credits is $1 of use, and every reply shows what it cost.
      </p>
      <p>
        We charge {config.costs.markup === 2 ? "twice" : `${config.costs.markup} times`} what Cloudflare charges us to run
        each model, and that's the whole pricing model. Models are priced per million tokens (a token is about three-quarters
        of a word), so that's how we list them here; in the app you only ever see credits.
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
        Search charges us ${config.tools.web_search.cost_usd.toFixed(3)}, and the same doubling applies). Reading a web
        page costs nothing extra. Both show as steps above the reply, so you can see what it looked up.
      </p>
      <WhereItGoes />
    </DocPage>
  );
}

// /whats-new: what Lechuga can do, newest first, each with its date. To
// announce something, add an entry at the top of NEWS: a date, a headline, a
// sentence or two of why, then the changes, each with a short bold lead.
type NewsEntry = { date: string; title: string; intro: string; items: { lead: string; text: string }[] };

const NEWS: NewsEntry[] = [
  {
    date: "September 22, 2026",
    title: "It can look things up",
    intro:
      "The models know a great deal, but only up to the day their training ended, and until now Lechuga had no way past that. Now the model can search the web and read pages while it answers you, when it decides it needs to.",
    items: [
      {
        lead: "Search and read, when it matters.",
        text: "Ask about something recent, or something the model isn't sure of, and it will search the web, open the pages that look right and answer from them, with links to what it read. You'll see each step above the reply as it happens: what it searched for, which sites it looked at. Ask it to read a particular address and it will.",
      },
      {
        lead: "What a search costs.",
        text: "Reading a page is free. A search is 100 credits, a cent, which is what the search company charges us, doubled, the same as everything else here. The model is asked not to search for things it already knows, and the cost of any searches is folded into the reply's cost line.",
      },
      {
        lead: "The model knows a little about where it is.",
        text: "Every chat now begins with a quiet note to the model: what day it is, that its knowledge has an end date and it should say so rather than guess, that most of you are in California, and to be direct and skip the flattery. It also asks the model to think only as much as a question needs.",
      },
    ],
  },
  {
    date: "September 21, 2026 (later)",
    title: "It says alpha now",
    intro:
      "A small word next to the name, everywhere the name appears. It is there to set expectations: Lechuga is a few friends trying things out, and it will have rough edges for a while. Tell us about the ones you find.",
    items: [
      {
        lead: "The invite email got dressed.",
        text: "It now looks like the home page, says what Lechuga is and what it is not, and explains the name. If you have invited someone before and the invite lapsed, sending again renews the same one.",
      },
      {
        lead: "The models know what day it is.",
        text:
          "We measured the effort setting: on low, GLM 5.3 Flash skips its thinking entirely and answers at once for about a third of the cost, and on medium it thinks first and answers better. Medium stays the default, and the hints in the menu now say plainly what each one costs. Every chat also now begins with a quiet note to the model saying what day it is, that its knowledge has an end date and it should say so rather than guess, and that most of you are in California. Before, it tended to assume it was still early 2025.",
      },
      {
        lead: "Sales tax is handled by Stripe.",
        text: "Stripe is now the seller on your receipt and works out sales tax and VAT wherever you are. It takes a little more for doing so, and the where-the-money-goes sums on the home page say how much.",
      },
    ],
  },
  {
    date: "September 21, 2026",
    title: "Files from your phone, and some tidying",
    intro:
      "A day of smaller things, most of them found by using Lechuga on a phone and by sharing chats with real people for the first time.",
    items: [
      {
        lead: "A + in the message box.",
        text: "Until now the only ways to give Lechuga a file were to drag it in or paste it, and a phone can do neither. There is a + at the corner of the box now. Press it and your phone offers its photo library, its camera and its files; on a computer it opens the usual file picker. Everything after that is as before: pictures are scaled down and go to a model that can see, PDFs and Office files are turned into text.",
      },
      {
        lead: "Your name is optional.",
        text: "The profile would not save a photo unless you also filled in a name. It will now. Leave the name empty and the people you share chats with see your username instead.",
      },
      {
        lead: "An invite you already sent is used again.",
        text: "Share a chat with an address that has no account, and Lechuga asks to spend one of your invites. If you had invited that person before and the invite ran out unanswered, it now renews that one and sends the link again, without asking and without costing you a second invite. The same goes for inviting them again from the menu behind your name.",
      },
      {
        lead: "A head is 100,000 credits.",
        text: "It was 110,000, a tenth thrown in for buying the larger size. That is the kind of nudge we said we would not do: a credit is worth the same whichever way you buy it, so $10 now buys exactly twice what $5 does. Credits already bought are untouched.",
      },
      {
        lead: "Deleting your account has moved.",
        text: "It sat in the menu behind your name, one line under Sign out, which is a poor place for something with no undo. It is at the foot of the credits page now, and still asks you to type the word before it does anything.",
      },
    ],
  },
  {
    date: "September 20, 2026",
    title: "Chats you can share",
    intro:
      "Until now a chat was yours and nobody else's. Now you can bring a friend into one and keep it going together: they read all of it, they can ask their own questions, and because it is still your chat, the bill is still yours.",
    items: [
      {
        lead: "Share a chat with someone.",
        text: "Open a chat and press Share, then add people by username or by email address, up to ten of them. They get the whole conversation from its first message, files and pictures included, and they can carry on typing in it just as you would. If the address you enter has no account yet, Lechuga offers to spend one of your invites, and the chat is waiting for them the moment they sign in.",
      },
      {
        lead: "The replies come out of your credits.",
        text: "Whoever asks the question, every reply in a chat you started is charged to you. It says so plainly before you share, and each reply still shows what it cost. Worth knowing before you hand a chat to someone with a great many questions.",
      },
      {
        lead: "A face and a name to go with it.",
        text: "There is a profile behind your name now: what you would like to be called, and a photo if you want one. It is what the people you share chats with see. Your email address is not shown to them, ever.",
      },
      {
        lead: "You can tell who said what.",
        text: "In a shared chat every message carries the name and face of whoever typed it, and the model is told who is speaking so it does not mix you up. The person whose chat it is wears a green ring, in the chat and in your list of chats.",
      },
      {
        lead: "And you can take it back.",
        text: "Remove someone and the chat disappears from their side. What they already wrote stays where it is, with their name on it, for everyone still there. Anyone who has had enough of a shared chat can leave it themselves.",
      },
      {
        lead: "The model, where it cannot change.",
        text: "A chat keeps the model it started with, so in an open chat the picker no longer pretends otherwise: it says which model is answering and leaves it at that. How hard it thinks is still yours to change, message by message.",
      },
    ],
  },
  {
    date: "September 19, 2026",
    title: "A day of tidying up",
    intro:
      "Lechuga opened yesterday. Today went to the things you only notice once real people are using something: where to find help, what you've paid for, and what happens when a chat gets very long.",
    items: [
      {
        lead: "Bring your own reading material.",
        text: "Drag a file onto the page, or paste in something long, and it tucks itself into a small card above your message instead of flooding the box. Lechuga reads the whole thing along with your question and keeps it in mind for the rest of the chat. PDFs, Word and Excel files, notes, Markdown, CSV, JSON and code all work. So do pictures, on GLM 5.3 Flash, the one model here that can see.",
      },
      {
        lead: "Compact a chat that's grown heavy.",
        text: "Every message re-reads the whole conversation, files included, and you pay for the reading. When that starts to add up, Lechuga tells you what each message is costing and offers to compact the chat: it writes itself a summary and carries that from then on. Everything stays on screen for you; it just stops being re-read.",
      },
      {
        lead: "Tips + tricks.",
        text: "A plain guide to using one of these well: how they work, why they make things up, why they don't know what happened yesterday, what not to type into any of them, and how to spend fewer credits. It's in the footer and the menu behind your name.",
      },
      {
        lead: "You decide how hard it thinks.",
        text: "These models reason before they answer, which is why a simple question could take ten seconds. A new setting beside the model picker chooses low, medium or high effort. Low answers almost at once and costs the least; high is for the problems that deserve it. It remembers what you chose.",
      },
      {
        lead: "A Help page.",
        text: "Common questions, a short guide to getting around, and a feedback form that works whether or not you have an account. It's in the footer of every page, and in the menu behind your name.",
      },
      {
        lead: "Your purchases, with dates.",
        text: "The Credits page now lists everything that has ever changed your balance other than replies: packs you bought, the monthly plan, refunds, your starter credits, and anything we gave you.",
      },
      {
        lead: "Where the money goes, out in the open.",
        text: "The breakdown of every purchase (Cloudflare, Stripe, and what's left for us) used to sit behind sign-in. It's on the home page and on its own Pricing page now, where anyone can check it before they pay us anything.",
      },
      {
        lead: "Long chats stay quick and cheap.",
        text: "Every message re-sends the conversation so far, so a very long chat gets slower and costs more with each reply. Lechuga now sends only the most recent part once a chat passes a generous length, and tells you when it does. If the model loses the thread, start a new chat.",
      },
      {
        lead: "Sensible limits.",
        text: "A cap on how fast one account can send messages and on how long a single reply can run. You won't meet them in normal use. They're there so one runaway script can't spend everyone's day.",
      },
      {
        lead: "Terms and privacy, finished.",
        text: "No longer drafts. They now cover the phone apps we intend to build, what we're liable for, and your rights over your data, in the same plain language as before.",
      },
      {
        lead: "Lechuga facts.",
        text: "Once your start page has told you that lechuga is lettuce in Spanish a few times, it moves on to other things worth knowing about lettuce. All true, as far as we can tell.",
      },
    ],
  },
  {
    date: "September 18, 2026",
    title: "Lechuga opens",
    intro:
      "A simple box you type into, and it answers. Underneath are the best open source models we can find, running on Cloudflare's servers in place of the model maker's, priced at twice what they cost us and not a cent more. Here's what's in it on day one.",
    items: [
      {
        lead: "Three models, and an honest guide to them.",
        text: "GLM 5.3 Flash is the default and the right choice nearly every time. GLM 5.3 is its bigger sibling for the hard problems. DeepSeek V4 Flash is a second opinion from a different lab. The guide under the message box says what each is for and what it costs next to the default, in plain words.",
      },
      {
        lead: "Watch it think.",
        text: "These models reason before they answer. Lechuga shows that reasoning as it happens, with a timer, then folds it away when the answer arrives. It's shown to you and never stored.",
      },
      {
        lead: "Every reply shows what it cost.",
        text: "In credits, under each answer, with the model that wrote it and a running total for the chat. A typical reply is a fraction of a cent. If you'd rather not look, one click hides it.",
      },
      {
        lead: "Pay for what you use.",
        text: "$5 or $10 of credits that never expire, or $5 a month with whatever you don't use rolling over. Cancel the monthly plan whenever you like and keep every credit. Payment goes through Stripe, and we never see your card.",
      },
      {
        lead: "Try it first.",
        text: "One free chat a day from the home page, no account, nothing stored on our side. If you sign up afterwards, that conversation comes with you as your first chat.",
      },
      {
        lead: "Invite only, for now.",
        text: "Sign in with an emailed link or with Google, pick a username once, and you get five invites of your own. No invite? Ask for one from the sign-in page, or ask a friend who's already in, which is quicker.",
      },
      {
        lead: "Your chats are yours.",
        text: "They're kept so you can come back to them, and for no other reason: not for training, not for sale, not for advertisers. Delete a chat and it's gone. Delete your account and everything goes with it.",
      },
    ],
  },
];

export function WhatsNewPage() {
  return (
    <DocPage title="What's new">
      {NEWS.map((entry) => (
        <section key={entry.date} className="news-entry">
          <p className="news-date">{entry.date}</p>
          <h2>{entry.title}</h2>
          <p>{entry.intro}</p>
          <ul>
            {entry.items.map((item) => (
              <li key={item.lead}>
                <strong>{item.lead}</strong> {item.text}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </DocPage>
  );
}
