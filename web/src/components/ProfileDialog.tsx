import { useRef, useState, type FormEvent } from "react";
import { saveProfile, type Me } from "../api";
import { Avatar } from "./Avatar";
import config from "../../../worker/config.json";

type Props = { me: Me; onClose: () => void; onSaved: (profile: { name: string; photo: number | null }) => void };

const SIDE = 256;

// Crops a picture to a centred square and scales it to 256px, as a JPEG small
// enough for the worker to take (config.json limits.avatar_chars).
async function squareJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const crop = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIDE;
  canvas
    .getContext("2d")!
    .drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, SIDE, SIDE);
  for (const quality of [0.85, 0.7, 0.5]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= config.limits.avatar_chars) return url;
  }
  throw new Error("that picture won't shrink enough; try another");
}

// Your name and your face, as the people you share chats with see them.
export function ProfileDialog({ me, onClose, onSaved }: Props) {
  const [name, setName] = useState(me.name);
  // undefined: leave the photo as it is. null: remove it. A string: the new one.
  const [photo, setPhoto] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setPhoto(await squareJpeg(file));
    } catch (err) {
      setError((err as Error).message || "that file isn't a picture we can use");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!changed || busy) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveProfile(name.trim(), photo));
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  // Either one is enough to save, and the name can be left empty.
  const changed = name.trim() !== me.name.trim() || photo !== undefined;
  const hasPhoto = photo === undefined ? me.photo !== null : photo !== null;
  const shownName = name.trim() || (me.username ? `@${me.username}` : me.email);

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>Your profile</h2>
        <p>This is what people see when you share a chat with them. Your email address is never shown.</p>
        <form onSubmit={submit}>
          <div className="profile-photo">
            {typeof photo === "string" ? (
              <span className="avatar" style={{ width: 72, height: 72 }}>
                <img src={photo} alt="" />
              </span>
            ) : (
              <Avatar person={{ id: me.id, name: shownName, username: me.username, photo: photo === null ? null : me.photo }} size={72} />
            )}
            <div className="profile-photo-actions">
              <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
                {hasPhoto ? "Change photo" : "Add a photo"}
              </button>
              {hasPhoto && (
                <button type="button" className="signin-link" onClick={() => setPhoto(null)} disabled={busy}>
                  remove
                </button>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void choose(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
          <label htmlFor="profile-name">Name, if you'd like one shown</label>
          <input
            id="profile-name"
            autoComplete="name"
            maxLength={60}
            value={name}
            placeholder={me.username ? `@${me.username}` : ""}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
          {me.username && (
            <p className="profile-username">
              Your username is @{me.username}. That's how people find you to share a chat, and what they see if you leave the name empty.
            </p>
          )}
          {error && <p className="modal-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy || !changed}>
              {busy ? "saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
