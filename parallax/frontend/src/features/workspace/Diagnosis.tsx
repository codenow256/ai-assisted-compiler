// Step 2 — Diagnosis. What the compiler found, in order: the lexer (characters
// → tokens), the parser (tokens → grammar), the first reliable error and the
// later reports with evidence about whether they depend on it, then hints
// and a "Check my fix" loop that re-runs the real compiler.
import { Lightbulb, ListTree, MapPin, PencilLine } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useProject } from "../../app/ProjectContext";
import { Rich } from "../../components/Rich";
import { Badge, Banner, Disclosure } from "../../components/ui";
import type { Explanation } from "../../lib/explain";
import { CATEGORY, ROLE_LABEL, diagnosticRoles, practiceFeedback, type InputCategory } from "../../lib/journey";
import type { AnalyzeDoc, RepairDoc } from "../../types/api";
import { RunSummary } from "./RunSummary";

export interface Practice { line: number; source: string }

export function Diagnosis({ doc, source, ex, category, practice, setPractice, onLoadSample }: {
  doc: RepairDoc | AnalyzeDoc; source: string; ex: Explanation; category: InputCategory;
  practice: Practice | null; setPractice: (p: Practice | null) => void; onLoadSample: () => void;
}) {
  const p = useProject();
  const [hints, setHints] = useState(0);
  useEffect(() => setHints(0), [ex.headline, ex.location?.from]);
  const roles = diagnosticRoles(doc);
  const lexErrs = doc.lexical_errors;
  const d0 = doc.parse.diagnostics[0];
  const meta = CATEGORY[category];
  const feedback = practice && p.parse && !p.isStale(p.parse) && p.parse.source !== practice.source ? practiceFeedback(practice.line, doc) : null;
  const noProgram = category === "empty" || category === "whitespace" || category === "comments-only";

  return (
    <div className="stack-lg" data-testid="explanation">
      <div className="stack" style={{ gap: 6 }}>
        <div className="row"><Badge tone={ex.tone === "success" ? "success" : ex.tone === "danger" ? "danger" : ex.tone === "info" ? "info" : "warning"} icon={false}>{meta.label}</Badge><span className="tiny muted"><Rich text={meta.establishes} /></span></div>
        <h3 className={`diag-head tone-text-${ex.tone}`}><Rich text={ex.headline} /></h3>
        {ex.paragraphs.map((t, i) => <p key={i} className="small"><Rich text={t} /></p>)}
        {ex.location && (
          <button className="loc" onClick={() => p.setHighlight({ from: ex.location!.from, to: ex.location!.to, tone: "error" })} title="Highlight in the editor">
            <MapPin size={13} aria-hidden /> line {ex.location.line}, column {ex.location.column}: <code>{ex.location.lineText.trim() || "(empty line)"}</code>
          </button>
        )}
        {ex.expected && <p className="small"><strong>Expected here:</strong> <Rich text={ex.expected} /></p>}
        {noProgram && <div><button className="btn sm" onClick={onLoadSample}>Load a sample program</button></div>}
      </div>

      {/* the two front-end phases, as they actually ran */}
      {!noProgram && (
        <div className="phases" aria-label="How the compiler read your code">
          <div className={`phase ${lexErrs.length ? "bad" : "good"}`}>
            <div className="phase-name">1 · Lexer</div>
            <div className="small">{doc.tokens.length} tokens{lexErrs.length ? `, ${lexErrs.length} lexical error(s)` : ", every character is valid"}</div>
            <div className="tiny muted">Groups characters into tokens (names, numbers, operators). Spelling only — not order.</div>
          </div>
          <div className="phase-arrow" aria-hidden>→</div>
          <div className={`phase ${doc.parse.ok ? "good" : "bad"}`}>
            <div className="phase-name">2 · Parser</div>
            <div className="small">{doc.parse.ok ? `accepted; built an AST of ${doc.parse.ast_nodes ?? "?"} nodes` : doc.parse.resource_limit ? "stopped: nesting limit" : `stopped at line ${d0?.start.line}, column ${d0?.start.column}`}</div>
            <div className="tiny muted">Checks the order of tokens against MiniC's grammar (LALR(1), Bison).</div>
          </div>
          <div className="phase-arrow" aria-hidden>→</div>
          <div className="phase neutral">
            <div className="phase-name">3 · Meaning</div>
            <div className="small">not checked</div>
            <div className="tiny muted">Types and behaviour are semantic questions; IntelliFix checks syntax (and name use).</div>
          </div>
        </div>
      )}

      {ex.facts && ex.facts.length > 0 && (
        <div className="small"><strong>What your program contains</strong> <span className="tiny faint">(read from the AST)</span>
          <ul className="hint-list">{ex.facts.map((f) => <li key={f}><Rich text={f} /></li>)}</ul>
        </div>
      )}
      {ex.unknowns && <ul className="hint-list tiny muted">{ex.unknowns.map((u) => <li key={u}>{u}</li>)}</ul>}

      {roles.length > 1 && (
        <section className="stack" aria-label="Error reports">
          <h3 className="section-title">{roles.length} error reports — which one matters?</h3>
          <p className="tiny muted">After the first error the parser skips ahead to recover and keeps reporting. Later reports can be real mistakes or side effects of the first.</p>
          <ol className="cascade">
            {roles.map((r, i) => (
              <li key={i} className={`cascade-${r.role}`}>
                <div className="row">
                  <button className="linklike" onClick={() => p.setHighlight({ from: r.diag.start.offset, to: Math.max(r.diag.end.offset, r.diag.start.offset + 1), tone: "error" })}>line {r.diag.start.line}:{r.diag.start.column}</button>
                  <span className="small">{r.diag.message}</span>
                  <Badge tone={r.role === "first" ? "danger" : r.role === "likely-consequence" ? "neutral" : r.role === "likely-separate" ? "warning" : "neutral"} icon={false}>{ROLE_LABEL[r.role]}</Badge>
                </div>
                <div className="tiny muted">{r.evidence}</div>
              </li>
            ))}
          </ol>
          <p className="tiny faint">These are all the errors the parser can report for this version of the code. More may become visible once earlier ones are fixed. Step 3 offers fixes for the first error; after you apply one, the whole program is analyzed again and step 5 shows which reports are no longer reported, which remain and which are newly visible.</p>
        </section>
      )}

      {ex.hints && (
        <section className="hints" aria-label="Fix it yourself">
          <div className="row">
            <strong className="small"><Lightbulb size={13} aria-hidden /> Fix it yourself</strong>
            {hints < ex.hints.length && <button className="btn sm" onClick={() => setHints((h) => h + 1)}>{hints === 0 ? "Show a hint" : "Next hint"} ({hints + 1}/{ex.hints.length})</button>}
            {!practice && <button className="btn sm" onClick={() => setPractice({ line: ex.location?.line ?? 1, source })}><PencilLine size={13} aria-hidden /> I'll try it in the editor</button>}
          </div>
          {hints > 0 && (
            <ol className="hint-steps small">
              {ex.hints.slice(0, hints).map((h, i) => <li key={i}><span className="tiny faint">{["Where", "What MiniC expects", "Fixes the parser accepted"][i] ?? "Hint"}: </span><Rich text={h} /></li>)}
            </ol>
          )}
        </section>
      )}
      {practice && (
        <section className="hints stack" data-testid="practice" aria-label="Check my fix">
          <p className="small">Edit the code on the left, then press <strong>Check my fix</strong>. The real compiler checks it.</p>
          <div className="row">
            <button className="btn primary sm" onClick={p.runAll} disabled={p.source === practice.source || p.running.parse}>Check my fix</button>
            <button className="btn sm" onClick={() => setPractice(null)}>Stop practising</button>
          </div>
          {p.parse && p.parse.source !== p.source && p.source !== practice.source && <p className="tiny warn-text">The explanation above still describes the earlier text until you press Check my fix.</p>}
          {feedback && <Banner tone={feedback.tone} title={feedback.title}>{feedback.body}</Banner>}
        </section>
      )}

      <div className="next small"><strong>Next:</strong> {ex.nextSteps.map((s, i) => <span key={i}><Rich text={s} />{i < ex.nextSteps.length - 1 ? " " : ""}</span>)}</div>

      <Disclosure summary="Compiler internals: tokens, parser state, every candidate">
        <div className="stack">
          <RunSummary />
          <div className="row small">
            <Link className="btn sm" to="/lexer">Token table</Link>
            <Link className="btn sm" to="/parser">Parser state &amp; expected tokens</Link>
            <Link className="btn sm" to="/repair">All candidates &amp; evidence</Link>
            <Link className="btn sm" to="/hypotheses">Hypothesis lanes</Link>
            <Link className="btn sm" to="/ast"><ListTree size={13} aria-hidden /> AST Explorer</Link>
          </div>
          <div className="row small">
            <span className="tiny faint">Run one stage at a time:</span>
            <button className="btn sm" onClick={p.runLex} disabled={p.running.lex}>Run lexer</button>
            <button className="btn sm" onClick={() => p.runParse(true)} disabled={p.running.parse}>Run parser</button>
            <button className="btn sm" onClick={p.runRepair} disabled={p.running.repair}>Run repair engine</button>
          </div>
        </div>
      </Disclosure>
    </div>
  );
}
