/* eslint-disable @typescript-eslint/no-explicit-any */
// Research & Method: the question, the method, the measured key result, the
// reliability/coverage trade-off, the ablation and the limitations. Every
// number is read at runtime from evaluation/results/summary.json (and the
// clarification simulation file); nothing is typed in by hand.
import { ArrowRight, BookOpen, GraduationCap, Table2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Banner, ErrorBanner, Spinner } from "../../components/ui";
import { num, pct } from "../../lib/format";
import { ApiError, api, type EvaluationResultsResponse } from "../../services/api";

export interface Bar { label: string; sub?: string; k: number; n: number; rate: number; ci?: [number, number]; tone: "accent" | "base" | "warn" }

/** Horizontal proportion bars with 95% interval whiskers and k/n labels. */
export function Bars({ bars, title }: { bars: Bar[]; title: string }) {
  const W = 560, left = 190, right = 96, rowH = 34, H = bars.length * rowH + 26;
  const x = (v: number) => left + v * (W - left - right);
  return (
    <figure className="bars">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}><line x1={x(t)} x2={x(t)} y1={0} y2={H - 20} className="grid-line" /><text x={x(t)} y={H - 6} textAnchor="middle" className="axis-text">{t * 100}%</text></g>
        ))}
        {bars.map((b, i) => {
          const y = i * rowH + 6;
          return (
            <g key={b.label}>
              <text x={left - 10} y={y + 13} textAnchor="end" className="bar-label">{b.label}</text>
              {b.sub && <text x={left - 10} y={y + 25} textAnchor="end" className="bar-sub">{b.sub}</text>}
              <rect x={left} y={y + 3} width={Math.max(1, x(b.rate) - left)} height={18} rx={4} className={`bar-${b.tone}`} />
              {b.ci && <line x1={x(b.ci[0])} x2={x(b.ci[1])} y1={y + 12} y2={y + 12} className="whisker" />}
              <text x={x(Math.max(b.rate, b.ci?.[1] ?? 0)) + 6} y={y + 16} className="bar-value">{pct(b.rate)} <tspan className="bar-sub">({b.k}/{b.n})</tspan></text>
            </g>
          );
        })}
      </svg>
      <figcaption className="tiny muted">{title}. Whiskers: 95% Wilson interval.</figcaption>
    </figure>
  );
}

const m = (x: any): Pick<Bar, "k" | "n" | "rate" | "ci"> => ({ k: x.k, n: x.n, rate: x.rate, ci: x.ci95 });
const pts = (d: number) => `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)} points`;

