import { Link } from "react-router-dom";

const YEAR = new Date().getFullYear();

// The full trust footer: brand + tagline, two columns of links, a copyright
// line. Lives at the bottom of every public marketing/doc page (home, about,
// terms, privacy, help, pricing, what's new). Signed-in app screens and the
// trial page are tighter on room, so they get <Copyright> instead.
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-brand-block">
        <Link className="site-footer-brand" to="/">
          <span className="logo">
            <img src="/lechuga_logo.png" alt="" />
          </span>
          Lechuga
        </Link>
        <p className="site-footer-tag">
          Lettuce in Spanish. Built on open source models, running on Cloudflare, at a fraction of the usual price.
        </p>
      </div>
      <nav className="site-footer-col" aria-label="Product">
        <h3>Product</h3>
        <Link to="/#why-its-different">Why?</Link>
        <Link to="/whats-new">What's new</Link>
        <Link to="/pricing">Pricing transparency</Link>
        <Link to="/tips">Tips + tricks</Link>
        <Link to="/help">Help</Link>
      </nav>
      <nav className="site-footer-col" aria-label="Team">
        <h3>Team</h3>
        <Link to="/about">About</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
      </nav>
      <div className="site-footer-bottom">
        <Copyright />
      </div>
    </footer>
  );
}

// The one-line version for screens with no room for the full footer: the
// trial page, the signed-in app's sidebar, and the bottom of the full footer
// itself. No Terms/Privacy here — the full footer already has them in its
// Team column, and the app has its own Help/legal menu (see Sidebar.tsx).
export function Copyright({ className = "" }: { className?: string }) {
  return <p className={`copyright ${className}`}>© {YEAR} Lechuga</p>;
}
