// Plain-language explanations built only from real compiler output.
//
// Nothing here guesses: every sentence is derived from the lexer tokens, the
// parser diagnostics (exact LAC expected sets), the AST, or the repair
// engine's candidates, plans, stability entries and decision. When the data
// does not support a statement, the explanation says what is unknown.
import type { AstNode, Diagnostic, Edit, LexicalError, Plan, RepairDoc, AnalyzeDoc, Token } from "../types/api";

// ------------------------------------------------------------------ token words
const SINGLE: Record<string, string> = {
  ";": "a semicolon `;`", ",": "a comma `,`", "(": "an opening parenthesis `(`", ")": "a closing parenthesis `)`",
  "{": "an opening brace `{`", "}": "a closing brace `}`", "[": "an opening bracket `[`", "]": "a closing bracket `]`",
  "=": "an equals sign `=`", "<identifier>": "a name (an identifier such as `x` or `total`)", "<end of input>": "the end of the file",
};
const OPERATORS = new Set(["+", "-", "*", "/", "%", "==", "!=", "<", "<=", ">", ">=", "&&", "||"]);
const EXPR_START = new Set(["true", "false", "<identifier>", "<int>", "<float>", "<char>", "-", "!", "("]);
const TYPES = new Set(["int", "float", "char", "bool"]);
const STMT_KW = new Set(["if", "while", "for", "return", "break", "continue"]);

/** "a semicolon `;`, or an operator such as `+` or `==`" — grouped, never truncated silently. */
export function describeExpected(spellings: string[]): string {
  const s = new Set(spellings);
  const parts: string[] = [];
  const has = (xs: Set<string>) => [...xs].some((x) => s.has(x));
  const take = (xs: Iterable<string>) => { for (const x of xs) s.delete(x); };
  const stmtLike = has(STMT_KW) && has(TYPES);
  if (s.has("<end of input>") && s.has("int") && s.has("void") && !stmtLike) {
    parts.push("a new function or global declaration (starting with a type such as `int`), or the end of the file");
    take(["<end of input>", "int", "float", "char", "bool", "void"]);
  }
  if (stmtLike) {
    parts.push("a statement (a declaration, assignment, `if`, `while`, `for`, `return`, …)");
    take([...STMT_KW, ...TYPES, "{", ";", "true", "false", "<identifier>", "<int>", "<float>", "<char>", "-", "!", "("]);
    if (s.has("}")) { parts.push("a closing brace `}` to end the block"); s.delete("}"); }
  }
  const exprCount = [...EXPR_START].filter((x) => s.has(x)).length;
  if (exprCount >= 4) {
    parts.push("a value or expression (a name, a number, `true`/`false`, `-`, `!` or `(`)");
    take(EXPR_START);
  }
  const ops = [...OPERATORS].filter((x) => s.has(x));
  if (ops.length >= 3) {
    parts.push("an operator such as `+`, `*` or `==` (to continue the expression)");
    take(OPERATORS);
  }
  for (const x of [...s]) {
    if (SINGLE[x]) parts.push(SINGLE[x]);
    else if (TYPES.has(x) || x === "void") parts.push("a type such as `int`");
    else if (x === "<int>" || x === "<float>" || x === "<char>") parts.push("a literal value");
    else parts.push("`" + x + "`");
  }
  const uniq = [...new Set(parts)];
  if (!uniq.length) return "nothing more (the parser could not continue here)";
  return uniq.length === 1 ? uniq[0] : uniq.slice(0, -1).join(", ") + " or " + uniq[uniq.length - 1];
}

