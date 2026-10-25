// Teaching model of the real AST: which grammar rule builds each node (taken
// from compiler/grammar/minic.y), which tokens a node absorbs without becoming
// separate nodes, how operators group their operands, and how source positions
// map to nodes. Everything is computed from the compiler's AST and spans.
import type { AstNode } from "../types/api";

export type Category = "structure" | "scope" | "statement" | "expression" | "leaf" | "special";

const CAT: Record<string, Category> = {
  Program: "structure", Function: "structure", Param: "structure",
  Block: "scope",
  DeclStmt: "statement", VarDecl: "statement", Assign: "statement", If: "statement", While: "statement", For: "statement",
  Return: "statement", Break: "statement", Continue: "statement", ExprStmt: "statement", EmptyStmt: "statement",
  Binary: "expression", Unary: "expression", Call: "expression", Index: "expression",
  Ident: "leaf", IntLit: "leaf", FloatLit: "leaf", CharLit: "leaf", BoolLit: "leaf",
  Empty: "special", Error: "special",
};
export const CATEGORY_LABEL: Record<Category, string> = {
  structure: "program structure", scope: "block / scope", statement: "statement", expression: "expression", leaf: "name or value", special: "placeholder",
};
export const categoryOf = (n: AstNode): Category => CAT[n.kind] ?? "special";

// ------------------------------------------------------------------ operators
/** Precedence level in the grammar (higher binds tighter), from the expr → … → unary rule chain. */
export const OP_LEVEL: Record<string, { level: number; rule: string; nonterminal: string }> = {
  "||": { level: 1, rule: "or_expr → or_expr '||' and_expr", nonterminal: "or_expr" },
  "&&": { level: 2, rule: "and_expr → and_expr '&&' eq_expr", nonterminal: "and_expr" },
  "==": { level: 3, rule: "eq_expr → eq_expr '==' rel_expr", nonterminal: "eq_expr" },
  "!=": { level: 3, rule: "eq_expr → eq_expr '!=' rel_expr", nonterminal: "eq_expr" },
  "<": { level: 4, rule: "rel_expr → rel_expr '<' add_expr", nonterminal: "rel_expr" },
  "<=": { level: 4, rule: "rel_expr → rel_expr '<=' add_expr", nonterminal: "rel_expr" },
  ">": { level: 4, rule: "rel_expr → rel_expr '>' add_expr", nonterminal: "rel_expr" },
  ">=": { level: 4, rule: "rel_expr → rel_expr '>=' add_expr", nonterminal: "rel_expr" },
  "+": { level: 5, rule: "add_expr → add_expr '+' mul_expr", nonterminal: "add_expr" },
  "-": { level: 5, rule: "add_expr → add_expr '-' mul_expr", nonterminal: "add_expr" },
  "*": { level: 6, rule: "mul_expr → mul_expr '*' unary", nonterminal: "mul_expr" },
  "/": { level: 6, rule: "mul_expr → mul_expr '/' unary", nonterminal: "mul_expr" },
  "%": { level: 6, rule: "mul_expr → mul_expr '%' unary", nonterminal: "mul_expr" },
};

// ------------------------------------------------------------------ grammar rules
export interface Construction {
  rule: string; // the production in minic.y that creates this node
  why: string; // why the parser builds the node here (one or two sentences)
}