export function ResearchPage() {
  const [data, setData] = useState<(EvaluationResultsResponse & { clarification?: any }) | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const load = () => api.evaluationResults().then((d) => { setData(d); setErr(null); }).catch((e) => setErr(e instanceof ApiError ? e : new ApiError("BACKEND_FAILURE", String(e))));
  useEffect(() => { load(); }, []);
  const s = data?.summary;
  const t = s?.test;
  const pt = s?.paired_tests;
  const cl = data?.clarification?.test;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Research &amp; Method</h1>
          <p>What IntelliFix adds to a classic compiler front end, how it was measured, and what the measurements do and do not show.</p>
        </div>
      </div>
      {err && (err.code === "RESULTS_NOT_FOUND" ? <Banner tone="warning" title="No stored evaluation results">{err.message} <code>{err.hint}</code></Banner> : <ErrorBanner error={err} onRetry={load} />)}
      {!s && !err && <Spinner label="Loading stored results…" />}
      {s && t && (
        <div className="research">
          <section>
            <h2>1 · The question</h2>
            <p>When a parser rejects a program it reports <em>where it got stuck</em>, which is often after the real mistake. Many small edits make the code parse again, and they can mean very different programs (<code>a + b</code> or <code>a - b</code>?). A local least-cost repair simply takes the cheapest edit.</p>
            <p className="rq"><strong>Research question.</strong> Does ranking parser-validated repairs by explicit evidence, and abstaining when the evidence is not decisive, give more correct and more reliable syntax repairs than local least-cost repair?</p>
          </section>

          <section>
            <h2>2 · How IntelliFix works</h2>
            <ol className="method">
              <li><strong>Generate.</strong> Around the first error, try every insertion, deletion or replacement of up to two tokens, guided by the parser's exact expected-token set (LAC) and by layout (line ends, indentation). <span className="faint">Mean {num(t.P.candidates_generated.mean, 0)} candidates per test case.</span></li>
              <li><strong>Validate.</strong> Run the real parser on every candidate. Keep only edits that let it continue past the error; reject those that just move the error. <span className="faint">Mean {num(t.P.parser_invocations.mean, 0)} parser runs per case.</span></li>
              <li><strong>Group &amp; rank.</strong> Candidates that produce the same AST are one option. Each option gets a score: a sum of named evidence (edit cost, resolves all errors, layout cues, invented placeholders, stability of later errors). <span className="faint">Mean {num(t.P.classes.mean, 1)} distinct options.</span></li>
              <li><strong>Decide.</strong> Recommend the best option only if its score leads the runner-up by at least τ = {s.tau_selection.tau} and it yields a complete valid program. Otherwise <em>abstain</em>: show the options and ask the user. In the Workspace this is the question in step 3.</li>
            </ol>
          </section>

          <section>
            <h2>3 · Key result: more repairs match the intended program</h2>
            <Bars title={`Held-out test set: top-1 repair has the reference AST (n = ${t.P.top1_ast.n})`} bars={[
              { label: "Least-cost baseline", sub: "same candidates, cost only", ...m(t.C.top1_ast), tone: "base" },
              { label: "IntelliFix", sub: "evidence ranking", ...m(t.P.top1_ast), tone: "accent" },
            ]} />
            <p>IntelliFix's top-ranked repair produced the intended program in <strong>{pct(t.P.top1_ast.rate)}</strong> of {t.P.top1_ast.n} test cases, against <strong>{pct(t.C.top1_ast.rate)}</strong> for least-cost repair over the same candidates: {pts(pt.top1_ast_P_minus_C.diff)} (paired bootstrap 95% CI {pts(pt.top1_ast_P_minus_C.ci95[0])} to {pts(pt.top1_ast_P_minus_C.ci95[1])}).</p>
          </section>

          <section>
            <h2>4 · Reliability vs coverage</h2>
            <Bars title="Held-out test set: wrong repairs presented with confidence (lower is better)" bars={[
              { label: "Always answer", sub: "IntelliFix without abstention", ...m(t.F.false_confident_rate), tone: "warn" },
              { label: "IntelliFix", sub: "with abstention", ...m(t.P.false_confident_rate), tone: "accent" },
            ]} />
            <p>Abstaining is not free. IntelliFix recommends a repair in <strong>{pct(t.P.coverage.rate)}</strong> of test cases ({t.P.coverage.k}/{t.P.coverage.n}); those recommendations are right {pct(t.P.selective_accuracy.rate)} of the time. In the other cases it shows the options instead of guessing, which cuts wrong-but-confident answers from {pct(t.F.false_confident_rate.rate)} to {pct(t.P.false_confident_rate.rate)}. τ was chosen on the separate dev split only ({s.tau_selection.rule}).</p>
            {cl && (
              <p className="small muted"><strong>Simulation, not a user study:</strong> in the {cl.abstained_cases} abstained test cases, the intended repair was among the options IntelliFix asks about in {cl.oracle_user.k} ({pct(cl.oracle_user.rate)}); an idealised user who always picks it would recover those. Real users were not measured.</p>
            )}
          </section>

          <section>
            <h2>5 · What the ablation shows</h2>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Variant (test set)</th><th className="num">Top-1 correct</th><th className="num">Recommends</th><th className="num">Wrong &amp; confident</th></tr></thead>
                <tbody>
                  {([["P", "IntelliFix (full)"], ["L", "without layout evidence"], ["E", "without stability evidence"], ["D", "without AST grouping"], ["F", "without abstention"], ["C", "least-cost baseline"]] as const).map(([id, name]) => (
                    <tr key={id} className={id === "P" ? "selected" : ""}><td>{name}</td><td className="num">{pct(t[id].top1_ast.rate)}</td><td className="num">{pct(t[id].coverage.rate)}</td><td className="num">{pct(t[id].false_confident_rate.rate)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="hint-list">
              <li><strong>Layout evidence carries most of the gain:</strong> removing it costs {(pt.top1_ast_P_minus_L.diff * 100).toFixed(1)} points of top-1 accuracy (95% CI {pts(pt.top1_ast_P_minus_L.ci95[0])} to {pts(pt.top1_ast_P_minus_L.ci95[1])}).</li>
              <li><strong>Stability evidence showed no measurable effect</strong> on this benchmark ({pts(pt.top1_ast_P_minus_E.diff)}, CI {pts(pt.top1_ast_P_minus_E.ci95[0])} to {pts(pt.top1_ast_P_minus_E.ci95[1])}).</li>
              <li><strong>AST grouping</strong> does not change the top-1 answer; it slightly raises how often IntelliFix can recommend ({pct(t.D.coverage.rate)} → {pct(t.P.coverage.rate)}), because equivalent edits no longer compete with each other.</li>
              <li><strong>Abstention</strong> leaves top-1 accuracy unchanged and is what lowers wrong-but-confident answers (paired CI {pts(pt.false_confident_P_minus_F.ci95[0])} to {pts(pt.false_confident_P_minus_F.ci95[1])}).</li>
            </ul>
          </section>

          <section>
            <h2>6 · Limitations and future work</h2>
            <ul className="hint-list">
              <li>The benchmark is <strong>synthetic</strong>: {s.n_cases} token-level mutations of {s.dataset.programs} hand-written programs ({s.dataset.by_kind.single} single-error, {s.dataset.by_kind.multi} two-error). It is not real student code; results may differ on real mistakes.</li>
              <li>“Correct” means the repaired AST equals the original program's AST. A parser-valid repair can still be semantically wrong; IntelliFix checks syntax and name use, not types or behaviour.</li>
              <li>The score margin is an uncalibrated score difference, not a probability.</li>
              <li>The repair search is local (at most two token edits near the first error, later errors handled greedily in hypothesis lanes) and bounded (30,000 parser runs or 4 s).</li>
              <li>A reference CPCT+ run is part of the full data; the systems optimise different objectives, so no general superiority is claimed.</li>
              <li>Hints, clarification questions and the explanations have <strong>not</strong> been evaluated with users. Next steps: a user study of the clarification flow, real student error corpora, and type-aware repair.</li>
            </ul>
          </section>

          <div className="row">
            <Link className="btn" to="/evaluation"><Table2 size={14} aria-hidden /> All results: tables, charts, per-category breakdowns <ArrowRight size={13} aria-hidden /></Link>
            <Link className="btn" to="/docs"><BookOpen size={14} aria-hidden /> Documentation &amp; method details</Link>
            <Link className="btn" to="/learn"><GraduationCap size={14} aria-hidden /> Learning center</Link>
          </div>
          <p className="tiny faint">Source: evaluation/results/summary.json, generated {data!.provenance.generated_utc} at commit {data!.provenance.git_commit}.</p>
        </div>
      )}
    </>
  );
}
