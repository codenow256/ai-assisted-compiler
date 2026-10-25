// Workspace: one connected repair journey on real compiler output.
//   1 Code → 2 Diagnosis → 3 Fixes (compare · resolve ambiguity) → 4 Tree → 5 Apply & verify
// The step indicator always shows where the user is, what is done and what is
// not applicable; each step ends with the most useful next action.
import { ArrowRight, Check, Eraser, FileUp, ListTree, Play, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useProject } from "../../app/ProjectContext";
import { AstOutline } from "../../components/AstOutline";
import { CodeEditor, type EditorHighlight } from "../../components/CodeEditor";
import { SourceDiff } from "../../components/SourceDiff";
import { Badge, Banner, ErrorBanner, Spinner } from "../../components/ui";
import { countNodes } from "../../lib/astModel";
import { explain } from "../../lib/explain";
import { CATEGORY, classifyError, classifyInput, compareDiagnostics, type InputCategory } from "../../lib/journey";
import { STATUS } from "../../lib/status";
import type { AnalyzeDoc, RepairDoc } from "../../types/api";
import { TreeComparison } from "../ast/AstPage";
import { Diagnosis, type Practice } from "./Diagnosis";
import { Fixes } from "./Fixes";

const MAX_BYTES = 64 * 1024;

/** Extra teaching samples (source text only; results always come from the compiler). */
export const LOCAL_SAMPLES = [
  { id: "local_missing_rhs", title: "Missing expression after +", source: "int main() {\n  int price = 5;\n  int total = price + ;\n  return total;\n}\n" },
  { id: "local_unterminated", title: "Unterminated comment", source: "int main() {\n  int x = 1;\n  /* the comment never ends\n  return x;\n}\n" },
];

type StepId = 1 | 2 | 3 | 4 | 5;
type StepState = "done" | "current" | "todo" | "skip";
const STEP_TITLE: Record<StepId, string> = { 1: "Code", 2: "Diagnosis", 3: "Fixes", 4: "Tree", 5: "Apply & verify" };