/** The real production that builds `n` (minic.y), chosen from the node's own shape. */
export function construction(n: AstNode, parent: AstNode | null, indexInParent = 0): Construction {
  const k = n.children.length;
  switch (n.kind) {
    case "Program": return { rule: "program → ext_list ;  ext_list → ext_list ext_decl | ε", why: "The start symbol. Each function or global declaration the parser finishes is appended as one more child." };
    case "Function": return { rule: n.type === "void" ? "function → 'void' IDENT '(' param_opt ')' block" : "function → var_type IDENT '(' param_opt ')' block", why: "Reduced when the closing `}` of the body is read: the type, name, parameters and body are all known then." };
    case "Param": return { rule: n.array ? "param → var_type IDENT '[' ']'" : "param → var_type IDENT", why: "One entry of the parameter list between the function's parentheses." };
    case "DeclStmt": return { rule: "decl_stmt → decl_core ';'  ;  decl_core → var_type declarator_list", why: "A type keyword at the start of a statement selects the declaration rule; each name after it becomes one VarDecl child." };
    case "VarDecl": return k ? { rule: "declarator → IDENT '=' expr", why: "A name followed by `=`: the expression after it becomes the only child (the initial value)." } : n.array ? { rule: "declarator → IDENT '[' INT_LIT ']'", why: "A name with a size in brackets declares an array; the size is stored as an attribute, not a child." } : { rule: "declarator → IDENT", why: "A name without an initial value." };
    case "Block": return { rule: "block → '{' stmt_list '}'  ;  stmt_list → stmt_list stmt | ε", why: "Each statement between the braces is appended as a child, in source order." };
    case "Assign": return { rule: "stmt → assignment ';'  ;  assignment → lvalue '=' expr", why: "In MiniC assignment is a statement: target on the left of `=`, value on the right." };
    case "If": return { rule: k > 2 ? "if_stmt → 'if' '(' expr ')' stmt 'else' stmt" : "if_stmt → 'if' '(' expr ')' stmt", why: k > 2 ? "The `else` part attaches to the nearest `if` (the grammar resolves the dangling else by precedence)." : "No `else` follows, so the if has two children: condition and then-part." };
    case "While": return { rule: "while_stmt → 'while' '(' expr ')' stmt", why: "The condition and the body are the two children." };
    case "For": return { rule: "for_stmt → 'for' '(' for_init ';' for_cond ';' for_update ')' stmt", why: "Always four children; an omitted clause is kept as an Empty node so positions stay fixed." };
    case "Return": return { rule: k ? "return_stmt → 'return' expr ';'" : "return_stmt → 'return' ';'", why: k ? "The returned expression is the only child." : "No value: a return without children." };
    case "Break": return { rule: "stmt → 'break' ';'", why: "A leaf statement." };
    case "Continue": return { rule: "stmt → 'continue' ';'", why: "A leaf statement." };
    case "ExprStmt": return { rule: "stmt → expr ';'", why: "An expression (usually a call) used as a statement." };
    case "EmptyStmt": return { rule: "stmt → ';'", why: "A lone `;` is a statement of its own, so it appears in the tree." };
    case "Ident": return parent?.kind === "Assign" && indexInParent === 0 ? { rule: "lvalue → IDENT", why: "The target of an assignment." } : { rule: "primary → IDENT", why: "A name used as a value; the parser reduces it immediately to a leaf." };
    case "IntLit": return { rule: "primary → INT_LIT", why: "A literal token becomes a leaf; its spelling is stored as the value." };
    case "FloatLit": return { rule: "primary → FLOAT_LIT", why: "A literal token becomes a leaf; its spelling is stored as the value." };
    case "CharLit": return { rule: "primary → CHAR_LIT", why: "A literal token becomes a leaf; its spelling is stored as the value." };
    case "BoolLit": return { rule: n.value === "false" ? "primary → 'false'" : "primary → 'true'", why: "A literal keyword becomes a leaf." };
    case "Unary": return { rule: n.op === "!" ? "unary → '!' unary" : "unary → '-' unary", why: "A prefix operator applies to the single operand after it; the operator is stored as an attribute." };
    case "Binary": {
      const o = OP_LEVEL[n.op ?? ""];
      return { rule: o?.rule ?? "binary expression", why: "Built when the parser reduces the operator rule: the two operand subtrees it has already built become the children, and the operator token becomes the `op` attribute." };
    }
    case "Call": return { rule: "postfix → IDENT '(' args_opt ')'", why: "A name directly followed by `(`. Each argument expression becomes a child; the commas leave no node." };
    case "Index": return parent?.kind === "Assign" && indexInParent === 0 ? { rule: "lvalue → IDENT '[' expr ']'", why: "An array element as an assignment target; the index expression is the child." } : { rule: "postfix → IDENT '[' expr ']'", why: "An array element read; the index expression is the child." };
    case "Empty": return { rule: "for_init | for_cond | for_update → ε", why: "An optional clause that was left out. Keeping a node keeps the For's four positions fixed." };
    case "Error": return { rule: "stmt → error ';'  |  ext_decl → error ';' | error '}'", why: "Panic-mode recovery: the parser skipped tokens up to the next `;` or `}` and left this placeholder. It is not part of any valid program." };
  }
  return { rule: n.kind, why: "" };
}

