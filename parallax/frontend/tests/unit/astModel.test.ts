import { describe, expect, it } from "vitest";
import { categoryOf, construction, countNodes, errorReplacements, expressionNotes, expressionRoot, hasErrorNodes, nodeAtOffset, nodeAtPath, nodesOnPath, ownTokens, sourceOf } from "../../src/lib/astModel";
import type { AstNode } from "../../src/types/api";
import cases from "./fixtures/ast_cases.json";

// Real ASTs from parallaxc (gen_ast_fixtures.py).
type Case = { source: string; parse: { ok: boolean; ast: AstNode | null; recovered_ast: AstNode | null }; plans: { summary: string; source: string; ast: AstNode | null }[]; compare_plan0_plan1?: unknown[] };
const C = cases as unknown as Record<string, Case>;
const ast = (k: string) => C[k].parse.ast!;

/** path of the first node (pre-order) matching the predicate */
function find(root: AstNode, pred: (n: AstNode) => boolean, path = "0"): string | null {
  if (pred(root)) return path;
  for (let i = 0; i < root.children.length; i++) {
    const r = find(root.children[i], pred, `${path}/${i}`);
    if (r) return r;
  }
  return null;
}

describe("grammar construction for every real node", () => {
  it("each node kind maps to a production of minic.y", () => {
    const seen = new Set<string>();
    for (const c of Object.values(C)) {
      for (const root of [c.parse.ast, c.parse.recovered_ast, ...c.plans.map((p) => p.ast)]) {
        if (!root) continue;
        const rec = (n: AstNode, parent: AstNode | null, i: number) => {
          const k = construction(n, parent, i);
          expect(k.rule).toMatch(/→/);
          expect(k.why.length).toBeGreaterThan(10);
          seen.add(n.kind);
          n.children.forEach((ch, j) => rec(ch, n, j));
        };
        rec(root, null, 0);
      }
    }
    for (const k of ["Program", "Function", "Param", "Block", "DeclStmt", "VarDecl", "Assign", "If", "For", "Return", "Break", "Binary", "Call", "Ident", "IntLit", "Error"]) expect(seen.has(k)).toBe(true);
  });
  it("operator rules follow the precedence chain", () => {
    const root = ast("precedence");
    const plus = nodeAtPath(root, find(root, (n) => n.op === "+")!)!;
    expect(construction(plus, null).rule).toBe("add_expr → add_expr '+' mul_expr");
    const times = nodeAtPath(root, find(root, (n) => n.op === "*")!)!;
    expect(construction(times, null).rule).toBe("mul_expr → mul_expr '*' unary");
  });
  it("an assignment target is an lvalue, a use is a primary", () => {
    const root = ast("control");
    const assign = find(root, (n) => n.kind === "Assign")!;
    const a = nodeAtPath(root, assign)!;
    expect(construction(a.children[0], a, 0).rule).toBe("lvalue → IDENT");
    expect(construction(a.children[1].children[0] ?? a.children[1], a, 1).rule).toMatch(/primary|expr/);
  });
});

describe("expression structure is explained from the real tree shape", () => {
  it("a + b * c: the multiplication is grouped first by precedence", () => {
    const root = ast("precedence");
    const plus = nodeAtPath(root, find(root, (n) => n.op === "+")!)!;
    const notes = expressionNotes(plus, C.precedence.source);
    expect(notes[0]).toBe("`+` combines `a` (left) and `b * c` (right).");
    expect(notes[1]).toMatch(/`b \* c` is grouped first: `\*` binds tighter than `\+`/);
  });
  it("(a + b) * c: parentheses force the grouping and leave no node", () => {
    const root = ast("parens");
    const times = nodeAtPath(root, find(root, (n) => n.op === "*")!)!;
    expect(expressionNotes(times, C.parens.source).join(" ")).toMatch(/grouped first only because of parentheses/);
    const own = ownTokens(times, C.parens.source).map((t) => t.text);
    expect(own).toEqual(["(", ")", "*"]); // the parentheses are absorbed by the * node
    expect(find(root, (n) => n.kind === "Paren")).toBeNull();
  });
  it("a - b - c groups left to right", () => {
    const root = ast("left_assoc");
    const outer = nodeAtPath(root, find(root, (n) => n.op === "-")!)!;
    expect(sourceOf(C.left_assoc.source, outer.children[0]).trim()).toBe("a - b");
    expect(expressionNotes(outer, C.left_assoc.source).join(" ")).toMatch(/left-associative/);
  });
  it("selecting an operand shows the whole expression it belongs to", () => {
    const root = ast("precedence");
    const c = find(root, (n) => n.kind === "Ident" && n.name === "c")!;
    const top = expressionRoot(root, c)!;
    expect(top.node.op).toBe("+");
    const ret = find(root, (n) => n.kind === "Return")!;
    expect(expressionRoot(root, ret)!.node.op).toBe("+");
  });
});

