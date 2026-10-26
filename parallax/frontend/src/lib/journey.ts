// The Workspace journey: one response flow for every input, built only from
// real compiler output (tokens, diagnostics, candidates, classes, plans).
//
//   classifyInput     which kind of input this is, what can be established, what to do next
//   describeAmbiguity what exactly is ambiguous, and the targeted question to ask
//   diagnosticRoles   first error vs. later reports, with the evidence for "likely consequence"
//   planCards         comparison data for each structurally different repair
//   compareDiagnostics which diagnostics disappeared / remain after an edit (re-parse)
//   practiceFeedback  feedback on a student's own fix, from a real re-parse
import type { AnalyzeDoc, Candidate, Diagnostic, Edit, LexicalError, Plan, RepairDoc } from "../types/api";
import type { ApiError } from "../services/api";
import { describeExpected, planRisks, planWords } from "./explain";
import { lineDiff } from "./diff";

type Doc = RepairDoc | AnalyzeDoc;
const repairOf = (doc: Doc) => ("repair" in doc ? doc.repair : null);

// ------------------------------------------------------------------ input categories
export type InputCategory =
  | "valid" | "name-warnings" | "empty" | "whitespace" | "comments-only"
  | "missing-delimiter" | "missing-content" | "ambiguous" | "multiple-errors"
  | "lexical" | "unterminated-comment" | "incomplete-code" | "unsupported"
  | "resource-limit" | "no-safe-repair" | "syntax-error"
  | "too-large" | "compiler-failure" | "backend-offline";

export interface CategoryMeta {
  label: string;
  /** what IntelliFix can establish for this kind of input */
  establishes: string;
  /** the most useful next action */
  next: string;
}

export const CATEGORY: Record<InputCategory, CategoryMeta> = {
  valid: { label: "Valid MiniC", establishes: "Lexer, parser and name check pass. Types and run-time behaviour are not checked.", next: "Inspect the tree to see how the program is structured." },
  "name-warnings": { label: "Syntax OK, name problems", establishes: "The parser accepts the program, but the name check found an undeclared, duplicate or misused name. That is not a syntax error, so it is not repaired automatically.", next: "Correct the name in the editor, then press Analyze." },
  empty: { label: "Empty input", establishes: "There is no program to analyze.", next: "Load a sample or type a MiniC program." },
  whitespace: { label: "Only whitespace", establishes: "There is no program to analyze: the text contains only spaces or line breaks.", next: "Load a sample or type a MiniC program." },
  "comments-only": { label: "Only comments", establishes: "The lexer skipped the comments; no tokens remain, so the program is empty.", next: "Write code outside the comments." },
  "missing-delimiter": { label: "Missing delimiter", establishes: "One small insertion makes the whole program parse, and it clearly beats the alternatives.", next: "Compare the fix with its alternatives, then apply it or fix it yourself." },
  "missing-content": { label: "Missing expression or name", establishes: "Something is missing here, but its content cannot be recovered from the code.", next: "Tell IntelliFix what you meant: type the missing part." },
  ambiguous: { label: "Ambiguous repair", establishes: "Several structurally different fixes parse, with similar evidence.", next: "Answer the question: which change did you mean?" },
  "multiple-errors": { label: "Several syntax errors", establishes: "The first error is reliable; later reports may be consequences of it.", next: "Fix the first error, then re-check which reports remain." },
  lexical: { label: "Invalid token (lexical error)", establishes: "Before parsing, the lexer found text that is not a valid MiniC token: an invalid character, an out-of-range number or an over-long name.", next: "Replace or delete the highlighted text." },
  "unterminated-comment": { label: "Unterminated comment", establishes: "A `/*` comment never ends, so everything after it is hidden inside the comment.", next: "Add `*/` where the comment should end." },
  "incomplete-code": { label: "Incomplete code", establishes: "The file ends before a function, block or statement is complete.", next: "Finish the construct that is still open (often a missing `}`)." },
  unsupported: { label: "Unsupported C construct", establishes: "This is valid C but not MiniC; rewriting it automatically could change its meaning.", next: "Rewrite it with MiniC features, as the message suggests." },
  "resource-limit": { label: "Too deeply nested", establishes: "The input exceeds the parser's stack (5000 entries). This is a capacity limit, not necessarily a mistake.", next: "Split deeply nested code into smaller pieces." },
  "no-safe-repair": { label: "No safe repair", establishes: "No small edit near the error makes the parser continue; IntelliFix will not guess a large rewrite.", next: "Use the hints and rewrite the statement yourself." },
  "syntax-error": { label: "Syntax error", establishes: "The parser stopped at the highlighted token; candidate fixes were checked by the real parser.", next: "Compare the candidate fixes." },
  "too-large": { label: "Input too large", establishes: "The backend accepts at most 64 KB; nothing was analyzed.", next: "Shorten the program or split it." },
  "compiler-failure": { label: "Compiler unavailable or failed", establishes: "No analysis result exists, so none is shown. Your code is unchanged.", next: "Retry; if it persists, rebuild the compiler (see the message)." },
  "backend-offline": { label: "Backend offline", establishes: "The browser cannot reach the IntelliFix backend. Your code is unchanged.", next: "Start the backend, then press Analyze again." },
};

