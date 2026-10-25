// Top-down drawing of one expression subtree of the real AST, the way a
// textbook draws it: operators above their operands, edges labelled with the
// operand's role. Clicking a node selects it in the explorer.
import { categoryOf, countNodes, shortLabel } from "../lib/astModel";
import type { AstNode } from "../types/api";

const MAX_NODES = 31;

interface Placed { node: AstNode; path: string; x: number; y: number; parent?: Placed; role: string }

function layout(root: AstNode, rootPath: string): { nodes: Placed[]; width: number; height: number } {
  const nodes: Placed[] = [];
  let leaf = 0;
  let maxDepth = 0;
  const place = (n: AstNode, path: string, depth: number, parent: Placed | undefined, role: string): Placed => {
    maxDepth = Math.max(maxDepth, depth);
    const me: Placed = { node: n, path, x: 0, y: depth, parent, role };
    nodes.push(me);
    if (!n.children.length) me.x = leaf++;
    else {
      const kids = n.children.map((c, i) => place(c, `${path}/${i}`, depth + 1, me, n.kind === "Binary" ? (i === 0 ? "left" : "right") : n.kind === "Call" ? `arg ${i + 1}` : n.kind === "Index" ? "index" : "operand"));
      me.x = (kids[0].x + kids[kids.length - 1].x) / 2;
    }
    return me;
  };
  place(root, rootPath, 0, undefined, "");
  return { nodes, width: Math.max(1, leaf), height: maxDepth + 1 };
}

export function ExprDiagram({ root, rootPath, selected, onSelect }: { root: AstNode; rootPath: string; selected?: string | null; onSelect?: (path: string) => void }) {
  if (countNodes(root) > MAX_NODES) return <p className="tiny muted">This expression has {countNodes(root)} nodes, too many to draw clearly; use the tree.</p>;
  const { nodes, width, height } = layout(root, rootPath);
  const dx = 74, dy = 64, pad = 34;
  const W = Math.max(160, (width - 1) * dx + pad * 2), H = (height - 1) * dy + pad * 2;
  const X = (p: Placed) => pad + p.x * dx + (width === 1 ? W / 2 - pad : 0);
  const Y = (p: Placed) => pad + p.y * dy;
  return (
    <svg className="expr-diagram" viewBox={`0 0 ${W} ${H}`} width={Math.min(W, 560)} role="img" aria-label={`Expression tree with ${nodes.length} nodes`}>
      {nodes.filter((p) => p.parent).map((p) => {
        const a = p.parent!;
        const mx = (X(a) + X(p)) / 2, my = (Y(a) + Y(p)) / 2;
        return (
          <g key={"e" + p.path}>
            <line x1={X(a)} y1={Y(a) + 14} x2={X(p)} y2={Y(p) - 14} className="edge" />
            <text x={mx + (X(p) < X(a) ? -6 : X(p) > X(a) ? 6 : 8)} y={my} textAnchor={X(p) < X(a) ? "end" : "start"} className="edge-label">{p.role}</text>
          </g>
        );
      })}
      {nodes.map((p) => {
        const cat = categoryOf(p.node);
        const label = shortLabel(p.node);
        const w = Math.max(30, label.length * 8 + 16);
        return (
          <g key={p.path} className={`dnode cat-${cat} ${selected === p.path ? "sel" : ""}`} onClick={() => onSelect?.(p.path)} role="button" tabIndex={0} aria-label={`${p.node.kind} ${label}`} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect?.(p.path)}>
            {cat === "expression" && p.node.kind !== "Call" && p.node.kind !== "Index" ? <circle cx={X(p)} cy={Y(p)} r={15} /> : <rect x={X(p) - w / 2} y={Y(p) - 13} width={w} height={26} rx={7} />}
            <text x={X(p)} y={Y(p) + 4} textAnchor="middle">{label}</text>
          </g>
        );
      })}
    </svg>
  );
}
