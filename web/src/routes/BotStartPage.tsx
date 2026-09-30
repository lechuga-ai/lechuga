import { useMemo, useState } from "react";
import { Composer } from "../components/Composer";
import { Avatar } from "../components/Avatar";
import type { Bot, Model } from "../api";
import type { Attachment } from "../../../worker/src/attachments";

type Props = {
  bot: Bot | null;
  models: Model[];
  selectedModel: string;
  onSelectModel: (id: string) => void;
  // Creates the chat with this bot and navigates to /c/:id where the reply streams.
  onSend: (content: string, model?: string, attachments?: Attachment[]) => Promise<void>;
};

const LINES = ["what can I help with?", "what's on your mind?", "ask me anything.", "need a hand?"];

// /b/:botId: an empty chat with one bot, on the light chat background, the
// box in the middle of the screen. The home page's dark lettuce is for
// arriving; this is for starting.
export function BotStartPage({ bot, models, selectedModel, onSelectModel, onSend }: Props) {
  const [error, setError] = useState<string | null>(null);
  const line = useMemo(() => LINES[Math.floor(Math.random() * LINES.length)], []);

  async function send(content: string, attachments: Attachment[]) {
    setError(null);
    try {
      await onSend(content, undefined, attachments);
    } catch {
      setError("couldn't start your chat, try again");
    }
  }

  return (
    <div className="bot-start">
      {bot && (
        <div className="bot-start-head">
          <Avatar person={{ id: bot.id, name: bot.name, username: null, photo: null }} size={56} />
          <h1 className="bot-start-name">{bot.name}</h1>
          <p className="bot-start-line">{line}</p>
        </div>
      )}
      <Composer
        streaming={false}
        models={models}
        selectedModel={selectedModel}
        modelLocked={false}
        placeholder={bot ? `message ${bot.name}` : "message"}
        onSelectModel={onSelectModel}
        acceptsAttachments
        onSend={(content, attachments) => void send(content, attachments)}
        onStop={() => {}}
      />
      {error && <p className="hero-error">{error}</p>}
    </div>
  );
}