const DELIMS = new Set([";", ",", ")", "]", "}", "(", "[", "{"]);

export function classifyError(err: ApiError): InputCategory {
  if (err.code === "INPUT_TOO_LARGE") return "too-large";
  if (err.code === "BACKEND_UNAVAILABLE") return "backend-offline";
  return "compiler-failure";
}

export function classifyInput(doc: Doc, source: string): InputCategory {
  const parse = doc.parse;
  if (parse.ok) {
    if (source.length === 0) return "empty";
    if (!source.trim()) return "whitespace";
    if (doc.tokens.length === 0) return "comments-only";
    return parse.name_warnings?.length ? "name-warnings" : "valid";
  }
  if (parse.resource_limit) return "resource-limit";
  const rep = repairOf(doc);
  const status = rep?.decision.status;
  // Lexical categories only when the lexical error IS the first error; a `++` further down does not
  // turn a missing `;` into an "invalid token" case.
  const d0 = parse.diagnostics[0];
  const lex = doc.lexical_errors.filter((e) => !d0 || e.start.offset <= d0.start.offset);
  if (lex.some((e) => e.kind === "UNSUPPORTED") && (status === "UNSUPPORTED_CONSTRUCT" || !rep || d0?.message.startsWith("unsupported construct"))) return "unsupported";
  if (lex.some((e) => /unterminated block comment/.test(e.message))) return "unterminated-comment";
  if (lex.length) return "lexical";
  const d = parse.diagnostics[0];
  if (d && (d.unexpected === "EOF" || d.message.startsWith("unexpected end of input"))) return "incomplete-code";
  const plans = rep?.decision.plans ?? [];
  const top = plans[0];
  // Several errors only if the evidence says so: when one valid single edit fixes everything,
  // the later reports came from the parser's recovery, not from separate mistakes.
  if (top?.valid ? top.edits.length > 1 : parse.diagnostics.length > 1) return "multiple-errors";
  if (plans.some((p) => p.edits.length === 1 && p.edits[0].placeholder) && (status === "MULTIPLE_PLAUSIBLE" || status === "LOW_CONFIDENCE")) return "missing-content";
  if (status === "MULTIPLE_PLAUSIBLE" || status === "LOW_CONFIDENCE") return "ambiguous";
  if (status === "NO_SAFE_REPAIR" || status === "BUDGET_EXHAUSTED") return "no-safe-repair";
  if (status === "RECOMMENDED" && top?.edits.length === 1 && top.edits[0].op === "insert" && DELIMS.has(top.edits[0].text ?? "")) return "missing-delimiter";
  return "syntax-error";
}

// ------------------------------------------------------------------ ambiguity
export interface Ambiguity {
  /** plain-English statement of what is ambiguous */
  what: string;
  /** the targeted question */
  question: string;
}