// ------------------------------------------------------------------ tokens absorbed by a node
export interface OwnToken {
  text: string;
  meaning: string;
}

const TOKEN_RE = /[A-Za-z_]\w*|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|'(?:\\.|[^'\\])*'|==|!=|<=|>=|&&|\|\||\S/g;
const KEYWORDS = new Set(["if", "else", "while", "for", "return", "break", "continue", "int", "float", "char", "bool", "void", "true", "false"]);

function slice(bytes: Uint8Array, a: number, b: number) {
  return new TextDecoder().decode(bytes.slice(a, b));
}

/**
 * Tokens inside the node's span that are not inside any child's span: what the
 * node itself "consumed". Each is classified by what happened to it (stored as
 * an attribute, decided the node kind, or only shaped the parse).
 */
export function ownTokens(n: AstNode, source: string): OwnToken[] {
  const bytes = new TextEncoder().encode(source);
  const kids = [...n.children].sort((a, b) => a.span.start.offset - b.span.start.offset);
  let pos = n.span.start.offset;
  let text = "";
  for (const c of kids) {
    if (c.span.start.offset > pos) text += slice(bytes, pos, c.span.start.offset) + " ";
    pos = Math.max(pos, c.span.end.offset);
  }
  if (n.span.end.offset > pos) text += slice(bytes, pos, n.span.end.offset);
  text = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, " ");
  const out: OwnToken[] = [];
  for (const t of text.match(TOKEN_RE) ?? []) {
    let meaning: string;
    if (n.kind === "Error") meaning = "skipped by error recovery";
    else if (t === n.op) meaning = "stored as the operator (op)";
    else if (t === n.name) meaning = "stored as the name";
    else if (t === n.type) meaning = "stored as the type";
    else if (t === n.value) meaning = "stored as the value";
    else if (n.array && n.array === t) meaning = "stored as the array size";
    else if (KEYWORDS.has(t)) meaning = "selects the grammar rule (it becomes the node kind)";
    else meaning = "punctuation: shapes the parse, leaves no node";
    out.push({ text: t, meaning });
  }
  return out;
}

// ------------------------------------------------------------------ expression structure
/** Short label of a node as drawn in diagrams. */
export function shortLabel(n: AstNode): string {
  if (n.kind === "Binary" || n.kind === "Unary") return n.op ?? n.kind;
  if (n.kind === "Ident") return n.name ?? "?";
  if (n.kind === "Call") return `${n.name}( )`;
  if (n.kind === "Index") return `${n.name}[ ]`;
  if (n.value !== undefined) return n.value;
  return n.kind;
}

const isExpr = (n: AstNode) => n.kind === "Binary" || n.kind === "Unary" || n.kind === "Call" || n.kind === "Index";

/** Notes on why operands are grouped as they are, from the real tree shape. */
export function expressionNotes(n: AstNode, source: string): string[] {
  const out: string[] = [];
  const txt = (x: AstNode) => sourceOf(source, x).replace(/\s+/g, " ").trim();
  if (n.kind === "Binary" && n.children.length === 2) {
    const [l, r] = n.children;
    const me = OP_LEVEL[n.op ?? ""]?.level ?? 0;
    out.push(`\`${n.op}\` combines \`${txt(l)}\` (left) and \`${txt(r)}\` (right).`);
    [l, r].forEach((c, side) => {
      if (c.kind !== "Binary") return;
      const lv = OP_LEVEL[c.op ?? ""]?.level ?? 0;
      const sideW = side === 0 ? "left" : "right";
      if (lv > me) out.push(`\`${txt(c)}\` is grouped first: \`${c.op}\` binds tighter than \`${n.op}\` (it sits lower in the grammar), so it becomes the ${sideW} child.`);
      else if (lv < me || (lv === me && side === 1)) out.push(`\`${txt(c)}\` is grouped first only because of parentheses; the parentheses themselves leave no node.`);
      else if (lv === me && side === 0) out.push(`Same precedence on the left: \`${c.op}\` and \`${n.op}\` group left to right (left-associative), so \`${txt(c)}\` is computed first.`);
    });
  } else if (n.kind === "Unary" && n.children[0]) {
    out.push(`\`${n.op}\` applies only to \`${txt(n.children[0])}\`, its single operand.`);
  } else if (n.kind === "Call") {
    out.push(n.children.length ? `${n.children.length} argument expression(s), evaluated and passed to \`${n.name}\`.` : `\`${n.name}\` is called with no arguments.`);
  }
  return out;
}

