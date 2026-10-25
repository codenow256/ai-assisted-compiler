import { ChevronsDownUp, ChevronsUpDown, GitCompare, ListTree, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useProject } from "../../app/ProjectContext";
import { AstTree, countNodes, findByPath, markKey, parentOf, type Mark } from "../../components/AstTree";
import { CodeEditor, type EditorHighlight } from "../../components/CodeEditor";
import { RunGate } from "../../components/RunGate";
import { Badge, Banner, Disclosure, ErrorBanner, Panel, Spinner, Tabs } from "../../components/ui";
import { useDemoFocus } from "../demo/DemoContext";
import { infoFor, nodeSource } from "../../lib/astInfo";
import { formatPos } from "../../lib/positions";
import { ApiError, api } from "../../services/api";
import type { AstNode, CompareResult } from "../../types/api";

type Tab = "tree" | "compare" | "json" | "text";
type Shown = { root: AstNode; source: string; kind: "ast" | "recovered" | "repaired"; label: string };

export function AstPage() {
  const p = useProject();
  const doc = p.parse?.envelope.data;
  const focus = useDemoFocus("ast");
  const [tab, setTab] = useState<Tab>("tree");
  const [sel, setSel] = useState<{ node: AstNode; path: string } | null>(null);
  const [query, setQuery] = useState("");
  const [openAll, setOpenAll] = useState({ open: true, n: 0 });
  const [view, setView] = useState<"own" | "repaired">("own");
  const [compare, setCompare] = useState<CompareResult | null>(null);
  useEffect(() => {
    if (focus) setTab(focus === "compare" ? "compare" : (focus as Tab));
  }, [focus]);
  useEffect(() => { setSel(null); setView("own"); }, [doc]);

  // The top-ranked plan's AST (real, from the compiler) when the user's code has none.
  const repaired = useMemo(() => {
    const r = p.repair && p.parse && p.repair.source === p.parse.source ? p.repair.envelope.data.repair : null;
    const pl = r?.decision.plans.find((x) => x.valid && x.ast);
    return pl?.ast ? { root: pl.ast, source: pl.source, summary: pl.summary, status: r!.decision.status } : null;
  }, [p.repair, p.parse]);

  const shown: Shown | null = useMemo(() => {
    if (!doc || !p.parse) return null;
    if (doc.parse.ast) return { root: doc.parse.ast, source: p.parse.source, kind: "ast", label: "AST of your program" };
    if (view === "repaired" && repaired) return { root: repaired.root, source: repaired.source, kind: "repaired", label: `AST after the top-ranked repair (${repaired.summary})` };
    if (doc.parse.recovered_ast) return { root: doc.parse.recovered_ast, source: p.parse.source, kind: "recovered", label: "Partial tree from error recovery" };
    return null;
  }, [doc, p.parse, view, repaired]);

  // marks from the last structural comparison, for nodes of the shown tree
  const marks = useMemo(() => {
    const m = new Map<string, Mark>();
    if (!compare?.comparable || !shown) return m;
    for (const c of compare.changes) {
      const kind = c.path.split("/").pop()!.replace(/\[\d+\]$/, "");
      const span = shown.kind === "repaired" ? c.after_span : c.before_span;
      if (span && (shown.kind === "repaired" ? c.change !== "removed" : c.change !== "added")) m.set(markKey(kind, span), c.change as Mark);
    }
    return m;
  }, [compare, shown]);

  const highlights: EditorHighlight[] = useMemo(() => (sel ? [{ from: sel.node.span.start.offset, to: sel.node.span.end.offset, tone: "select" }] : []), [sel]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>AST explorer</h1>
          <p>The abstract syntax tree is the structure the parser builds from your code: functions contain blocks, blocks contain statements, statements contain expressions. Click any node to see what it means, which code it came from and what its children are.</p>
        </div>
        <button className="btn primary" onClick={() => p.runParse(true)} disabled={p.running.parse}>
          <ListTree size={14} aria-hidden /> {p.running.parse ? "Parsing…" : "Build AST"}
        </button>
      </div>
      <RunGate kind="parse" has={!!doc} what="parser">
        {doc && (
          <div className="split">
            <div className="stack">
              <Panel title={shown?.kind === "repaired" ? "Repaired source (not your code)" : "Source"}>
                <CodeEditor value={shown?.source ?? p.parse!.source} readOnly highlights={highlights} minHeight={220} maxHeight={420} ariaLabel="Source (read-only)" />
              </Panel>
              <NodeDetails sel={sel} shown={shown} compare={compare} onSelect={(node, path) => setSel({ node, path })} />
            </div>
            <Panel flush>
              <Tabs<Tab>
                label="AST views"
                value={tab}
                onChange={setTab}
                tabs={[
                  { id: "tree", label: "Explained tree" },
                  { id: "compare", label: <><GitCompare size={13} aria-hidden /> Before &amp; after</> },
                  { id: "json", label: "JSON" },
                  { id: "text", label: "Text" },
                ]}
              />
              <div className="panel-body">
                {tab === "tree" && (
                  <div className="stack">
                    {!doc.parse.ast && (
                      <Banner tone="warning" title="Your code has syntax errors, so there is no complete AST">
                        {doc.parse.diagnostics.length} syntax error(s). {shown?.kind === "recovered" && "Below is the partial tree the parser built while recovering: parts it could not understand appear as Error nodes. It is not a valid program's AST."}
                        {shown?.kind === "repaired" && "Below is the real AST of the top-ranked repaired program, not of your code. Accept a repair (or fix the code) to make it yours."}
                        <div className="row" style={{ marginTop: 6 }}>
                          {repaired && view === "own" && <button className="btn sm" onClick={() => { setView("repaired"); setSel(null); }}>Show the AST after the top-ranked repair</button>}
                          {view === "repaired" && <button className="btn sm" onClick={() => { setView("own"); setSel(null); }}>Back to the partial tree</button>}
                          {!repaired && <span className="tiny faint">Run the repair engine (Analyze) to see a repaired program's AST.</span>}
                        </div>
                      </Banner>
                    )}
                    {shown ? (
                      <>
                        <div className="row small">
                          <Badge tone={shown.kind === "ast" ? "success" : shown.kind === "repaired" ? "info" : "warning"} icon={false}>{shown.label}</Badge>
                          <Badge tone="neutral" icon={false}>{countNodes(shown.root)} nodes</Badge>
                          {shown.kind === "ast" && <span className="mono tiny faint" title="FNV-1a hash of the canonical form">hash {doc.parse.ast_hash}</span>}
                          {marks.size > 0 && <Badge tone="info" icon={false}>{marks.size} node(s) marked from the last comparison</Badge>}
                        </div>
                        <div className="row">
                          <label className="search-box">
                            <Search size={13} aria-hidden />
                            <span className="sr-only">Search the tree</span>
                            <input className="input sm" placeholder="Find a node: While, total, +, 10…" value={query} onChange={(e) => setQuery(e.target.value)} />
                          </label>
                          <button className="btn sm" onClick={() => setOpenAll((o) => ({ open: true, n: o.n + 1 }))}><ChevronsUpDown size={13} aria-hidden /> Expand all</button>
                          <button className="btn sm" onClick={() => setOpenAll((o) => ({ open: false, n: o.n + 1 }))}><ChevronsDownUp size={13} aria-hidden /> Collapse all</button>
                        </div>
                        <div className="scroll-y" style={{ maxHeight: 600 }}>
                          <AstTree root={shown.root} selected={sel?.path} onSelect={(node, path) => setSel({ node, path })} query={query} openAll={openAll} marks={marks} />
                        </div>
                      </>
                    ) : (
                      <p className="small muted">The parser produced no tree for this input.</p>
                    )}
                    {!!doc.parse.name_warnings?.length && shown?.kind === "ast" && (
                      <Disclosure summary={`Static name checks: ${doc.parse.name_warnings.length} warning(s)`}>
                        <ul className="hint-list">
                          {doc.parse.name_warnings.map((w, i) => <li key={i}><span className="mono">{formatPos(w.start)}</span> {w.message}</li>)}
                        </ul>
                        <p className="tiny faint">Name resolution only (scopes, arity); MiniC has no type checker.</p>
                      </Disclosure>
                    )}
                    <Disclosure summary="Parse tree vs. AST (for the curious)">
                      <p className="small">A <strong>parse tree</strong> records every grammar rule used, including chains like <code>expr → or_expr → … → primary</code>, and every token. The <strong>AST</strong> keeps only meaningful structure: <code>(a + b) * c</code> becomes <code>Binary * (Binary + (a, b), c)</code>; parentheses, semicolons and braces disappear because the tree shape already says what they said.</p>
                    </Disclosure>
                  </div>
                )}
                {tab === "json" && (shown ? <pre className="code-block" style={{ maxHeight: 640 }}>{JSON.stringify(shown.root, null, 2)}</pre> : <p className="small muted">No tree.</p>)}
                {tab === "text" && (doc.parse.ast ? <pre className="code-block" style={{ maxHeight: 640 }}>{doc.parse.ast_text}</pre> : <p className="small muted">The text form exists only for a complete AST.</p>)}
                {tab === "compare" && <ComparePane onResult={setCompare} />}
              </div>
            </Panel>
          </div>
        )}
      </RunGate>
    </>
  );
}

function NodeDetails({ sel, shown, compare, onSelect }: { sel: { node: AstNode; path: string } | null; shown: Shown | null; compare: CompareResult | null; onSelect: (n: AstNode, path: string) => void }) {
  if (!sel || !shown) return (
    <Panel title="Node details">
      <p className="muted small">Select a node in the tree. You will see what it represents, a plain-English explanation, how it fits into the program, its children and the exact source code it came from.</p>
    </Panel>
  );
  const n = sel.node, info = infoFor(n);
  const parent = parentOf(shown.root, sel.path);
  const idx = Number(sel.path.split("/").pop());
  const asChild = parent ? infoFor(parent).childRole(parent, idx) : "";
  const text = nodeSource(shown.source, n).trim();
  const change = compare?.comparable ? compare.changes.find((c) => {
    const span = shown.kind === "repaired" ? c.after_span : c.before_span;
    return span && span.start.offset === n.span.start.offset && span.end.offset === n.span.end.offset && c.path.split("/").pop()!.startsWith(n.kind);
  }) : undefined;
  return (
    <Panel title={<span>{n.kind} <span className="faint small">— {info.title}</span></span>}>
      <dl className="kv explain-kv">
        <dt>What it is</dt><dd>{info.title}{n.name && <> named <code>{n.name}</code></>}{n.op && <> with operator <code>{n.op}</code></>}{n.value && <> with value <code>{n.value}</code></>}</dd>
        <dt>In plain English</dt><dd>{info.plain(n)}</dd>
        <dt>Its role</dt><dd>{info.role}{parent && asChild && <> Here it is <strong>{asChild}</strong> of the {parent.kind} above it.</>}</dd>
        <dt>Children</dt>
        <dd>
          {n.children.length ? (
            <ul className="hint-list">
              {n.children.map((c, i) => (
                <li key={i}>
                  <button className="linklike" onClick={() => onSelect(c, `${sel.path}/${i}`)}>{c.kind}{c.name ? ` ${c.name}` : c.op ? ` ${c.op}` : c.value ? ` ${c.value}` : ""}</button>
                  {info.childRole(n, i) && <span className="muted"> — {info.childRole(n, i)}</span>}
                </li>
              ))}
            </ul>
          ) : "none (a leaf)"}
        </dd>
        <dt>Source code</dt>
        <dd>
          <div className="tiny muted">from line {n.span.start.line}, column {n.span.start.column} to line {n.span.end.line}, column {n.span.end.column}</div>
          {text ? <pre className="code-block" style={{ maxHeight: 140, marginTop: 4 }}>{text.length > 400 ? text.slice(0, 400) + " …" : text}</pre> : <span className="faint">empty span</span>}
        </dd>
        <dt>After repair</dt>
        <dd>{change ? <><Badge tone={change.change === "added" ? "success" : change.change === "removed" ? "danger" : "warning"} icon={false}>{change.change}</Badge> {change.detail || change.after || change.before}</> : compare?.comparable ? "unchanged in the last comparison" : <span className="faint">run a comparison in “Before &amp; after” to see changes</span>}</dd>
        {shown.kind === "recovered" && n.kind !== "Error" && <><dt>Note</dt><dd className="small">Part of a partial tree built during error recovery; it may not match what you meant.</dd></>}
      </dl>
      <Disclosure summary="Technical details">
        <dl className="kv">
          <dt>Kind</dt><dd className="mono">{n.kind}</dd>
          {(["type", "name", "op", "value", "array"] as const).map((k) => (n[k] ? <span key={k} style={{ display: "contents" }}><dt>{k}</dt><dd className="mono">{n[k]}</dd></span> : null))}
          <dt>Byte offsets</dt><dd className="mono">{n.span.start.offset}–{n.span.end.offset}</dd>
          <dt>Subtree</dt><dd>{countNodes(n)} nodes</dd>
          <dt>Path</dt><dd className="mono tiny">{sel.path}</dd>
        </dl>
      </Disclosure>
    </Panel>
  );
}

function ComparePane({ onResult }: { onResult: (r: CompareResult | null) => void }) {
  const p = useProject();
  const choices = useMemo(() => {
    const out: { id: string; label: string; source: string }[] = [{ id: "current", label: "Current editor source", source: p.source }];
    if (p.baseline !== p.source) out.push({ id: "baseline", label: "Source as loaded", source: p.baseline });
    if (p.history.length) out.push({ id: "before-repair", label: "Before last accepted repair", source: p.history[p.history.length - 1].source });
    const r = p.repair?.envelope.data.repair;
    r?.decision.plans.forEach((pl, i) => out.push({ id: `plan${i}`, label: `Plan #${i + 1}: ${pl.summary}`, source: pl.source }));
    r?.candidates.slice(0, 10).forEach((c) => {
      if (c.valid) out.push({ id: `cand${c.id}`, label: `Candidate #${c.rank}: ${c.summary}`, source: c.source });
    });
    return out;
  }, [p.source, p.baseline, p.history, p.repair]);
  // Sensible defaults: two valid repairs of invalid code are structurally comparable; code with errors is not.
  const currentValid = !!(p.parse && p.parse.source === p.source && p.parse.envelope.data.parse.ok);
  const validPlans = (p.repair?.envelope.data.repair.decision.plans ?? []).map((pl, i) => ({ pl, i })).filter((x) => x.pl.valid);
  const [defA, defB] = p.history.length && currentValid ? ["before-repair", "current"]
    : !currentValid && validPlans.length >= 2 ? [`plan${validPlans[0].i}`, `plan${validPlans[1].i}`]
    : ["current", (choices.find((c) => c.id === "plan0") ?? choices[1] ?? choices[0]).id];
  const [a, setA] = useState(defA);
  const [b, setB] = useState(defB);
  const [res, setRes] = useState<CompareResult | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = (id: string) => choices.find((c) => c.id === id);

  const run = async () => {
    const A = pick(a), B = pick(b);
    if (!A || !B) return;
    setBusy(true);
    setErr(null);
    try {
      const r = (await api.compare(A.source, B.source)).data;
      setRes(r);
      onResult(r);
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError("BACKEND_FAILURE", String(e)));
    } finally {
      setBusy(false);
    }
  };

  const before = new Map<string, Mark>(), after = new Map<string, Mark>();
  if (res?.comparable) for (const c of res.changes) {
    const kind = c.path.split("/").pop()!.replace(/\[\d+\]$/, "");
    if (c.before_span && c.change !== "added") before.set(markKey(kind, c.before_span), c.change as Mark);
    if (c.after_span && c.change !== "removed") after.set(markKey(kind, c.after_span), c.change as Mark);
  }

  return (
    <div className="stack">
      <p className="small muted">Both programs are parsed again by the compiler; the comparison aligns the two real ASTs and reports nodes that were added, removed or changed. Marks appear in the trees below and in the Explained tree.</p>
      <div className="grid grid-2">
        <label className="stack small">Before
          <select className="select" value={a} onChange={(e) => setA(e.target.value)}>{choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        </label>
        <label className="stack small">After
          <select className="select" value={b} onChange={(e) => setB(e.target.value)}>{choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        </label>
      </div>
      <div><button className="btn primary sm" onClick={run} disabled={busy}><GitCompare size={13} aria-hidden /> Compare ASTs</button></div>
      {choices.length < 2 && <p className="tiny faint">Run Analyze or accept a repair to get more programs to compare.</p>}
      {busy && <Spinner />}
      {err && <ErrorBanner error={err} onRetry={run} />}
      {res && (
        <div className="stack">
          {!res.comparable ? (
            <>
              <Banner tone="warning" title="No node-by-node comparison: at least one side has syntax errors">
                A program with syntax errors has no complete AST, so IntelliFix will not claim which nodes changed. {[...res.before.diagnostics, ...res.after.diagnostics].slice(0, 2).join(" · ")}
                {validPlans.length >= 2 && " Tip: compare two repairs (Plan #1 vs Plan #2) to see how the alternatives differ structurally."}
              </Banner>
              {(() => {
                const A = pick(a);
                const partial = p.parse && A && p.parse.source === A.source ? p.parse.envelope.data.parse.recovered_ast : null;
                return partial && res.after.ast ? (
                  <div className="grid grid-2">
                    <div className="stack"><strong className="small">Before: partial tree of the code with errors</strong><span className="tiny muted">from error recovery; Error nodes mark skipped text</span><AstTree root={partial} expandDepth={3} plainTitles={false} /></div>
                    <div className="stack"><strong className="small">After: complete AST</strong><span className="tiny muted">the real AST of the repaired program</span><AstTree root={res.after.ast} expandDepth={3} plainTitles={false} /></div>
                  </div>
                ) : null;
              })()}
            </>
          ) : res.equivalent ? (
            <Banner tone="success" title="Structurally identical">Same canonical AST (hash {res.after.ast_hash}). The programs may differ only in spacing, comments or redundant parentheses.</Banner>
          ) : (
            <Banner tone="info" title={`${res.changes.length} structural change(s)`}>
              {res.changes.filter((c) => c.change === "added").length} added · {res.changes.filter((c) => c.change === "removed").length} removed · {res.changes.filter((c) => c.change === "changed").length} changed.
            </Banner>
          )}
          {res.changes.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Change</th><th>Where</th><th>Before</th><th>After</th></tr></thead>
                <tbody>
                  {res.changes.map((c, i) => (
                    <tr key={i}>
                      <td><Badge tone={c.change === "added" ? "success" : c.change === "removed" ? "danger" : "warning"} icon={false}>{c.change}</Badge></td>
                      <td className="mono tiny" title={c.path}>…/{c.path.split("/").slice(-2).join("/")}<div className="faint">{(c.after_span ?? c.before_span) ? `line ${(c.after_span ?? c.before_span)!.start.line}` : ""}</div></td>
                      <td className="mono small">{c.before ?? "—"}</td>
                      <td className="mono small">{c.after ?? "—"}{c.detail && <div className="tiny muted">{c.detail}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {res.comparable && (
            <div className="grid grid-2">
              <div className="stack"><strong className="small">Before</strong>{res.before.ast && <AstTree root={res.before.ast} expandDepth={2} marks={before} plainTitles={false} />}</div>
              <div className="stack"><strong className="small">After</strong>{res.after.ast && <AstTree root={res.after.ast} expandDepth={2} marks={after} plainTitles={false} />}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { findByPath };
