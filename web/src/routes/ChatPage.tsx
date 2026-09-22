import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { MessageList } from "../components/MessageList";
import { Composer } from "../components/Composer";
import { AvatarStack } from "../components/Avatar";
import { ShareDialog } from "../components/ShareDialog";
import { ApiError, compactChat, getChat, sendMessage, type Me, type Message, type Model, type Person, type Roster, type Step } from "../api";
import { takeStartMessage } from "../startMessage";
import { composeMessage, estimateMessageTokens, type Attachment } from "../../../worker/src/attachments";
import { sinceLastSummary } from "../../../worker/src/summary";
import config from "../../../worker/config.json";

// How often a shared chat looks for what the others have written. There's no
// live channel, so it asks.
const SHARED_POLL_MS = 5000;

export type ChatPageProps = {
  me: Me;
  models: Model[];
  // The model the home page used when it created the chat, shown until the
  // chat row loads.
  expectedModel: string;
  onFirstMessage: (chatId: string, firstMessage: string) => void;
  refreshChats: () => Promise<void>;
  // Called once a reply has been charged, so the sidebar's balance follows.
  refreshBalance: () => void;
};

export function ChatPage({ me, models, expectedModel, onFirstMessage, refreshChats, refreshBalance }: ChatPageProps) {
  const { id: chatId = "" } = useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatModel, setChatModel] = useState(expectedModel);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [streamingSteps, setStreamingSteps] = useState<Step[]>([]);
  // Said by the server alongside a reply: the chat was too long to send whole.
  const [notice, setNotice] = useState<string | null>(null);
  const [compacting, setCompacting] = useState(false);
  // Whose chat this is and who's in it. A chat made a moment ago on the start
  // page is mine and has nobody else in it yet.
  const [role, setRole] = useState<"owner" | "member">("owner");
  const [roster, setRoster] = useState<Roster | null>(null);
  const [sharing, setSharing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // The chat this mount has already started from its handoff message.
  const startedRef = useRef<string | null>(null);

  // StrictMode runs an effect twice in development (run, clean up, run again).
  // The handoff below must happen once per chat: it takes a one-shot entry and
  // sends a real message. Loading a chat is the opposite — it has to be free to
  // run again, because the first run's answer is thrown away by its own
  // cleanup. Guarding both at once leaves the chat empty, which is what
  // clicking one in the sidebar used to do.
  useEffect(() => {
    setRole("owner");
    setRoster(null);
    setSharing(false);
    if (startedRef.current === chatId) return;

    const first = takeStartMessage(chatId);
    if (first) {
      // The home page just created this chat, so it's empty and its model is
      // the one picked there. Stream the reply at once, no load needed.
      startedRef.current = chatId;
      void send(first.content, first.attachments, true);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { chat, messages: history, role: myRole, roster: people } = await getChat(chatId);
        if (cancelled) return;
        setChatModel(chat.model);
        setMessages(history);
        setRole(myRole);
        setRoster(people);
      } catch {
        if (!cancelled) navigate("/", { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatId]);

  async function send(typed: string, attachments: Attachment[], isFirst: boolean) {
    // Shown the way it will be stored, so the chiclets appear at once.
    const content = composeMessage(typed, attachments);
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        chat_id: chatId,
        role: "user",
        content,
        user_id: me.id,
        prompt_tokens: null,
        completion_tokens: null,
        created_at: Date.now(),
      },
    ]);
    setStreamingText("");
    setStreamingReasoning("");
    setNotice(null);
    if (isFirst) onFirstMessage(chatId, typed || attachments.map((a) => a.name).join(", "));

    let full = "";
    let reasoning = "";
    let steps: Step[] = [];
    let failure: string | null = null;
    let failureCode: string | undefined;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await sendMessage(chatId, typed, attachments, {
        signal: controller.signal,
        onDelta: (delta) => {
          full += delta;
          setStreamingText(full);
        },
        onReasoning: (r) => {
          reasoning += r;
          setStreamingReasoning(reasoning);
        },
        onStep: (step) => {
          steps = steps.some((s) => s.id === step.id) ? steps.map((s) => (s.id === step.id ? step : s)) : [...steps, step];
          setStreamingSteps(steps);
        },
        onRetract: () => {
          full = "";
          setStreamingText("");
        },
        onNotice: setNotice,
      });
    } catch (err) {
      failure = (err as Error).message || "something went wrong";
      failureCode = err instanceof ApiError ? err.code : undefined;
    } finally {
      abortRef.current = null;
      setStreamingText(null);
      setStreamingReasoning("");
      setStreamingSteps([]);
    }

    const localId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      {
        id: localId,
        chat_id: chatId,
        role: "assistant",
        content: full,
        prompt_tokens: null,
        completion_tokens: null,
        created_at: Date.now(),
        reasoning: reasoning.trim() || undefined,
        steps: steps.length ? steps : undefined,
        error: failure ?? undefined,
        errorCode: failureCode,
      },
    ]);
    if (!failure) void settleReply(localId);
    await refreshChats();
  }

  // The worker stores and charges a reply just after its stream ends. Re-read
  // the chat until the stored copy shows up, then copy what it cost onto the
  // message on screen and refresh the balance.
  async function settleReply(localId: string) {
    for (const wait of [400, 1200, 3000]) {
      await new Promise((r) => setTimeout(r, wait));
      try {
        const { messages: stored } = await getChat(chatId);
        const reply = [...stored].reverse().find((m) => m.role === "assistant");
        if (reply?.credits == null) continue;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === localId
              ? { ...m, prompt_tokens: reply.prompt_tokens, completion_tokens: reply.completion_tokens, credits: reply.credits, model: reply.model }
              : m
          )
        );
        break;
      } catch {
        // try again
      }
    }
    refreshBalance();
  }

  const mePerson: Person = { id: me.id, name: me.name.trim() || (me.username ? `@${me.username}` : "you"), username: me.username, photo: me.photo };
  const owner = roster?.owner ?? mePerson;
  const others = roster?.members ?? [];
  const active = others.filter((m) => !m.removed);
  const isShared = role === "member" || active.length > 0;
  // Everyone who has ever typed here, for the names over their messages.
  // Only a chat that has been shared needs them.
  const people = useMemo(
    () => (others.length > 0 || role === "member" ? new Map([owner, ...others].map((p) => [p.id, p])) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roster, role]
  );

  // A shared chat asks every few seconds what the others have written. It
  // holds off while a reply is streaming here, and only ever takes a longer
  // chat from the server, never a shorter one: just after a reply streams,
  // what's on screen is briefly ahead of what's stored.
  const idleRef = useRef(true);
  idleRef.current = streamingText === null && !compacting;
  useEffect(() => {
    if (!isShared) return;
    const timer = setInterval(async () => {
      if (!idleRef.current || document.hidden) return;
      try {
        const fresh = await getChat(chatId);
        if (!idleRef.current) return;
        setRole(fresh.role);
        setRoster(fresh.roster);
        setMessages((prev) => {
          const settled = prev.filter((m) => !m.error);
          const last = fresh.messages[fresh.messages.length - 1];
          const same = fresh.messages.length === settled.length && last?.content === settled[settled.length - 1]?.content;
          if (same || fresh.messages.length < settled.length) return prev;
          // Reasoning is only ever held here, so carry it over.
          return fresh.messages.map((m, i) => (prev[i]?.content === m.content ? { ...m, reasoning: prev[i].reasoning } : m));
        });
      } catch (err) {
        // Removed from the chat, or it was deleted: it's gone from here too.
        if (err instanceof ApiError && err.message === "not found") {
          void refreshChats();
          navigate("/", { replace: true });
        }
      }
    }, SHARED_POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, isShared]);

  // Every message re-reads the chat so far (since the last compaction), and
  // pays for it. Once that's a noticeable amount, offer to compact.
  const carried = sinceLastSummary(messages).reduce((n, m) => n + estimateMessageTokens(m.content), 0);
  const rate = models.find((m) => m.id === chatModel)?.credit_per_million_prompt_tokens ?? 0;
  const carriedCredits = Math.ceil((carried * rate) / 1_000_000);
  // Compacting spends the owner's credits, so it's only offered to them.
  const offerCompact =
    role === "owner" && carried >= config.limits.compact_offer_tokens && streamingText === null && sinceLastSummary(messages).length >= 3;

  async function compact() {
    setCompacting(true);
    setNotice(null);
    try {
      await compactChat(chatId);
      setMessages((await getChat(chatId)).messages);
      refreshBalance();
    } catch (err) {
      setNotice((err as Error).message || "couldn't compact the chat, try again");
    } finally {
      setCompacting(false);
    }
  }

  return (
    <div className="chat-view">
      {sharing &&
        createPortal(
          <ShareDialog
            chatId={chatId}
            roster={roster ?? { owner: mePerson, members: [], pending: [] }}
            onRoster={(r) => {
              setRoster(r);
              void refreshChats();
            }}
            onClose={() => setSharing(false)}
          />,
          document.body
        )}
      <MessageList
        messages={messages}
        streamingText={streamingText}
        streamingReasoning={streamingReasoning}
        streamingSteps={streamingSteps}
        models={models}
        people={people}
        ownerId={owner.id}
        meId={me.id}
      />
      {notice && <p className="chat-notice">{notice}</p>}
      {(offerCompact || compacting) && (
        <p className="chat-notice">
          {compacting ? (
            "Compacting: Lechuga is reading the chat one last time and writing itself a summary…"
          ) : (
            <>
              Each message re-reads this whole chat, about {carriedCredits.toLocaleString()} {carriedCredits === 1 ? "credit" : "credits"} a
              time.{" "}
              <button
                type="button"
                className="chat-notice-action"
                onClick={compact}
                title="Lechuga writes a summary of the chat so far and carries that instead. Costs about one message. Files and details not in the summary are no longer available to it; everything stays on screen for you."
              >
                Compact this chat
              </button>
            </>
          )}
        </p>
      )}
      <Composer
        streaming={streamingText !== null}
        models={models}
        selectedModel={chatModel}
        modelLocked
        placeholder="message Lechuga"
        onSelectModel={() => {}}
        acceptsAttachments
        onSend={(content, attachments) => void send(content, attachments, messages.length === 0)}
        onStop={() => abortRef.current?.abort()}
        leading={
          messages.length > 0 || isShared ? (
            <div className="composer-people">
              {/* Who started it is the one wearing the ring, so nothing has to
                  say so. Past four faces the rest become a +n to hover. */}
              {isShared && <AvatarStack people={[owner, ...active]} ownerId={owner.id} size={22} max={4} />}
              {role === "owner" && (
                <button type="button" className="composer-share-btn" onClick={() => setSharing(true)}>
                  {isShared ? "Sharing" : "Share"}
                </button>
              )}
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
