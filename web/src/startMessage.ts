import type { Attachment } from "../../worker/src/attachments";

// Hands a chat's first message from a start page to the chat page that
// streams the reply. Lives outside React state so it survives the route
// change, and vanishes on refresh or a new tab, so a first message can
// never be sent twice by reloading.
type StartMessage = { content: string; attachments: Attachment[] };
let pending: ({ chatId: string } & StartMessage) | null = null;

export function setStartMessage(chatId: string, content: string, attachments: Attachment[] = []): void {
  pending = { chatId, content, attachments };
}

export function takeStartMessage(chatId: string): StartMessage | null {
  if (pending?.chatId === chatId) {
    const { content, attachments } = pending;
    pending = null;
    return { content, attachments };
  }
  return null;
}

// A message typed on the public landing page by someone not yet signed in.
// sessionStorage so it survives the round trip through email or Google and
// comes back in the same tab, but never leaks to another tab or session.
const DRAFT_KEY = "lechuga:draft";

export function saveDraft(content: string, model: string): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ content, model }));
  } catch {
    // Private mode or storage disabled; the message just won't be kept.
  }
}

export function takeDraft(): { content: string; model: string } | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(DRAFT_KEY);
    const draft = JSON.parse(raw);
    if (typeof draft?.content !== "string" || !draft.content.trim()) return null;
    return { content: draft.content, model: typeof draft.model === "string" ? draft.model : "" };
  } catch {
    return null;
  }
}

// The home page's free trial chat. The message travels to /try in memory,
// like a start message. The finished conversation is kept in localStorage,
// not sessionStorage: a magic link usually opens in a new tab, and the point
// is to find the conversation again after signing up and make it the
// account's first chat. It never leaves the browser until then, and it is
// removed the moment it's imported.
let pendingTrial: string | null = null;

export function setTrialMessage(content: string): void {
  pendingTrial = content;
}

export function takeTrialMessage(): string | null {
  const content = pendingTrial;
  pendingTrial = null;
  return content;
}

const TRIAL_KEY = "lechuga:trial";

export type TrialChat = { question: string; answer: string; day: string };

export function saveTrial(question: string, answer: string): void {
  try {
    localStorage.setItem(TRIAL_KEY, JSON.stringify({ question, answer, day: new Date().toISOString().slice(0, 10) }));
  } catch {
    // Storage disabled; the conversation just won't be kept.
  }
}

export function readTrial(): TrialChat | null {
  try {
    const trial = JSON.parse(localStorage.getItem(TRIAL_KEY) ?? "null");
    return typeof trial?.question === "string" && typeof trial?.answer === "string" ? trial : null;
  } catch {
    return null;
  }
}

export function clearTrial(): void {
  try {
    localStorage.removeItem(TRIAL_KEY);
  } catch {
    // nothing to clear
  }
}
