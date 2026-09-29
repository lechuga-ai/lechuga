import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { searchChats, type Bot, type Chat, type ChatHit, type Me } from "../api";
import { Avatar, AvatarStack } from "./Avatar";
import { InviteDialog } from "./InviteDialog";
import { NewBotDialog } from "./NewBotDialog";
import { Copyright } from "./SiteFooter";

type Props = {
  chats: Chat[];
  // My bots, Seed first; the chat list is the selected one's chats.
  bots: Bot[];
  selectedBotId: string | null;
  onSelectBot: (id: string) => void;
  onBotCreated: (bot: Bot) => void;
  activeChatId: string | null;
  open: boolean;
  onSelect: (id: string) => void;
  onNewChat: () => void;
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
  selectedBotId,
  onSelectBot,
  onBotCreated,
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
  const [botMenuOpen, setBotMenuOpen] = useState(false);
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
  // Mine, with the selected bot (a chat from before bots counts as Seed's);
  // then the ones others have shared with me, whichever bot they're with.
  // A search looks across all of them.
  const seedId = bots.find((b) => b.is_default)?.id ?? null;
  const selectedBot = bots.find((b) => b.id === selectedBotId) ?? null;
  const mine = chats.filter((c) => c.user_id === me.id && (c.bot_id ?? seedId) === selectedBotId);
  const sharedWithMe = chats.filter((c) => c.user_id !== me.id);
  const shown: (Chat & { snippet?: string | null })[] = searching ? (hits ?? []) : [...mine, ...sharedWithMe];
  const firstShared = searching ? null : sharedWithMe[0]?.id ?? null;

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
      {/* Which bot you're with: New chat starts one with it and the list is
          its chats. Press it to switch. */}
      <div className="bot-switch">
        <span className="bot-switch-label">Chats with</span>
        <button type="button" className="bot-switch-btn" onClick={() => setBotMenuOpen((v) => !v)} aria-expanded={botMenuOpen} aria-haspopup="menu">
          {selectedBot && <Avatar person={{ id: selectedBot.id, name: selectedBot.name, username: null, photo: null }} size={22} />}
          <span className="bot-switch-name">{selectedBot?.name ?? "…"}</span>
          <span className="account-caret">{botMenuOpen ? "▴" : "▾"}</span>
        </button>
        {botMenuOpen && (
          <div className="bot-menu" role="menu">
            {bots.map((bot) => (
              <button
                key={bot.id}
                type="button"
                role="menuitemradio"
                aria-checked={bot.id === selectedBotId}
                className={bot.id === selectedBotId ? "current" : ""}
                onClick={() => {
                  setBotMenuOpen(false);
                  onSelectBot(bot.id);
                }}
                title={bot.soul ? bot.soul.slice(0, 160) : undefined}
              >
                <Avatar person={{ id: bot.id, name: bot.name, username: null, photo: null }} size={20} />
                <span className="bot-switch-name">{bot.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="new-chat-btn" onClick={onNewChat}>
        New chat
      </button>
      <div className="chat-list">
        {searching && hits !== null && hits.length === 0 && <p className="chat-list-empty">No chat has those words.</p>}
        {!searching && mine.length === 0 && sharedWithMe.length === 0 && <p className="chat-list-empty">No chats yet with this bot.</p>}
        {shown.map((chat) => (
          <div
            key={chat.id}
            className={`chat-list-item ${chat.id === activeChatId ? "active" : ""}`}
            onClick={() => onSelect(chat.id)}
          >
            {chat.id === firstShared && <span className="chat-list-label">Shared with me</span>}
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
        ))}
      </div>

      {/* Dialogs go to document.body: the sidebar is transformed for its
          drawer animation, which would otherwise trap position: fixed
          inside its 260px box. */}
      {dialog === "invite" &&
        createPortal(<InviteDialog onClose={() => setDialog("none")} onRemainingChange={setRemaining} />, document.body)}
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
