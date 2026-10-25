import { useMemo, useState } from "react";
import { infoFor, nodeMatches } from "../lib/astInfo";
import type { AstNode } from "../types/api";

export function nodeLabelAttrs(n: AstNode): string {
  const parts: string[] = [];
  if (n.type) parts.push(`type=${n.type}`);
  if (n.name) parts.push(`name=${n.name}`);
  if (n.op) parts.push(`op=${n.op}`);
  if (n.value) parts.push(`value=${n.value}`);
  if (n.array) parts.push(`array=${n.array}`);
  return parts.join(" ");
}

export type Mark = "added" | "removed" | "changed";

interface Props {
  root: AstNode;
  selected?: string | null;
  onSelect?: (node: AstNode, path: string) => void;
  expandDepth?: number;
  /** highlight nodes matching this text (kind, name, operator, value) and open their ancestors */
  query?: string;
  /** structural-diff marks, keyed by `${kind}@${start}-${end}` (real spans from the comparison) */
  marks?: Map<string, Mark>;
  /** bump to force every node open (true) or closed (false) */
  openAll?: { open: boolean; n: number };
  plainTitles?: boolean;
}

export const markKey = (kind: string, span: { start: { offset: number }; end: { offset: number } }) => `${kind}@${span.start.offset}-${span.end.offset}`;

/** Expandable AST view. Paths are "0/2/1" child-index strings. */
export function AstTree({ root, selected, onSelect, expandDepth = 4, query = "", marks, openAll, plainTitles = true }: Props) {
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map());
  const [lastAll, setLastAll] = useState(0);
  if (openAll && openAll.n !== lastAll) {
    setLastAll(openAll.n);
    setToggled(new Map());
  }
  const forced = openAll && openAll.n > 0 ? openAll.open : null;

  // paths of matches and of their ancestors (opened automatically)
  const { hits, open: autoOpen } = useMemo(() => {
    const hits = new Set<string>(), open = new Set<string>();
    if (!query.trim()) return { hits, open };
    const rec = (n: AstNode, path: string, anc: string[]) => {
      if (nodeMatches(n, query)) { hits.add(path); anc.forEach((a) => open.add(a)); }
      n.children.forEach((c, i) => rec(c, `${path}/${i}`, [...anc, path]));
    };
    rec(root, "0", []);
    return { hits, open };
  }, [root, query]);
  // ancestors of marked nodes open by default too
  const markOpen = useMemo(() => {
    const open = new Set<string>();
    if (!marks?.size) return open;
    const rec = (n: AstNode, path: string, anc: string[]) => {
      if (marks.has(markKey(n.kind, n.span))) anc.forEach((a) => open.add(a));
      n.children.forEach((c, i) => rec(c, `${path}/${i}`, [...anc, path]));
    };
    rec(root, "0", []);
    return open;
  }, [root, marks]);

  const render = (n: AstNode, path: string, depth: number) => {
    const hasKids = n.children.length > 0;
    const base = forced ?? (depth < expandDepth || autoOpen.has(path) || markOpen.has(path));
    const open = toggled.has(path) ? toggled.get(path)! : base;
    const mark = marks?.get(markKey(n.kind, n.span));
    return (
      <li key={path}>
        <button
          className="twisty"
          aria-label={open ? "Collapse" : "Expand"}
          onClick={() => hasKids && setToggled((s) => new Map(s).set(path, !open))}
          tabIndex={hasKids ? 0 : -1}
          aria-expanded={hasKids ? open : undefined}
        >
          {hasKids ? (open ? "▾" : "▸") : "·"}
        </button>
        <span
          role="treeitem"
          aria-selected={selected === path}
          tabIndex={0}
          data-path={path}
          className={`node ${selected === path ? "sel" : ""} ${hits.has(path) ? "hit" : ""} ${mark ? "mark-" + mark : ""}`}
          onClick={() => onSelect?.(n, path)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect?.(n, path);
            }
          }}
          title={`${infoFor(n).title} · ${n.span.start.line}:${n.span.start.column} – ${n.span.end.line}:${n.span.end.column}`}
        >
          <span className="kind">{n.kind}</span>
          <span className="attr">{nodeLabelAttrs(n)}</span>
          {plainTitles && <span className="faint tiny plain-title">{infoFor(n).title}</span>}
          <span className="faint tiny">
            {n.span.start.line}:{n.span.start.column}
          </span>
          {mark && <span className={`mark-badge ${mark}`}>{mark}</span>}
        </span>
        {hasKids && open && <ul role="group">{n.children.map((c, i) => render(c, `${path}/${i}`, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="tree" role="tree" aria-label="Abstract syntax tree">
      <ul>{render(root, "0", 0)}</ul>
    </div>
  );
}

export function findByPath(root: AstNode, path: string): AstNode | null {
  const parts = path.split("/").slice(1).map(Number);
  let n: AstNode | undefined = root;
  for (const i of parts) {
    n = n?.children[i];
    if (!n) return null;
  }
  return n ?? null;
}

export function parentOf(root: AstNode, path: string): AstNode | null {
  const parts = path.split("/");
  return parts.length > 1 ? findByPath(root, parts.slice(0, -1).join("/")) : null;
}

export function countNodes(n: AstNode): number {
  return 1 + n.children.reduce((a, c) => a + countNodes(c), 0);
}
