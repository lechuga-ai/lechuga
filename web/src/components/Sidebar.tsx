import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { searchChats, type Bot, type Chat, type ChatHit, type Me } from "../api";
import { Avatar, AvatarStack, colourFor } from "./Avatar";
import { InviteDialog } from "./InviteDialog";
import { NewBotDialog } from "./NewBotDialog";
import { BotShare } from "./BotManager";
import type { Person } from "../api";
import { Copyright } from "./SiteFooter";

type Props = {
  chats: Chat[];
  // My bots, Seed first. Each is a group in the list with its chats.
  bots: Bot[];
  onBotCreated: (bot: Bot) => void;
  // Who has a bot changed (the share dialog), so its faces follow.
  onBotPeople: (botId: string, people: Person[] | undefined) => void;
  activeChatId: string | null;
  open: boolean;
  onSelect: (id: string) => void;
  // New chat, from a bot's dots: the start page, with that bot.
  onNewChat: (botId: string) => void;
  onDelete: (id: string) => void;
  me: Me;
  // Live balance (App refreshes it after every reply); me.balance is only
  // what it was at page load.
  balance: number;
  onSignOut: () => Promise<void>;
};

type Dialog = "none" | "invite" | "newBot";

const SIX_DAYS = 6 * 24 * 60 * 60 * 1000;

