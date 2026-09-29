import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { SiteFooter } from "./SiteFooter";

export type NavSection = { id: string; label: string };
// A page in the group. Its sections are the headings on it, listed under it
// in the nav while it's the page being read.
export type NavGroup = { to: string; label: string; sections?: NavSection[] };

type Props = {
  title: string;
  nav: NavGroup[];
  navLabel?: string;
  children: ReactNode;
};

// How far down the page a heading has to be before it counts as "the one
// you're reading": a little below the top, so a heading that has just
// scrolled under the fold isn't still the highlighted one.
const READING_LINE = 120;

// A long page with a table of contents down the left: the pages in a group
// (Help, Getting started with AI; or Profile, Credits), and under the one
// being read, its sections, with the section on screen marked as you scroll.
// Everything scrolls inside .doc-page, not the window, so the nav sticks
// within that and the scroll-spy listens there.
export function SideNavPage({ title, nav, navLabel = "On these pages", children }: Props) {
  const { pathname, hash } = useLocation();
  const pageRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const current = nav.find((g) => g.to === pathname) ?? nav[0];
  const sections = current.sections ?? [];

  // Arriving with a hash from another route: the router doesn't scroll to it.
  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash, pathname]);

  useEffect(() => {
    const page = pageRef.current;
    if (!page || sections.length === 0) return;
    const update = () => {
      const top = page.getBoundingClientRect().top + READING_LINE;
      let found: string | null = sections[0].id;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= top) found = s.id;
      }
      setActiveId(found);
    };
    update();
    page.addEventListener("scroll", update, { passive: true });
    return () => page.removeEventListener("scroll", update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, sections.map((s) => s.id).join()]);

  return (
    <div className="doc-page" ref={pageRef}>
      <div className="doc-inner docnav">
        {/* A way back that doesn't depend on the browser's back button:
            inside the native app there isn't one. */}
        <Link className="doc-back" to="/">
          ← Home
        </Link>
        <Link className="doc-brand" to="/">
          <span className="logo">
            <img src="/lechuga_logo.png" alt="" />
          </span>
          Lechuga
        </Link>
        <div className="docnav-body">
          <nav className="docnav-nav" aria-label={navLabel}>
            {nav.map((g) => (
              <div key={g.to} className={`docnav-group ${g.to === current.to ? "current" : ""}`}>
                <Link to={g.to} aria-current={g.to === current.to ? "page" : undefined}>
                  {g.label}
                </Link>
                {g.to === current.to && g.sections && g.sections.length > 0 && (
                  <div className="docnav-sections">
                    {g.sections.map((s) => (
                      <a key={s.id} href={`#${s.id}`} className={s.id === activeId ? "active" : ""}>
                        {s.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
          <div className="docnav-content">
            <h1>{title}</h1>
            {children}
          </div>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
