import { Eraser, FileUp, Play, RotateCcw, ScanText, Boxes, Undo2, Wand2, ArrowRight } from "lucide-react";
import { useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { useProject } from "../../app/ProjectContext";
import { AcceptRepair } from "../../components/AcceptRepair";
import { CodeEditor, type EditorHighlight } from "../../components/CodeEditor";
import { SourceDiff } from "../../components/SourceDiff";
import { Banner, Badge, EmptyState, ErrorBanner, Panel, Spinner, StatusBadge } from "../../components/ui";
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
          <p>Write or load MiniC, then run the real Flex/Bison compiler and the IntelliFix repair engine. Every result below comes from the compiler; nothing is simulated.</p>
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
              <button className="btn sm" onClick={p.runLex} disabled={p.running.lex}>
                <ScanText size={13} aria-hidden /> Run lexer
              </button>
              <button className="btn sm" onClick={() => p.runParse(true)} disabled={p.running.parse}>
                <Boxes size={13} aria-hidden /> Run parser
              </button>
              <button className="btn sm" onClick={p.runRepair} disabled={p.running.repair}>
                <Wand2 size={13} aria-hidden /> Repair suggestions
              </button>
              <button className="btn primary sm" onClick={p.runAll} disabled={p.running.lex || p.running.parse || p.running.repair}>
                <Play size={13} aria-hidden /> Full analysis
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
            <RunSummary />
            {(p.errors.repair || p.errors.parse || p.errors.lex) && <ErrorBanner error={(p.errors.repair || p.errors.parse || p.errors.lex)!} onRetry={p.runAll} />}
            {p.running.repair && <Spinner label="Generating and validating repair candidates…" />}
            {!repairFresh && !p.running.repair && !p.errors.repair && (
              <div className="panel">
                <EmptyState icon={Play} title="Run an analysis" action={<button className="btn primary" onClick={p.runAll}><Play size={14} aria-hidden /> Full analysis</button>}>
                  {p.repair && p.isStale(p.repair) ? "The source changed since the last run." : "Lexing, parsing and repair run on the compiler; results appear here and in every section."}
                </EmptyState>
              </div>
            )}
            {repairFresh && decision && (
              <>
                <Banner
                  tone={STATUS[decision.status].tone}
                  title={
                    <span className="row">
                      <StatusBadge status={decision.status} /> {decision.summary}
                    </span>
                  }
                >
                  {repairFresh.repair.error_site?.message && (
                    <div>
                      Parser: <code>{repairFresh.repair.error_site.message}</code> at {repairFresh.repair.error_site.start.line}:{repairFresh.repair.error_site.start.column}
                    </div>
                  )}
                  <ul className="hint-list">
                    {decision.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </Banner>
                {plan && (
                  <Panel
                    title={decision.status === "RECOMMENDED" ? "Recommended repair" : "Top-ranked repair (not recommended)"}
                    actions={<AcceptRepair source={plan.source} edits={plan.edits} reason={plan.summary} />}
                  >
                    <div className="stack">
                      <div className="small">
                        <code>{plan.summary}</code> · cost {plan.total_cost} · {plan.valid ? <Badge tone="success">parser-validated</Badge> : <Badge tone="warning">does not fully parse</Badge>}
                      </div>
                      <SourceDiff before={p.repair!.source} after={plan.source} maxHeight={260} />
                    </div>
                  </Panel>
                )}
                <Panel title="Pipeline stages (this run)">
                  <div className="pipeline" aria-label="Stages that ran">
                    {repairFresh.repair.stages.map((s, i) => (
                      <div key={s.name} className={`stage ${s.status === "ran" ? "ran" : "warn"}`} title={s.detail}>
                        <div className="n">{i + 1}</div>
                        <div className="t">{s.name}</div>
                        <div className="s">{ms(s.ms)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="tiny muted" style={{ marginTop: 8 }}>
                    {repairFresh.repair.budget.parser_invocations} parser invocations · engine {ms(repairFresh.repair.budget.elapsed_ms)} · end-to-end {ms(p.repair!.envelope.backend_ms)}
                  </div>
                </Panel>
                <div className="row">
                  <Link className="btn sm" to="/repair">Inspect candidates <ArrowRight size={13} /></Link>
                  <Link className="btn sm" to="/hypotheses">Hypothesis lanes <ArrowRight size={13} /></Link>
                  <Link className="btn sm" to="/parser">Parser view <ArrowRight size={13} /></Link>
                  <Link className="btn sm" to="/ast">AST <ArrowRight size={13} /></Link>
                </div>
              </>
            )}
          </div>
        </div>
      </Panel>
    </>
  );
}
