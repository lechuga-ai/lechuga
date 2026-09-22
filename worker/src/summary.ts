// "Compact this chat": the conversation so far is replaced, as far as the
// model is concerned, by a summary of it. The summary is stored as an
// ordinary assistant message wrapped in a marker. Everything before the
// latest one stays on screen but is no longer sent, which is the point: a
// long chat, or one carrying a big document, stops paying to re-read it all
// with every message. The web app imports this file too, to draw the divider.

const OPEN = "<summary>\n";
const CLOSE = "\n</summary>";

export function wrapSummary(text: string): string {
  return OPEN + text.trim() + CLOSE;
}

export function isSummary(content: string): boolean {
  return content.startsWith(OPEN) && content.endsWith(CLOSE);
}

export function summaryText(content: string): string {
  return isSummary(content) ? content.slice(OPEN.length, -CLOSE.length) : content;
}

// The messages the model should be sent: from the latest summary onwards.
export function sinceLastSummary<T extends { role: string; content: string }>(messages: T[]): T[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant" && isSummary(messages[i].content)) return messages.slice(i);
  }
  return messages;
}

export const SUMMARY_PREAMBLE =
  "This conversation was compacted at the person's request. What follows is a summary of everything before this point. The earlier messages and any attached files are no longer available to you, so rely on the summary, and say so if something you need isn't in it.\n\n";

export const SUMMARY_REQUEST =
  "Write a summary of this conversation so far that you could pick up and continue from. Cover what I'm trying to do, the facts and decisions we've settled, what matters from any attached documents or pictures (keep the names, numbers, dates and exact wording that are likely to be needed again), and anything still open. Be thorough but compact. No preamble, no sign-off: just the summary.";