const CATEGORY_WORD: Record<string, string> = {
  "type-keyword": "the type keyword", keyword: "the keyword", identifier: "the name", literal: "the value",
  operator: "the operator", punctuation: "the symbol", error: "the invalid text", unsupported: "the C construct",
};
export function describeToken(t: Token | undefined, d?: Diagnostic): string {
  if (d && (d.unexpected === "EOF" || d.message.startsWith("unexpected end of input"))) return "the end of the file";
  if (!t) return d?.unexpected_lexeme ? "`" + d.unexpected_lexeme + "`" : "this point";
  return `${CATEGORY_WORD[t.category] ?? "the token"} \`${t.lexeme}\``;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ------------------------------------------------------------------ text helpers
/** Replace `removeBytes` UTF-8 bytes at a UTF-8 byte offset with `insert`. */
export function spliceBytes(source: string, byteOffset: number, removeBytes: number, insert: string): string {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b = enc.encode(source);
  const o = Math.max(0, Math.min(byteOffset, b.length));
  return dec.decode(b.slice(0, o)) + insert + dec.decode(b.slice(Math.min(b.length, o + removeBytes)));
}

/** The source line (1-based) as text. */
export function lineText(source: string, line: number): string {
  return source.split("\n")[line - 1] ?? "";
}

/**
 * Variable and parameter names declared (by `type name`) before `byteOffset`,
 * excluding a name whose own declaration has not ended yet (MiniC: a variable
 * cannot be used in its own initialiser). Lexer evidence only — the parser
 * and name resolution check any choice afterwards.
 */
export function namesDeclaredBefore(tokens: Token[], byteOffset: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < tokens.length; i++) {
    const t = tokens[i], n = tokens[i + 1];
    if (n.start.offset >= byteOffset) break;
    if (t.category === "type-keyword" && n.kind === "IDENT") {
      const after = tokens[i + 2];
      if (after?.kind === "LPAREN") continue; // a function name, not a variable
      const ended = tokens.slice(i + 2).some((x) => x.start.offset < byteOffset && (x.kind === "SEMI" || x.kind === "COMMA" || x.kind === "RPAREN"));
      if (ended && !out.includes(n.lexeme)) out.push(n.lexeme);
    }
  }
  return out;
}

// ------------------------------------------------------------------ program summary (valid code)
export function walk(n: AstNode, f: (n: AstNode, parent: AstNode | null) => void, parent: AstNode | null = null) {
  f(n, parent);
  n.children.forEach((c) => walk(c, f, n));
}

export function summarizeProgram(ast: AstNode): string[] {
  const fns: string[] = [];
  let globals = 0, locals = 0, loops = 0, ifs = 0, returns = 0, calls = 0, assigns = 0;
  const ops = new Set<string>();
  const callNames = new Set<string>();
  walk(ast, (n, parent) => {
    if (n.kind === "Function") fns.push(`${n.type} ${n.name}(${n.children.filter((c) => c.kind === "Param").map((c) => c.name).join(", ")})`);
    if (n.kind === "VarDecl") { if (parent && ast.children.some((g) => g === parent)) globals++; else locals++; }
    if (n.kind === "While" || n.kind === "For") loops++;
    if (n.kind === "If") ifs++;
    if (n.kind === "Return") returns++;
    if (n.kind === "Assign") assigns++;
    if (n.kind === "Call") { calls++; if (n.name) callNames.add(n.name); }
    if ((n.kind === "Binary" || n.kind === "Unary") && n.op) ops.add(n.op);
  });
  const out: string[] = [];
  if (!ast.children.length) out.push("The program is empty: no functions and no global declarations. That is valid MiniC, but it does nothing.");
  if (fns.length) out.push(`${fns.length} function${fns.length > 1 ? "s" : ""}: ${fns.map((f) => "`" + f + "`").join(", ")}.`);
  if (globals) out.push(`${globals} global variable${globals > 1 ? "s" : ""}, visible in every function declared after ${globals > 1 ? "them" : "it"}.`);
  if (locals) out.push(`${locals} local variable${locals > 1 ? "s" : ""} (declared inside functions or blocks).`);
  const flow = [loops && `${loops} loop${loops > 1 ? "s" : ""}`, ifs && `${ifs} \`if\` statement${ifs > 1 ? "s" : ""}`, returns && `${returns} \`return\`${returns > 1 ? "s" : ""}`, assigns && `${assigns} assignment${assigns > 1 ? "s" : ""}`].filter(Boolean);
  if (flow.length) out.push(`Statements include ${flow.join(", ")}.`);
  if (calls) out.push(`${calls} function call${calls > 1 ? "s" : ""} (${[...callNames].map((c) => "`" + c + "`").join(", ")}).`);
  if (ops.size) out.push(`Operators used: ${[...ops].map((o) => "`" + o + "`").join(" ")}.`);
  return out;
}