const tick = (s: string | undefined) => "`" + (s ?? "") + "`";

/** What is ambiguous, from the real plans (only called for MULTIPLE_PLAUSIBLE / LOW_CONFIDENCE). */
export function describeAmbiguity(doc: RepairDoc): Ambiguity {
  const plans = doc.repair.decision.plans.filter((p) => !p.edits.some((e) => e.removed_kind === "ERROR" && (e.removed_text ?? "").startsWith("/*")));
  const single = plans.filter((p) => p.edits.length === 1).map((p) => p.edits[0]);
  const d = doc.parse.diagnostics[0];
  const tokAt = (i: number) => doc.tokens[i];
  const gap = `${doc.repair.decision.margin === null ? "" : ` (score gap ${doc.repair.decision.margin.toFixed(2)}, below the threshold τ = ${doc.repair.decision.tau})`}`;
  const OPS = new Set(["+", "-", "*", "/", "%", "==", "!=", "<", "<=", ">", ">=", "&&", "||"]);

  // a declaration name was lost
  if (single.length && single.every((e) => e.placeholder) && single.some((e) => e.text === "__hole")) {
    return { what: `A name is missing at line ${single[0].at.line}: a declaration needs a name after the type. Any name would parse, so only you know which one you meant.`, question: "What should the name be?" };
  }
  // the same position, only different operators inserted: a missing operator
  if (single.length >= 2 && single.every((e) => e.op === "insert" && OPS.has(e.text ?? "")) && new Set(single.map((e) => e.at.offset)).size === 1 && d) {
    const prev = tokAt(d.token_index - 1);
    return {
      what: `Between ${tick(prev?.lexeme)} and ${tick(d.unexpected_lexeme)} on line ${d.start.line} two values stand next to each other with no operator. ${single.map((e) => tick(e.text)).join(", ")} all give valid programs with different meanings${gap}.`,
      question: `Which operator did you mean between ${tick(prev?.lexeme)} and ${tick(d.unexpected_lexeme)}?`,
    };
  }
  // an invalid character replaced in different ways
  const lexErr = doc.lexical_errors.find((e) => e.kind === "ERROR");
  if (lexErr && single.length >= 2 && single.every((e) => e.op === "replace" && e.removed_text === lexErr.lexeme)) {
    return {
      what: `${tick(lexErr.lexeme)} on line ${lexErr.start.line} is not a MiniC character. It stands where an operator could go, and ${single.map((e) => tick(e.text)).join(", ")} would all parse${gap}.`,
      question: `What did you mean by ${tick(lexErr.lexeme)}?`,
    };
  }
  // an operator with nothing after it: extra operator, or missing operand?
  const del = single.find((e) => e.op === "delete" && OPS.has(e.removed_text ?? ""));
  const hole = single.find((e) => e.placeholder);
  if (del && hole) {
    return {
      what: `${tick(del.removed_text)} on line ${del.at.line} has nothing valid after it. Either the ${tick(del.removed_text)} is extra, or the value after it is missing — the code alone cannot tell which${gap}.`,
      question: `Is the ${tick(del.removed_text)} extra, or is something missing after it?`,
    };
  }
  if (hole) {
    return { what: `Something is missing at line ${hole.at.line}, column ${hole.at.column}${d?.expected_spelling.length ? ` (MiniC expects ${describeExpected(d.expected_spelling)})` : ""}. Its content cannot be recovered from the code.`, question: "What should go here?" };
  }
  return {
    what: `${plans.length} structurally different fixes all make the code parse, and the evidence does not clearly favour one${gap}. Choosing would mean guessing your intent.`,
    question: "Which change did you mean?",
  };
}

// ------------------------------------------------------------------ error cascade
export type DiagRole = "first" | "likely-consequence" | "likely-separate" | "unknown";
export interface DiagnosticRole {
  diag: Diagnostic;
  role: DiagRole;
  evidence: string;
}

