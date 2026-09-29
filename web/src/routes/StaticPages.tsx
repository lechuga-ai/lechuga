import type { ReactNode } from "react";
import { SideNavPage } from "../components/SideNavPage";
import { HELP_NAV } from "./GettingStartedPage";

// /terms and /privacy are components/Legal.tsx: those are the texts people
// accept on the username step, so there is one copy of each. Every page here
// sits in the public set's nav (HELP_NAV, routes/GettingStartedPage.tsx).

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

// The two of us, with a way to say hi. Under "Who we are" on /welcome.
export function AboutTeam() {
  return (
    <>
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
                <a href="https://podcasts.apple.com/us/podcast/letters-from-an-american/id1730358737" target="_blank" rel="noopener">
                  Letters from an American
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
    </>
  );
}

// /whats-new: what Lechuga can do, newest first, each with its date. To
// announce something, add an entry at the top of NEWS: a date, a headline, a
// sentence or two of why, then the changes, each with a short bold lead.
type NewsEntry = { date: string; title: string; intro: string; items: { lead: string; text: string }[] };

const NEWS: NewsEntry[] = [
  {
    date: "September 29, 2026",
    title: "Bots",
    intro:
      "Until now there was one Lechuga, and every chat was with it. Now there are bots: you make them, name them, and tell them what they're for. Every chat is with one of them.",
    items: [
      {
        lead: "Seed.",
        text: "The bot every account starts with. All your chats so far are with it, and whatever you'd written about how Lechuga should talk to you is now how Seed behaves. It's the one that can't be deleted.",
      },
      {
        lead: "Name one and it knows what it's for.",
        text: "New bot, at the top on the left, asks one thing: what you'd like to name it. Think of it as hiring someone for one job, and name it for the job. Lechuga works out from the name alone how the bot should behave (try Penny Pincher, or Sous Chef), and you're chatting with it straight away.",
      },
      {
        lead: "Each bot has its own chats.",
        text: "On the left, every bot is a group with a bar down its side in its own colour, its name at the top and its chats underneath. Chats people have shared with you sit at the bottom, and the search box at the top looks across everything.",
      },
      {
        lead: "Three dots beside a bot's name.",
        text: "New chat starts one with that bot. Bot Manager is a page under Account with every bot on it: its name, the model its new chats start on, and how it behaves, which you can rewrite from scratch. From the dots it lands on that bot.",
      },
      {
        lead: "Memory is yours; the soul is the bot's.",
        text: "What Lechuga remembers about you stays one note under Account, shared by all your bots. How a bot behaves lives on the bot's page. Remember, in a chat, still updates both; the overnight pass now touches only the note about you.",
      },
    ],
  },
  {
    date: "September 28, 2026",
    title: "Lechuga remembers",
    intro:
      "Until now every chat started from nothing. Lechuga can now carry a little about you from one chat to the next, and it has a clearer idea of who it is.",
    items: [
      {
        lead: "A memory, in two notes.",
        text: "About you (what you're working on, what you like) and how Lechuga should talk to you (short answers, no bullet points, whatever you'd want). Both live under Account, then Memory, where you can read them, rewrite them, switch them off, or wipe them. They go with every message in your own chats and never in a shared one, so they cost a few credits a message while they're not empty.",
      },
      {
        lead: "Remember, beside Share.",
        text: "Press it in a chat and Lechuga reads the chat and updates both notes, keeping what still holds and dropping what's out of date. It costs about one message. Or just tell it: \"remember that I'm vegetarian\" saves a line on the spot.",
      },
      {
        lead: "And it learns overnight.",
        text: "Once a night Lechuga reads what you said that day in your own chats and keeps only what's clearly lasting, for the price of about one message. It's on by default and has its own switch on the Memory page; off, only Remember and what you type reach the notes.",
      },
      {
        lead: "It knows its name.",
        text: "Ask what it is and it says it's Lechuga, running on whichever model the chat is on. It also knows what it can and can't do here (pictures, search, memory, compacting), and that questions about credits or invites are for the Help page, not for guessing.",
      },
    ],
  },
  {
    date: "September 28, 2026",
    title: "Lechuga on your home screen",
    intro:
      "Lechuga can now be installed like an app on an iPhone, iPad, Mac, Android phone or desktop. It's the same site and the same account; it just opens in a window of its own, without the browser around it.",
    items: [
      {
        lead: "How to install it.",
        text: "Help has the steps for each. In short: on an iPhone or iPad, Safari's share button, then Add to Home Screen. On a Mac, Add to Dock in Safari's File menu, or the install icon in Chrome's address bar. On Android, Install app in Chrome's menu.",
      },
      {
        lead: "Signing in there.",
        text: "An installed copy emails you a six-digit code instead of a link, because a link would open in the browser, and the browser and the app don't share a sign-in.",
      },
    ],
  },
  {
    date: "September 28, 2026",
    title: "Easier to find your way around",
    intro:
      "A handful of changes for anyone new here, and for anyone who has ever lost a chat. Nothing about the models or prices has changed.",
    items: [
      {
        lead: "Search your chats.",
        text: "A box above the list on the left. Type a word or two and the list becomes the chats that mention them, each with the line where the words appear. Clear it and everything is back.",
      },
      {
        lead: "A ? beside the model.",
        text: "The line under the box that unfolded a guide to the models is gone. In its place, a small ? next to the model's name opens a plain explanation of what the models are, what each is for, and what low, medium and high effort actually change about an answer and its price.",
      },
      {
        lead: "Help, with a table of contents.",
        text: "The help pages have a list of their sections down the left that follows you as you read. Tips + tricks is now called Getting started with AI and lives there too.",
      },
      {
        lead: "Account.",
        text: "Profile has become Account, a page of its own in the menu behind your name: your name and photo on one side, credits and billing on the other.",
      },
      {
        lead: "About Lechuga, from inside.",
        text: "Everything the home page says to people who aren't signed in, plus who we are, now sits beside the help pages as About Lechuga, so you can read it after signing in.",
      },
    ],
  },
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
    <SideNavPage title="What's new" nav={HELP_NAV}>
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
    </SideNavPage>
  );
}
