import { useState } from "react";
import { authClient } from "../auth";

// At the foot of /billing: a quiet link, and the dialog that makes sure. It
// lives here, not in the menu behind your name, so it's never one slip away
// from Sign out.
export function DeleteAccount({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (typed.trim().toLowerCase() !== "delete" || busy) return;
    setBusy(true);
    setError(null);
    // Immediate. The session ends with the account, so go back to the front
    // page, which is the visitor's one from here on.
    const { error: failed } = await authClient.deleteUser({});
    if (failed) {
      setError(failed.message || "couldn't delete the account");
      setBusy(false);
      return;
    }
    window.location.href = "/";
  }

  return (
    <section className="billing-delete">
      <h2 className="billing-heading">Delete account</h2>
      <p>
        This removes your account, every chat in it, and any credits you have left. There's no undo.{" "}
        <button
          type="button"
          className="billing-link danger"
          onClick={() => {
            setTyped("");
            setError(null);
            setOpen(true);
          }}
        >
          Delete my account
        </button>
      </p>
      {open && (
        <div className="modal-backdrop" onClick={() => !busy && setOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>Delete your account?</h2>
            <p>
              This removes <strong>{email}</strong> and every chat in it. There's no undo.
            </p>
            <label htmlFor="confirm-delete">
              Type <code>delete</code> to confirm
            </label>
            <input
              id="confirm-delete"
              autoFocus
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void confirm()}
              disabled={busy}
            />
            {error && <p className="modal-error">{error}</p>}
            <div className="modal-actions">
              <button type="button" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="danger" onClick={() => void confirm()} disabled={busy || typed.trim().toLowerCase() !== "delete"}>
                {busy ? "deleting…" : "Delete account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
