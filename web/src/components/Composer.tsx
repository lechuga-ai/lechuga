import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { convertFile, type Model } from "../api";
import { CONVERTIBLE, looksLikeText, type Attachment } from "../../../worker/src/attachments";
import config from "../../../worker/config.json";

import { getEffort, saveEffort, type Effort } from "../effort";

const LIMITS = config.limits;

type Props = {
  streaming: boolean;
  models: Model[];
  selectedModel: string;
  // An open chat keeps the model it was created with; the picker only applies to new chats.
  modelLocked: boolean;
  // Why it's locked, for the tooltip, when it isn't the usual reason.
  modelLockedTitle?: string;
  placeholder: string;
  onSelectModel: (id: string) => void;
  // attachments: files and long pastes, sent along with what was typed. Only
  // offered where the parent passes acceptsAttachments.
  onSend: (content: string, attachments: Attachment[]) => void;
  acceptsAttachments?: boolean;
  onStop: () => void;
  // Bumping this number focuses the textarea.
  focusSignal?: number;
  // Anything to sit at the start of the row with the model and send button,
  // left of them. The chat page puts who's in a shared chat there.
  leading?: ReactNode;
  // Words on the send button instead of the arrow (the home page's "Try it").
  // A labelled button is never grayed out: pressed with nothing typed, it
  // puts the cursor in the box.
  sendLabel?: string;
};

