import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useProject } from "../../app/ProjectContext";
import { Badge, Disclosure } from "../../components/ui";
import { num } from "../../lib/format";

interface StageDoc {
  id: string;
  title: string;
  simple: string;
  technical: string;
  why: string;
  limits: string;
  input: string;
  output: string;
  route?: string;
  example: () => ReactNode;
}

export function LearningPage() {
  const p = useProject();
  const lex = p.lex?.envelope.data;
  const parse = p.parse?.envelope.data;
  const rep = p.repair?.envelope.data.repair;
  const top = rep?.candidates[0];
  const none = <span className="muted">Run a full analysis to see this stage on your program.</span>;

  const STAGES: StageDoc[] = [
    {
      id: "lexer", title: "1. Lexer", route: "/lexer",
      simple: "Reads the characters and groups them into words and symbols (tokens), like splitting a sentence into words.",
      technical: "A re-entrant Flex scanner with longest-match rules. It tracks byte offsets, lines and code-point columns; malformed input becomes ERROR/UNSUPPORTED tokens instead of aborting.",
      input: "source bytes", output: "token stream + comments + lexical errors",
      why: "The parser reasons about tokens, not characters; precise spans let every later stage point at exact source.",
      limits: "Only '\\n' starts a line; strings, preprocessor lines and ++ are recognised but unsupported.",
      example: () => (lex ? <span>{lex.tokens.length} tokens, {lex.lexical_errors.length} lexical errors; first tokens: <code>{lex.tokens.slice(0, 8).map((t) => t.lexeme).join(" ")}</code></span> : none),
    },
    {
      id: "grammar", title: "2. Grammar", route: "/parser",
      simple: "The rule book that says which token orders form a valid program.",
      technical: "A Bison grammar with explicit expression levels for precedence; one precedence declaration resolves the dangling else; %expect 0 makes any new conflict a build error.",
      input: "grammar/minic.y", output: "LALR(1) tables (parser.output report)",
      why: "Repairs are only meaningful relative to a precise grammar.",
      limits: "MiniC is a teaching subset of C (no pointers, structs, strings).",
      example: () => <span>See the rule list and LR states in <Link to="/parser">Grammar & parsing</Link>.</span>,
    },
    {
      id: "parser", title: "3. Parser and error localisation", route: "/parser",
      simple: "Checks the tokens against the rules and stops at the first token that cannot fit.",
      technical: "A pure Bison parser with LAC (lookahead correction), so the expected-token set at an error is exact. Diagnostics record the offending token, expected kinds and LR state.",
      input: "token stream", output: "AST or structured diagnostics",
      why: "The detection point anchors the repair search; the expected set tells us which insertions make grammatical sense.",
      limits: "Detection is often later than the cause (a missing ';' is noticed on the next line).",
      example: () => (parse ? (parse.parse.ok ? <span>Parses: AST with {parse.parse.ast_nodes} nodes.</span> : <span>{parse.parse.diagnostics[0].message} at {parse.parse.diagnostics[0].start.line}:{parse.parse.diagnostics[0].start.column}</span>) : none),
    },
    {
      id: "ast", title: "4. Parse tree vs. AST", route: "/ast",
      simple: "The AST is the program's meaning-carrying skeleton, without punctuation.",
      technical: "Bison actions build typed nodes in an arena; a canonical form (kinds + attributes + children, no spans) gives structural identity and a hash.",
      input: "reductions", output: "AST JSON, canonical hash",
      why: "Comparing repairs by AST tells whether two different edits produce the same program.",
      limits: "Empty statements are structural; no type checking.",
      example: () => (parse?.parse.ast_hash ? <span>AST hash <code>{parse.parse.ast_hash}</code>, depth {parse.parse.ast_depth}.</span> : none),
    },
    {
      id: "generation", title: "5. Candidate generation", route: "/repair",
      simple: "Try small fixes near the error: add, remove or swap one token (sometimes two).",
      technical: "For positions e−3…e the parser is probed for its exact expected set; insertions/replacements use those kinds, plus deletions. Layout generators propose ';' at line ends and braces at indentation changes further back. Cost-2 pairs are searched only if no single edit works.",
      input: "token stream, error index", output: "bounded candidate set",
      why: "Bounded, grammar-guided search keeps the number of candidates small and relevant.",
      limits: "Repairs outside the window and layout reach are not found; budgets bound time.",
      example: () => (rep ? <span>{rep.counts.single_edit} single-edit and {rep.counts.two_edit} two-edit candidates.</span> : none),
    },
    {
      id: "validation", title: "6. Parser-based validation", route: "/repair",
      simple: "Each fix is checked by running the real parser again.",
      technical: "Edits apply to the token stream; the source is rebuilt with original whitespace, re-lexed (must equal the edited stream) and re-parsed. A candidate is accepted only if parsing gets ≥3 tokens past the edit and past the original error.",
      input: "candidate edits", output: "accepted / rejected with reasons",
      why: "Prevents “fixes” that only move the error or silently change other tokens.",
      limits: "Syntax validity is not semantic correctness.",
      example: () => (rep ? <span>{rep.counts.accepted} accepted; outcomes: {Object.entries(rep.counts.by_outcome).map(([k, v]) => `${v} ${k}`).join(", ")}.</span> : none),
    },
    {
      id: "ranking", title: "7. Evidence ranking", route: "/repair",
      simple: "Each fix gets points for good signs and loses points for bad ones.",
      technical: "A fixed linear score of interpretable features (edit cost, completeness, invented content, deletions of user content, distance, layout, indentation consistency, name/arity warnings, residual errors, cascade, completion cost). Weights were set on the dev split only.",
      input: "accepted candidates", output: "scores with per-feature contributions",
      why: "Edit cost alone cannot tell ';' from ',' — context can.",
      limits: "Weights are hand-set, not learned; the score is not a probability.",
      example: () => (top ? <span>Top: <code>{top.summary}</code> score {num(top.score)} from {top.evidence.filter((e) => e.contribution !== 0).length} non-zero features.</span> : none),
    },
    {
      id: "grouping", title: "8. AST grouping", route: "/repair",
      simple: "Fixes that produce the same program are counted as one idea.",
      technical: "Candidates are grouped by identical canonical AST (or recovery-tree structure if later errors remain). Margins are measured between classes.",
      input: "ranked candidates", output: "equivalence classes",
      why: "Without grouping, equivalent fixes would look like competing alternatives.",
      limits: "Syntactically different but semantically equivalent programs (a+b vs b+a) stay separate.",
      example: () => (rep ? <span>{rep.counts.accepted} candidates in {rep.counts.classes} classes.</span> : none),
    },
    {
      id: "stability", title: "9. Hypothesis lanes & stability", route: "/hypotheses",
      simple: "For each idea, keep fixing the next errors and see which problems remain whatever you chose.",
      technical: "Up to 3 root classes are extended with up to 2 alternatives per later error, depth ≤ 4, ≤ 12 leaves. Follow-on error sites met under every hypothesis are reported as stable across the tested hypotheses.",
      input: "top classes", output: "lanes, leaves, stability table",
      why: "A first repair that makes later errors expensive is less plausible; stable errors are likely real.",
      limits: "Only explored hypotheses are compared; stability is evidence, not proof.",
      example: () => (rep ? <span>{rep.hypotheses.leaves.length} leaves; {rep.hypotheses.stability.filter((s) => s.stable).length} stable follow-on sites.</span> : none),
    },
    {
      id: "abstention", title: "10. Confidence & abstention", route: "/repair",
      simple: "If two different fixes look equally good, IntelliFix says so instead of guessing.",
      technical: "RECOMMENDED only if the plan is complete, invents nothing, and beats every structurally different alternative (at the root and each later step) by τ; τ is chosen on dev to keep selective risk ≤ 10%.",
      input: "class scores, plans", output: "decision status with reasons",
      why: "A wrong confident correction is worse than an honest “here are the options”.",
      limits: "τ did not fully transfer to test (see Evaluation); margins are not calibrated probabilities.",
      example: () => (rep ? <span>Status <Badge tone="neutral" icon={false}>{rep.decision.status}</Badge> margin {num(rep.decision.margin)} vs τ {rep.decision.tau}.</span> : none),
    },
    {
      id: "metrics", title: "11. Evaluation metrics", route: "/evaluation",
      simple: "We break known-good programs on purpose and check whether IntelliFix restores them.",
      technical: "Top-1/top-3 AST match against the original, exact token match, coverage, selective accuracy, wrong-and-confident rate, AURC, localisation, cost; Wilson intervals and paired bootstrap; dev/test split by program.",
      input: "benchmark cases", output: "summary.json, report.md",
      why: "Claims about improvement need measurements, including where the method does not help.",
      limits: "Synthetic mutations are not real student errors.",
      example: () => <span>See <Link to="/evaluation">Evaluation & impact</Link>.</span>,
    },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Learning center</h1>
          <p>The IntelliFix pipeline, one stage at a time. Each stage has a plain explanation, a technical one, and a live example from your latest run.</p>
        </div>
      </div>
      <div className="stack">
        {STAGES.map((s, i) => (
          <Disclosure key={s.id} open={i === 0} summary={<span className="row">{s.title} <span className="muted small">— {s.simple}</span></span>}>
            <div className="grid grid-2">
              <div className="stack small">
                <div><h4>Technical</h4><p>{s.technical}</p></div>
                <div><h4>Why it exists</h4><p>{s.why}</p></div>
                <div><h4>Known limitations</h4><p>{s.limits}</p></div>
              </div>
              <div className="stack small">
                <dl className="kv"><dt>Input</dt><dd>{s.input}</dd><dt>Output</dt><dd>{s.output}</dd></dl>
                <div className="panel panel-body"><h4 style={{ marginBottom: 4 }}>From your latest run</h4>{s.example()}</div>
                {s.route && <Link to={s.route} className="small">Open the related view →</Link>}
              </div>
            </div>
          </Disclosure>
        ))}
      </div>
    </>
  );
}
