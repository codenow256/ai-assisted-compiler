import { ArrowLeft, FlaskConical, ListTree, Menu, Moon, PencilRuler, Sun, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Badge, StatusBadge } from "../components/ui";
import { useProject } from "./ProjectContext";
import { applyTheme, initialTheme, type Theme } from "./theme";

const NAV: { to: string; label: string; icon: LucideIcon; hint: string }[] = [
  { to: "/", label: "Workspace", icon: PencilRuler, hint: "write, analyze, repair" },
  { to: "/ast", label: "AST Explorer", icon: ListTree, hint: "the tree the parser builds" },
  { to: "/research", label: "Research & Method", icon: FlaskConical, hint: "how it works, what was measured" },
];

/** Specialist pages: where they belong and what they are. */
const SPECIALIST: Record<string, { back: string; backLabel: string; what: string }> = {
  "/lexer": { back: "/", backLabel: "Workspace", what: "Compiler internals · token table" },
  "/parser": { back: "/", backLabel: "Workspace", what: "Compiler internals · grammar and parser state" },
  "/repair": { back: "/", backLabel: "Workspace", what: "Compiler internals · every repair candidate and its evidence" },
  "/hypotheses": { back: "/", backLabel: "Workspace", what: "Compiler internals · hypothesis lanes for several errors" },
  "/evaluation": { back: "/research", backLabel: "Research & Method", what: "Full evaluation data" },
  "/learn": { back: "/research", backLabel: "Research & Method", what: "Learning center" },
  "/docs": { back: "/research", backLabel: "Research & Method", what: "Documentation" },
};

export function AppShell({ children }: { children: ReactNode }) {
  const p = useProject();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [menuOpen, setMenuOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => setMenuOpen(false), [loc.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        p.runAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p]);

  const status = p.repair && !p.isStale(p.repair) ? p.repair.envelope.data.repair.decision.status : null;
  const modified = p.source !== p.baseline;
  const special = SPECIALIST["/" + loc.pathname.split("/")[1]];

  return (
    <div className="app">
      <a href="#main" className="sr-only">Skip to content</a>
      {menuOpen && <div className="overlay" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? "open" : ""}`} aria-label="Primary">
        <div className="brand">
          <img className="brand-mark" src="/favicon.svg" alt="" />
          <div>
            <div className="brand-name">IntelliFix</div>
            <div className="brand-sub">An Intelligent Compiler for Syntax Error Analysis, Detection, and Correction</div>
          </div>
        </div>
        <nav className="primary-nav">
          {NAV.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.to === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <it.icon size={17} aria-hidden />
              <span>{it.label}<span className="nav-hint">{it.hint}</span></span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="row small">
            {p.health?.compiler.available ? (
              <Badge tone="success">Compiler {p.health.compiler.version}</Badge>
            ) : p.healthError ? (
              <Badge tone="danger">Backend offline</Badge>
            ) : p.health ? (
              <Badge tone="danger">Compiler missing</Badge>
            ) : (
              <Badge tone="neutral">Checking…</Badge>
            )}
            <span className="spacer" />
            <button className="btn sm icon ghost" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </div>
          {p.healthError && <p className="tiny muted">Start the backend, then reload. Your code is kept in this browser.</p>}
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn icon ghost menu-btn" aria-label="Open navigation" onClick={() => setMenuOpen(true)}>
            <Menu size={18} />
          </button>
          {special ? (
            <Link className="btn sm ghost" to={special.back}><ArrowLeft size={14} aria-hidden /> {special.backLabel}</Link>
          ) : null}
          <div className="file-chip" title="Current program">
            <span>{p.origin.label}</span>
            {modified && <Badge tone="neutral" icon={false}>edited</Badge>}
            {p.history.length > 0 && <Badge tone="teal" icon={false}>{p.history.length} repair{p.history.length > 1 ? "s" : ""} applied</Badge>}
          </div>
          {status && <StatusBadge status={status} />}
          {special && <span className="tiny muted special-what">{special.what}</span>}
        </header>
        <main id="main" className="page fade-in" key={loc.pathname}>
          {children}
        </main>
      </div>
    </div>
  );
}
