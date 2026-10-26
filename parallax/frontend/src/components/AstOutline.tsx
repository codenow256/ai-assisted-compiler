// The AST as a structured outline: indentation guides show containment
// (program ⊃ function ⊃ block ⊃ statement ⊃ expression), every row carries the
// node's category and the role it plays in its parent ("the condition",
// "left operand"), and rows can carry structural-diff and search marks.
// Keyboard: ↑/↓ move, → opens, ← closes or goes to the parent, Enter selects.
import { useEffect, useMemo, useRef, useState } from "react";
import { categoryOf, shortLabel } from "../lib/astModel";
import { infoFor, nodeMatches } from "../lib/astInfo";
import type { AstNode } from "../types/api";

const MAX_ROWS = 1500;

export type Mark = "added" | "removed" | "changed";
export const markKey = (kind: string, span: { start: { offset: number }; end: { offset: number } }) => `${kind}@${span.start.offset}-${span.end.offset}`;

interface Props {
  root: AstNode;
  selected?: string | null;
  onSelect?: (path: string) => void;
  /** depth opened by default */
  expandDepth?: number;
  query?: string;
  marks?: Map<string, Mark>;
  /** bump n to open (true) or close (false) every node */
  openAll?: { open: boolean; n: number };
  compact?: boolean;
  label?: string;
}

interface Row { node: AstNode; path: string; depth: number; role: string; open: boolean; hasKids: boolean }

function attrLabel(n: AstNode): string {
  if (n.kind === "Binary" || n.kind === "Unary") return n.op ?? "";
  if (n.kind === "Function") return `${n.type} ${n.name}( )`;
  if (n.kind === "Param") return `${n.type} ${n.name}${n.array ?? ""}`;
  if (n.kind === "DeclStmt") return n.type ?? "";
  if (n.kind === "VarDecl") return `${n.name}${n.array ? `[${n.array}]` : ""}`;
  if (n.kind === "Ident" || n.kind === "Call" || n.kind === "Index" || n.value !== undefined) return shortLabel(n);
  return "";
}