function ageLabel(timestamp: number, now: number): string {
  const diff = Math.max(0, now - timestamp);
  if (diff > SIX_DAYS) {
    const d = new Date(timestamp);
    const sameYear = d.getFullYear() === new Date(now).getFullYear();
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  }
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function Sidebar({
  chats,
  bots,
  onBotCreated,
  onBotPeople,
  activeChatId,
  open,
  onSelect,
  onNewChat,
  onDelete,
  me,
  balance,
  onSignOut,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>("none");
  // Which bot's dots are open, if any; and which bot's share dialog.
  const [botMenu, setBotMenu] = useState<string | null>(null);
  const [shareBot, setShareBot] = useState<Bot | null>(null);
  const [remaining, setRemaining] = useState(me.invitesRemaining);
  // The search box. While it has words in it the list below is the server's
  // answer (title or message text containing every word), each with a line
  // showing where it matched; empty it and the full list is back.
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ChatHit[] | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  // A click anywhere else closes a bot's dots menu; the dots themselves
  // stop the click so they can toggle it.
  useEffect(() => {
    if (!botMenu) return;
    const close = () => setBotMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [botMenu]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchChats(q)
        .then((r) => !cancelled && setHits(r))
        .catch(() => !cancelled && setHits([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const searching = query.trim() !== "";
  // My chats, grouped under their bots (one from before bots counts as
  // Seed's); then the ones others have shared with me, whichever bot
  // they're with. A search looks across all of them.
  const seedId = bots.find((b) => b.is_default)?.id ?? null;
  // Under a bot I own: every chat with it, mine and (with their face) the
  // ones people I've shared it with started. Under a bot shared with me:
  // my own chats with it.
  const botOf = (c: Chat) => bots.find((b) => b.id === (c.bot_id ?? seedId)) ?? null;
  const inGroup = (c: Chat, bot: Bot) => botOf(c)?.id === bot.id && (c.user_id === me.id || bot.role === "owner");
  const groups = bots.map((bot) => ({ bot, chats: chats.filter((c) => inGroup(c, bot)) }));
  // Never lose a chat: one whose bot isn't in the list (the bots didn't
  // load, or a row points somewhere odd) still shows, under a plain heading.
  const orphans = chats.filter((c) => c.user_id === me.id && botOf(c) === null);
  // Chats others started and let me into, one at a time.
  const sharedWithMe = chats.filter((c) => c.user_id !== me.id && !bots.some((b) => inGroup(c, b)));

  function chatRow(chat: Chat & { snippet?: string | null }) {
    return (
      <div key={chat.id} className={`chat-list-item ${chat.id === activeChatId ? "active" : ""}`} onClick={() => onSelect(chat.id)}>
        <span className="chat-title">{chat.title ?? "New chat"}</span>
        {chat.snippet && <span className="chat-snippet">{chat.snippet}</span>}
        {/* Shared: everyone in it, the owner ringed. */}
        {chat.people && <AvatarStack people={chat.people} ownerId={chat.user_id} size={16} max={3} />}
        <span className="chat-age">{ageLabel(chat.updated_at, now)}</span>
        <button
          className="chat-delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(chat.id);
          }}
          aria-label={chat.user_id === me.id ? "Delete chat" : "Leave chat"}
          title={chat.user_id === me.id ? "Delete chat" : "Leave chat"}
        >
          ✕
        </button>
      </div>
    );
  }

  function openDialog(d: Dialog) {
    setMenuOpen(false);
    setDialog(d);
  }

  return (
    <div className={`sidebar ${open ? "open" : ""}`}>
      <div className="wordmark">
        <span className="logo">
          <img src="/lechuga_logo.png" alt="" />
        </span>
        <span className="wordmark-text">
          Lechuga <span className="alpha" title="Early days: rough edges expected">alpha</span>
        </span>
      </div>
      {/* Search first: it looks across every chat, whichever bot. */}
      <input
        className="chat-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setQuery("");
        }}
        placeholder="Search chats"
        aria-label="Search chats"
      />
      <button type="button" className="new-bot-btn" onClick={() => openDialog("newBot")}>
        <span className="new-bot-plus">+</span> New bot
      </button>
      <div className="chat-list">
        {searching && hits !== null && hits.length === 0 && <p className="chat-list-empty">No chat has those words.</p>}
        {searching && (hits ?? []).map((chat) => chatRow(chat))}
        {/* Every bot, a group each: its name, the faces once it's shared, the
            dots (New chat, Bot Manager), then its chats down a bar in its
            colour. Then what others have shared with me. */}
        {!searching &&
          groups.map(({ bot, chats: own }) => (
            <div key={bot.id} className="bot-group" style={{ borderLeftColor: colourFor(bot.id) }}>
              <div className="bot-row">
                <span className="bot-row-name">{bot.name}</span>
                {/* Once shared: everyone with it, the owner ringed. */}
                {bot.people && <AvatarStack people={bot.people} ownerId={bot.user_id} size={16} max={3} />}
                <button
                  type="button"
                  className="bot-row-dots"
                  onClick={(e) => {
                    e.stopPropagation();
                    setBotMenu((cur) => (cur === bot.id ? null : bot.id));
                  }}
                  aria-expanded={botMenu === bot.id}
                  aria-haspopup="menu"
                  aria-label={`${bot.name} menu`}
                >
                  ⋮
                </button>
                {botMenu === bot.id && (
                  <div className="bot-row-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setBotMenu(null);
                        onNewChat(bot.id);
                      }}
                    >
                      New chat
                    </button>
                    {bot.role === "owner" && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setBotMenu(null);
                          setShareBot(bot);
                        }}
                      >
                        Share…
                      </button>
                    )}
                    <Link to={`/settings/bots#${bot.id}`} role="menuitem" onClick={() => setBotMenu(null)}>
                      Bot Manager
                    </Link>
                  </div>
                )}
              </div>
              {own.map((chat) => chatRow(chat))}
            </div>
          ))}
        {!searching && orphans.length > 0 && (
          <div className="bot-group">
            <div className="bot-row">
              <span className="bot-row-name">Chats</span>
            </div>
            {orphans.map((chat) => chatRow(chat))}
          </div>
        )}
        {!searching && sharedWithMe.length > 0 && (
          <div className="bot-group shared">
            <div className="bot-row">
              <span className="bot-row-name">Shared with me</span>
            </div>
            {sharedWithMe.map((chat) => chatRow(chat))}
          </div>
        )}
      </div>

      {/* Dialogs go to document.body: the sidebar is transformed for its
          drawer animation, which would otherwise trap position: fixed
          inside its 260px box. */}
      {dialog === "invite" &&
        createPortal(<InviteDialog onClose={() => setDialog("none")} onRemainingChange={setRemaining} />, document.body)}
      {shareBot &&
        createPortal(
          <div className="modal-backdrop" onClick={() => setShareBot(null)}>
            <div className="modal share-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <BotShare bot={shareBot} onPeople={(people) => onBotPeople(shareBot.id, people)} />
              <div className="modal-actions">
                <button type="button" onClick={() => setShareBot(null)}>
                  Done
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      {dialog === "newBot" &&
        createPortal(
          <NewBotDialog
            onClose={() => setDialog("none")}
            onCreated={(bot) => {
              setDialog("none");
              onBotCreated(bot);
            }}
          />,
          document.body
        )}
      <div className="sidebar-footer">
        {menuOpen && (
          <div className="account-menu" role="menu">
            <button type="button" onClick={() => openDialog("invite")}>
              Invites <span className="menu-count">{remaining} left</span>
            </button>
            {/* Profile, and credits: buying happens there now, so the balance
                below is just a number. */}
            <Link to="/settings" role="menuitem" onClick={() => setMenuOpen(false)}>
              Account
            </Link>
            {/* Feedback, Getting started with AI and About Lechuga live on
                the Help pages (linked from the footer too) instead of
                crowding this menu. */}
            <Link to="/help" role="menuitem" onClick={() => setMenuOpen(false)}>
              Help
            </Link>
            {me.isAdmin && (
              <a href="/admin" role="menuitem">
                Admin
              </a>
            )}
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onSignOut();
              }}
            >
              Log out
            </button>
            {/* Set apart from the actions above: not things to do, just where
                the legal text lives. */}
            <div className="account-menu-legal">
              <Link to="/terms" onClick={() => setMenuOpen(false)}>
                Terms
              </Link>
              <Link to="/privacy" onClick={() => setMenuOpen(false)}>
                Privacy
              </Link>
            </div>
          </div>
        )}
        <div className={`sidebar-balance ${balance <= 0 ? "empty" : ""}`}>{balance.toLocaleString()} credits</div>
        <button
          type="button"
          className="account-btn"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          title={me.email}
        >
          <Avatar person={{ id: me.id, name: me.name.trim() || me.username || me.email, username: me.username, photo: me.photo }} size={22} />
          <span className="account-email">{me.username ? `@${me.username}` : me.email}</span>
          <span className="account-caret">{menuOpen ? "▴" : "▾"}</span>
        </button>
        <Copyright className="sidebar-copyright" />
      </div>
    </div>
  );
}