export function WorkspacePage() {
  const p = useProject();
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<StepId>(1);
  const [practice, setPractice] = useState<Practice | null>(null);
  const bytes = useMemo(() => new TextEncoder().encode(p.source).length, [p.source]);
  const example = p.examples.find((e) => e.id === p.origin.exampleId);

  // newest real result: the repair run (it contains lexer + parser output) unless a newer parse exists
  const run = (() => {
    const r = p.repair, a = p.parse;
    if (r && (!a || a.source === r.source || r.at >= a.at)) return { doc: r.envelope.data as RepairDoc | AnalyzeDoc, source: r.source, repair: true };
    return a ? { doc: a.envelope.data as RepairDoc | AnalyzeDoc, source: a.source, repair: false } : null;
  })();
  const fresh = !!run && run.source === p.source;
  const busy = p.running.lex || p.running.parse || p.running.repair;
  const err = p.errors.repair || p.errors.parse || p.errors.lex;
  const ex = useMemo(() => (run ? explain(run.doc, run.source) : null), [run?.doc, run?.source]); // eslint-disable-line react-hooks/exhaustive-deps
  const category: InputCategory | null = err && !busy ? classifyError(err) : run ? classifyInput(run.doc, run.source) : null;
  const valid = !!run?.doc.parse.ok;
  const repairDoc = run?.repair ? (run.doc as RepairDoc) : null;

  // Move forward automatically only when a fresh analysis arrives from the Code step, or after applying a fix.
  const lastRun = useRef<number | null>(null);
  useEffect(() => {
    const at = p.repair?.at ?? null;
    if (at && at !== lastRun.current) {
      lastRun.current = at;
      if (step === 1) setStep(2);
    }
  }, [p.repair?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastHistory = p.history[p.history.length - 1];
  const states: Record<StepId, StepState> = {
    1: run ? "done" : "current",
    2: run ? "done" : "todo",
    3: !run ? "todo" : valid && !p.history.length ? "skip" : p.proposal || p.history.length ? "done" : "todo",
    4: !run ? "todo" : p.proposal || valid ? "done" : "todo",
    5: p.history.length && fresh && valid ? "done" : "todo",
  };
  states[step] = "current";
  const sub: Record<StepId, string> = {
    1: p.source.trim() ? `${p.source.split("\n").length} lines` : "empty",
    2: category ? CATEGORY[category].label : "not analyzed",
    3: !run ? "—" : valid && !p.history.length ? "not needed" : valid ? "fix applied" : p.proposal ? "fix chosen" : repairDoc ? `${repairDoc.repair.decision.plans.length} option(s)` : "—",
    4: valid ? "complete AST" : run ? (p.proposal ? "before → after" : "partial tree") : "—",
    5: p.history.length ? (valid && fresh ? "verified" : "applied") : p.proposal ? "ready to apply" : "—",
  };

  const highlights: EditorHighlight[] = useMemo(() => {
    const out: EditorHighlight[] = [];
    const d = fresh ? run?.doc.parse.diagnostics[0] : undefined;
    if (d) out.push({ from: d.start.offset, to: d.end.offset, tone: "error" });
    if (p.highlight) out.push({ from: p.highlight.from, to: p.highlight.to, tone: p.highlight.tone ?? "select" });
    return out;
  }, [fresh, run?.doc, p.highlight]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSample = (id: string) => {
    const ex = p.examples.find((x) => x.id === id);
    const local = LOCAL_SAMPLES.find((x) => x.id === id);
    if (ex) p.loadSource(ex.source, { kind: "example", label: `${ex.id}.mc`, exampleId: ex.id });
    else if (local) p.loadSource(local.source, { kind: "example", label: `${local.id}.mc` });
    setPractice(null);
    setStep(1);
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_BYTES) { alert(`${f.name} is ${f.size} bytes; the limit is ${MAX_BYTES} bytes.`); return; }
    p.loadSource(await f.text(), { kind: "file", label: f.name });
    setStep(1);
  };
  // On narrow screens the step panel sits below the editor: bring it into view when the step changes.
  const stepPanel = useRef<HTMLElement>(null);
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return; }
    if (window.innerWidth < 1100) stepPanel.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [step]);
  const analyze = () => { if (step === 5 || step === 1) setStep(1); void p.runAll(); };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Workspace</h1>
          <p>Write MiniC (a small subset of C), press <strong>Analyze</strong>, then follow the steps. Every result comes from the real Flex/Bison compiler and the IntelliFix repair engine.</p>
        </div>
      </div>

      <ol className="stepper" aria-label="Repair journey">
        {([1, 2, 3, 4, 5] as StepId[]).map((s) => (
          <li key={s} className={`st-${states[s]}`}>
            <button onClick={() => setStep(s)} aria-current={step === s ? "step" : undefined} disabled={s > 1 && !run && !err}>
              <span className="st-n" aria-hidden>{states[s] === "done" ? <Check size={13} /> : s}</span>
              <span className="st-t">{STEP_TITLE[s]}<span className="st-s">{sub[s]}</span></span>
            </button>
          </li>
        ))}
      </ol>

      <div className="ws">
        <section className="panel ws-editor" aria-label="Code">
          <div className="panel-head">
            <h2>Your code</h2>
            <div className="actions">
              <label className="sr-only" htmlFor="sample">Sample program</label>
              <select id="sample" className="select" value={p.origin.exampleId ?? ""} onChange={(e) => loadSample(e.target.value)}>
                <option value="" disabled>{p.examples.length ? "Load a sample…" : p.examplesError ? "Samples unavailable (backend offline)" : "Loading samples…"}</option>
                {p.examples.map((e) => <option key={e.id} value={e.id}>{e.title} — {STATUS[e.expected_status].short}</option>)}
                {p.examples.length > 0 && LOCAL_SAMPLES.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
              <input ref={fileInput} type="file" accept=".mc,.c,.txt" hidden onChange={(e) => onFile(e.target.files?.[0])} />
              <button className="btn sm icon" onClick={() => fileInput.current?.click()} aria-label="Open a file" title="Open a file"><FileUp size={14} /></button>
              <button className="btn sm icon" onClick={() => { p.loadSource("", { kind: "empty", label: "untitled.mc" }); setStep(1); }} aria-label="Clear" title="Clear the editor"><Eraser size={14} /></button>
              {p.history.length > 0 && <button className="btn sm" onClick={() => p.undo({ reanalyze: true })} title="Undo the last applied fix"><Undo2 size={13} aria-hidden /> Undo repair</button>}
            </div>
          </div>
          <div className="panel-body stack">
            {example && <p className="tiny muted"><strong>{example.title}.</strong> {example.description}</p>}
            <CodeEditor value={p.source} onChange={(v) => p.setSource(v)} highlights={highlights} minHeight={320} maxHeight={560} />
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="tiny muted">{bytes.toLocaleString()} / {MAX_BYTES.toLocaleString()} bytes{bytes > MAX_BYTES && <> · <Badge tone="danger">too large</Badge></>}</span>
              <span className="row">
                {run && !fresh && !busy && <span className="tiny warn-text">changed since the last analysis</span>}
                <span className="tiny faint kbd-hint"><span className="kbd">Ctrl</span>+<span className="kbd">Enter</span></span>
                <button className="btn primary" onClick={analyze} disabled={busy} data-testid="analyze">
                  <Play size={14} aria-hidden /> {busy ? "Analyzing…" : "Analyze"}
                </button>
              </span>
            </div>
          </div>
        </section>

        <section ref={stepPanel} className="panel ws-step" aria-label={`Step ${step}: ${STEP_TITLE[step]}`} aria-live="polite">
          <div className="panel-head"><h2><span className="faint">Step {step}</span> {STEP_TITLE[step]}</h2>
            {busy && <div className="actions"><Spinner label="Running the compiler…" /></div>}
          </div>
          <div className="panel-body stack-lg">
            {run && !fresh && !busy && step !== 1 && !(practice && step === 2) && (
              <Banner tone="neutral" title="You changed the code since this analysis" actions={<button className="btn sm primary" onClick={() => void p.runAll()}>Analyze again</button>}>The steps below describe the earlier text.</Banner>
            )}
            {err && !busy && category && (
              <p className="small"><strong>{CATEGORY[category].label}.</strong> {CATEGORY[category].establishes} {CATEGORY[category].next}</p>
            )}
            {err && !busy && <ErrorBanner error={err} onRetry={() => void p.runAll()} />}

            {step === 1 && <StepCode onAnalyze={analyze} hasRun={!!run} busy={busy} onSample={loadSample} />}
            {step === 2 && run && ex && category && (
              <Diagnosis doc={run.doc} source={run.source} ex={ex} category={category} practice={practice} setPractice={setPractice} onLoadSample={() => loadSample(p.examples[0]?.id ?? LOCAL_SAMPLES[0].id)} />
            )}
            {step === 3 && run && (repairDoc ? <Fixes doc={repairDoc} source={run.source} onChosen={() => setStep(4)} onPractice={() => { setPractice({ line: run.doc.parse.diagnostics[0]?.start.line ?? 1, source: run.source }); setStep(2); }} /> : <Banner tone="neutral" title="The repair engine has not run for this code">Press Analyze to generate and check repair candidates.</Banner>)}
            {step === 4 && run && <StepTree valid={valid} source={run.source} />}
            {step === 5 && <StepVerify fresh={fresh} validNow={valid} lastDiagnostics={lastHistory?.diagnostics ?? null} onUndo={() => { p.undo({ reanalyze: true }); setStep(2); }} />}

            {step < 5 && run && !err && (
              <div className="step-nav">
                {step > 1 && <button className="btn sm ghost" onClick={() => setStep((step - 1) as StepId)}>← {STEP_TITLE[(step - 1) as StepId]}</button>}
                <span className="spacer" />
                <NextButton step={step} states={states} setStep={setStep} />
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function NextButton({ step, states, setStep }: { step: StepId; states: Record<StepId, StepState>; setStep: (s: StepId) => void }) {
  let next = (step + 1) as StepId;
  while (next < 5 && states[next] === "skip") next = (next + 1) as StepId;
  const label: Record<StepId, string> = { 1: "", 2: "See the diagnosis", 3: "Compare fixes", 4: "Inspect the tree", 5: "Apply & verify" };
  return <button className="btn primary sm" onClick={() => setStep(next)}>{label[next]} <ArrowRight size={13} aria-hidden /></button>;
}

function StepCode({ onAnalyze, hasRun, busy, onSample }: { onAnalyze: () => void; hasRun: boolean; busy: boolean; onSample: (id: string) => void }) {
  const p = useProject();
  const picks = [["02_missing_semicolon", "missing semicolon"], ["local_missing_rhs", "ambiguous: `price + ;`"], ["06_multiple_errors", "two errors"], ["01_valid_basic", "valid program"]] as const;
  return (
    <div className="stack">
      <p className="small">IntelliFix reads your code in the same order a compiler does: the <strong>lexer</strong> turns characters into tokens, the <strong>parser</strong> checks those tokens against the grammar and builds a tree, and — if the parser gets stuck — the <strong>repair engine</strong> tries small edits and re-runs the parser on each one.</p>
      <p className="small">Type in the editor, or start from an example:</p>
      <div className="row">{picks.map(([id, label]) => (p.examples.some((e) => e.id === id) || LOCAL_SAMPLES.some((e) => e.id === id)) && <button key={id} className="btn sm" onClick={() => onSample(id)}>{label.replace(/`/g, "")}</button>)}</div>
      <div><button className="btn primary" onClick={onAnalyze} disabled={busy}><Play size={14} aria-hidden /> {busy ? "Analyzing…" : hasRun ? "Analyze again" : "Analyze"}</button></div>
    </div>
  );
}

function StepTree({ valid, source }: { valid: boolean; source: string }) {
  const p = useProject();
  const ast = p.parse && p.parse.source === source ? p.parse.envelope.data.parse.ast : null;
  const partial = p.parse && p.parse.source === source ? p.parse.envelope.data.parse.recovered_ast : null;
  if (p.proposal && p.proposal.forSource === source) {
    return (
      <div className="stack">
        <p className="small">How your chosen fix (<strong>{p.proposal.label}</strong>) changes the tree. Both programs were parsed by the compiler.</p>
        <TreeComparison before={source} after={p.proposal.source} edits={p.proposal.edits.length ? [{ side: "your chosen fix", edits: p.proposal.edits }] : []} compact />
        <div className="row"><Link className="btn sm" to="/ast"><ListTree size={13} aria-hidden /> Open in the AST Explorer</Link></div>
      </div>
    );
  }
  if (valid && ast) {
    return (
      <div className="stack">
        <p className="small">The parser built this tree ({countNodes(ast)} nodes). Indentation shows what contains what: the program contains functions, a function contains its body block, a block contains statements, statements contain expressions.</p>
        <div className="outline-wrap" style={{ maxHeight: 360 }}><AstOutline root={ast} expandDepth={4} compact label="AST preview" /></div>
        <div className="row"><Link className="btn primary sm" to="/ast"><ListTree size={13} aria-hidden /> Explore it node by node</Link></div>
      </div>
    );
  }
  return (
    <div className="stack">
      <Banner tone="warning" title="No complete tree yet">Code with syntax errors has only a partial tree. Choose a fix in step 3 to compare the partial tree with the repaired program's complete tree.</Banner>
      {partial && <div className="outline-wrap" style={{ maxHeight: 300 }}><AstOutline root={partial} expandDepth={4} compact label="Partial tree" /></div>}
      <div className="row"><Link className="btn sm" to="/ast"><ListTree size={13} aria-hidden /> Open the partial tree in the AST Explorer</Link></div>
    </div>
  );
}

function StepVerify({ fresh, validNow, lastDiagnostics, onUndo }: { fresh: boolean; validNow: boolean; lastDiagnostics: import("../../types/api").Diagnostic[] | null; onUndo: () => void }) {
  const p = useProject();
  const prop = p.proposal && p.proposal.forSource === p.source ? p.proposal : null;
  if (prop) {
    return (
      <div className="stack">
        <p className="small">Your chosen fix: <strong>{prop.label}</strong>. This is the change it makes to your code:</p>
        <SourceDiff before={p.source} after={prop.source} maxHeight={260} />
        <Banner tone={prop.parses ? "success" : "warning"} title={prop.parses ? "The real parser accepts the repaired program" : "The repaired program still has errors"}>
          Parser validity is a syntax check only: it does not prove the program does what you intended. Your original stays in the undo history.
        </Banner>
        <div className="row">
          <button className="btn primary" onClick={() => p.applyRepair(prop.source, prop.label, { reanalyze: true })} data-testid="apply"><Check size={14} aria-hidden /> Apply to my code</button>
          <button className="btn sm" onClick={() => p.setProposal(null)}>Discard this choice</button>
        </div>
      </div>
    );
  }
  if (p.history.length) {
    const nowDiags = p.parse && p.parse.source === p.source ? p.parse.envelope.data.parse.diagnostics : null;
    const cmp = lastDiagnostics && nowDiags ? compareDiagnostics(lastDiagnostics, nowDiags) : null;
    const last = p.history[p.history.length - 1];
    return (
      <div className="stack" data-testid="verify">
        {!fresh || !nowDiags ? <Spinner label="Re-running the compiler on the repaired code…" /> : validNow ? (
          <Banner tone="success" title="Verified: the compiler re-parsed your code and accepts it">The fix “{last.reason}” was applied and the lexer, parser and repair engine ran again on the new text.</Banner>
        ) : (
          <Banner tone="warning" title="Applied, but the parser still reports errors">The fix “{last.reason}” was applied and the code re-analyzed. Go back to step 2 for the remaining problem.</Banner>
        )}
        {cmp && (
          <div className="verify-grid">
            <div><strong className="small">Disappeared ({cmp.fixed.length})</strong><ul className="hint-list small">{cmp.fixed.map((d, i) => <li key={i} className="gone">{d.message} <span className="faint">(was line {d.start.line})</span></li>)}</ul></div>
            <div><strong className="small">Still reported ({cmp.remaining.length})</strong><ul className="hint-list small">{cmp.remaining.length ? cmp.remaining.map((d, i) => <li key={i}>{d.message} <span className="faint">(line {d.start.line})</span></li>) : <li className="faint">none</li>}</ul></div>
            <div><strong className="small">New ({cmp.added.length})</strong><ul className="hint-list small">{cmp.added.length ? cmp.added.map((d, i) => <li key={i}>{d.message} <span className="faint">(line {d.start.line})</span></li>) : <li className="faint">none</li>}</ul></div>
          </div>
        )}
        {cmp && <p className="tiny faint">Reports are matched by their message, because line and column numbers shift after an edit.</p>}
        <div className="row">
          <button className="btn sm" onClick={onUndo}><Undo2 size={13} aria-hidden /> Undo repair</button>
          <Link className="btn sm" to="/ast"><ListTree size={13} aria-hidden /> Compare the trees</Link>
        </div>
      </div>
    );
  }
  return <Banner tone="neutral" title="Nothing to apply yet">Choose a fix in step 3, or fix the code yourself with the hints in step 2 and press Check my fix.</Banner>;
}