describe("tokens absorbed by a node", () => {
  it("return statement: the keyword and the semicolon", () => {
    const root = ast("precedence");
    const ret = nodeAtPath(root, find(root, (n) => n.kind === "Return")!)!;
    const own = ownTokens(ret, C.precedence.source);
    expect(own.map((t) => t.text)).toEqual(["return", ";"]);
    expect(own[0].meaning).toMatch(/selects the grammar rule/);
    expect(own[1].meaning).toMatch(/punctuation/);
  });
  it("binary operator is stored as an attribute; names are stored too", () => {
    const root = ast("precedence");
    const plus = nodeAtPath(root, find(root, (n) => n.op === "+")!)!;
    expect(ownTokens(plus, C.precedence.source)).toEqual([{ text: "+", meaning: "stored as the operator (op)" }]);
    const fn = nodeAtPath(root, find(root, (n) => n.kind === "Function")!)!;
    const own = ownTokens(fn, C.precedence.source);
    expect(own.find((t) => t.text === "f")?.meaning).toBe("stored as the name");
    expect(own.find((t) => t.text === "int")?.meaning).toBe("stored as the type");
  });
});

describe("source ↔ tree navigation", () => {
  it("a source offset selects the deepest node containing it", () => {
    const src = C.precedence.source;
    const root = ast("precedence");
    const off = new TextEncoder().encode(src.slice(0, src.indexOf("c;"))).length;
    const path = nodeAtOffset(root, off)!;
    expect(nodeAtPath(root, path)).toMatchObject({ kind: "Ident", name: "c" });
    expect(nodesOnPath(root, path).map((x) => x.node.kind)).toEqual(["Program", "Function", "Block", "Return", "Binary", "Binary", "Ident"]);
  });
  it("an offset on punctuation selects the node that absorbed it", () => {
    const src = C.precedence.source;
    const root = ast("precedence");
    const off = new TextEncoder().encode(src.slice(0, src.indexOf(";"))).length;
    expect(nodeAtPath(root, nodeAtOffset(root, off)!)!.kind).toBe("Return");
  });
  it("categories group the hierarchy", () => {
    const root = ast("control");
    expect(categoryOf(root)).toBe("structure");
    expect(categoryOf(nodeAtPath(root, find(root, (n) => n.kind === "Block")!)!)).toBe("scope");
    expect(categoryOf(nodeAtPath(root, find(root, (n) => n.kind === "For")!)!)).toBe("statement");
    expect(categoryOf(nodeAtPath(root, find(root, (n) => n.kind === "Call")!)!)).toBe("expression");
  });
});

describe("partial trees and before/after", () => {
  it("invalid code has no AST; the recovered tree is partial and contains an Error node", () => {
    const c = C.partial;
    expect(c.parse.ok).toBe(false);
    expect(c.parse.ast).toBeNull();
    expect(hasErrorNodes(c.parse.recovered_ast!)).toBe(true);
    expect(countNodes(c.parse.recovered_ast!)).toBeLessThan(countNodes(c.plans[0].ast!));
  });
  it("the Error node is matched to the real statement of the repaired program on the same line", () => {
    const c = C.partial;
    const r = errorReplacements(c.parse.recovered_ast!, c.plans[0].ast!);
    expect(r).toHaveLength(1);
    expect(r[0].error.span.start.line).toBe(3);
    expect(r[0].replacedBy.map((x) => x.node.kind)).toEqual(["DeclStmt"]);
  });
  it("two repairs differ in exactly one real node (backend astdiff)", () => {
    const ch = C.ambiguous.compare_plan0_plan1 as { change: string; before: string; after: string }[];
    expect(ch).toEqual([expect.objectContaining({ change: "changed", before: "Binary op=+", after: "Binary op=-" })]);
  });
});
