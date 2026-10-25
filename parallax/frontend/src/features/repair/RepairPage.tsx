import { Ban, Columns3, Pencil, Settings2, Undo2, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DEFAULT_OPTIONS, useProject } from "../../app/ProjectContext";
import { AcceptRepair } from "../../components/AcceptRepair";
import { RunGate } from "../../components/RunGate";
import { SourceDiff } from "../../components/SourceDiff";
import { Badge, Banner, Disclosure, EmptyState, ErrorBanner, OutcomeBadge, Panel, Spinner, Stat, StatusBadge, Tabs } from "../../components/ui";
import { num } from "../../lib/format";
import { formatPos } from "../../lib/positions";
import { STATUS } from "../../lib/status";
import { ApiError, api } from "../../services/api";
import type { Candidate, CompareResult, Evidence, RepairDoc } from "../../types/api";
import { useDemoFocus } from "../demo/DemoContext";

type Tab = "candidates" | "classes" | "rejected" | "compare";

export function RepairPage() {
  const p = useProject();
  const doc = p.repair?.envelope.data;
  const focus = useDemoFocus("repair");
  const [tab, setTab] = useState<Tab>("candidates");
  const [selId, setSelId] = useState<number | null>(null);
  const [compare, setCompare] = useState<number[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [showOptions, setShowOptions] = useState(false);

  useEffect(() => {
    if (focus) setTab(focus as Tab);
  }, [focus]);
  useEffect(() => {
    setSelId(doc?.repair.candidates[0]?.id ?? null);
    setCompare(doc?.repair.candidates.slice(0, 2).map((c) => c.id) ?? []);
    setDismissed(new Set());
  }, [doc]);

  const r = doc?.repair;
  const sel = r?.candidates.find((c) => c.id === selId) ?? null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Repair laboratory</h1>
          <p>Every candidate below was produced by a bounded, grammar-guided search and validated by re-running the real parser on the reconstructed source. Ranking uses interpretable evidence; candidates with the same AST form one class.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setShowOptions((s) => !s)} aria-expanded={showOptions}>
            <Settings2 size={14} aria-hidden /> Options
          </button>
          <button className="btn" onClick={p.undo} disabled={!p.history.length}>
            <Undo2 size={14} aria-hidden /> Undo
          </button>
          <button className="btn primary" onClick={p.runRepair} disabled={p.running.repair}>
            <Wand2 size={14} aria-hidden /> {p.running.repair ? "Searching…" : "Run repair"}
          </button>
        </div>
      </div>
      {showOptions && <OptionsPanel />}
      <RunGate kind="repair" has={!!doc} what="repair engine">
        {doc && r && (
          <>
            <DecisionBanner doc={doc} />
            {r.decision.status === "NO_REPAIR_NEEDED" ? null : (
              <>
                <div className="grid grid-4">
                  <Stat k="Candidates generated" v={r.counts.generated} d={`${r.counts.single_edit} single-edit · ${r.counts.two_edit} two-edit`} />
                  <Stat k="Accepted by the parser" v={r.counts.accepted} d={`${r.counts.classes} structural classes`} />
                  <Stat k="Rejected" v={r.counts.generated - r.counts.accepted} d={Object.entries(r.counts.by_outcome).filter(([k]) => k !== "valid" && k !== "local-repair").map(([k, v]) => `${v} ${k}`).join(" · ")} />
                  <Stat k="Search cost" v={`${r.budget.parser_invocations} parses`} d={`${num(r.budget.elapsed_ms, 1)} ms of ${r.budget.time_limit_ms} ms · ${r.budget.exhausted ? "budget exhausted" : "within budget"}`} />
                </div>
                <Panel flush>
                  <Tabs<Tab>
                    label="Repair views"
                    value={tab}
                    onChange={setTab}
                    tabs={[
                      { id: "candidates", label: `Ranked candidates (${r.candidates.length})` },
                      { id: "classes", label: `AST classes (${r.classes.length})` },
                      { id: "rejected", label: `Rejected (${r.counts.generated - r.counts.accepted})` },
                      { id: "compare", label: <><Columns3 size={13} aria-hidden /> Compare ({compare.length})</> },
                    ]}
                  />
                  <div className="panel-body">
                    {tab === "candidates" && (
                      r.candidates.length === 0 ? (
                        <EmptyState title="No candidate was accepted">Every generated edit failed validation; see the Rejected tab for the reasons.</EmptyState>
                      ) : (
                        <div className="split">
                          <div className="table-wrap scroll-y" style={{ maxHeight: 640 }}>
                            <table className="table">
                              <thead>
                                <tr>
                                  <th className="num">Rank</th>
                                  <th>Repair</th>
                                  <th>Outcome</th>
                                  <th className="num">Cost</th>
                                  <th className="num">Score</th>
                                  <th className="num">Class</th>
                                  <th><span className="sr-only">Compare</span></th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.candidates.map((c) => (
                                  <tr key={c.id} className={`clickable ${c.id === selId ? "selected" : ""}`} onClick={() => setSelId(c.id)} style={{ opacity: dismissed.has(c.id) ? 0.45 : 1 }}>
                                    <td className="num">{c.rank}</td>
                                    <td className="mono small">{c.summary}{dismissed.has(c.id) && <Badge tone="neutral" icon={false}>rejected by you</Badge>}</td>
                                    <td><OutcomeBadge outcome={c.outcome} /></td>
                                    <td className="num">{c.cost}</td>
                                    <td className="num">{num(c.score)}</td>
                                    <td className="num">{c.class_id}</td>
                                    <td onClick={(e) => e.stopPropagation()}>
                                      <input
                                        type="checkbox"
                                        aria-label={`Compare candidate ${c.rank}`}
                                        checked={compare.includes(c.id)}
                                        onChange={(e) => setCompare((s) => (e.target.checked ? [...s, c.id].slice(-3) : s.filter((x) => x !== c.id)))}
                                      />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {r.candidates_truncated && <p className="tiny faint" style={{ padding: 8 }}>Only the top {r.candidates.length} candidates are reported.</p>}
                          </div>
                          {sel && (
                            <CandidateDetail
                              c={sel}
                              doc={doc}
                              original={p.repair!.source}
                              dismissed={dismissed.has(sel.id)}
                              onDismiss={() => setDismissed((s) => new Set(s).add(sel.id))}
                            />
                          )}
                        </div>
                      )
                    )}
                    {tab === "classes" && <ClassesView doc={doc} onPick={(id) => { setSelId(id); setTab("candidates"); }} />}
                    {tab === "rejected" && <RejectedView doc={doc} />}
                    {tab === "compare" && <CompareView doc={doc} ids={compare} original={p.repair!.source} />}
                  </div>
                </Panel>
              </>
            )}
          </>
        )}
      </RunGate>
    </>
  );
}

function OptionsPanel() {
  const p = useProject();
  const o = p.options;
  const set = (patch: Partial<typeof o>) => p.setOptions({ ...o, ...patch });
  return (
    <Panel title="Engine options" foot="Options apply to the next run. Turning a component off reproduces the corresponding ablation from the evaluation.">
      <div className="row" style={{ gap: 18 }}>
        <label className="toggle">
          Strategy
          <select className="select" value={o.strategy} onChange={(e) => set({ strategy: e.target.value as typeof o.strategy })}>
            <option value="parallax">IntelliFix (evidence ranking)</option>
            <option value="least-cost">Least-cost baseline (C)</option>
          </select>
        </label>
        {(["grouping", "stability", "layout", "abstention"] as const).map((k) => (
          <label key={k} className="toggle">
            <input type="checkbox" checked={o[k]} onChange={(e) => set({ [k]: e.target.checked })} disabled={o.strategy === "least-cost"} />
            {k === "grouping" ? "AST grouping" : k === "stability" ? "Follow-on stability evidence" : k === "layout" ? "Layout evidence" : "Abstention"}
          </label>
        ))}
        <label className="toggle">
          τ (margin threshold)
          <input
            className="input"
            style={{ width: 80 }}
            type="number"
            step="0.25"
            placeholder="dev-tuned"
            value={o.tau ?? ""}
            onChange={(e) => set({ tau: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </label>
        <button className="btn sm" onClick={() => p.setOptions(DEFAULT_OPTIONS)}>Reset</button>
      </div>
    </Panel>
  );
}

function DecisionBanner({ doc }: { doc: RepairDoc }) {
  const d = doc.repair.decision;
  const m = STATUS[d.status];
  return (
    <Banner tone={m.tone} title={<span className="row"><StatusBadge status={d.status} /> {d.summary}</span>}>
      <div className="small">{m.meaning}</div>
      {d.reasons.length > 0 && (
        <ul className="hint-list">
          {d.reasons.map((x) => <li key={x}>{x}</li>)}
        </ul>
      )}
      {d.margin !== null && d.status !== "NO_REPAIR_NEEDED" && <MarginBar margin={d.margin} tau={d.tau} />}
      <div className="tiny faint" style={{ marginTop: 4 }}>
        τ = {d.tau} ({doc.tau_source ?? "request"}). The margin is a score difference, not a probability.
      </div>
    </Banner>
  );
}

function MarginBar({ margin, tau }: { margin: number; tau: number }) {
  const max = Math.max(4, tau * 2, margin + 0.5);
  return (
    <div style={{ marginTop: 8, maxWidth: 420 }} aria-label={`Margin ${num(margin)} versus threshold ${tau}`}>
      <div style={{ position: "relative", height: 10, background: "var(--surface-2)", borderRadius: 5 }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(Math.max(0, margin) / max) * 100}%`, background: margin >= tau ? "var(--success)" : "var(--warning)", borderRadius: 5 }} />
        <div style={{ position: "absolute", left: `${(tau / max) * 100}%`, top: -3, bottom: -3, width: 2, background: "var(--text)" }} title="threshold τ" />
      </div>
      <div className="tiny muted row" style={{ justifyContent: "space-between" }}>
        <span>margin to best distinct alternative: {num(margin)}</span>
        <span>τ = {tau}</span>
      </div>
    </div>
  );
}

export function EvidenceBars({ evidence }: { evidence: Evidence[] }) {
  const maxAbs = Math.max(1, ...evidence.map((e) => Math.abs(e.contribution)));
  return (
    <div>
      {evidence.map((e) => (
        <div className="ev-row" key={e.name} title={e.explanation}>
          <div>
            <div className="mono small">{e.name}</div>
            <div className="tiny faint ev-why">{e.group}</div>
          </div>
          <div className="mono tiny">
            {num(e.value, e.value % 1 ? 2 : 0)} × {num(e.weight)}
          </div>
          <div className="ev-bar" aria-hidden>
            <div className="zero" />
            {e.contribution !== 0 && <div className={`fill ${e.contribution > 0 ? "pos" : "neg"}`} style={{ width: `${(Math.abs(e.contribution) / maxAbs) * 50}%` }} />}
          </div>
          <div className="mono small" style={{ textAlign: "right", color: e.contribution > 0 ? "var(--success)" : e.contribution < 0 ? "var(--danger)" : "var(--text-faint)" }}>
            {e.contribution > 0 ? "+" : ""}
            {num(e.contribution)}
          </div>
        </div>
      ))}
    </div>
  );
}

function CandidateDetail({ c, doc, original, dismissed, onDismiss }: { c: Candidate; doc: RepairDoc; original: string; dismissed: boolean; onDismiss: () => void }) {
  const p = useProject();
  const nav = useNavigate();
  const top = doc.repair.candidates[0];
  const rival = c.id === top.id ? doc.repair.candidates.find((x) => x.class_id !== c.class_id) : top;
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h3>Rank {c.rank}: <span className="mono">{c.summary}</span></h3>
          <div className="row small muted" style={{ marginTop: 4 }}>
            <OutcomeBadge outcome={c.outcome} /> score {num(c.score)} · cost {c.cost} · class {c.class_id} · <span className="mono tiny">AST {c.ast_hash}</span>
          </div>
        </div>
      </div>
      <div className="row">
        <AcceptRepair source={c.source} edits={c.edits} reason={c.summary} label="Accept" />
        <button
          className="btn sm"
          onClick={() => {
            p.applyRepair(c.source, `edit from candidate: ${c.summary}`);
            nav("/workbench");
          }}
          disabled={p.isStale(p.repair)}
        >
          <Pencil size={13} aria-hidden /> Edit in workbench
        </button>
        <button className="btn sm danger" onClick={onDismiss} disabled={dismissed}>
          <Ban size={13} aria-hidden /> {dismissed ? "Rejected" : "Reject"}
        </button>
      </div>
      <p className="small">{c.reason}.{c.valid ? "" : c.next_error ? ` Next error at ${formatPos(c.next_error.at)} (“${c.next_error.token}”).` : ""}</p>
      <Disclosure summary="Source change (original → candidate)" open>
        <SourceDiff before={original} after={c.source} maxHeight={260} />
        <p className="tiny faint" style={{ marginTop: 6 }}>Reconstructed from the edited token stream with your original whitespace and comments; re-lexing it reproduces the edited stream exactly ({c.roundtrip_ok ? "verified" : "FAILED"}).</p>
      </Disclosure>
      <Disclosure summary={`Evidence breakdown (score ${num(c.score)})`} open>
        <EvidenceBars evidence={c.evidence} />
      </Disclosure>
      {rival && rival.id !== c.id && <WhyRank a={c} b={rival} />}
      <Disclosure summary={`Edit operations (${c.edits.length})`}>
        <table className="table">
          <thead><tr><th>Op</th><th>Token</th><th>At</th><th>Generator</th><th>Support</th><th className="num">Cost</th></tr></thead>
          <tbody>
            {c.edits.map((e, i) => (
              <tr key={i}>
                <td>{e.op}</td>
                <td className="mono">{e.op === "delete" ? e.removed_text : e.op === "replace" ? `${e.removed_text} → ${e.text}` : e.text}{e.placeholder && <Badge tone="warning" icon={false}>placeholder</Badge>}</td>
                <td className="mono">{formatPos(e.at)}</td>
                <td className="small">{e.generator}</td>
                <td className="small">{e.support || "—"}</td>
                <td className="num">{e.cost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Disclosure>
      {c.residual_diagnostics.length > 0 && (
        <Disclosure summary={`Remaining diagnostics after this edit (${c.residual_diagnostics.length})`}>
          <ul className="hint-list">
            {c.residual_diagnostics.map((d, i) => <li key={i}><span className="mono">{formatPos(d.original.at)}</span> {d.message}</li>)}
          </ul>
        </Disclosure>
      )}
      {c.name_warnings.length > 0 && (
        <Disclosure summary={`Name-resolution warnings in the repaired program (${c.name_warnings.length})`}>
          <ul className="hint-list">{c.name_warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
        </Disclosure>
      )}
    </div>
  );
}

function WhyRank({ a, b }: { a: Candidate; b: Candidate }) {
  const names = Array.from(new Set([...a.evidence, ...b.evidence].map((e) => e.name)));
  const rows = names
    .map((n) => {
      const ea = a.evidence.find((e) => e.name === n)?.contribution ?? 0;
      const eb = b.evidence.find((e) => e.name === n)?.contribution ?? 0;
      return { n, d: ea - eb };
    })
    .filter((r) => Math.abs(r.d) > 1e-9)
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const higher = a.score >= b.score;
  return (
    <Disclosure summary={`Why rank ${a.rank} ${higher ? "outranks" : "trails"} rank ${b.rank} (${b.summary})`}>
      <p className="small">Score difference {num(a.score - b.score)} decomposes into:</p>
      <ul className="hint-list">
        {rows.map((r) => (
          <li key={r.n}><span className="mono">{r.n}</span>: {r.d > 0 ? "+" : ""}{num(r.d)} {r.d > 0 ? "in favour of" : "against"} rank {a.rank}</li>
        ))}
        {rows.length === 0 && <li>Identical evidence; the tie is broken by lower cost, then generation order.</li>}
      </ul>
      {a.class_id === b.class_id && <p className="tiny muted">Both candidates produce the same AST, so they do not compete for the decision margin.</p>}
    </Disclosure>
  );
}

function ClassesView({ doc, onPick }: { doc: RepairDoc; onPick: (candidateId: number) => void }) {
  const r = doc.repair;
  const byId = new Map(r.candidates.map((c) => [c.id, c]));
  return (
    <div className="stack">
      <p className="small muted">
        A class is a set of accepted candidates whose repaired programs have the identical canonical AST (node kinds, attributes and child order; spans, whitespace, comments and redundant parentheses ignored). Candidates that cannot be completed yet are grouped by the structure of their panic-mode recovery tree. The decision margin is measured between the best <em>class</em> and the best <em>different</em> class, so equivalent candidates never make IntelliFix doubt itself.
        {!r.config.grouping && " Grouping is disabled for this run: every candidate is its own class."}
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th className="num">Class</th><th>Representative</th><th className="num">Members</th><th>Complete AST</th><th className="num">Best score</th><th className="num">Min cost</th><th>AST hash</th></tr></thead>
          <tbody>
            {r.classes.map((k) => {
              const rep = byId.get(k.representative);
              return (
                <tr key={k.id} className="clickable" onClick={() => rep && onPick(rep.id)}>
                  <td className="num">{k.id}</td>
                  <td className="mono small">
                    {rep?.summary ?? `candidate ${k.representative}`}
                    {k.size > 1 && (
                      <div className="tiny muted">also: {k.members.slice(1).map((m) => byId.get(m)?.summary ?? `#${m}`).join(" · ")}</div>
                    )}
                  </td>
                  <td className="num">{k.size}</td>
                  <td>{k.complete_ast ? <Badge tone="success">yes</Badge> : <Badge tone="warning">partial</Badge>}</td>
                  <td className="num">{num(k.best_score)}</td>
                  <td className="num">{k.min_cost}</td>
                  <td className="mono tiny">{k.ast_hash}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {r.classes.length > 1 && (
        <Banner tone="info" title={`${r.classes.length} structurally distinct outcomes`}>
          A single parser-valid program does not prove intent: these classes are different programs, each accepted by the grammar.
        </Banner>
      )}
    </div>
  );
}

function RejectedView({ doc }: { doc: RepairDoc }) {
  const r = doc.repair;
  return (
    <div className="stack">
      <div className="chip-list">
        {Object.entries(r.counts.by_outcome).map(([k, v]) => (
          <span key={k} className="row small"><OutcomeBadge outcome={k} /> {v}</span>
        ))}
      </div>
      <p className="small muted">
        A candidate is accepted only if the parser gets at least {String(r.config.min_progress)} tokens past the edit and past the original error point (or parses completely). Candidates that merely move the error a little are rejected as <em>defers-error</em>. Showing a deterministic sample of {r.rejected.length}.
      </p>
      <div className="table-wrap scroll-y">
        <table className="table">
          <thead><tr><th>Candidate edit</th><th>Outcome</th><th>Why it was rejected</th><th className="num">Cost</th></tr></thead>
          <tbody>
            {r.rejected.map((c) => (
              <tr key={c.id}>
                <td className="mono small">{c.summary}</td>
                <td><OutcomeBadge outcome={c.outcome} /></td>
                <td className="small">{c.reason}{c.next_error ? ` (next error at ${formatPos(c.next_error.at)})` : ""}</td>
                <td className="num">{c.cost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompareView({ doc, ids, original }: { doc: RepairDoc; ids: number[]; original: string }) {
  const cands = ids.map((id) => doc.repair.candidates.find((c) => c.id === id)).filter((c): c is Candidate => !!c);
  const [res, setRes] = useState<CompareResult | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const names = useMemo(() => Array.from(new Set(cands.flatMap((c) => c.evidence.map((e) => e.name)))), [cands]);
  if (cands.length < 2)
    return <EmptyState icon={Columns3} title="Pick two or three candidates">Tick the compare boxes in the candidate table. The original source is never modified while you compare.</EmptyState>;
  const astCompare = async () => {
    setBusy(true);
    setErr(null);
    try {
      setRes((await api.compare(cands[0].source, cands[1].source)).data);
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError("BACKEND_FAILURE", String(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Evidence</th>
              {cands.map((c) => <th key={c.id} className="num">#{c.rank}: <span className="mono" style={{ textTransform: "none" }}>{c.summary}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {names.map((n) => (
              <tr key={n}>
                <td className="mono small">{n}</td>
                {cands.map((c) => {
                  const e = c.evidence.find((x) => x.name === n);
                  return <td key={c.id} className="num mono small">{e ? `${num(e.value, 2)} → ${num(e.contribution)}` : "—"}</td>;
                })}
              </tr>
            ))}
            <tr>
              <td><strong>Score</strong></td>
              {cands.map((c) => <td key={c.id} className="num"><strong>{num(c.score)}</strong></td>)}
            </tr>
            <tr>
              <td>AST class</td>
              {cands.map((c) => <td key={c.id} className="num mono tiny">{c.class_id} · {c.ast_hash}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <div className={`grid ${cands.length === 3 ? "grid-3" : "grid-2"}`}>
        {cands.map((c) => (
          <div key={c.id} className="stack">
            <h3 className="mono small">#{c.rank} {c.summary}</h3>
            <SourceDiff before={original} after={c.source} maxHeight={300} />
          </div>
        ))}
      </div>
      <div className="row">
        <button className="btn sm" onClick={astCompare} disabled={busy}>Compare ASTs of #{cands[0].rank} and #{cands[1].rank}</button>
        {busy && <Spinner />}
      </div>
      {err && <ErrorBanner error={err} />}
      {res && (
        res.equivalent ? (
          <Banner tone="success" title="Same AST">These candidates are the same program structurally.</Banner>
        ) : res.comparable ? (
          <Banner tone="info" title={`${res.changes.length} structural difference(s)`}>
            <ul className="hint-list">{res.changes.slice(0, 8).map((ch, i) => <li key={i}><span className="mono tiny">{ch.path}</span>: {ch.change} {ch.before ?? ""} {ch.after ? `→ ${ch.after}` : ""} {ch.detail}</li>)}</ul>
          </Banner>
        ) : (
          <Banner tone="warning" title="At least one candidate does not parse completely">AST comparison needs two complete programs.</Banner>
        )
      )}
    </div>
  );
}
