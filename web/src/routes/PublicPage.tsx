import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SideNavPage } from "../components/SideNavPage";
import { Avatar } from "../components/Avatar";
import { listPublicChats, type PublicChatSummary } from "../api";

// /public: every public chat, newest first, with a box to search them all.
// Open one and you can read it and join in; the replies are on Lechuga.
export function PublicPage() {
  const [query, setQuery] = useState("");
  const [chats, setChats] = useState<PublicChatSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      listPublicChats(query.trim())
        .then((r) => !cancelled && setChats(r))
        .catch(() => !cancelled && setError("couldn't load the public chats"));
    }, query ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <SideNavPage title="Public chats" nav={[{ to: "/public", label: "Public chats" }]} navLabel="Public">
      <p className="settings-lead">
        Chats their owners have opened to everyone on Lechuga. Read any of them, and join in if you like: the replies come out of Lechuga's own
        credits, not yours or theirs. Everyone sees who said what. To open one of your own chats this way, use Share in the chat.
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
