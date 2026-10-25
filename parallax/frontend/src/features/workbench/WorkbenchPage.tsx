import { Eraser, FileUp, Play, RotateCcw, ScanText, Boxes, Undo2, Wand2, ArrowRight, GitCompare } from "lucide-react";
import { useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { useProject } from "../../app/ProjectContext";
import { AcceptRepair } from "../../components/AcceptRepair";
import { CodeEditor, type EditorHighlight } from "../../components/CodeEditor";
import { ExplainPanel, Rich } from "../../components/ExplainPanel";
import { SourceDiff } from "../../components/SourceDiff";
import { Banner, Badge, Disclosure, EmptyState, ErrorBanner, Panel, Spinner, StatusBadge } from "../../components/ui";
import { planWords } from "../../lib/explain";
import { ms } from "../../lib/format";
import { STATUS } from "../../lib/status";
import { RunSummary } from "./RunSummary";

const MAX_BYTES = 64 * 1024;

export function WorkbenchPage() {
  const p = useProject();
  const fileInput = useRef<HTMLInputElement>(null);
  const bytes = useMemo(() => new TextEncoder().encode(p.source).length, [p.source]);
  const example = p.examples.find((e) => e.id === p.origin.exampleId);

  const repairFresh = p.repair && !p.isStale(p.repair) ? p.repair.envelope.data : null;
  const parseFresh = p.parse && !p.isStale(p.parse) ? p.parse.envelope.data : null;
  const decision = repairFresh?.repair.decision;
  const plan = decision?.plans[0];

  const highlights: EditorHighlight[] = useMemo(() => {
    const out: EditorHighlight[] = [];
    const site = repairFresh?.repair.error_site ?? null;
    const diag = parseFresh?.parse.diagnostics[0];
    if (site) out.push({ from: site.start.offset, to: site.end.offset, tone: "error" });
    else if (diag) out.push({ from: diag.start.offset, to: diag.end.offset, tone: "error" });
    if (p.highlight) out.push({ from: p.highlight.from, to: p.highlight.to, tone: p.highlight.tone ?? "select" });
    return out;
  }, [repairFresh, parseFresh, p.highlight]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      alert(`${f.name} is ${f.size} bytes; the limit is ${MAX_BYTES} bytes.`);
      return;
    }
    p.loadSource(await f.text(), { kind: "file", label: f.name });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Code workbench</h1>
          <p>Type MiniC or load a sample, then press <strong>Analyze</strong>. The real Flex/Bison compiler and the IntelliFix repair engine explain what they find in plain language. Nothing is simulated.</p>
        </div>
      </div>

      <Panel
        title="Source"
        icon={ScanText}
        actions={
          <>
            <label className="sr-only" htmlFor="sample">Sample program</label>
            <select
              id="sample"
              className="select"
              value={p.origin.exampleId ?? ""}
              onChange={(e) => {
                const ex = p.examples.find((x) => x.id === e.target.value);
                if (ex) p.loadSource(ex.source, { kind: "example", label: `${ex.id}.mc`, exampleId: ex.id });
              }}
            >
              <option value="" disabled>
                {p.examples.length ? "Load a sample program…" : p.examplesError ? "Samples unavailable (backend offline)" : "Loading samples…"}
              </option>
              {p.examples.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title} — {STATUS[e.expected_status].short}
                </option>
              ))}
            </select>
            <input ref={fileInput} type="file" accept=".mc,.c,.txt" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            <button className="btn sm" onClick={() => fileInput.current?.click()}>
              <FileUp size={13} aria-hidden /> Open
            </button>
            <button className="btn sm" onClick={p.resetSource} disabled={p.source === p.baseline} title="Restore the source as loaded">
              <RotateCcw size={13} aria-hidden /> Reset
            </button>
            <button className="btn sm" onClick={() => p.loadSource("", { kind: "empty", label: "untitled.mc" })}>
              <Eraser size={13} aria-hidden /> Clear
            </button>
            <button className="btn sm" onClick={p.undo} disabled={!p.history.length} title="Undo the last accepted repair">
              <Undo2 size={13} aria-hidden /> Undo repair
            </button>
          </>
        }
        foot={
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>
              {bytes.toLocaleString()} / {MAX_BYTES.toLocaleString()} bytes · {p.source.split("\n").length} lines
            </span>
            {bytes > MAX_BYTES && <Badge tone="danger">Too large: the backend will reject this input</Badge>}
            <span className="row">
              <span className="tiny faint">Step by step:</span>
              <button className="btn sm" onClick={p.runLex} disabled={p.running.lex} title="Only the lexer: tokens and lexical errors">
                <ScanText size={13} aria-hidden /> Run lexer
              </button>
              <button className="btn sm" onClick={() => p.runParse(true)} disabled={p.running.parse} title="Lexer + parser: syntax errors and the AST">
                <Boxes size={13} aria-hidden /> Run parser
              </button>
              <button className="btn sm" onClick={p.runRepair} disabled={p.running.repair} title="Lexer + parser + repair engine">
                <Wand2 size={13} aria-hidden /> Repair suggestions
              </button>
              <button className="btn primary" onClick={p.runAll} disabled={p.running.lex || p.running.parse || p.running.repair} title="Lexer, parser and repair engine (Ctrl+Enter)">
                <Play size={14} aria-hidden /> Analyze
              </button>
            </span>
          </div>
        }
      >
        <div className="split">
          <CodeEditor value={p.source} onChange={(v) => p.setSource(v)} highlights={highlights} minHeight={360} />
          <div className="stack">
            {example && (
              <Banner tone="neutral" title={example.title}>
                {example.description} <span className="faint">Why it matters: {example.why}</span>
              </Banner>
            )}
            <ExplainPanel />
            {(p.errors.repair || p.errors.parse || p.errors.lex) && <ErrorBanner error={(p.errors.repair || p.errors.parse || p.errors.lex)!} onRetry={p.runAll} />}
            {p.running.repair && <Spinner label="Generating and validating repair candidates…" />}
            {!repairFresh && !p.running.repair && !p.errors.repair && (
              <div className="panel">
                <EmptyState icon={Play} title={p.repair && p.isStale(p.repair) ? "The code changed: analyze again" : "Press Analyze"} action={<button className="btn primary" onClick={p.runAll}><Play size={14} aria-hidden /> Analyze</button>}>
                  {p.repair && p.isStale(p.repair) ? "The explanation below the editor refers to the earlier text." : "IntelliFix will tell you whether the code is valid MiniC, where any error is, what was expected there and how it could be fixed."}
                </EmptyState>
              </div>
            )}
            {repairFresh && decision && (
              <>
                {plan && !["UNSUPPORTED_CONSTRUCT", "MULTIPLE_PLAUSIBLE", "LOW_CONFIDENCE"].includes(decision.status) && (
                  <Panel
                    title={decision.status === "RECOMMENDED" ? "Recommended repair" : "Top-ranked repair (not recommended)"}
                    actions={<AcceptRepair source={plan.source} edits={plan.edits} reason={plan.summary} />}
                  >
                    <div className="stack">
                      <div className="small">
                        <Rich text={planWords(plan).replace(/^./, (c) => c.toUpperCase())} /> · cost {plan.total_cost} · {plan.valid ? <Badge tone="success">parser-validated</Badge> : <Badge tone="warning">does not fully parse</Badge>}
                      </div>
                      <SourceDiff before={p.repair!.source} after={plan.source} maxHeight={240} />
                    </div>
                  </Panel>
                )}
                {decision.plans.length > 1 && (
                  <Disclosure summary={`Compare the ${decision.plans.length} structurally different repairs`}>
                    <div className="table-wrap">
                      <table className="table" data-testid="plan-compare">
                        <thead><tr><th>#</th><th>Change</th><th>Edit cost</th><th>Parses?</th><th></th></tr></thead>
                        <tbody>
                          {decision.plans.map((pl, i) => (
                            <tr key={i}>
                              <td>{i + 1}</td>
                              <td className="small"><Rich text={planWords(pl)} />{pl.edits.some((e) => e.placeholder) && <div className="tiny muted">contains an invented placeholder</div>}</td>
                              <td>{pl.total_cost}</td>
                              <td>{pl.valid ? <Badge tone="success">yes</Badge> : <Badge tone="warning">no</Badge>}</td>
                              <td><AcceptRepair source={pl.source} edits={pl.edits} reason={pl.summary} label="Use this" /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="tiny muted">
                      Ranked by the evidence score; the best leads the second by a margin of {decision.margin === null ? "n/a (only one class)" : decision.margin.toFixed(2)} (threshold τ = {decision.tau}). The margin is a score difference, not a probability, and “parses” means the real parser accepts the result — not that it is what you meant.{" "}
                      <Link to="/repair">See the evidence for every candidate <ArrowRight size={12} /></Link>
                    </p>
                  </Disclosure>
                )}
                <Disclosure summary="Technical details (engine decision, runs, pipeline)">
                  <div className="stack">
                    <Banner tone={STATUS[decision.status].tone} title={<span className="row"><StatusBadge status={decision.status} /> {decision.summary}</span>}>
                      {repairFresh.repair.error_site?.message && (
                        <div>Parser: <code>{repairFresh.repair.error_site.message}</code> at {repairFresh.repair.error_site.start.line}:{repairFresh.repair.error_site.start.column}</div>
                      )}
                      <ul className="hint-list">{decision.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                    </Banner>
                    <RunSummary />
                    <div className="pipeline" aria-label="Stages that ran">
                      {repairFresh.repair.stages.map((s, i) => (
                        <div key={s.name} className={`stage ${s.status === "ran" ? "ran" : "warn"}`} title={s.detail}>
                          <div className="n">{i + 1}</div>
                          <div className="t">{s.name}</div>
                          <div className="s">{ms(s.ms)}</div>
                        </div>
                      ))}
                    </div>
                    <div className="tiny muted">
                      {repairFresh.repair.budget.parser_invocations} parser invocations · engine {ms(repairFresh.repair.budget.elapsed_ms)} · end-to-end {ms(p.repair!.envelope.backend_ms)}
                    </div>
                  </div>
                </Disclosure>
                <div className="row">
                  <Link className="btn sm" to="/ast">AST explorer <ArrowRight size={13} /></Link>
                  <Link className="btn sm" to="/repair"><GitCompare size={13} /> Repair laboratory</Link>
                  <Link className="btn sm" to="/hypotheses">Hypothesis lanes <ArrowRight size={13} /></Link>
                  <Link className="btn sm" to="/parser">Parser view <ArrowRight size={13} /></Link>
                </div>
              </>
            )}
            {!repairFresh && <RunSummary />}
          </div>
        </div>
      </Panel>
    </>
  );
}
