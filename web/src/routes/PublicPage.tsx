import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SideNavPage } from "../components/SideNavPage";
import { Avatar } from "../components/Avatar";
import { listPublicBots, listPublicChats, type PublicBotSummary, type PublicChatSummary } from "../api";

// /public: every public chat, newest first, with a box to search them all.
// Open one and you can read it and join in; the replies are on Lechuga.
export function PublicPage() {
  const [query, setQuery] = useState("");
  const [chats, setChats] = useState<PublicChatSummary[] | null>(null);
  const [bots, setBots] = useState<PublicBotSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      listPublicChats(query.trim())
        .then((r) => !cancelled && setChats(r))
        .catch(() => !cancelled && setError("couldn't load the public chats"));
      listPublicBots(query.trim())
        .then((r) => !cancelled && setBots(r))
        .catch(() => {});
    }, query ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <SideNavPage title="Public" nav={[{ to: "/public", label: "Public" }]} navLabel="Public">
      <p className="settings-lead">
        Bots and chats their owners have opened to everyone on Lechuga. Chat with a public bot, or read any public chat and join in: the replies
        come out of Lechuga's own credits, not yours or theirs, and everyone sees who said what. To open one of your own, use Share on the bot or
        the chat.
      </p>
      <input
        className="chat-search public-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search public chats"
        aria-label="Search public chats"
      />
      {error && <p className="modal-error">{error}</p>}
      {bots.length > 0 && (
        <>
          <h2 className="public-heading">Bots</h2>
          <ul className="public-list">
            {bots.map((b) => (
              <li key={b.id}>
                <Link to={`/b/${b.id}`} className="public-item">
                  <Avatar person={{ id: b.id, name: b.name, username: null, photo: null }} size={28} />
                  <span className="public-item-main">
                    <span className="public-item-title">{b.name}</span>
                    {b.soul && <span className="public-item-snippet">{b.soul}</span>}
                    <span className="public-item-meta">
                      {b.owner.name}'s · {b.chats} {b.chats === 1 ? "chat" : "chats"}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <h2 className="public-heading">Chats</h2>
        </>
      )}
      {chats === null ? (
        <p className="settings-lead">loading…</p>
      ) : chats.length === 0 ? (
        <p className="settings-lead">{query ? "No public chat has those words." : "No public chats yet. Yours could be the first."}</p>
      ) : (
        <ul className="public-list">
          {chats.map((c) => (
            <li key={c.id}>
              <Link to={`/c/${c.id}`} className="public-item">
                <Avatar person={c.owner} size={28} />
                <span className="public-item-main">
                  <span className="public-item-title">{c.title ?? "untitled"}</span>
                  {c.snippet && <span className="public-item-snippet">{c.snippet}</span>}
                  <span className="public-item-meta">
                    {c.owner.name} · {c.messages} {c.messages === 1 ? "message" : "messages"} ·{" "}
                    {new Date(c.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SideNavPage>
  );
}
