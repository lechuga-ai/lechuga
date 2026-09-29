import { useEffect, useState } from "react";
import { Navigate, Route, Routes, matchPath, useLocation, useNavigate } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { StartPage } from "./routes/StartPage";
import { ChatPage } from "./routes/ChatPage";
import { setStartMessage } from "./startMessage";
import type { Attachment } from "../../worker/src/attachments";
import { createChat, deleteChat, getMe, listBots, listChats, listModels, removeChatMember, type Bot, type Chat, type Me, type Model } from "./api";

// The bot picked last time, so a reload lands where you were.
const BOT_KEY = "lechuga.bot";
function readBotKey(): string | null {
  try {
    return localStorage.getItem(BOT_KEY);
  } catch {
    return null;
  }
}

type Props = {
  me: Me;
  onSignOut: () => Promise<void>;
};

// The signed-in app: the sidebar around two routes, "/" (a fresh chat) and
// /c/<id>. Root only renders this with a session and a username.
export default function App({ me, onSignOut }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const [chats, setChats] = useState<Chat[]>([]);
  // My bots, Seed first, and the one the sidebar and the start page are on.
  const [bots, setBots] = useState<Bot[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(readBotKey);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [balance, setBalance] = useState(me.balance);

  const activeChatId = matchPath("/c/:id", location.pathname)?.params.id ?? null;
  // "/" keeps the landing look (photo, wordmark, one box); a chat is chat mode.
  const landing = activeChatId === null;

  useEffect(() => {
    listChats().then(setChats).catch(() => setChats([]));
    listBots().then(setBots).catch(() => setBots([]));
    listModels()
      .then((m) => {
        setModels(m);
        if (m.length > 0) setSelectedModel(m[0].id);
      })
      .catch(() => setModels([]));
  }, []);

  // A chat someone else shares with me should turn up without a reload, and
  // the balance has to follow the same way: in a shared chat anyone can spend
  // the owner's credits, and otherwise the owner's own window would sit on a
  // stale number while the money went.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      void refreshChats();
      refreshBalance();
    }, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keeps a locally shown placeholder title until the server has generated one.
  async function refreshChats() {
    let fresh: Chat[];
    try {
      fresh = await listChats();
    } catch {
      return;
    }
    setChats((prev) =>
      fresh
        .map((c) => (c.title ? c : { ...c, title: prev.find((p) => p.id === c.id)?.title ?? null }))
        .sort((a, b) => b.updated_at - a.updated_at)
    );
  }

  // The selected bot, falling back to Seed when the remembered one is gone.
  const selectedBot = bots.find((b) => b.id === selectedBotId) ?? bots[0] ?? null;

  function selectBot(id: string) {
    setSelectedBotId(id);
    try {
      localStorage.setItem(BOT_KEY, id);
    } catch {
      // fine without
    }
    // A bot that has its own model starts new chats on it.
    const bot = bots.find((b) => b.id === id);
    if (bot?.model && models.some((m) => m.id === bot.model)) setSelectedModel(bot.model);
    setDrawerOpen(false);
    navigate("/");
  }

  function handleBotCreated(bot: Bot) {
    setBots((prev) => [...prev, bot]);
    selectBot(bot.id);
    navigate(`/bots/${bot.id}`);
  }

  function refreshBalance() {
    getMe()
      .then((m) => setBalance(m.balance))
      .catch(() => {});
  }

  function selectChat(id: string) {
    setDrawerOpen(false);
    navigate(`/c/${id}`);
  }

  function handleNewChat() {
    setDrawerOpen(false);
    navigate("/");
  }

  // The ✕ beside a chat. On my own chat it deletes it, for everyone in it; on
  // one shared with me it only takes me out.
  async function handleDelete(id: string) {
    const target = chats.find((c) => c.id === id);
    const mine = !target || target.user_id === me.id;
    if (mine && target?.people && !window.confirm("Delete this chat? It's shared, and it will be gone for everyone in it.")) return;
    if (!mine && !window.confirm("Leave this chat? It will disappear from your list. What you wrote stays in it.")) return;
    try {
      await (mine ? deleteChat(id) : removeChatMember(id, me.id));
    } catch {
      // list refresh below shows the real state
    }
    if (id === activeChatId) navigate("/");
    await refreshChats();
  }

  // A brand new chat shows a placeholder title in the sidebar until the
  // server generates one, so poll for it a few times.
  function handleFirstMessage(chatId: string, firstMessage: string) {
    const placeholder = firstMessage.length > 48 ? firstMessage.slice(0, 47) + "…" : firstMessage;
    const now = Date.now();
    setChats((prev) =>
      prev
        .map((c) => (c.id === chatId ? { ...c, updated_at: now, title: c.title ?? placeholder } : c))
        .sort((a, b) => b.updated_at - a.updated_at)
    );
    for (const ms of [4000, 10000, 20000]) setTimeout(() => void refreshChats(), ms);
  }

  // The start composer: create the chat, hand its first message to the chat
  // page, and move to /c/:id where the reply streams in.
  async function handleStartSend(content: string, model?: string, attachments: Attachment[] = []) {
    const { id } = await createChat(model || selectedModel, selectedBot?.id);
    await refreshChats();
    setStartMessage(id, content, attachments);
    navigate(`/c/${id}`);
  }

  return (
    <div className={`app ${landing ? "landing" : "chat-mode"}`}>
      <button
        className={`sidebar-drawer-toggle ${drawerOpen ? "open" : ""}`}
        onClick={() => setDrawerOpen((v) => !v)}
        aria-label={drawerOpen ? "Close chats" : "Chats"}
      >
        {drawerOpen ? "✕" : "☰"}
      </button>
      {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}
      <Sidebar
        chats={chats}
        bots={bots}
        selectedBotId={selectedBot?.id ?? null}
        onSelectBot={selectBot}
        onBotCreated={handleBotCreated}
        activeChatId={activeChatId}
        open={drawerOpen}
        onSelect={selectChat}
        onNewChat={handleNewChat}
        onDelete={handleDelete}
        me={me}
        balance={balance}
        onSignOut={onSignOut}
      />
      <Routes>
        <Route
          path="/"
          element={
            <StartPage
              models={models}
              botName={selectedBot?.name ?? "Seed"}
              selectedModel={selectedModel}
              onSelectModel={setSelectedModel}
              onSend={handleStartSend}
              refreshChats={refreshChats}
            />
          }
        />
        <Route
          path="/c/:id"
          element={
            <ChatPage
              me={me}
              models={models}
              expectedModel={selectedModel}
              expectedBotName={selectedBot?.name ?? "Seed"}
              onFirstMessage={handleFirstMessage}
              refreshChats={refreshChats}
              refreshBalance={refreshBalance}
            />
          }
        />
        {/* Old invite links and anything unknown. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