export function AstOutline({ root, selected, onSelect, expandDepth = 6, query = "", marks, openAll, compact, label = "Abstract syntax tree" }: Props) {
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map());
  const [forced, setForced] = useState<boolean | null>(null);
  const lastAll = useRef(0);
  useEffect(() => {
    if (openAll && openAll.n !== lastAll.current) {
      lastAll.current = openAll.n;
      setToggled(new Map());
      setForced(openAll.open);
    }
  }, [openAll]);

  // ancestors of search hits, marked nodes and the selection open automatically
  const { hits, autoOpen } = useMemo(() => {
    const hits = new Set<string>(), autoOpen = new Set<string>();
    const rec = (n: AstNode, path: string, anc: string[]) => {
      const hit = !!query.trim() && nodeMatches(n, query);
      if (hit) hits.add(path);
      if (hit || marks?.has(markKey(n.kind, n.span)) || selected === path) anc.forEach((a) => autoOpen.add(a));
      n.children.forEach((c, i) => rec(c, `${path}/${i}`, [...anc, path]));
    };
    rec(root, "0", []);
    if (selected) selected.split("/").forEach((_, i, a) => i < a.length - 1 && autoOpen.add(a.slice(0, i + 1).join("/")));
    return { hits, autoOpen };
  }, [root, query, marks, selected]);

  // Very large trees (a 64 KB program has ~25,000 nodes) are drawn up to MAX_ROWS rows; the rest
  // stay reachable by collapsing, searching or clicking code, and the hidden count is shown.
  const rows: Row[] = [];
  let hidden = 0;
  const walk = (n: AstNode, path: string, depth: number, parent: AstNode | null, idx: number) => {
    if (rows.length >= MAX_ROWS && path !== selected && !autoOpen.has(path) && !hits.has(path)) { hidden++; return; }
    const hasKids = n.children.length > 0;
    const base = autoOpen.has(path) || (forced ?? depth < expandDepth);
    const open = hasKids && (toggled.has(path) ? toggled.get(path)! : base);
    rows.push({ node: n, path, depth, role: parent ? infoFor(parent).childRole(parent, idx) : "", open, hasKids });
    if (open) n.children.forEach((c, i) => walk(c, `${path}/${i}`, depth + 1, n, i));
  };
  walk(root, "0", 0, null, 0);

  const setOpen = (path: string, v: boolean) => setToggled((s) => new Map(s).set(path, v));
  const focusRow = (path: string) => requestAnimationFrame(() => (document.querySelector(`[data-ast-path="${CSS.escape(path)}"]`) as HTMLElement | null)?.focus());
  const onKey = (e: React.KeyboardEvent, r: Row, i: number) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect?.(r.path); }
    else if (e.key === "ArrowDown" && rows[i + 1]) { e.preventDefault(); focusRow(rows[i + 1].path); onSelect?.(rows[i + 1].path); }
    else if (e.key === "ArrowUp" && rows[i - 1]) { e.preventDefault(); focusRow(rows[i - 1].path); onSelect?.(rows[i - 1].path); }
    else if (e.key === "ArrowRight" && r.hasKids && !r.open) { e.preventDefault(); setOpen(r.path, true); }
    else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (r.open) setOpen(r.path, false);
      else if (r.path.includes("/")) { const up = r.path.slice(0, r.path.lastIndexOf("/")); focusRow(up); onSelect?.(up); }
    }
  };

  return (
    <div className={`outline ${compact ? "compact" : ""}`} role="tree" aria-label={label}>
      {rows.map((r, i) => {
        const mark = marks?.get(markKey(r.node.kind, r.node.span));
        const cat = categoryOf(r.node);
        const a = attrLabel(r.node);
        const span = r.node.span;
        return (
          <div
            key={r.path}
            className={`orow cat-${cat} ${selected === r.path ? "sel" : ""} ${hits.has(r.path) ? "hit" : ""} ${mark ? "mark-" + mark : ""} ${r.node.kind === "Error" ? "err" : ""}`}
            style={{ paddingLeft: 6 + r.depth * 18 }}
          >
            {Array.from({ length: r.depth }, (_, d) => <span key={d} className="guide" style={{ left: 14 + d * 18 }} aria-hidden />)}
            <button className="twisty" tabIndex={-1} aria-hidden onClick={() => r.hasKids && setOpen(r.path, !r.open)}>{r.hasKids ? (r.open ? "▾" : "▸") : ""}</button>
            <span
              role="treeitem"
              aria-selected={selected === r.path}
              aria-expanded={r.hasKids ? r.open : undefined}
              aria-level={r.depth + 1}
              tabIndex={selected === r.path || (!selected && i === 0) ? 0 : -1}
              data-ast-path={r.path}
              className="ocell"
              onClick={() => onSelect?.(r.path)}
              onKeyDown={(e) => onKey(e, r, i)}
              title={`${infoFor(r.node).title} · lines ${span.start.line}–${span.end.line}`}
            >
              {r.role && !compact && <span className="orole">{r.role}</span>}
              <span className="odot" aria-hidden />
              <span className="okind">{r.node.kind}</span>
              {a && <span className="oattr">{a}</span>}
              {!compact && <span className="oline">{span.start.line === span.end.line ? `line ${span.start.line}` : `lines ${span.start.line}–${span.end.line}`}</span>}
              {mark && <span className={`mark-badge ${mark}`}>{mark}</span>}
            </span>
          </div>
        );
      })}
      {hidden > 0 && <div className="tiny muted" style={{ padding: "6px 10px" }} role="note">{hidden.toLocaleString()} more branch(es) are not drawn, to keep the page responsive. Collapse a branch, search, or click the code to reach them.</div>}
    </div>
  );
}
