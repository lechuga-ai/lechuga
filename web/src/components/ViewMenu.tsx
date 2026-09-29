import { useState } from "react";
import { Link } from "react-router-dom";

type Props = {
  // The bot the view is on, so Bot Manager opens at it.
  botId: string | null;
};

// Three dots at the top right of the chat view. Where things about the
// current bot live, starting with Bot Manager, which lands on it.
export function ViewMenu({ botId }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {open && <div className="view-menu-backdrop" onClick={() => setOpen(false)} />}
      <button type="button" className="view-menu-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" aria-label="Menu">
        ⋮
      </button>
      {open && (
        <div className="view-menu" role="menu">
          <Link to={botId ? `/settings/bots#${botId}` : "/settings/bots"} role="menuitem" onClick={() => setOpen(false)}>
            Bot Manager
          </Link>
          <Link to="/settings" role="menuitem" onClick={() => setOpen(false)}>
            Account
          </Link>
          <Link to="/help" role="menuitem" onClick={() => setOpen(false)}>
            Help
          </Link>
        </div>
      )}
    </>
  );
}
