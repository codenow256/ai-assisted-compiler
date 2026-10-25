import {
  BookOpen,
  Boxes,
  ChartColumnBig,
  FileCode2,
  FlaskConical,
  GitBranch,
  GraduationCap,
  LayoutDashboard,
  ListTree,
  Menu,
  Moon,
  Play,
  ScanText,
  Sun,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Badge, StatusBadge } from "../components/ui";
import { useDemo } from "../features/demo/DemoContext";
import { GuidedDemo } from "../features/demo/GuidedDemo";
import { useProject } from "./ProjectContext";
import { applyTheme, initialTheme, type Theme } from "./theme";

const NAV: { group: string; items: { to: string; label: string; icon: LucideIcon }[] }[] = [
  { group: "Explore", items: [
    { to: "/", label: "Overview", icon: LayoutDashboard },
    { to: "/workbench", label: "Code workbench", icon: FileCode2 },
  ] },
  { group: "Compiler stages", items: [
    { to: "/lexer", label: "Lexical analysis", icon: ScanText },
    { to: "/parser", label: "Grammar & parsing", icon: Boxes },
    { to: "/ast", label: "AST explorer", icon: ListTree },
  ] },
  { group: "Repair research", items: [
    { to: "/repair", label: "Repair laboratory", icon: Wand2 },
    { to: "/hypotheses", label: "Hypothesis explorer", icon: GitBranch },
    { to: "/evaluation", label: "Evaluation & impact", icon: ChartColumnBig },
  ] },
  { group: "Learn", items: [
    { to: "/learn", label: "Learning center", icon: GraduationCap },
    { to: "/docs", label: "Documentation & about", icon: BookOpen },
  ] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const p = useProject();
  const demo = useDemo();
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

  const anyRunning = p.running.lex || p.running.parse || p.running.repair;
  const status = p.repair && !p.isStale(p.repair) ? p.repair.envelope.data.repair.decision.status : null;
  const modified = p.source !== p.baseline;

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
        <nav>
          {NAV.map((g) => (
            <div className="nav-group" key={g.group}>
              <h4>{g.group}</h4>
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.to === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <it.icon size={16} aria-hidden />
                  {it.label}
                </NavLink>
              ))}
            </div>
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
          </div>
          <div className="row">
            <button className="btn sm" onClick={demo.start}>
              <FlaskConical size={13} aria-hidden /> Guided demo
            </button>
            <button className="btn sm icon" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn icon ghost menu-btn" aria-label="Open navigation" onClick={() => setMenuOpen(true)}>
            <Menu size={18} />
          </button>
          <div className="file-chip" title="Current program">
            <FileCode2 size={14} aria-hidden className="muted" />
            <span>{p.origin.label}</span>
            {modified && <Badge tone="neutral" icon={false}>edited</Badge>}
            {p.history.length > 0 && <Badge tone="teal" icon={false}>{p.history.length} repair{p.history.length > 1 ? "s" : ""} applied</Badge>}
          </div>
          {status && <StatusBadge status={status} />}
          <div className="spacer" />
          <span className="muted tiny nowrap kbd-hint" aria-hidden>
            <span className="kbd">Ctrl</span> + <span className="kbd">Enter</span> runs everything
          </span>
          <button className="btn primary" onClick={() => p.runAll()} disabled={anyRunning}>
            <Play size={14} aria-hidden /> {anyRunning ? "Running…" : "Analyze"}
          </button>
        </header>
        <main id="main" className="page fade-in" key={loc.pathname}>
          {children}
        </main>
      </div>
      {demo.open && <GuidedDemo />}
    </div>
  );
}