/** The rank-1 candidate: the best single fix for the first error. */
function firstFix(doc: Doc): Candidate | null {
  const c = repairOf(doc)?.candidates ?? [];
  return [...c].sort((a, b) => a.rank - b.rank)[0] ?? null;
}

/**
 * First diagnostic vs. later ones. Evidence: does a later report survive when
 * only the first error is fixed (the rank-1 candidate re-parsed by the engine)?
 * "Likely", never "proven".
 */
export function diagnosticRoles(doc: Doc): DiagnosticRole[] {
  const ds = doc.parse.diagnostics;
  if (!ds.length) return [];
  const fix = firstFix(doc);
  return ds.map((d, i) => {
    if (i === 0) return { diag: d, role: "first", evidence: "Everything before this point parsed, so this report is reliable." };
    if (!fix) return { diag: d, role: "unknown", evidence: "Found after the parser skipped ahead to recover. No repair candidate was available to test whether it depends on the first error." };
    if (fix.valid) return { diag: d, role: "likely-consequence", evidence: `When only the first error is fixed (${fix.summary}), the whole program parses, so this report was probably a consequence (likely, not proven).` };
    const survives = fix.residual_diagnostics.some((r) => r.original.token_index === d.token_index);
    return survives
      ? { diag: d, role: "likely-separate", evidence: `Still reported after the first error is fixed (${fix.summary}), so it does not depend on the first error (likely, not proven).` }
      : { diag: d, role: "likely-consequence", evidence: `No longer reported once the first error is fixed (${fix.summary}), so it was probably caused by the first error (likely, not proven).` };
  });
}

export const ROLE_LABEL: Record<DiagRole, string> = {
  first: "first error (reliable)",
  "likely-consequence": "likely a consequence",
  "likely-separate": "likely independent of the first",
  unknown: "unknown relation",
};

// ------------------------------------------------------------------ repair comparison
export interface PlanCard {
  index: number;
  plan: Plan;
  words: string;
  valid: boolean;
  cost: number;
  /** evidence score of the plan's AST class (sum of named contributions); null if not reported */
  score: number | null;
  /** score difference to the top plan (not a probability) */
  behind: number | null;
  evidence: { name: string; contribution: number; explanation: string }[];
  placeholder: boolean;
  hidesCode: boolean;
  /** how the edit may change what the program does (empty: only punctuation / invalid characters change) */
  risks: string[];
  /** changed lines: [line number in the original, before text, after text] */
  lines: { line: number; before: string; after: string }[];
}

export function changedLines(before: string, after: string): { line: number; before: string; after: string }[] {
  const diff = lineDiff(before, after);
  const out: { line: number; before: string; after: string }[] = [];
  for (let i = 0; i < diff.length; ) {
    if (diff[i].kind === "same") { i++; continue; }
    const dels: typeof diff = [], adds: typeof diff = [];
    let lastLine = diff[i - 1]?.a ?? 0;
    while (i < diff.length && diff[i].kind !== "same") { (diff[i].kind === "del" ? dels : adds).push(diff[i]); i++; }
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) out.push({ line: dels[k]?.a ?? ++lastLine, before: dels[k]?.text ?? "", after: adds[k]?.text ?? "" });
  }
  return out;
}

export function planCards(doc: RepairDoc, source: string): PlanCard[] {
  const rep = doc.repair;
  const classes = rep.classes ?? [];
  const cands = rep.candidates ?? [];
  const cards = rep.decision.plans.map((plan, index) => {
    const cls = classes.find((c) => c.id === plan.root_class);
    const rep1 = cls ? cands.find((c) => c.id === cls.representative) : undefined;
    return {
      index,
      plan,
      words: planWords(plan),
      valid: plan.valid,
      cost: plan.total_cost,
      score: cls ? cls.best_score : null,
      behind: null as number | null,
      evidence: (rep1?.evidence ?? []).filter((e) => e.contribution !== 0).map((e) => ({ name: e.name, contribution: e.contribution, explanation: e.explanation })),
      placeholder: plan.edits.some((e) => e.placeholder),
      hidesCode: plan.edits.some((e) => e.op !== "insert" && e.removed_kind === "ERROR" && (e.removed_text ?? "").startsWith("/*")),
      risks: planRisks(plan),
      lines: changedLines(source, plan.source),
    };
  });
  const top = cards[0]?.score;
  for (const c of cards) c.behind = top !== null && top !== undefined && c.score !== null ? +(top - c.score).toFixed(2) : null;
  return cards;
}