/** The expression subtree to draw for a selected node: the outermost expression containing it, if any. */
export function expressionRoot(root: AstNode, path: string): { node: AstNode; path: string } | null {
  const chain = nodesOnPath(root, path);
  const leaf = (n: AstNode) => categoryOf(n) === "leaf";
  let top = -1;
  for (let i = chain.length - 1; i >= 0; i--) {
    const n = chain[i].node;
    if (isExpr(n)) top = i;
    else if (!leaf(n)) break;
  }
  if (top >= 0) return chain[top];
  const self = chain[chain.length - 1];
  const i = self ? self.node.children.findIndex(isExpr) : -1;
  return i >= 0 ? { node: self.node.children[i], path: `${self.path}/${i}` } : null;
}

// ------------------------------------------------------------------ navigation
export function sourceOf(source: string, n: AstNode): string {
  return slice(new TextEncoder().encode(source), n.span.start.offset, n.span.end.offset);
}

export function nodeAtPath(root: AstNode, path: string): AstNode | null {
  let n: AstNode | undefined = root;
  for (const i of path.split("/").slice(1).map(Number)) {
    n = n?.children[i];
    if (!n) return null;
  }
  return n ?? null;
}

export function nodesOnPath(root: AstNode, path: string): { node: AstNode; path: string }[] {
  const parts = path.split("/");
  const out: { node: AstNode; path: string }[] = [];
  for (let i = 1; i <= parts.length; i++) {
    const p = parts.slice(0, i).join("/");
    const n = nodeAtPath(root, p);
    if (!n) break;
    out.push({ node: n, path: p });
  }
  return out;
}

/** Deepest node whose span contains the byte offset (source → tree). */
export function nodeAtOffset(root: AstNode, offset: number): string | null {
  const inside = (n: AstNode) => n.span.start.offset <= offset && offset < Math.max(n.span.end.offset, n.span.start.offset + 1);
  if (!inside(root)) return null;
  let path = "0";
  let n = root;
  for (;;) {
    const i = n.children.findIndex(inside);
    if (i < 0) return path;
    n = n.children[i];
    path = `${path}/${i}`;
  }
}

export function countNodes(n: AstNode): number {
  return 1 + n.children.reduce((a, c) => a + countNodes(c), 0);
}

export function depthOf(n: AstNode): number {
  return 1 + Math.max(0, ...n.children.map(depthOf));
}

export function hasErrorNodes(n: AstNode): boolean {
  return n.kind === "Error" || n.children.some(hasErrorNodes);
}

// ------------------------------------------------------------------ partial vs complete
export interface Replacement {
  error: AstNode; // Error node of the partial tree
  errorPath: string;
  replacedBy: { node: AstNode; path: string }[]; // statements of the repaired tree on the same lines
}

/**
 * For a partial (recovered) tree and the complete tree of a repaired program:
 * which real statements of the repaired tree occupy the lines that an Error
 * node skipped. Single-token repairs do not add lines, so lines are comparable;
 * the UI labels this as a line-based match.
 */
export function errorReplacements(partial: AstNode, repaired: AstNode): Replacement[] {
  const errs: { node: AstNode; path: string }[] = [];
  const stmts: { node: AstNode; path: string }[] = [];
  const rec = (n: AstNode, p: string, into: { node: AstNode; path: string }[], pred: (n: AstNode, parent: AstNode | null) => boolean, parent: AstNode | null) => {
    if (pred(n, parent)) into.push({ node: n, path: p });
    n.children.forEach((c, i) => rec(c, `${p}/${i}`, into, pred, n));
  };
  rec(partial, "0", errs, (n) => n.kind === "Error", null);
  rec(repaired, "0", stmts, (_n, parent) => !!parent && (parent.kind === "Block" || parent.kind === "Program"), null);
  return errs.map((e) => ({
    error: e.node,
    errorPath: e.path,
    replacedBy: stmts.filter((s) => s.node.span.start.line <= e.node.span.end.line && s.node.span.end.line >= e.node.span.start.line && !stmts.some((o) => o !== s && o.path.startsWith(s.path + "/") && o.node.span.start.line <= e.node.span.end.line && o.node.span.end.line >= e.node.span.start.line)),
  }));
}
