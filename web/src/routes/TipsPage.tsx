import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { DocPage } from "./StaticPages";
import config from "../../../worker/config.json";

// /tips: a plain guide to using a chat model well, for people who haven't
// spent much time with one. Linked from the footer, Help, and the models
// panel under the message box. Each section is a question someone has
// actually asked; add new ones where they fit, not at the end.
const SECTIONS: { id: string; title: string; body: ReactNode }[] = [
  {
    id: "how-it-works",
    title: "What is this thing, really?",
    body: (
      <>
        <p>
          A language model is a program that has read an enormous amount of text and learned one skill from it: given
          some words, guess the next one. That's all it does. It guesses a word, adds it to the pile, and guesses again,
          a few dozen times a second, until it has written you an answer.
        </p>
        <p>
          It turns out that to guess the next word well across millions of books, arguments, manuals and recipes, you
          have to pick up a great deal about how the world works. So the guesses are often very good. But it helps to
          remember what's underneath: it isn't looking anything up, it has no database of facts, and it doesn't know
          whether what it's writing is true. It's writing what a good answer would probably look like.
        </p>
      </>
    ),
  },
  {
    id: "making-things-up",
    title: "It will make things up, and it won't tell you",
    body: (
      <>
        <p>
          Because it writes what an answer would probably look like, it will sometimes write a book that doesn't exist,
          a quote nobody said, a court case with a convincing name, or a statistic to two decimal places that it
          invented on the spot. People call this hallucinating. It isn't rare and it isn't a bug that's about to be
          fixed. It's what the machine does; most of the time the probable answer also happens to be the true one.
        </p>
        <p>
          The trouble is that it sounds exactly as confident when it's wrong. So check anything that matters: names,
          numbers, dates, quotes, links, citations, doses, laws, and sums. It is worst at obscure things (a small town, a
          minor paper, your own family history) and at exact arithmetic. Asking "are you sure?" proves nothing: it
          will often apologise and change a right answer, or defend a wrong one.
        </p>
        <p>
          It's at its best when you can judge the result yourself: a draft you'll read, an explanation you can test,
          code you'll run, ideas you'll pick from.
        </p>
      </>
    ),
  },
  {
    id: "yesterday",
    title: "Why doesn't it know what happened yesterday?",
    body: (
      <>
        <p>
          A model is trained once, on text collected up to some date, and then it's frozen. It knows nothing after that,
          and it's often unsure what today's date even is.
        </p>
        <p>
          It can catch up, though. Ask about something recent, or something it isn't sure of, and it will search the web
          and open the pages that look right, answering from those with links to what it read. Each step shows above the
          reply, so you can see where the answer came from. A search costs {config.tools.web_search.credits} credits, a
          cent; reading a page is free.
        </p>
        <p>
          When you already have the material, give it to the model anyway: paste in the article, drop in the PDF, and
          ask your question about that. It reads what you give it far more reliably than it remembers what it was
          trained on.
        </p>
      </>
    ),
  },
  {
    id: "memory",
    title: "Does it remember me?",
    body: (
      <>
        <p>
          No. Each chat starts from nothing, and nothing carries from one chat to another. Inside a chat it seems to
          remember because every time you send a message, the whole conversation so far is sent along with it, and the
          model re-reads all of it before replying.
        </p>
        <p>
          That's why a long chat, or one with a big file in it, costs more per message as it goes on. Two habits help:
          start a new chat when you change the subject, and when a chat you want to keep going has grown heavy, use
          "Compact this chat", which swaps the history for a summary.
        </p>
      </>
    ),
  },
  {
    id: "private",
    title: "What shouldn't I type in?",
    body: (
      <>
        <p>
          Your Social Security number, passwords, card and bank numbers, anyone's medical details, and anything you'd
          be in trouble for leaking. That's good practice with every AI service, not only this one.
        </p>
        <p>
          Here is exactly where Lechuga stands. We don't train on your chats, we don't sell them, and we don't read
          them. But they are stored in our database as ordinary text so you can come back to them, and they are not
          end-to-end encrypted. That means the two of us who run Lechuga could technically read them, and so could
          anyone who broke into the database. Delete a chat and it's gone from there; delete your account and
          everything goes. The full detail is on the <Link to="/privacy">privacy page</Link>.
        </p>
      </>
    ),
  },
  {
    id: "asking-well",
    title: "How do I get better answers?",
    body: (
      <>
        <ul>
          <li>
            <strong>Say who it's for and why.</strong> "Explain mortgages" gets an encyclopedia entry. "I'm 26, buying
            my first flat, and I don't understand what a fixed rate is" gets help.
          </li>
          <li>
            <strong>Give it the material.</strong> The email you're replying to, the contract, the error message, the
            spreadsheet. It works from what's in front of it much better than from memory.
          </li>
          <li>
            <strong>Say what shape you want.</strong> Three bullet points, a table, a two-line text message, in plain
            words, no more than 100 words.
          </li>
          <li>
            <strong>Show an example</strong> of the tone or format you like. One example beats a paragraph of
            description.
          </li>
          <li>
            <strong>Push back.</strong> The first answer is a draft. "Shorter." "Less formal." "You ignored the second
            half of my question." It doesn't get tired or offended.
          </li>
          <li>
            <strong>Ask it to ask you.</strong> "Before you answer, ask me whatever you need to know" works
            surprisingly well for anything personal or complicated.
          </li>
          <li>
            <strong>One job at a time.</strong> A big task done in steps, where you look at each step, comes out better
            than one giant request.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "effort",
    title: "What are low, medium and high effort?",
    body: (
      <>
        <p>
          These models can think before they answer: they write themselves a page of working-out first (you can watch
          it), then the reply. Thinking makes them better at anything with steps in it, such as maths, logic, planning
          and tricky code. It also takes time, and you pay for the working-out as well as the answer.
        </p>
        <ul>
          {config.efforts.map((e) => (
            <li key={e.id}>
              <strong>{e.label}.</strong> {e.hint}
            </li>
          ))}
        </ul>
        <p>
          For a quick fact, a rewrite, or a chat, low is plenty and feels instant. Save high for the problems that
          deserve it.
        </p>
      </>
    ),
  },
  {
    id: "which-model",
    title: "Which model should I pick?",
    body: (
      <>
        <ul>
          {config.models
            .filter((m) => !("retired" in m && m.retired))
            .map((m) => (
              <li key={m.id}>
                <strong>{m.label}.</strong> {"blurb" in m ? m.blurb : ""}
              </li>
            ))}
        </ul>
        <p>
          A chat stays on the model it started with, so to try another, start a new chat. If an answer matters, asking
          two different models the same question is a cheap way to find out where they disagree.
        </p>
      </>
    ),
  },
  {
    id: "open-source",
    title: "What's an open source model, and why should I care?",
    body: (
      <>
        <p>
          The best-known models, from OpenAI, Anthropic and Google, are closed: the model lives on the company's
          computers, and the only way to use it is to send your words to them, at their price, under their rules. An
          open model is one whose maker has published the model itself, a very large file of numbers, so that anyone
          with the hardware can run their own copy.
        </p>
        <p>
          That matters to you in three ways. Anyone can offer an open model, so there's real competition on price. We
          get to choose whose computers it runs on, which is the whole point of the next two sections. And you can
          check our claims, because the models and their prices are public.
        </p>
        <p>
          To be fair to the closed ones: the very best of them are still somewhat better on the hardest problems. For
          most of what most people ask, you won't notice.
        </p>
      </>
    ),
  },
  {
    id: "cheaper",
    title: "Why is this so much cheaper?",
    body: (
      <>
        <p>
          The big labs spend billions training their models and have investors to repay, and most of them sell you a
          flat monthly plan whether you use it or not. We didn't train anything. We rent time on open models from
          Cloudflare, charge {config.costs.markup === 2 ? "twice" : `${config.costs.markup} times`} what that costs us, and
          you pay only for what you use. There are no ads, no investors, and two of us. The{" "}
          <Link to="/pricing">pricing page</Link> shows where every dollar goes.
        </p>
      </>
    ),
  },
  {
    id: "where",
    title: "These models come from China. Where do my words go?",
    body: (
      <>
        <p>
          Several of the best open models, including the GLM and DeepSeek models here, were trained by labs in China.
          It's worth separating two things: who made the model, and whose computers run it.
        </p>
        <p>
          A model is a file. It can't phone home, and it sends nothing to the people who trained it. What decides where
          your words go is where that file is running. If you use those labs' own apps, your chats go to their servers
          and sit under Chinese law, which can require companies to hand data to the state. On Lechuga, the same models
          run on Cloudflare, an American company. Your chats never go to the lab that trained the model.
        </p>
        <p>
          Two honest footnotes. First, no country is a vault: American companies can also be made to hand over data, by
          a court order. What you're choosing is which legal system you'd rather your words lived under, and for most
          of our users that's an easy choice. Second, where a model was trained can show in what it says: models from
          Chinese labs tend to be evasive on subjects the Chinese government is sensitive about. For those, ask
          elsewhere as well.
        </p>
      </>
    ),
  },
  {
    id: "credits",
    title: "What are credits?",
    body: (
      <>
        <p>
          Credits are how you pay: 10,000 credits is $1, they never expire, and every reply shows what it cost. A
          typical reply is somewhere between 5 and 50 credits, which is to say a fraction of a cent.
        </p>
        <p>What a reply costs depends on three things:</p>
        <ul>
          <li>
            <strong>How much it had to read.</strong> That's your message plus the whole chat so far, including any
            files in it, every time.
          </li>
          <li>
            <strong>How much it wrote,</strong> thinking included. Writing costs about three times what reading does.
          </li>
          <li>
            <strong>Which model.</strong> GLM 5.3 costs around nine times what Flash does for the same work.
          </li>
        </ul>
        <p>
          So to spend less: use Flash, use low effort for easy things, start a new chat for a new subject, and compact
          a long chat you want to keep.
        </p>
      </>
    ),
  },
  {
    id: "files",
    title: "Can I give it files and pictures?",
    body: (
      <>
        <p>
          Yes. Drag a file onto the page, or paste in something long, and it becomes a small card on your message.
          PDFs, Word and Excel files, text, CSV and code all work; a scanned PDF doesn't, because a scan is a picture
          of words with no words in it. Pictures work on GLM 5.3 Flash, the one model here that can see.
        </p>
        <p>
          It reads the whole file, which is the good news and the cost: a long document is re-read, and paid for, with
          each message after it. When you've got what you needed from it, compact the chat or start a new one.
        </p>
      </>
    ),
  },
  {
    id: "other",
    title: "A few more things people ask",
    body: (
      <>
        <p>
          <strong>Why did I get a different answer the second time?</strong> There's a little randomness in how each
          word is chosen, on purpose; without it the writing goes flat. Ask twice and you get two drafts.
        </p>
        <p>
          <strong>Does it have opinions or feelings?</strong> It writes like a person because it learned from people's
          writing. It will tell you it's delighted or sorry. Nobody has shown that anything is felt, and it will take
          whichever side of an argument you nudge it towards, so don't mistake agreement for being right.
        </p>
        <p>
          <strong>Is it biased?</strong> Yes, in the ways its reading was: towards English, towards the internet's
          view of things, towards whatever was written about most. It's a good reason to ask for the other side's best
          argument.
        </p>
        <p>
          <strong>Can I use it for school or work?</strong> That's between you and your school or employer; many have
          rules. Whatever they say, you are responsible for what you hand in, including the parts it got wrong.
        </p>
        <p>
          <strong>Should I trust it on health, law or money?</strong> Use it to understand your situation and to work
          out what to ask. Then ask a person whose job it is.
        </p>
      </>
    ),
  },
];

export function TipsPage() {
  return (
    <DocPage title="Tips + tricks">
      <p>
        How to get the most out of a chat model, and what to watch for, written for people who haven't spent much time
        with one. None of it is specific to Lechuga except where it says so.
      </p>
      <nav className="tips-contents" aria-label="On this page">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            {s.title}
          </a>
        ))}
      </nav>
      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="tips-section">
          <h2>{s.title}</h2>
          {s.body}
        </section>
      ))}
    </DocPage>
  );
}