/** How a plan differs from the top-ranked one, in words (from the edits, not guessed). */
export function differsFromTop(cards: PlanCard[], i: number): string {
  if (i === 0 || !cards[0]) return "Top-ranked by the evidence score.";
  const a = cards[0], b = cards[i];
  const parts: string[] = [];
  if (b.score !== null && a.score !== null) parts.push(`scores ${b.behind?.toFixed(2)} lower than option 1`);
  if (b.cost !== a.cost) parts.push(b.cost > a.cost ? `costs more to edit (${b.cost} vs ${a.cost})` : `costs less to edit (${b.cost} vs ${a.cost})`);
  if (b.placeholder && !a.placeholder) parts.push("invents a placeholder");
  if (b.valid !== a.valid) parts.push(b.valid ? "parses completely, unlike option 1" : "leaves errors that option 1 fixes");
  const ea = a.plan.edits[0], eb = b.plan.edits[0];
  if (ea && eb && ea.at.offset !== eb.at.offset) parts.push(`edits a different place (${eb.at.line}:${eb.at.column} instead of ${ea.at.line}:${ea.at.column})`);
  return parts.length ? cap(parts.join("; ")) + "." : "Same cost and score as option 1, but a different program structure.";
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ------------------------------------------------------------------ verification (re-parse)
export interface DiagnosticComparison {
  fixed: Diagnostic[];
  remaining: Diagnostic[]; // as reported after the edit
  added: Diagnostic[];
}

/**
 * Before/after diagnostics of a real re-parse. Matched by message text
 * (positions shift after an edit), so the comparison is approximate and the
 * UI says so.
 */
export function compareDiagnostics(before: Diagnostic[], after: Diagnostic[]): DiagnosticComparison {
  const pool = [...after];
  const fixed: Diagnostic[] = [], remaining: Diagnostic[] = [];
  for (const d of before) {
    const k = pool.findIndex((x) => x.message === d.message);
    if (k >= 0) remaining.push(pool.splice(k, 1)[0]);
    else fixed.push(d);
  }
  return { fixed, remaining, added: pool };
}

// ------------------------------------------------------------------ practice ("Check my fix")
export interface Feedback {
  tone: "success" | "info" | "warning" | "danger";
  title: string;
  body: string;
}

export function practiceFeedback(oldLine: number, doc: Doc): Feedback {
  if (doc.parse.ok) {
    if (!doc.tokens.length) return { tone: "warning", title: "The program is now empty.", body: "An empty program parses, but there is nothing left to check. Undo or write the code again." };
    return { tone: "success", title: "Your fix works: the program now parses.", body: "The real parser accepts every token. It checks syntax only: make sure the program still means what you intended." };
  }
  const d = doc.parse.diagnostics[0];
  const unsupported = doc.lexical_errors.find((e) => e.kind === "UNSUPPORTED");
  if (unsupported) return { tone: "info", title: "That is C, not MiniC.", body: `${unsupported.message} (line ${unsupported.start.line}).` };
  const lexical = doc.lexical_errors[0];
  if (lexical) return { tone: "warning", title: "The lexer rejects a character.", body: `Line ${lexical.start.line}, column ${lexical.start.column}: ${lexical.message}.` };
  if (!d) return { tone: "warning", title: "Not fixed yet.", body: "The parser rejected the code." };
  if (d.unexpected === "EOF" || d.message.startsWith("unexpected end of input")) return { tone: "warning", title: "Incomplete: the code ends too early.", body: "The parser reached the end of the file while a function, block or statement was still open. Check for a missing `}` or `;`." };
  if (d.start.line > oldLine) return { tone: "info", title: `Progress: the error on line ${oldLine} is gone.`, body: `The next problem is on line ${d.start.line}: ${d.message}.` };
  if (d.start.line < oldLine) return { tone: "danger", title: "Your edit introduced an earlier error.", body: `The parser now stops at line ${d.start.line}, column ${d.start.column}: ${d.message}.` };
  return { tone: "warning", title: "Not fixed yet.", body: `The parser still stops at line ${d.start.line}, column ${d.start.column}: ${d.message}.` };
}

/** Text of a single-line custom answer spliced into the source (whole line replaced). */
export function replaceLine(source: string, line: number, text: string): string {
  const lines = source.split("\n");
  if (line < 1 || line > lines.length) return source;
  lines[line - 1] = text;
  return lines.join("\n");
}

export function editAt(e: Edit): string {
  return `${e.at.line}:${e.at.column}`;
}

// ------------------------------------------------------------------ one error at a time
export interface FirstErrorView {
  /** the doc with its plans replaced by the engine's single-edit candidates for the first error */
  doc: RepairDoc;
  /** the engine's complete plan for every error (kept as an alternative, never applied silently) */
  fullPlan: Plan | null;
  reported: number;
}

/**
 * When the code has several errors, the engine's plans fix all of them at once and can bundle
 * risky edits (e.g. deleting `++`). For a step-by-step correction we offer the engine's real
 * candidates for the FIRST error only (each was re-parsed by the engine), one per AST class,
 * and decide with the same rule as the engine: recommend only if the best leads the runner-up
 * by at least tau and removes no code. After the user applies one, everything is re-analyzed.
 */
export function firstErrorView(doc: RepairDoc, source: string): FirstErrorView | null {
  const plans = doc.repair.decision.plans;
  const multi = plans[0] ? plans[0].edits.length > 1 : doc.parse.diagnostics.length > 1;
  const cands = [...(doc.repair.candidates ?? [])].sort((a, b) => a.rank - b.rank);
  if (!multi || !cands.length) return null;
  // Candidates can bundle an edit for a LATER error (e.g. deleting `++` two tokens on). Keep only the
  // edits on the first edit's line and apply them to the user's text; the result is never claimed to
  // parse (later errors remain) — the real re-analysis after applying decides.
  const seen = new Set<string>();
  const picked: { c: Candidate; plan: Plan }[] = [];
  for (const c of cands) {
    if (!c.edits.length) continue;
    const edits = c.edits.filter((e) => e.at.line === c.edits[0].at.line);
    const hole = edits.some((e) => e.placeholder);
    if (picked.length >= 4 && (!hole || picked.some((x) => x.plan.edits.some((e) => e.placeholder)))) continue;
    const src = applyEdits(source, edits);
    if (src === null || seen.has(src)) continue;
    seen.add(src);
    const trimmed = edits.length < c.edits.length;
    picked.push({ c, plan: { leaf: -1, root_class: c.class_id, valid: trimmed ? false : c.valid, total_cost: edits.reduce((a, e) => a + e.cost, 0), summary: edits.map((e) => e.op).join("+"), source: trimmed ? src : c.source, edits, tokens: [] } });
  }
  if (!picked.length) return null;
  const fplans = picked.map((x) => x.plan);
  const margin = picked.length > 1 ? +(picked[0].c.score - picked[1].c.score).toFixed(2) : null;
  const tau = doc.repair.decision.tau;
  const risky = planRisks(fplans[0]).length > 0;
  const status = doc.repair.decision.status === "UNSUPPORTED_CONSTRUCT" ? "UNSUPPORTED_CONSTRUCT" : !risky && (margin === null || margin >= tau) ? "RECOMMENDED" : "MULTIPLE_PLAUSIBLE";
  const classes = picked.map(({ c }) => ({ id: c.class_id, ast_hash: "", complete_ast: c.valid, size: 1, best_score: c.score, min_cost: c.cost, representative: c.id, members: [c.id] }));
  const view: RepairDoc = {
    ...doc,
    repair: {
      ...doc.repair,
      classes,
      decision: { ...doc.repair.decision, status, margin, plans: fplans, reasons: [margin === null ? "only one structurally distinct fix for this error" : `score margin ${margin.toFixed(2)} ${margin >= tau ? ">=" : "<"} tau = ${tau}`, ...(risky ? ["the best fix for this error removes code, so IntelliFix will not recommend it"] : [])] },
    },
  };
  return { doc: view, fullPlan: plans[0] ?? null, reported: doc.parse.diagnostics.length };
}

// ------------------------------------------------------------------ unsupported constructs
export interface Rewrite { line: number; before: string; after: string; why: string }

/** A supported MiniC rewrite for `x++;`, `++x;`, `x--;` and `x op= e;` on the line of an unsupported token. */
export function unsupportedRewrite(source: string, err: LexicalError | undefined): Rewrite | null {
  if (!err || err.kind !== "UNSUPPORTED") return null;
  const lines = source.split("\n");
  const before = lines[err.start.line - 1];
  if (before === undefined) return null;
  const ind = before.match(/^\s*/)![0];
  let m = before.match(/^\s*([A-Za-z_]\w*)\s*(\+\+|--)\s*;\s*$/) ?? before.match(/^\s*(\+\+|--)\s*([A-Za-z_]\w*)\s*;\s*$/);
  if (m) {
    const [name, op] = m[1] === "++" || m[1] === "--" ? [m[2], m[1]] : [m[1], m[2]];
    return { line: err.start.line, before, after: `${ind}${name} = ${name} ${op[0]} 1;`, why: `MiniC has no \`${op}\`. \`${name} = ${name} ${op[0]} 1;\` does the same ${op === "++" ? "increment" : "decrement"} with supported syntax.` };
  }
  m = before.match(/^\s*([A-Za-z_]\w*(?:\[[^\]]*\])?)\s*([+\-*/%])=\s*(.+?)\s*;\s*$/);
  if (m) return { line: err.start.line, before, after: `${ind}${m[1]} = ${m[1]} ${m[2]} (${m[3]});`, why: `MiniC has no compound assignment \`${m[2]}=\`; this is the equivalent plain assignment.` };
  return null;
}

