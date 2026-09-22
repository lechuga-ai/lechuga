import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { Chat, Me } from "../api";
import { Avatar, AvatarStack } from "./Avatar";
import { InviteDialog } from "./InviteDialog";
import { ProfileDialog } from "./ProfileDialog";
import { Copyright } from "./SiteFooter";

type Props = {
  chats: Chat[];
  activeChatId: string | null;
  open: boolean;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
  me: Me;
  onMeChange: (me: Me) => void;
  // Live balance (App refreshes it after every reply); me.balance is only
  // what it was at page load.
  balance: number;
  onSignOut: () => Promise<void>;
};

type Dialog = "none" | "invite" | "profile";

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
  activeChatId,
  open,
  onSelect,
  onNewChat,
  onDelete,
  me,
  onMeChange,
  balance,
  onSignOut,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>("none");
  const [remaining, setRemaining] = useState(me.invitesRemaining);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

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
      <button className="new-chat-btn" onClick={onNewChat}>
        New chat
      </button>
      <div className="chat-list">
        {chats.map((chat) => (
          <div
            key={chat.id}
            className={`chat-list-item ${chat.id === activeChatId ? "active" : ""}`}
            onClick={() => onSelect(chat.id)}
          >
            <span className="chat-title">{chat.title ?? "New chat"}</span>
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
      {dialog === "profile" &&
        createPortal(
          <ProfileDialog me={me} onClose={() => setDialog("none")} onSaved={(profile) => onMeChange({ ...me, ...profile })} />,
          document.body
        )}
      <div className="sidebar-footer">
        {menuOpen && (
          <div className="account-menu" role="menu">
            <button type="button" onClick={() => openDialog("profile")}>
              Profile
            </button>
            <button type="button" onClick={() => openDialog("invite")}>
              Invite someone <span className="menu-count">{remaining} left</span>
            </button>
            {/* Feedback and Tips + tricks live on the Help page (linked from
                the footer too) instead of crowding this menu. */}
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
              Sign out
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
        <a className={`balance-link ${balance <= 0 ? "empty" : ""}`} href="/billing" title="Credits: see, buy, subscribe">
          <span>{balance.toLocaleString()} credits</span>
          <span className="balance-link-action">{balance <= 0 && me.creditsEnforced ? "get more" : "manage"}</span>
        </a>
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
