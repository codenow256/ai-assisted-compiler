// The Workspace journey: one response flow for every input, built only from
// real compiler output (tokens, diagnostics, candidates, classes, plans).
//
//   classifyInput     which kind of input this is, what can be established, what to do next
//   describeAmbiguity what exactly is ambiguous, and the targeted question to ask
//   diagnosticRoles   first error vs. later reports, with the evidence for "likely consequence"
//   planCards         comparison data for each structurally different repair
//   compareDiagnostics which diagnostics disappeared / remain after an edit (re-parse)
//   practiceFeedback  feedback on a student's own fix, from a real re-parse
import type { AnalyzeDoc, Candidate, Diagnostic, Edit, Plan, RepairDoc } from "../types/api";
import type { ApiError } from "../services/api";
import { describeExpected, planWords } from "./explain";
import { lineDiff } from "./diff";

type Doc = RepairDoc | AnalyzeDoc;
const repairOf = (doc: Doc) => ("repair" in doc ? doc.repair : null);

// ------------------------------------------------------------------ input categories
export type InputCategory =
  | "valid" | "empty" | "whitespace" | "comments-only"
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
  valid: { label: "Valid MiniC", establishes: "The parser accepted every token and built a complete AST.", next: "Inspect the tree to see how the program is structured." },
  empty: { label: "Empty input", establishes: "There is no program to analyze.", next: "Load a sample or type a MiniC program." },
  whitespace: { label: "Only whitespace", establishes: "There is no program to analyze: the text contains only spaces or line breaks.", next: "Load a sample or type a MiniC program." },
  "comments-only": { label: "Only comments", establishes: "The lexer skipped the comments; no tokens remain, so the program is empty.", next: "Write code outside the comments." },
  "missing-delimiter": { label: "Missing delimiter", establishes: "One small insertion makes the whole program parse, and it clearly beats the alternatives.", next: "Compare the fix with its alternatives, then apply it or fix it yourself." },
  "missing-content": { label: "Missing expression or name", establishes: "Something is missing here, but its content cannot be recovered from the code.", next: "Tell IntelliFix what you meant: type the missing part." },
  ambiguous: { label: "Ambiguous repair", establishes: "Several structurally different fixes parse, with similar evidence.", next: "Answer the question: which change did you mean?" },
  "multiple-errors": { label: "Several syntax errors", establishes: "The first error is reliable; later reports may be consequences of it.", next: "Fix the first error, then re-check which reports remain." },
  lexical: { label: "Invalid characters", establishes: "The lexer found characters that are not part of MiniC, before parsing.", next: "Replace or delete the highlighted character." },
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
    return "valid";
  }
  if (parse.resource_limit) return "resource-limit";
  const rep = repairOf(doc);
  const status = rep?.decision.status;
  const lex = doc.lexical_errors;
  if (lex.some((e) => e.kind === "UNSUPPORTED") && (status === "UNSUPPORTED_CONSTRUCT" || !rep)) return "unsupported";
  if (lex.some((e) => /unterminated block comment/.test(e.message))) return "unterminated-comment";
  if (lex.length) return "lexical";
  const d = parse.diagnostics[0];
  if (d && (d.unexpected === "EOF" || d.message.startsWith("unexpected end of input"))) return "incomplete-code";
  const plans = rep?.decision.plans ?? [];
  const top = plans[0];
  if (parse.diagnostics.length > 1 || (top?.valid && top.edits.length > 1)) return "multiple-errors";
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
