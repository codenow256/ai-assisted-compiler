import { ArrowRight, ChartColumnBig, FileCode2, FlaskConical, GitBranch, Layers, ShieldCheck, Wand2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useProject } from "../../app/ProjectContext";
import { Badge, Banner, Panel, StatusBadge } from "../../components/ui";
import { ms } from "../../lib/format";
import { useDemo } from "../demo/DemoContext";

export const PIPELINE = [
  { id: "lex", title: "Lex", text: "Flex scanner → tokens with byte/line/column spans" },
  { id: "parse", title: "Parse", text: "Bison LALR(1) with LAC: exact expected tokens" },
  { id: "localise", title: "Localise", text: "First error token, LR state, expectations" },
  { id: "generate-and-validate", title: "Generate & validate", text: "Bounded insert/delete/replace edits, each re-parsed" },
  { id: "rank-and-group", title: "Rank & group", text: "Interpretable evidence score; AST equivalence classes" },
  { id: "hypothesis-lanes", title: "Hypothesis lanes", text: "Repair later errors under each hypothesis; stability" },
  { id: "decide", title: "Decide", text: "Recommend, list alternatives, or abstain" },
];

export function OverviewPage() {
  const p = useProject();
  const demo = useDemo();
  const r = p.repair?.envelope.data.repair;
  const ranStages = new Set(r?.stages.map((s) => s.name) ?? []);
  const example = p.examples.find((e) => e.id === p.origin.exampleId);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>IntelliFix</h1>
          <p style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginTop: 4 }}>An Intelligent Compiler for Syntax Error Analysis, Detection, and Correction</p>
          <p style={{ fontSize: 15 }}>
            Evidence-ranked, multi-hypothesis syntax error detection, localisation and correction — with confidence-aware abstention. IntelliFix does not just print “syntax error”: it generates alternative repairs, validates each with the real parser, explains why one outranks another, and says so when the evidence is not strong enough.
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={demo.start}><FlaskConical size={14} aria-hidden /> Guided demo</button>
          <Link className="btn primary" to="/workbench"><FileCode2 size={14} aria-hidden /> Open workbench</Link>
        </div>
      </div>

      {!p.health && p.healthError && (
        <Banner tone="danger" title="The backend is not reachable">
          Start it with <code>cd parallax/backend && uvicorn app.main:app --port 8000</code>. The interface never substitutes simulated compiler output.
        </Banner>
      )}
      {p.health && !p.health.compiler.available && (
        <Banner tone="danger" title="The compiler binary is not built">{p.health.hint}</Banner>
      )}

      <Panel title="The processing pipeline" icon={Layers} foot={r ? `Stages marked ✓ ran in the latest repair run (${p.origin.label}).` : "Run an analysis to see which stages execute and how long they take."}>
        <div className="pipeline">
          {PIPELINE.map((s, i) => {
            const stage = r?.stages.find((x) => x.name === s.id);
            return (
              <div key={s.id} className={`stage ${ranStages.has(s.id) ? "ran" : r ? "pending" : ""}`} title={stage?.detail}>
                <div className="n">{i + 1}</div>
                <div className="t">{s.title}</div>
                <div className="s">{s.text}</div>
                {stage && <div className="tiny faint" style={{ marginTop: 4 }}>{ms(stage.ms)}</div>}
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid grid-3">
        <Panel title="Many hypotheses, one parser" icon={Wand2}>
          <p className="small">Candidate edits come from the parser's own expected-token sets around the error, plus layout cues (line ends, indentation). Each candidate is re-lexed and re-parsed: “parser-valid” always means the real parser accepted it.</p>
        </Panel>
        <Panel title="Evidence, not a single cost" icon={GitBranch}>
          <p className="small">Edit cost is one feature among many: invented content, layout, name resolution, residual errors and how much repairing later errors costs under each hypothesis. Every contribution is shown.</p>
        </Panel>
        <Panel title="Abstain when unsure" icon={ShieldCheck}>
          <p className="small">Parser validity is not intent. When structurally different repairs are similarly supported, or a repair must invent a name, IntelliFix lists alternatives instead of guessing. The trade-off is measured.</p>
        </Panel>
      </div>

      <div className="split">
        <Panel title="Latest run" actions={<Link className="btn sm" to="/repair">Repair lab <ArrowRight size={13} /></Link>}>
          {r ? (
            <div className="stack">
              <div className="row"><StatusBadge status={r.decision.status} /> <span className="small">{r.decision.summary}</span></div>
              <dl className="kv">
                <dt>Program</dt><dd>{p.origin.label}{p.isStale(p.repair) && <Badge tone="warning">source changed since</Badge>}</dd>
                <dt>Candidates</dt><dd>{r.counts.generated} generated, {r.counts.accepted} parser-accepted, {r.counts.classes} AST classes</dd>
                <dt>Search</dt><dd>{r.budget.parser_invocations} parser invocations in {ms(r.budget.elapsed_ms)}</dd>
              </dl>
            </div>
          ) : (
            <p className="muted small">No run yet. Load a sample in the workbench or start the guided demo.</p>
          )}
        </Panel>
        <Panel title={example ? `Selected sample: ${example.title}` : "Selected program"}>
          {example ? (
            <div className="stack small">
              <p>{example.description}</p>
              <p className="muted">{example.why}</p>
              <div className="row">Documented outcome: <StatusBadge status={example.expected_status} /></div>
            </div>
          ) : (
            <p className="small muted">{p.origin.label} — your own code. Samples come with an explanation of why they matter.</p>
          )}
        </Panel>
      </div>

      <div className="grid grid-3">
        <Link to="/learn" className="panel panel-body" style={{ color: "inherit", textDecoration: "none" }}>
          <h3>How it works →</h3>
          <p className="small muted" style={{ marginTop: 4 }}>Each stage explained simply and technically, with the data from your latest run.</p>
        </Link>
        <Link to="/evaluation" className="panel panel-body" style={{ color: "inherit", textDecoration: "none" }}>
          <h3 className="row"><ChartColumnBig size={15} aria-hidden /> Evaluation & impact →</h3>
          <p className="small muted" style={{ marginTop: 4 }}>Measured accuracy, abstention trade-offs, baselines (incl. CPCT+), failures and limits.</p>
        </Link>
        <Link to="/docs" className="panel panel-body" style={{ color: "inherit", textDecoration: "none" }}>
          <h3>Documentation →</h3>
          <p className="small muted" style={{ marginTop: 4 }}>Language spec, grammar, repair algorithm, API, research positioning.</p>
        </Link>
      </div>
    </>
  );
}
