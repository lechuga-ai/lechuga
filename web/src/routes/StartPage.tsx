import { useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "../components/Composer";
import { randomEmptyLine } from "../emptyLine";
import { heroTagline } from "../heroTagline";
import { useNavigate } from "react-router-dom";
import { clearTrial, readTrial, takeDraft } from "../startMessage";
import { importTrialChat, type Model } from "../api";
import type { Attachment } from "../../../worker/src/attachments";

type Props = {
  models: Model[];
  selectedModel: string;
  onSelectModel: (id: string) => void;
  // Creates the chat and navigates to /c/:id where the reply streams.
  onSend: (content: string, model?: string, attachments?: Attachment[]) => Promise<void>;
  refreshChats: () => Promise<void>;
};

// The signed-in "/" view: the wordmark over the photo and one box to type in.
// If the visitor typed a message before signing in, that message is waiting;
// start it now.
export function StartPage({ models, selectedModel, onSelectModel, onSend, refreshChats }: Props) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const placeholder = useMemo(randomEmptyLine, []);
  const tagline = useMemo(heroTagline, []);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      // The free chat they had before signing up becomes the account's first
      // chat. The worker only accepts it while the account has no chats, so
      // for anyone else this is a quiet no-op; either way it's forgotten here.
      const trial = readTrial();
      let importedId: string | null = null;
      if (trial) {
        clearTrial();
        try {
          importedId = (await importTrialChat(trial.question, trial.answer)).id;
          await refreshChats();
        } catch {
          // not a new account, or it didn't save; nothing to show
        }
      }
      const draft = takeDraft();
      if (draft) await onSend(draft.content, draft.model).catch(() => setError("couldn't start your chat, try again"));
      else if (importedId) navigate(`/c/${importedId}`);
    })();
  }, []);

  async function send(content: string, attachments: Attachment[]) {
    setError(null);
    try {
      await onSend(content, undefined, attachments);
    } catch {
      setError("couldn't start your chat, try again");
    }
  }

  return (
    // The home page's hero frame (photo, centering), without the marketing.
    <div className="home">
      <section className="home-hero">
        <img className="hero-logo" src="/lechuga_logo.png" alt="" />
        <h1 className="hero-title">
          Lechuga <span className="alpha" title="Early days: rough edges expected">alpha</span>
        </h1>
        <p className="hero-tag">{tagline}</p>
        <Composer
          streaming={false}
          models={models}
          selectedModel={selectedModel}
          modelLocked={false}
          placeholder={placeholder}
          onSelectModel={onSelectModel}
          acceptsAttachments
          onSend={(content, attachments) => void send(content, attachments)}
          onStop={() => {}}
        />
        {error && <p className="hero-error">{error}</p>}
      </section>
    </div>
  );
}