// ------------------------------------------------------------------ result explanation
export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export interface ClarifyOption {
  id: string;
  label: string; // plain description of the real candidate
  detail: string;
  source?: string; // ready-made repaired program (real candidate)
  fill?: { at: number; remove: number; kind: "expression" | "name"; placeholder: string; suggestions: string[] };
}

export interface Explanation {
  tone: Tone;
  headline: string;
  paragraphs: string[];
  location?: { line: number; column: number; from: number; to: number; lineText: string };
  expected?: string;
  facts?: string[]; // valid program summary
  cascade?: { lines: string[]; total: number };
  hints?: string[]; // progressive: where → what is expected → options
  question?: { text: string; options: ClarifyOption[] };
  nextSteps: string[];
  unknowns?: string[];
}

function editWords(e: Edit): string {
  if (e.op === "insert") return e.placeholder ? `insert a placeholder \`${e.text}\` at ${e.at.line}:${e.at.column}` : `insert \`${e.text}\` at ${e.at.line}:${e.at.column}`;
  if (e.op === "delete") return `delete \`${e.removed_text}\` at ${e.at.line}:${e.at.column}`;
  return e.placeholder ? `replace \`${e.removed_text}\` with a placeholder at ${e.at.line}:${e.at.column}` : `replace \`${e.removed_text}\` with \`${e.text}\` at ${e.at.line}:${e.at.column}`;
}
export function planWords(pl: Plan): string {
  const w = pl.edits.slice(0, 3).map(editWords).join(", then ");
  return pl.edits.length > 3 ? `${w}, and ${pl.edits.length - 3} more edit(s)` : w;
}

/** A plan that throws away a multi-line lexical error (e.g. an unterminated comment) hides code: never offer it as a choice. */
const discardsHiddenCode = (pl: Plan) => pl.edits.some((e) => e.op !== "insert" && e.removed_kind === "ERROR" && (e.removed_text ?? "").startsWith("/*"));

/** Builds clarification options from the real top plans (never invented). */
export function clarifyOptions(doc: RepairDoc): ClarifyOption[] {
  const plans = doc.repair.decision.plans;
  const out: ClarifyOption[] = [];
  plans.forEach((pl, i) => {
    if (discardsHiddenCode(pl)) return;
    const hole = pl.edits.find((e) => e.placeholder);
    if (hole && pl.edits.length === 1 && out.some((o) => o.fill && o.fill.at === hole.at.offset)) return; // one fill-in per position
    if (hole && pl.edits.length === 1) {
      const isName = hole.kind === "IDENT" || hole.text === "__hole";
      const names = namesDeclaredBefore(doc.tokens, hole.at.offset);
      out.push({
        id: `fill${i}`,
        label: isName ? "Type the missing name yourself" : "Fill in the missing value or expression yourself",
        detail: `IntelliFix found that something is missing at ${hole.at.line}:${hole.at.column} but cannot know what you meant, so it will not invent it.`,
        fill: { at: hole.at.offset, remove: hole.op === "replace" ? new TextEncoder().encode(hole.removed_text ?? "").length : 0, kind: isName ? "name" : "expression", placeholder: isName ? "e.g. count" : "e.g. 1 or price", suggestions: isName ? [] : names },
      });
    } else if (!hole) {
      out.push({ id: `plan${i}`, label: planWords(pl).replace(/^./, (c) => c.toUpperCase()), detail: pl.valid ? "Real candidate; the whole program parses after this change." : "Real candidate; later errors remain after this change.", source: pl.source });
    }
  });
  return out;
}