// ------------------------------------------------------------------ completion
export type Completion = "complete" | "name-warnings" | "errors" | "empty";

/** "complete" only when every check IntelliFix implements passes on this exact text. */
export function completionOf(doc: RepairDoc | AnalyzeDoc): Completion {
  if (!doc.parse.ok) return "errors";
  if (!doc.tokens.length) return "empty";
  return doc.parse.name_warnings?.length ? "name-warnings" : "complete";
}

export const CHECKS_DONE = ["lexical analysis (every character forms a valid MiniC token)", "syntax (the LALR(1) parser accepts the whole program)", "name use (declared before use, no duplicates, functions called with the right number of arguments)"];
export const CHECKS_NOT_DONE = ["types (e.g. adding a bool to an int)", "run-time behaviour (the program is never executed)", "code generation (IntelliFix is a front end only)"];

/** Apply engine edits (UTF-8 byte offsets in `source`) to the text; null if the text does not match. */
export function applyEdits(source: string, edits: Edit[]): string | null {
  const enc = new TextEncoder(), dec = new TextDecoder();
  let b = enc.encode(source);
  for (const e of [...edits].sort((x, y) => y.at.offset - x.at.offset)) {
    const at = e.at.offset;
    const removed = e.op === "insert" ? 0 : enc.encode(e.removed_text ?? "").length;
    if (e.op !== "insert" && dec.decode(b.slice(at, at + removed)) !== e.removed_text) return null;
    const before = dec.decode(b.slice(0, at)), after = dec.decode(b.slice(at + removed));
    let text = e.op === "delete" ? "" : e.text ?? "";
    if (text && /\w$/.test(before) && /^\w/.test(text)) text = " " + text;
    if (text && /\w$/.test(text) && /^\w/.test(after)) text = text + " ";
    b = enc.encode(before + text + after);
  }
  return dec.decode(b);
}
