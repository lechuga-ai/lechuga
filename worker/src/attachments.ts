// Files and long pastes attached to a message. The models only read text, so
// an attachment is text, and it travels inside the message itself: each one
// is a marked block ahead of what the person typed. That's what the model
// sees, what's stored, and what's re-sent with later turns, so the chat
// "remembers" the file for as long as its turn stays within the history
// budget (config.json limits.history_tokens). The web app imports this file
// too, to show the blocks as chiclets instead of as text.

export type Attachment = {
  name: string;
  // The file's text; for an image, its data URL (a JPEG the browser has
  // already scaled down, see the composer).
  text: string;
  // True for a long paste, which has no file name of its own.
  pasted?: boolean;
  // True for a picture. Only models marked "vision" in config.json get these.
  image?: boolean;
};

const OPEN = (a: Attachment) => `<attachment name="${a.name}"${a.pasted ? ' pasted="true"' : ""}${a.image ? ' image="true"' : ""}>`;
const CLOSE = "</attachment>";

function cleanName(name: string): string {
  return name.replace(/["<>\r\n]/g, "").trim().slice(0, 120) || "file";
}

// A closing tag inside a file would end its block early; break it up.
function cleanText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/<\/attachment>/g, "</ attachment>");
}

export function composeMessage(typed: string, attachments: Attachment[]): string {
  const blocks = attachments.map((a) => `${OPEN({ ...a, name: cleanName(a.name) })}\n${cleanText(a.text)}\n${CLOSE}`);
  return [...blocks, typed].filter(Boolean).join("\n\n");
}

const BLOCK = /^<attachment name="([^"]*)"( pasted="true")?( image="true")?>\n([\s\S]*?)\n<\/attachment>(?:\n\n|$)/;

// The reverse: the attachments at the start of a stored message, and the
// typed text after them. A message with none comes back unchanged.
export function splitMessage(content: string): { attachments: Attachment[]; typed: string } {
  const attachments: Attachment[] = [];
  let rest = content;
  for (let m = BLOCK.exec(rest); m; m = BLOCK.exec(rest)) {
    attachments.push({ name: m[1], text: m[4], ...(m[2] ? { pasted: true } : {}), ...(m[3] ? { image: true } : {}) });
    rest = rest.slice(m[0].length);
  }
  return { attachments, typed: rest };
}

// Anything with a NUL in it isn't text (images, PDFs, zips, Office files).
export function looksLikeText(text: string): boolean {
  return !text.includes(String.fromCharCode(0));
}

const IMAGE_URL = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;

export function looksLikeImage(dataUrl: string): boolean {
  return IMAGE_URL.test(dataUrl);
}

// A rough token count for the history budget. A picture's data URL is
// hundreds of thousands of characters but costs the model about a thousand
// tokens, so it's counted as that and not by its length.
const IMAGE_TOKENS = 1200;
export function estimateMessageTokens(content: string): number {
  const { attachments, typed } = splitMessage(content);
  return attachments.reduce((n, a) => n + (a.image ? IMAGE_TOKENS : Math.ceil(a.text.length / 4)), Math.ceil(typed.length / 4));
}

// What the model is sent for one stored message. Text-only messages stay a
// plain string. One with pictures becomes a list of parts, the pictures as
// image_url parts, in the OpenAI-compatible shape the gateway takes.
export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export function modelContent(content: string): string | ContentPart[] {
  const { attachments, typed } = splitMessage(content);
  const images = attachments.filter((a) => a.image);
  if (images.length === 0) return content;
  const text = composeMessage(typed, attachments.filter((a) => !a.image)) || "Here is a picture.";
  return [{ type: "text", text }, ...images.map((a) => ({ type: "image_url" as const, image_url: { url: a.text } }))];
}

// Files the worker turns into text before they're attached (convert.ts).
// By extension, since browsers report Office types inconsistently.
export const CONVERTIBLE = ["pdf", "docx", "xlsx", "xls", "xlsm", "ods", "odt", "numbers", "html", "htm"];