export function Composer({
  streaming,
  models,
  selectedModel,
  modelLocked,
  modelLockedTitle,
  placeholder,
  onSelectModel,
  onSend,
  onStop,
  focusSignal,
  sendLabel,
  leading,
  acceptsAttachments = false,
}: Props) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Names of files being scaled down or converted, shown while that happens.
  const [reading, setReading] = useState<string[]>([]);
  const model = models.find((m) => m.id === selectedModel);
  const modelRef = useRef(model);
  modelRef.current = model;
  // The latest list, for the drop handler, which is registered once.
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const [guideOpen, setGuideOpen] = useState(false);
  const guideRef = useRef<HTMLDivElement>(null);
  // Remembered in this browser, and sent with each message by api.ts.
  const [effort, setEffort] = useState<Effort>(getEffort);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusSignal !== undefined && focusSignal > 0) textareaRef.current?.focus();
  }, [focusSignal]);

  // Ways out of the model guide, for anyone who doesn't know that clicking
  // away is one: a click anywhere outside it, and Escape. There's an ✕ in
  // the panel itself too. KeyboardEvent here is the browser's, not React's
  // same-named type, which this file imports.
  useEffect(() => {
    if (!guideOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (guideRef.current && !guideRef.current.contains(e.target as Node)) setGuideOpen(false);
    };
    const handleKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setGuideOpen(false);
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [guideOpen]);

  // Picking a model, from the box's own menu or from the guide panel, is
  // the same action either way, and both close the guide once it's done.
  function selectModel(id: string) {
    onSelectModel(id);
    setGuideOpen(false);
  }

  // Adds what fits and says why about what doesn't. The worker checks the
  // same limits again (chat.ts); these are here so the answer is immediate.
  function attach(incoming: Attachment[], problems: string[] = []) {
    const kept = [...attachmentsRef.current];
    for (const a of incoming) {
      const size = kept.reduce((n, k) => n + (k.image ? 0 : k.text.length), 0);
      if (a.image) kept.push(a);
      else if (!a.text.trim()) problems.push(`${a.name} is empty`);
      else if (!looksLikeText(a.text)) problems.push(`Sorry, Lechuga can't read ${a.name} yet, only plain text`);
      else if (kept.length >= LIMITS.attachments_per_message) problems.push(`${a.name}: ${LIMITS.attachments_per_message} attachments is the most one message can carry`);
      else if (size + a.text.length > LIMITS.attachment_chars)
        problems.push(`${a.name} is too long: one message can carry ${LIMITS.attachment_chars.toLocaleString()} characters of attachments`);
      else kept.push(a);
    }
    setAttachments(kept);
    setAttachError(problems.length ? problems.join(". ") + "." : null);
  }

  // What kind of file it is decides what happens to it, and the message if
  // nothing can: a photo on a model that can't see should hear exactly that,
  // not "too big".
  //   pictures        scaled down here and sent as pictures, to a model with vision
  //   PDFs, Office    turned into text by the worker (convert.ts)
  //   everything else read as text, if text is what it is
  async function attachFiles(files: File[]) {
    const problems: string[] = [];
    const ready: Attachment[] = [];
    setReading(files.map((f) => f.name));
    for (const f of files) {
      const ext = f.name.includes(".") ? f.name.split(".").pop()!.toLowerCase() : "";
      const kind = ext ? `.${ext} files` : "that kind of file";
      try {
        if (f.type.startsWith("image/") && !f.type.includes("svg")) {
          const current = modelRef.current;
          if (!current?.vision) {
            const seeing = models.find((m) => m.vision && !m.retired);
            problems.push(
              `Sorry, ${current?.label ?? "this model"} can't look at pictures` + (seeing ? `. ${seeing.label} can: start a new chat on it` : "")
            );
          } else if (attachmentsRef.current.concat(ready).filter((a) => a.image).length >= LIMITS.images_per_message) {
            problems.push(`${f.name}: ${LIMITS.images_per_message} pictures is the most one message can carry`);
          } else {
            ready.push({ name: f.name, text: await shrinkImage(f, LIMITS.image_chars), image: true });
          }
        } else if (CONVERTIBLE.includes(ext)) {
          ready.push(await convertFile(f));
        } else if (/^(audio|video|font)\//.test(f.type) || /zip|msword|ms-powerpoint|officedocument/.test(f.type) || !looksLikeText(await f.slice(0, 4096).text())) {
          // The type is the browser's guess from the name; the first few KB
          // say for sure, since text has no NUL bytes in it.
          problems.push(`Sorry, Lechuga can't read ${kind} yet`);
        } else if (f.size > LIMITS.attachment_chars * 4) {
          // 4 bytes is the most one character takes, so this can't fit.
          problems.push(`${f.name} is too long: one message can carry about ${Math.round(LIMITS.attachment_chars / 3000)} pages of attachments`);
        } else {
          ready.push({ name: f.name, text: await f.text() });
        }
      } catch (err) {
        problems.push((err as Error).message || `couldn't read ${f.name}`);
      }
      setReading((names) => names.filter((n) => n !== f.name));
    }
    setReading([]);
    attach(ready, problems);
    textareaRef.current?.focus();
  }

  // A long paste becomes a chiclet instead of filling the box; so do pasted files.
  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (!acceptsAttachments) return;
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      void attachFiles(files);
      return;
    }
    const text = e.clipboardData.getData("text/plain");
    if (text.length >= LIMITS.paste_becomes_attachment_chars) {
      e.preventDefault();
      attach([{ name: "Pasted text", text, pasted: true }]);
    }
  }

  // Dragging a file anywhere over the page shows the drop mask. Enter and
  // leave fire for every element crossed, so count them.
  useEffect(() => {
    if (!acceptsAttachments) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void attachFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptsAttachments]);

  function submit() {
    const trimmed = value.trim();
    if ((!trimmed && attachments.length === 0) || streaming) return;
    onSend(trimmed, attachments);
    setAttachments([]);
    setAttachError(null);
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "";
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }

  return (
    <div className="composer">
      <div className="composer-box">
        {(attachments.length > 0 || reading.length > 0) && (
          <div className="chiclets">
            {attachments.map((a, i) => (
              <Chiclet key={i} attachment={a} onRemove={() => setAttachments(attachments.filter((_, j) => j !== i))} />
            ))}
            {reading.map((name) => (
              <div key={name} className="chiclet reading">
                <div className="chiclet-body">
                  <span className="chiclet-text">reading…</span>
                  <span className="chiclet-name">{name}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            autoGrow(e.target);
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        {attachError && <p className="composer-attach-error">{attachError}</p>}
        <div className="composer-row">
          {(acceptsAttachments || leading) && (
            <div className="composer-start">
              {/* The only way in on a phone, where nothing can be dragged or
                  pasted. No accept list on purpose: left open, iOS and Android
                  offer the photo library, the camera and files in one sheet. */}
              {acceptsAttachments && (
                <>
                  <button type="button" className="attach-btn" onClick={() => fileInputRef.current?.click()} aria-label="Add pictures or files" title="Add pictures or files">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      // Emptied so choosing the same file again still fires.
                      e.target.value = "";
                      if (files.length > 0) void attachFiles(files);
                    }}
                  />
                </>
              )}
              {leading}
            </div>
          )}
          {/* Where the model can't change — an open chat, and the home page's
              free chat — it says which one and stops there. As a menu it had
              to carry a whole sentence explaining itself, and a select is as
              wide as its longest line. */}
          {models.length > 0 &&
            (modelLocked ? (
              <span className="model-fixed" title={modelLockedTitle ?? "This chat keeps the model it started with. Start a new chat to pick another."}>
                {model?.label ?? selectedModel}
              </span>
            ) : (
              <select
                className="model-select"
                value={selectedModel}
                title="Model for new chats"
                onChange={(e) => selectModel(e.target.value)}
                aria-label="Model"
              >
                {models
                  // Retired models only appear when this chat is already on one.
                  .filter((m) => !m.retired || m.id === selectedModel)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
              </select>
            ))}
          {/* Beside the model, and independent of it. Not on the public home
              page, whose free chat has no settings. */}
          {!sendLabel && (
            <select
              className="model-select"
              value={effort}
              title={config.efforts.find((e) => e.id === effort)?.hint}
              onChange={(e) => {
                setEffort(e.target.value as Effort);
                saveEffort(e.target.value as Effort);
              }}
              aria-label="How hard the model thinks before answering"
            >
              {config.efforts.map((e) => (
                <option key={e.id} value={e.id} title={e.hint}>
                  {e.label}
                </option>
              ))}
            </select>
          )}
          {streaming ? (
            <button className="send-btn stop" onClick={onStop} aria-label="Stop">
              <span className="stop-icon" />
            </button>
          ) : sendLabel ? (
            <button className="send-btn labelled" onClick={() => (value.trim() ? submit() : textareaRef.current?.focus())}>
              {sendLabel}
            </button>
          ) : (
            <button className="send-btn" onClick={submit} disabled={!value.trim() && attachments.length === 0} aria-label="Send">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M7 12V2M3 6l4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {dragging && createPortal(<DropMask />, document.body)}
      {/* Not on the public home page (sendLabel), where the model is fixed. */}
      {!sendLabel && models.length > 1 && (
        <ModelGuide
          containerRef={guideRef}
          open={guideOpen}
          onToggle={() => setGuideOpen((v) => !v)}
          models={models.filter((m) => !m.retired || m.id === selectedModel)}
          selectedModel={selectedModel}
          locked={modelLocked}
          onSelect={selectModel}
        />
      )}
    </div>
  );
}

// A file or a long paste, as a small card: the start of its text, and its
// name (or PASTED). With onRemove it's in the composer; without, it's in a
// sent message, where onOpen shows the whole text.
export function Chiclet({ attachment, onRemove, onOpen, open }: { attachment: Attachment; onRemove?: () => void; onOpen?: () => void; open?: boolean }) {
  const label = attachment.pasted ? "PASTED" : attachment.name;
  const body = (
    <>
      {attachment.image ? (
        <img className="chiclet-image" src={attachment.text} alt="" />
      ) : (
        <span className="chiclet-text">{attachment.text.slice(0, 160)}</span>
      )}
      <span className="chiclet-name" title={attachment.name}>
        {label}
      </span>
    </>
  );
  return (
    <div className={`chiclet ${open ? "open" : ""}`}>
      {onOpen ? (
        <button type="button" className="chiclet-body" onClick={onOpen} aria-expanded={open} title="Show or hide the text">
          {body}
        </button>
      ) : (
        <div className="chiclet-body">{body}</div>
      )}
      {onRemove && (
        <button type="button" className="chiclet-remove" onClick={onRemove} aria-label={`Remove ${attachment.name}`}>
          ✕
        </button>
      )}
    </div>
  );
}

// A page with something on it: what kind of file, drawn small.
// Scales a picture down to something a message can carry: at most 1280px on
// its long side, as a JPEG, smaller again if that's still too many characters.
async function shrinkImage(file: File, maxChars: number): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`Sorry, this browser can't open ${file.name}. A JPEG or PNG will work`);
  }
  let side = 1280;
  let quality = 0.85;
  for (let attempt = 0; attempt < 5; attempt++) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d")!;
    // JPEG has no transparency; put white behind a see-through PNG.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= maxChars) return url;
    side = Math.round(side * 0.75);
    quality -= 0.1;
  }
  throw new Error(`${file.name} is too detailed to send, even scaled down`);
}

function FileDrawing({ kind }: { kind: "text" | "markdown" | "table" | "data" | "code" | "picture" | "document" }) {
  return (
    <svg width="54" height="66" viewBox="0 0 54 66" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3h26l13 13v44a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z" />
      <path d="M34 3v13h13" />
      {kind === "text" && <path d="M14 28h26M14 36h26M14 44h26M14 52h16" />}
      {kind === "markdown" && <path d="M14 30h8M18 26v8M28 30h12M14 40h26M14 48h26M14 56h14" />}
      {kind === "table" && <path d="M13 27h28v28H13zM13 36h28M13 46h28M23 27v28M32 27v28" />}
      {kind === "data" && <path d="M22 27c-4 0-4 3-4 6s0 6-4 7c4 1 4 4 4 7s0 6 4 6M32 27c4 0 4 3 4 6s0 6 4 7c-4 1-4 4-4 7s0 6-4 6" />}
      {kind === "code" && <path d="M21 33l-7 8 7 8M33 33l7 8-7 8M29 29l-4 24" />}
      {kind === "picture" && <path d="M13 28h28v26H13zM13 48l8-9 7 7 5-5 8 8M33 35.5a2 2 0 1 0 .01 0" />}
      {kind === "document" && <path d="M14 27h14M14 34h26M14 41h26M14 48h26M14 55h18" />}
    </svg>
  );
}

// Covers the page while a file is being dragged over it.
function DropMask() {
  const kinds = [
    { kind: "picture", label: "Pictures", detail: "on GLM 5.3 Flash" },
    { kind: "document", label: "PDF and Office", detail: ".pdf .docx .xlsx" },
    { kind: "text", label: "Text and notes", detail: ".txt .log" },
    { kind: "markdown", label: "Markdown", detail: ".md" },
    { kind: "table", label: "Spreadsheets as CSV", detail: ".csv .tsv" },
    { kind: "data", label: "Data", detail: ".json .xml .yaml" },
    { kind: "code", label: "Code", detail: ".py .js .html …" },
  ] as const;
  return (
    <div className="drop-mask">
      <div className="drop-mask-inner">
        <h2>Drop it here</h2>
        <p>Lechuga reads the whole file along with your message, and keeps it in mind for the rest of the chat.</p>
        <div className="drop-mask-kinds">
          {kinds.map((k) => (
            <div key={k.kind} className="drop-mask-kind">
              <FileDrawing kind={k.kind} />
              <strong>{k.label}</strong>
              <span>{k.detail}</span>
            </div>
          ))}
        </div>
        <p className="drop-mask-note">
          Up to {LIMITS.attachments_per_message} files and about {Math.round(LIMITS.attachment_chars / 3000)} pages of text
          in all, and {LIMITS.images_per_message} pictures. Not yet: scanned PDFs, slides, audio or video.
        </p>
      </div>
    </div>
  );
}

type GuideProps = {
  containerRef: RefObject<HTMLDivElement>;
  open: boolean;
  onToggle: () => void;
  models: Model[];
  selectedModel: string;
  locked: boolean;
  onSelect: (id: string) => void;
};

// Unfolds under the box, in place: each model, what it costs next to the
// default, and what we honestly think it's for. Choosing here is the same as
// choosing in the picker; in an open chat it only informs.
function ModelGuide({ containerRef, open, onToggle, models, selectedModel, locked, onSelect }: GuideProps) {
  const base = models[0];
  return (
    <div className="model-guide" ref={containerRef}>
      <button type="button" className="model-guide-toggle" onClick={onToggle} aria-expanded={open}>
        about the models <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {/* Always in the DOM (so the open/close transition can play) but
          absolutely positioned, so opening it never changes the composer's
          height and shoves the chat above it around. */}
      <div className={`model-guide-panel ${open ? "open" : ""}`} aria-hidden={!open}>
        {open && (
          <button type="button" className="model-guide-close" onClick={onToggle} aria-label="Close">
            ✕
          </button>
        )}
        {open && (
          <p className="model-guide-intro">
            {locked
              ? "For your information. This chat stays on the model it started with."
              : "For your information. You can pick one here, or in the menu in the box above: it's the same choice."}
          </p>
        )}
        {open &&
          models.map((m) => {
            // Replies are most of any bill, so compare on the output rate.
            const times = Math.round(m.credit_per_million_completion_tokens / base.credit_per_million_completion_tokens);
            return (
              <button
                key={m.id}
                type="button"
                className={`model-guide-row ${m.id === selectedModel ? "selected" : ""}`}
                onClick={() => !locked && onSelect(m.id)}
                disabled={locked && m.id !== selectedModel}
              >
                <span className="model-guide-name">
                  {m.label}
                  <span className="model-guide-cost">{m.id === base.id ? "our default" : `about ${times}× the cost`}</span>
                </span>
                {m.blurb && <span className="model-guide-blurb">{m.blurb}</span>}
              </button>
            );
          })}
        {open && (
          <p className="model-guide-foot">
            Exact prices are on the <a href="/pricing">pricing page</a>, and there's more on choosing in <a href="/tips">Tips + tricks</a>.
          </p>
        )}
      </div>
    </div>
  );
}
