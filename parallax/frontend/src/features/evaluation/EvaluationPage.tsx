/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChartColumnBig, Download, ExternalLink, FlaskConical, Table2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProject } from "../../app/ProjectContext";
import { GroupedBars, LineChart } from "../../components/charts";
import { Badge, Banner, Disclosure, EmptyState, ErrorBanner, Panel, Spinner, Stat, Tabs } from "../../components/ui";
import { downloadText, num, pct } from "../../lib/format";
import { ApiError, api, type EvaluationResultsResponse, type LiveEvaluation } from "../../services/api";

type Split = "test" | "dev";
const REPAIR_IDS = ["P", "F", "E", "D", "L", "C"];

const ci = (m: any) => (m && m.rate !== null ? `${pct(m.rate)} [${pct(m.ci95[0])}, ${pct(m.ci95[1])}]` : "n/a");

export function EvaluationPage() {
  const [data, setData] = useState<EvaluationResultsResponse | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [split, setSplit] = useState<Split>("test");
  const [view, setView] = useState<"charts" | "tables">("charts");

  const load = () =>
    api
      .evaluationResults()
      .then((d) => {
        setData(d);
        setErr(null);
      })
      .catch((e) => setErr(e instanceof ApiError ? e : new ApiError("BACKEND_FAILURE", String(e))));
  useEffect(() => {
    load();
  }, []);

  const s = data?.summary;
  const r = s?.[split];
  const names: Record<string, string> = useMemo(() => Object.fromEntries((s?.systems ?? []).map((x: any) => [x.id, x.name])), [s]);
  const g = s?.cpctplus?.[split]?.[0];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Evaluation & impact</h1>
          <p>Measured results of the experiment harness: every system is a real run of the compiler (or of grmtools' CPCT+) on a reproducible benchmark. Numbers below are read from <code>evaluation/results/summary.json</code>; nothing is typed in by hand.</p>
        </div>
        {s && (
          <div className="row">
            <button className="btn sm" onClick={() => downloadText("parallax-summary.json", JSON.stringify(s, null, 1))}><Download size={13} aria-hidden /> summary.json</button>
            {data?.report_markdown && <button className="btn sm" onClick={() => downloadText("parallax-report.md", data.report_markdown!, "text/markdown")}><Download size={13} aria-hidden /> report.md</button>}
            <button className="btn sm" onClick={() => downloadText(`parallax-${split}.csv`, toCsv(s, split), "text/csv")}><Download size={13} aria-hidden /> CSV</button>
          </div>
        )}
      </div>
      {err && (err.code === "RESULTS_NOT_FOUND" ? (
        <Banner tone="warning" title="No stored evaluation results">{err.message} <code>{err.hint}</code></Banner>
      ) : <ErrorBanner error={err} onRetry={load} />)}
      {!s && !err && <Spinner label="Loading stored results…" />}
      {s && r && (
        <>
          <Banner tone="neutral" title="Provenance">
            {s.n_cases} benchmark cases from {s.dataset.programs} hand-written programs ({s.dataset.by_kind.single} single-error, {s.dataset.by_kind.multi} two-error), split by program into dev ({s.dataset.by_split.dev}) and held-out test ({s.dataset.by_split.test}). Generated {data!.provenance.generated_utc} at commit <code>{data!.provenance.git_commit}</code>; runtime {num(s.runtime_seconds, 1)} s on {s.environment.cpu_count} CPUs.
            <strong> The errors are synthetic token mutations, not real student code.</strong> τ = {s.tau_selection.tau} was chosen on dev only ({s.tau_selection.rule}).
          </Banner>
          <div className="row">
            <Tabs<Split> label="Split" value={split} onChange={setSplit} tabs={[{ id: "test", label: `Held-out test (${s.dataset.by_split.test})` }, { id: "dev", label: `Dev / tuning (${s.dataset.by_split.dev})` }]} />
            <div style={{ flex: 1 }} />
            <Tabs<"charts" | "tables"> label="View" value={view} onChange={setView} tabs={[{ id: "charts", label: <><ChartColumnBig size={13} aria-hidden /> Charts</> }, { id: "tables", label: <><Table2 size={13} aria-hidden /> Tables</> }]} />
          </div>
          <div className="grid grid-4">
            <Stat k="Top-1 repair = reference AST" v={pct(r.P.top1_ast.rate)} d={`IntelliFix · least-cost baseline ${pct(r.C.top1_ast.rate)}${g ? ` · CPCT+ ${pct(g.top1_ast.rate)}` : ""}`} />
            <Stat k="Wrong but confident" v={pct(r.P.false_confident_rate.rate)} d={`of all cases with abstention · forced top-1: ${pct(r.F.false_confident_rate.rate)}`} />
            <Stat k="Coverage (recommended)" v={pct(r.P.coverage.rate)} d={`selective accuracy ${pct(r.P.selective_accuracy.rate)}`} />
            <Stat k="Exact error localisation" v={pct(r.P.localisation_exact.rate)} d={`first repair edit · raw parser detection ${pct(r.A.localisation_exact.rate)}`} />
          </div>
          <ImpactSummary s={s} split={split} />
          {view === "charts" ? (
            <div className="grid grid-2">
              <Panel title="Repair accuracy by system" foot="Bars: proportion of cases; whiskers: 95% Wilson interval. Hover a bar for exact values; switch to Tables for the full data.">
                <GroupedBars
                  legend={[...REPAIR_IDS, ...(g ? ["G"] : [])].map((id) => ({ id, name: id === "G" ? "CPCT+ (replicate 1)" : names[id] }))}
                  groups={[
                    { label: "Top-1 AST match", bars: [...REPAIR_IDS.map((id) => bar(id, names[id], r[id].top1_ast)), ...(g ? [bar("G", "CPCT+", g.top1_ast)] : [])] },
                    { label: "Top-3 AST match", bars: [...REPAIR_IDS.map((id) => bar(id, names[id], r[id].top3_ast)), ...(g ? [bar("G", "CPCT+", g.top3_ast)] : [])] },
                    { label: "Wrong & confident", bars: REPAIR_IDS.map((id) => bar(id, names[id], r[id].false_confident_rate)) },
                  ]}
                />
              </Panel>
              <Panel title="Risk–coverage (selective prediction)" foot={`Cases accepted in order of decreasing confidence (margin). Lower is better; AURC: P ${num(r.P.aurc, 3)}, C ${num(r.C.aurc, 3)}, L ${num(r.L.aurc, 3)}, E ${num(r.E.aurc, 3)}, D ${num(r.D.aurc, 3)}. C has no confidence signal and is ordered by edit cost.`}>
                <LineChart
                  xLabel="coverage"
                  yLabel="risk (error rate among accepted)"
                  series={["P", "D", "E", "L", "C"].map((id) => ({ id, name: names[id], points: r[id].risk_coverage.map((p: any) => ({ x: p.coverage, y: p.risk })) }))}
                />
              </Panel>
            </div>
          ) : (
            <Panel title="All repair metrics" flush>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>System</th><th>Top-1 AST</th><th>Top-1 exact</th><th>Top-3 AST</th><th>Parses</th><th>Coverage</th><th>Selective acc.</th><th>Wrong & confident</th><th className="num">AURC</th></tr>
                  </thead>
                  <tbody>
                    {REPAIR_IDS.map((id) => (
                      <tr key={id}>
                        <td><strong>{id}</strong> {names[id]}</td>
                        <td>{ci(r[id].top1_ast)}</td><td>{ci(r[id].top1_exact)}</td><td>{ci(r[id].top3_ast)}</td>
                        <td>{ci(r[id].output_parser_valid)}</td><td>{ci(r[id].coverage)}</td><td>{ci(r[id].selective_accuracy)}</td>
                        <td>{ci(r[id].false_confident_rate)}</td><td className="num">{num(r[id].aurc, 3)}</td>
                      </tr>
                    ))}
                    {(s.cpctplus?.[split] ?? []).map((m: any, k: number) => (
                      <tr key={`g${k}`}>
                        <td><strong>G</strong> CPCT+ replicate {k + 1}</td>
                        <td>{ci(m.top1_ast)}</td><td>{ci(m.top1_exact)}</td><td>{ci(m.top3_ast)}</td><td>{ci(m.output_parser_valid)}</td>
                        <td>100% (never abstains)</td><td>{ci(m.top1_ast)}</td><td>{pct(1 - m.top1_ast.rate)}</td><td className="num">—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
          <div className="grid grid-2">
            <Panel title="Error localisation" foot="Exact = same token (or insertion gap) as the injected mutation. A uses the parser's detection point; C/P use the first edit of their top repair.">
              <table className="table">
                <thead><tr><th>System</th><th>Exact</th><th>Within 1 token</th><th>Same line</th></tr></thead>
                <tbody>
                  <tr><td>A raw parser</td><td>{ci(r.A.localisation_exact)}</td><td>{ci(r.A.localisation_within_1)}</td><td>{ci(r.A.localisation_same_line)}</td></tr>
                  {g && <tr><td>G CPCT+ (rep. 1)</td><td>{ci(g.localisation_exact)}</td><td>{ci(g.localisation_within_1)}</td><td>{ci(g.localisation_same_line)}</td></tr>}
                  <tr><td>C least-cost</td><td>{ci(r.C.localisation_exact)}</td><td>{ci(r.C.localisation_within_1)}</td><td>{ci(r.C.localisation_same_line)}</td></tr>
                  <tr><td>P IntelliFix</td><td>{ci(r.P.localisation_exact)}</td><td>{ci(r.P.localisation_within_1)}</td><td>{ci(r.P.localisation_same_line)}</td></tr>
                </tbody>
              </table>
            </Panel>
            <Panel title="Diagnostics-only baselines (A, B)">
              <dl className="kv">
                <dt>A: an error is detected</dt><dd>{ci(r.A.detected)}</dd>
                <dt>Lexical errors detected</dt><dd>{ci(r.A.lexical_error_detection)} (invalid-character cases)</dd>
                <dt>B: diagnostics per case</dt><dd>mean {num(r.B.diagnostics_per_case.mean)} (max {r.B.diagnostics_per_case.max}) for 1–2 injected errors</dd>
                <dt>B: spurious diagnostics</dt><dd>mean {num(r.B.spurious_diagnostics_per_case.mean)} per case; {ci(r.B.cases_with_spurious)} of cases have at least one</dd>
                <dt>B: multi-error coverage</dt><dd>{ci(r.B.multi_error_all_reported)} of two-error cases report ≥ 2 diagnostics</dd>
              </dl>
              <p className="tiny faint" style={{ marginTop: 8 }}>A and B never propose repairs, so repair metrics do not apply to them.</p>
            </Panel>
          </div>
          <Panel title="Cost" flush foot="End-to-end includes process start-up of parallaxc for every case. CPCT+ timings include grammar loading and LR table construction on each invocation.">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>System</th><th className="num">Candidates (mean)</th><th className="num">AST classes (mean)</th><th className="num">Parser calls (mean / p95)</th><th className="num">Engine ms (mean / p95)</th><th className="num">End-to-end ms (mean / p95)</th></tr></thead>
                <tbody>
                  {REPAIR_IDS.map((id) => (
                    <tr key={id}>
                      <td>{id} {names[id]}</td>
                      <td className="num">{num(r[id].candidates_generated.mean, 1)}</td>
                      <td className="num">{num(r[id].classes.mean, 1)}</td>
                      <td className="num">{num(r[id].parser_invocations.mean, 0)} / {r[id].parser_invocations.p95}</td>
                      <td className="num">{num(r[id].engine_ms.mean)} / {num(r[id].engine_ms.p95)}</td>
                      <td className="num">{num(r[id].latency_ms.mean)} / {num(r[id].latency_ms.p95)}</td>
                    </tr>
                  ))}
                  <tr><td>A raw parser</td><td className="num">—</td><td className="num">—</td><td className="num">1</td><td className="num">—</td><td className="num">{num(r.A.latency_ms.mean)} / {num(r.A.latency_ms.p95)}</td></tr>
                  {g && <tr><td>G CPCT+</td><td className="num">—</td><td className="num">—</td><td className="num">—</td><td className="num">—</td><td className="num">{num(g.latency_ms.mean)} / {num(g.latency_ms.p95)}</td></tr>}
                </tbody>
              </table>
            </div>
          </Panel>
          {split === "test" && <Breakdowns s={s} />}
          {split === "test" && <FailureExamples s={s} />}
          <Methodology s={s} />
          <LiveEvaluationPanel />
        </>
      )}
    </>
  );
}

function bar(id: string, name: string, m: any) {
  return { id, name, value: m?.rate ?? null, lo: m?.ci95?.[0] ?? null, hi: m?.ci95?.[1] ?? null };
}

function toCsv(s: any, split: Split): string {
  const rows = [["system", "top1_ast", "top1_exact", "top3_ast", "coverage", "selective_accuracy", "false_confident_rate", "aurc"]];
  for (const id of REPAIR_IDS) {
    const m = s[split][id];
    rows.push([id, m.top1_ast.rate, m.top1_exact.rate, m.top3_ast.rate, m.coverage.rate, m.selective_accuracy.rate, m.false_confident_rate.rate, m.aurc]);
  }
  return rows.map((r) => r.join(",")).join("\n") + "\n";
}

/** Plain-language findings computed from the numbers (improvements AND non-improvements). */
function ImpactSummary({ s, split }: { s: any; split: Split }) {
  const r = s[split];
  const pts = (a: number, b: number) => `${((a - b) * 100).toFixed(1)} pts`;
  const diff = s.paired_tests;
  const items: { tone: "success" | "warning" | "neutral"; text: string }[] = [];
  const dPC = r.P.top1_ast.rate - r.C.top1_ast.rate;
  items.push({ tone: dPC > 0 ? "success" : "warning", text: `Evidence ranking vs. least-cost: top-1 ${pct(r.P.top1_ast.rate)} vs ${pct(r.C.top1_ast.rate)} (${dPC >= 0 ? "+" : ""}${pts(r.P.top1_ast.rate, r.C.top1_ast.rate)})${split === "test" && diff ? `; paired bootstrap 95% CI [${pts(diff.top1_ast_P_minus_C.ci95[0], 0)}, ${pts(diff.top1_ast_P_minus_C.ci95[1], 0)}]` : ""}.` });
  items.push({ tone: "success", text: `Abstention trades coverage for reliability: wrong-but-confident falls from ${pct(r.F.false_confident_rate.rate)} (forced top-1) to ${pct(r.P.false_confident_rate.rate)}, at ${pct(r.P.coverage.rate)} coverage.` });
  if (split === "test") {
    const target = s.tau_selection.target_risk;
    const risk = 1 - r.P.selective_accuracy.rate;
    items.push({ tone: risk <= target ? "success" : "warning", text: `Selective risk on test is ${pct(risk)} against the ${pct(target, 0)} target set on dev${risk > target ? ": the dev-tuned threshold did not fully transfer." : "."}` });
  }
  const dL = r.P.top1_ast.rate - r.L.top1_ast.rate;
  items.push({ tone: dL > 0.01 ? "success" : "neutral", text: `Layout evidence (ablation L): ${dL >= 0 ? "+" : ""}${pts(r.P.top1_ast.rate, r.L.top1_ast.rate)} top-1.` });
  const dE = r.P.top1_ast.rate - r.E.top1_ast.rate;
  items.push({ tone: Math.abs(dE) < 0.01 ? "warning" : dE > 0 ? "success" : "warning", text: `Follow-on stability evidence (ablation E): ${dE >= 0 ? "+" : ""}${pts(r.P.top1_ast.rate, r.E.top1_ast.rate)} top-1, AURC ${num(r.P.aurc, 3)} vs ${num(r.E.aurc, 3)}${Math.abs(dE) < 0.01 ? " — no measurable accuracy gain on this benchmark." : "."}` });
  items.push({ tone: Math.abs(r.P.coverage.rate - r.D.coverage.rate) < 0.01 ? "warning" : "neutral", text: `AST grouping (ablation D): top-1 ${pct(r.D.top1_ast.rate)} vs ${pct(r.P.top1_ast.rate)} (grouping mainly changes which alternative the margin is measured against), giving coverage ${pct(r.P.coverage.rate)} vs ${pct(r.D.coverage.rate)} and wrong-confident ${pct(r.P.false_confident_rate.rate)} vs ${pct(r.D.false_confident_rate.rate)}.` });
  items.push({ tone: "neutral", text: `Cost: IntelliFix uses ${num(r.P.parser_invocations.mean, 0)} parser calls per case on average (least-cost ${num(r.C.parser_invocations.mean, 0)}), ${num(r.P.latency_ms.mean, 1)} ms end-to-end.` });
  return (
    <Panel title="What the experiment shows" icon={FlaskConical}>
      <ul className="hint-list" style={{ color: "var(--text)" }}>
        {items.map((it, i) => (
          <li key={i} style={{ marginBottom: 4 }}>
            <Badge tone={it.tone} icon={false}>{it.tone === "success" ? "improved" : it.tone === "warning" ? "caveat" : "note"}</Badge> {it.text}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Breakdowns({ s }: { s: any }) {
  const [by, setBy] = useState<"category" | "ambiguity" | "kind">("category");
  const table = by === "category" ? s.test_by_category : by === "ambiguity" ? s.test_by_ambiguity : s.test_by_kind;
  return (
    <Panel title="Where it works and where it fails (test)" flush actions={<select className="select" value={by} onChange={(e) => setBy(e.target.value as any)} aria-label="Group by"><option value="category">by error category</option><option value="ambiguity">by ambiguity label</option><option value="kind">single vs two errors</option></select>}>
      <div className="table-wrap scroll-y">
        <table className="table">
          <thead><tr><th>Group</th><th className="num">n</th><th className="num">C top-1</th><th className="num">P top-1</th><th className="num">P top-3</th><th className="num">P coverage</th><th className="num">P wrong & confident</th></tr></thead>
          <tbody>
            {Object.entries(table).map(([k, e]: [string, any]) => (
              <tr key={k}>
                <td>{k}</td><td className="num">{e.n}</td><td className="num">{pct(e.C.top1_ast, 0)}</td><td className="num">{pct(e.P.top1_ast, 0)}</td><td className="num">{pct(e.P.top3_ast, 0)}</td><td className="num">{pct(e.P.coverage, 0)}</td><td className="num">{pct(e.P.false_confident, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel-foot">“content-lost” cases (a deleted name or literal) cannot be recovered exactly by any syntax repair; the desirable behaviour there is to abstain. Small groups have wide uncertainty.</div>
    </Panel>
  );
}

function FailureExamples({ s }: { s: any }) {
  const p = useProject();
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const open = async (id: string) => {
    setBusy(id);
    try {
      const c = await api.evaluationCase(id);
      p.loadSource(c.corrupted, { kind: "case", label: `benchmark case ${c.id}` });
      nav("/repair");
      setTimeout(() => p.runAll(), 0);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Panel title="Failure cases: wrong but confident (test)" flush foot="Click a case to load the corrupted program into the workbench and re-run it live.">
      {s.failure_examples.length === 0 ? <EmptyState title="No confident errors on test" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Case</th><th>Category</th><th>Injected mutation</th><th>IntelliFix's repair</th><th className="num">Margin</th><th /></tr></thead>
            <tbody>
              {s.failure_examples.map((f: any) => (
                <tr key={f.id}>
                  <td className="mono small">{f.id}</td><td>{f.category}</td><td className="mono small">{f.injected}</td><td className="mono small">{f.parallax_repair}</td><td className="num">{num(f.margin)}</td>
                  <td><button className="btn sm" onClick={() => open(f.id)} disabled={busy === f.id}><ExternalLink size={12} aria-hidden /> Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Methodology({ s }: { s: any }) {
  return (
    <Panel title="Methodology & configuration">
      <div className="stack">
        <p className="small">
          Each case is a hand-written valid MiniC program with one or two injected token mutations (seed {s.dataset.config.seed}). A repair is <em>correct</em> when the repaired program's canonical AST equals the original's (exact token equality is reported separately). Programs, not mutations, are split into dev and test so no source program appears in both. Weights of the evidence model were fixed on dev before the first test run; τ is selected on dev by the rule “{s.tau_selection.rule}”.
        </p>
        <Disclosure summary="Systems compared">
          <ul className="hint-list">
            {s.systems.map((x: any) => <li key={x.id}><strong>{x.id} {x.name}</strong>: {x.description}</li>)}
            <li><strong>G CPCT+</strong>: {s.cpctplus?.availability?.available ? `${s.cpctplus.availability.tested_version}; ${s.cpctplus.note}` : `not run (${s.cpctplus?.availability?.reason})`}</li>
          </ul>
        </Disclosure>
        <Disclosure summary="Dataset composition">
          <pre className="code-block">{JSON.stringify({ by_category: s.dataset.by_category, by_ambiguity: s.dataset.by_ambiguity, rejected_mutations: s.dataset.rejected_mutations }, null, 1)}</pre>
        </Disclosure>
        <Disclosure summary="Threshold selection on dev (τ grid)">
          <table className="table">
            <thead><tr><th className="num">τ</th><th className="num">Coverage</th><th className="num">Selective risk</th><th className="num">Recommended</th></tr></thead>
            <tbody>{s.tau_selection.table.map((t: any) => <tr key={t.tau} className={t.tau === s.tau_selection.tau ? "selected" : ""}><td className="num">{t.tau}</td><td className="num">{pct(t.coverage)}</td><td className="num">{pct(t.selective_risk)}</td><td className="num">{t.recommended}</td></tr>)}</tbody>
          </table>
        </Disclosure>
        <Disclosure summary="Environment">
          <pre className="code-block">{JSON.stringify(s.environment, null, 1)}</pre>
        </Disclosure>
      </div>
    </Panel>
  );
}

function LiveEvaluationPanel() {
  const [res, setRes] = useState<LiveEvaluation | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(30);
  const [split, setSplit] = useState<"dev" | "test">("test");
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setRes((await api.evaluate(split, limit, 1)).data);
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError("BACKEND_FAILURE", String(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Run a live mini-evaluation" actions={
      <div className="row">
        <select className="select" value={split} onChange={(e) => setSplit(e.target.value as any)} aria-label="Split"><option value="test">test</option><option value="dev">dev</option></select>
        <select className="select" value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="Cases"><option value={15}>15 cases</option><option value={30}>30 cases</option><option value={60}>60 cases</option></select>
        <button className="btn primary sm" onClick={run} disabled={busy}>{busy ? "Running…" : "Run now"}</button>
      </div>
    }>
      <p className="small muted">Re-runs systems A, C, F and P on a seeded random sample right now, through the same harness. Small samples have wide confidence intervals; the stored full run above is the reference.</p>
      {busy && <Spinner label="Running the compiler on benchmark cases…" />}
      {err && <ErrorBanner error={err} onRetry={run} />}
      {res && (
        <div className="stack" style={{ marginTop: 10 }}>
          <Badge tone="info">Live run · {res.n} {res.split} cases · {num(res.seconds, 1)} s · τ = {res.tau}</Badge>
          <table className="table">
            <thead><tr><th>System</th><th>Top-1 AST</th><th>Top-3 AST</th><th>Coverage</th><th>Wrong & confident</th></tr></thead>
            <tbody>
              {["C", "F", "P"].map((id) => (
                <tr key={id}><td>{id}</td><td>{ci(res.metrics[id].top1_ast)}</td><td>{ci(res.metrics[id].top3_ast)}</td><td>{ci(res.metrics[id].coverage)}</td><td>{ci(res.metrics[id].false_confident_rate)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