function lexicalParagraphs(errs: LexicalError[]): string[] {
  const list = errs.slice(0, 4).map((e) => `line ${e.start.line}, column ${e.start.column}: ${e.message}`);
  const more = errs.length > 4 ? ` (and ${errs.length - 4} more)` : "";
  return [`The lexer found ${errs.length} problem${errs.length > 1 ? "s" : ""} with individual characters or words — ${list.join("; ")}${more}.`];
}

export function explain(doc: RepairDoc | AnalyzeDoc, source: string): Explanation {
  const parse = doc.parse;
  const rep = "repair" in doc ? doc.repair : null;
  const status = rep?.decision.status;
  const trimmed = source.trim();

  if (parse.ok) {
    const hasCode = doc.tokens.length > 0;
    return {
      tone: "success",
      headline: hasCode ? "Your program is valid MiniC: it parses without syntax errors." : (trimmed ? "Only comments or whitespace: an empty program, which is valid MiniC." : "The editor is empty: an empty program is valid MiniC, but it does nothing."),
      paragraphs: [
        hasCode ? `The lexer produced ${doc.tokens.length} tokens and the parser accepted all of them, building an abstract syntax tree (AST) with ${parse.ast_nodes ?? "?"} nodes.` : "There is nothing to analyse yet.",
        "This means the code follows MiniC's grammar. It does not mean the program is semantically correct or that it computes what you intended: IntelliFix checks syntax and name use, not types or behaviour.",
      ],
      facts: parse.ast ? summarizeProgram(parse.ast) : undefined,
      nextSteps: hasCode ? ["Open the AST explorer to see the structure, node by node.", "Change something (delete a `;` or a `)`) and press Analyze to see how errors are explained."] : ["Type a MiniC program or load a sample, then press Analyze."],
      unknowns: parse.name_warnings?.length ? [`Name checks found ${parse.name_warnings.length} warning(s) (for example ${parse.name_warnings[0].message}). They are not syntax errors.`] : undefined,
    };
  }

  const d = parse.diagnostics[0];
  const tok = doc.tokens[d?.token_index];
  const prev = d ? doc.tokens[d.token_index - 1] : undefined;
  const loc = d ? { line: d.start.line, column: d.start.column, from: d.start.offset, to: Math.max(d.end.offset, d.start.offset + 1), lineText: lineText(source, d.start.line) } : undefined;
  const expected = d && d.expected_spelling.length ? describeExpected(d.expected_spelling) : undefined;
  const ex: Explanation = { tone: "danger", headline: "", paragraphs: [], location: loc, expected, nextSteps: [] };

  // what was found, in words
  const where = d ? (prev ? `and including ${describeToken(prev)} (line ${prev.start.line})` : "") : "";
  if (parse.resource_limit) {
    ex.tone = "info";
    ex.headline = "The code nests deeper than the parser can handle.";
    ex.paragraphs.push(`The parser's stack holds 5000 entries; this input exceeds it around line ${d?.start.line}. This is a capacity limit, not necessarily a mistake in your code, so IntelliFix does not try to repair it.`);
    ex.nextSteps.push("Reduce the nesting (split deeply nested blocks or expressions into smaller pieces) and analyse again.");
    return ex;
  }
  const lexErrs = doc.lexical_errors;
  const unsupported = lexErrs.filter((e) => e.kind === "UNSUPPORTED");
  const invalid = lexErrs.filter((e) => e.kind !== "UNSUPPORTED");
  if (status === "UNSUPPORTED_CONSTRUCT" && unsupported.length) {
    ex.tone = "info";
    ex.headline = "This is C, not MiniC: the code uses a feature MiniC deliberately leaves out.";
    ex.paragraphs.push(`${unsupported[0].message} (line ${unsupported[0].start.line}).`);
    ex.paragraphs.push("Automatically rewriting it would change what the program means, so IntelliFix explains it instead of repairing it.");
    ex.nextSteps.push("Rewrite the construct with MiniC features (the message says how), then press Analyze.");
    if (unsupported.length > 1) ex.unknowns = [`${unsupported.length - 1} more unsupported construct(s) further on.`];
  } else if (invalid.length && d && d.message.startsWith("lexical error")) {
    ex.headline = `Line ${d.start.line} contains text that is not part of MiniC.`;
    ex.paragraphs.push(...lexicalParagraphs(invalid));
    ex.paragraphs.push("The parser then stops at the first such token, because it cannot fit into any MiniC statement.");
  } else if (d) {
    const found = describeToken(tok, d);
    ex.headline = d.unexpected === "EOF" ? "The file ends before the program is complete." : `Line ${d.start.line}: the parser did not expect ${found} here.`;
    ex.paragraphs.push(`${where ? `Reading from the top, everything up to ${where} is valid MiniC. ` : "The problem is at the very first token. "}At line ${d.start.line}, column ${d.start.column} the parser found ${found}, but at this point MiniC only allows ${expected}.`);
    if (d.expected_spelling.includes(";") && tok && prev && tok.start.line > prev.end.line)
      ex.paragraphs.push(`${cap(describeToken(tok))} starts a new line, and a \`;\` was one of the expected tokens. That pattern often means the previous line (${prev.end.line}) is missing its \`;\` — the parser can only notice it here, one line later.`);
    if (invalid.length) ex.paragraphs.push(...lexicalParagraphs(invalid));
    if (d.expected_spelling.includes("<end of input>") && d.expected_spelling.includes("void") && tok && ["identifier", "keyword", "literal", "operator"].includes(tok.category))
      ex.paragraphs.push("At the top level of a file MiniC only allows function definitions and global declarations. Statements such as assignments, calls and `return` must be inside a function body, for example `int main() { … }`.");
  }
  // where the likely cause is, when the engine's top plan edits an earlier line (evidence, not proof)
  const top0 = rep?.decision.plans[0];
  const firstEdit = top0?.edits[0];
  if (d && firstEdit && firstEdit.at.line < d.start.line && !discardsHiddenCode(top0!))
    ex.paragraphs.push(`Note: the parser noticed the problem on line ${d.start.line}, but the top-ranked fix changes **line ${firstEdit.at.line}** (${editWords(firstEdit)}). Errors are often detected later than the place where they were made.`);

  // cascade / root cause, from real evidence
  if (parse.diagnostics.length > 1) {
    const lines = [`The parser reported ${parse.diagnostics.length} problems. The first one (line ${d.start.line}) is the most reliable: everything before it is valid. The others were found after the parser skipped ahead to recover, so some may be consequences of the first.`];
    const top = rep?.decision.plans[0];
    if (top?.valid && top.edits.length === 1) lines.push(`Evidence: one single edit at the first error (${editWords(top.edits[0])}) makes the whole program parse, so the later reports were most likely caused by the first problem.`);
    else if (top?.valid && top.edits.length > 1) lines.push(`Evidence: the best plan needs ${top.edits.length} separate edits (${top.edits.map((e) => `line ${e.at.line}`).join(", ")}), so there are probably ${top.edits.length} independent mistakes.`);
    const stable = rep?.hypotheses.stability.filter((s) => s.stable) ?? [];
    if (stable.length) lines.push(`Under every first-fix the engine tried, problems remained at ${stable.slice(0, 4).map((s) => `line ${s.at.line} (\`${s.token}\`)`).join(", ")} — these look independent of the first error (likely, not proven).`);
    ex.cascade = { lines, total: parse.diagnostics.length };
  }

  // progressive hints (no answer in the first two)
  if (d && status === "UNSUPPORTED_CONSTRUCT" && unsupported.length) {
    ex.hints = [
      `Look at line ${unsupported[0].start.line}, column ${unsupported[0].start.column}: \`${unsupported[0].lexeme}\`.`,
      `${unsupported[0].message}.`,
      "Rewrite that part with MiniC features only (see the language specification under Documentation), then press Analyze.",
    ];
  } else if (d) {
    ex.hints = [
      `Look at line ${d.start.line}${prev ? `, just after ${describeToken(prev)}` : ""}. The parser got stuck at ${describeToken(tok, d)}.`,
      `Here MiniC expects ${expected}. Which of these is missing, or which token is extra?`,
      (() => {
        const opts = [...new Set((rep?.decision.plans ?? []).filter((p) => !discardsHiddenCode(p)).slice(0, 3).map((p) => planWords(p)))];
        return opts.length ? `Possible fixes the engine checked with the real parser: ${opts.join("; ")}.` : "The repair engine found no safe small fix here; try rewriting the statement yourself.";
      })(),
    ];
  }

  // decision-specific wording
  if (rep && status) {
    const plans = rep.decision.plans;
    if (status === "RECOMMENDED") {
      ex.tone = "warning";
      ex.paragraphs.push(`IntelliFix recommends one fix: **${planWords(plans[0])}**. It leads every structurally different alternative by a clear margin, and the repaired program was re-parsed successfully. Review it before accepting: the parser accepting it does not prove it is what you meant.`);
      ex.nextSteps.push("Review the recommended fix below and press Accept, or try your own fix first (hints).");
    } else if (status === "MULTIPLE_PLAUSIBLE") {
      ex.tone = "warning";
      ex.paragraphs.push(`Several different fixes are about equally well supported (margin ${rep.decision.margin?.toFixed(2) ?? "n/a"}, below the threshold ${rep.decision.tau}). IntelliFix will not pick one for you.`);
      ex.question = { text: "Which change did you mean?", options: clarifyOptions(doc as RepairDoc) };
      ex.nextSteps.push("Answer the question above, or edit the code yourself and press Analyze.");
    } else if (status === "LOW_CONFIDENCE") {
      ex.tone = "warning";
      const hole = plans[0]?.edits.find((e) => e.placeholder);
      ex.paragraphs.push(hole ? `Something is missing at line ${hole.at.line}, column ${hole.at.column} (${expected ?? "a value"}), and its intended content cannot be recovered from the code. The best mechanical fix would only insert a placeholder \`${hole.text}\`.` : rep.decision.summary);
      if (rep.decision.reasons.length) ex.unknowns = [...(ex.unknowns ?? []), ...rep.decision.reasons];
      const opts = clarifyOptions(doc as RepairDoc);
      if (opts.length) ex.question = { text: hole ? "What should go here?" : "Which change did you mean?", options: opts };
      ex.nextSteps.push("Tell IntelliFix what you meant (above), or edit the code and press Analyze.");
    } else if (status === "NO_SAFE_REPAIR" || status === "BUDGET_EXHAUSTED") {
      ex.paragraphs.push(status === "BUDGET_EXHAUSTED" ? "The repair search reached its limit (30,000 parser runs or 4 seconds) before finding a complete fix." : "No small edit (at most two tokens near the error) lets the parser continue. The mistake may need a larger rewrite, or the code may not be MiniC at all.");
      ex.nextSteps.push("Use the hints: check the statement around the highlighted line and rewrite it, then press Analyze.");
    } else if (status === "UNSUPPORTED_CONSTRUCT" && !unsupported.length) {
      ex.paragraphs.push(rep.decision.summary);
    }
  }
  if (!ex.nextSteps.length) ex.nextSteps.push("Edit the highlighted code and press Analyze again.");
  return ex;
}
